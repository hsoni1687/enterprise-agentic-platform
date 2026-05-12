package dispatch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/agent-platform/go-shared/pkg/models"
	"github.com/agent-platform/hook-engine/pkg/hooks"
)

// InvokeStatus values returned in InvokeResponse.
const (
	StatusCompleted    = "completed"
	StatusAwaitingHITL = "awaiting_hitl"
)

// InvokeRequest is the payload sent to POST /api/v1/skills/{name}/invoke.
type InvokeRequest struct {
	Version  string         `json:"version"`
	Args     map[string]any `json:"args,omitempty"`
	AgentID  string         `json:"agent_id"`
	TenantID string         `json:"tenant_id"`
	TraceID  string         `json:"trace_id"`
}

// ToolInvokeRequest is the payload sent to POST /api/v1/tools/invoke.
type ToolInvokeRequest struct {
	Tool               models.ToolRef `json:"tool"`
	Args               map[string]any `json:"args,omitempty"`
	AgentID            string         `json:"agent_id"`
	TenantID           string         `json:"tenant_id"`
	TraceID            string         `json:"trace_id,omitempty"`
	Mutating           bool           `json:"mutating"`
	HITLApprovalID     string         `json:"hitl_approval_id,omitempty"`
}

// InvokeResponse is returned after skill dispatch completes or is suspended.
type InvokeResponse struct {
	Status string `json:"status"`
	Result any    `json:"result,omitempty"`
	// HITLWorkflowID is populated when Status == StatusAwaitingHITL.
	HITLWorkflowID string `json:"hitl_workflow_id,omitempty"`
}

// SkillCatalog resolves skill manifests by name and tenant.
type SkillCatalog interface {
	Get(name, tenantID string) (*models.SkillManifest, bool)
}

// ToolRouter routes a tool invocation to its executor and returns the result.
type ToolRouter interface {
	Route(ctx context.Context, tool models.ToolRef, args map[string]any) (any, error)
}

// WorkflowStarter begins a workflow on the workflow-initiator service.
type WorkflowStarter interface {
	Start(ctx context.Context, agentID, tenantID string, args map[string]any) (workflowID string, result any, err error)
}

// Dispatcher orchestrates skill invocation: catalog lookup → pre-hooks → agent/tool routing → post-hooks.
type Dispatcher struct {
	catalog  SkillCatalog
	engine   *hooks.Engine
	router   ToolRouter
	workflows WorkflowStarter
}

func New(catalog SkillCatalog, engine *hooks.Engine, router ToolRouter, workflows WorkflowStarter) *Dispatcher {
	return &Dispatcher{catalog: catalog, engine: engine, router: router, workflows: workflows}
}

// BuildMux registers skill dispatcher routes on a new ServeMux.
func BuildMux(d *Dispatcher) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("skill-dispatcher healthy\n"))
	})
	mux.HandleFunc("POST /api/v1/skills/{name}/invoke", d.handleInvoke)
	mux.HandleFunc("POST /api/v1/tools/invoke", d.handleToolInvoke)
	return mux
}

func (d *Dispatcher) handleInvoke(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}

	skillName := r.PathValue("name")

	var req InvokeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	req.TenantID = tenantID

	skill, ok := d.catalog.Get(skillName, tenantID)
	if !ok {
		// Fall back to system skills (platform-system tenant)
		skill, ok = d.catalog.Get(skillName, "platform-system")
		if !ok {
			http.Error(w, fmt.Sprintf("skill %q not found", skillName), http.StatusNotFound)
			return
		}
	}

	hctx := hooks.HookContext{
		Phase:        hooks.PhasePre,
		TenantID:     tenantID,
		AgentID:      req.AgentID,
		SkillName:    skill.Name,
		SkillVersion: skill.Version,
		TraceID:      req.TraceID,
		Timestamp:    time.Now(),
		Args:         req.Args,
	}
	// Expose mutating flag so HITL hooks can inspect it.
	if hctx.Args == nil {
		hctx.Args = map[string]any{}
	}
	hctx.Args["__mutating"] = skill.Mutating

	result, _ := d.engine.Fire(r.Context(), hctx)
	if result.Halt {
		writeJSON(w, http.StatusAccepted, InvokeResponse{
			Status:         StatusAwaitingHITL,
			HITLWorkflowID: "",
		})
		return
	}

	var execResult any
	var execErr error

	// Route to agent (if agent_id set) or tools.
	if skill.AgentID != "" {
		_, execResult, execErr = d.workflows.Start(r.Context(), skill.AgentID, tenantID, req.Args)
	} else {
		// Execute all tools in the skill's tool chain sequentially.
		for _, tool := range skill.Tools {
			execResult, execErr = d.router.Route(r.Context(), tool, req.Args)
			if execErr != nil {
				break
			}
		}
	}

	if execErr != nil {
		http.Error(w, fmt.Sprintf("skill execution failed: %v", execErr), http.StatusInternalServerError)
		return
	}

	// Fire post-hooks (non-blocking: errors are logged but don't fail the response).
	postCtx := hctx
	postCtx.Phase = hooks.PhasePost
	postCtx.Result = map[string]any{"output": execResult}
	d.engine.Fire(context.Background(), postCtx)

	writeJSON(w, http.StatusOK, InvokeResponse{
		Status: StatusCompleted,
		Result: execResult,
	})
}

func (d *Dispatcher) handleToolInvoke(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}

	var req ToolInvokeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Tool.Name == "" {
		http.Error(w, "tool name required", http.StatusBadRequest)
		return
	}

	req.TenantID = tenantID

	hctx := hooks.HookContext{
		Phase:        hooks.PhasePre,
		TenantID:     tenantID,
		AgentID:      req.AgentID,
		SkillName:    req.Tool.Name,
		SkillVersion: req.Tool.Version,
		TraceID:      req.TraceID,
		Timestamp:    time.Now(),
		Args:         req.Args,
	}
	if hctx.Args == nil {
		hctx.Args = map[string]any{}
	}
	hctx.Args["__mutating"] = req.Mutating

	// Bypass HITL gate when a prior approval is attached
	if req.HITLApprovalID != "" {
		ctx := context.WithValue(r.Context(), "tenant_id", tenantID)
		execResult, execErr := d.router.Route(ctx, req.Tool, req.Args)
		if execErr != nil {
			http.Error(w, fmt.Sprintf("tool execution failed: %v", execErr), http.StatusInternalServerError)
			return
		}
		postCtx := hctx
		postCtx.Phase = hooks.PhasePost
		postCtx.Result = map[string]any{"output": execResult}
		d.engine.Fire(context.Background(), postCtx)
		writeJSON(w, http.StatusOK, InvokeResponse{Status: StatusCompleted, Result: execResult})
		return
	}

	result, _ := d.engine.Fire(r.Context(), hctx)
	if result.Halt {
		// Create HITL approval workflow
		hitlArgs := map[string]any{
			"tool_name":     req.Tool.Name,
			"tool_version":  req.Tool.Version,
			"tool_args":     req.Args,
			"agent_id":      req.AgentID,
			"reason":        result.Message,
		}
		hitlWorkflowID, _, _ := d.workflows.Start(r.Context(), "hitl-approver", tenantID, hitlArgs)

		writeJSON(w, http.StatusAccepted, InvokeResponse{
			Status:         StatusAwaitingHITL,
			HITLWorkflowID: hitlWorkflowID,
		})
		return
	}

	// Pass tenant ID through context for tools that need multi-tenant isolation (KG tools)
	ctx := context.WithValue(r.Context(), "tenant_id", tenantID)
	execResult, execErr := d.router.Route(ctx, req.Tool, req.Args)
	if execErr != nil {
		http.Error(w, fmt.Sprintf("tool execution failed: %v", execErr), http.StatusInternalServerError)
		return
	}

	postCtx := hctx
	postCtx.Phase = hooks.PhasePost
	postCtx.Result = map[string]any{"output": execResult}
	d.engine.Fire(context.Background(), postCtx)

	writeJSON(w, http.StatusOK, InvokeResponse{
		Status: StatusCompleted,
		Result: execResult,
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// --- InMemoryCatalog ---

// InMemoryCatalog is a map-backed SkillCatalog for tests and local dev.
type InMemoryCatalog struct {
	skills map[string]*models.SkillManifest
}

func NewInMemoryCatalog() *InMemoryCatalog {
	return &InMemoryCatalog{skills: make(map[string]*models.SkillManifest)}
}

func (c *InMemoryCatalog) Register(s *models.SkillManifest) {
	c.skills[catalogKey(s.Name, s.TenantID)] = s
}

func (c *InMemoryCatalog) Get(name, tenantID string) (*models.SkillManifest, bool) {
	s, ok := c.skills[catalogKey(name, tenantID)]
	return s, ok
}

func catalogKey(name, tenantID string) string {
	return tenantID + "/" + name
}

// --- MockToolRouter ---

// MockToolRouter returns a predetermined result for every tool call. Used in tests.
type MockToolRouter struct {
	result any
}

func NewMockToolRouter(result any) *MockToolRouter {
	return &MockToolRouter{result: result}
}

func (m *MockToolRouter) Route(_ context.Context, _ models.ToolRef, _ map[string]any) (any, error) {
	return m.result, nil
}

// MockWorkflowStarter returns a predetermined result for every workflow start. Used in tests.
type MockWorkflowStarter struct {
	result any
}

func NewMockWorkflowStarter(result any) *MockWorkflowStarter {
	return &MockWorkflowStarter{result: result}
}

func (m *MockWorkflowStarter) Start(_ context.Context, _, _ string, _ map[string]any) (string, any, error) {
	return "mock-workflow-id", m.result, nil
}

// --- HTTPToolRouter ---

// ToolExecutorRouter routes tools to specialized executors based on tool name
type ToolExecutorRouter struct {
	client     *http.Client
	routes     map[string]string // tool name -> executor URL
	defaultURL string
}

func NewToolExecutorRouter() *ToolExecutorRouter {
	bashExecutorURL := os.Getenv("BASH_EXECUTOR_URL")
	if bashExecutorURL == "" {
		bashExecutorURL = "http://localhost:8092"
	}

	sandboxManagerURL := os.Getenv("SANDBOX_MANAGER_URL")
	if sandboxManagerURL == "" {
		sandboxManagerURL = "http://localhost:8082"
	}

	kgServiceURL := os.Getenv("KG_SERVICE_URL")
	if kgServiceURL == "" {
		kgServiceURL = "http://localhost:8093"
	}

	return &ToolExecutorRouter{
		client: &http.Client{Timeout: 5 * time.Minute},
		routes: map[string]string{
			"bash":  bashExecutorURL,
			"kg":    kgServiceURL,
		},
		defaultURL: sandboxManagerURL,
	}
}

func (r *ToolExecutorRouter) Route(ctx context.Context, tool models.ToolRef, args map[string]any) (any, error) {
	log.Printf("[Route] tool.Name=%s | len=%d | first3=%s", tool.Name, len(tool.Name), tool.Name[:min(3, len(tool.Name))])

	// Route bash tool to bash-executor
	if tool.Name == "bash" {
		log.Printf("[Route] Routing to bash-executor")
		return r.executeBash(ctx, tool, args)
	}

	// Route kg-* tools to kg-service
	if len(tool.Name) > 3 && tool.Name[:3] == "kg-" {
		log.Printf("[Route] Routing to kg-service (executeKG)")
		return r.executeKG(ctx, tool, args)
	}

	// Route other tools to sandbox-manager
	log.Printf("[Route] Routing to sandbox-manager")
	return r.executeSandbox(ctx, tool, args)
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (r *ToolExecutorRouter) executeBash(ctx context.Context, tool models.ToolRef, args map[string]any) (any, error) {
	url := r.routes["bash"]

	payload := map[string]any{
		"script":       args["script"],
		"timeout_seconds": args["timeout_seconds"],
		"environment":  args["environment"],
		"working_dir":  args["working_dir"],
		"execution_id": fmt.Sprintf("exec-%d", time.Now().UnixNano()),
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url+"/api/v1/execute", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build bash request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("execute bash tool: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errMsg string
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			errMsg = fmt.Sprintf("bash tool returned %d (client error)", resp.StatusCode)
		} else {
			errMsg = fmt.Sprintf("bash executor failed: %d", resp.StatusCode)
		}
		return nil, fmt.Errorf(errMsg)
	}

	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode bash result: %w", err)
	}
	return result, nil
}

func (r *ToolExecutorRouter) executeSandbox(ctx context.Context, tool models.ToolRef, args map[string]any) (any, error) {
	// Determine endpoint based on tool name
	endpoint := "/api/v1/execute"
	switch tool.Name {
	case "web-search":
		endpoint = "/api/v1/web-search"
	case "web-fetch":
		endpoint = "/api/v1/web-fetch"
	}

	payload := map[string]any{"args": args}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.defaultURL+endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("execute tool %s: %w", tool.Name, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("tool %s returned %d", tool.Name, resp.StatusCode)
	}

	var result map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode tool response: %w", err)
	}
	return result, nil
}

func (r *ToolExecutorRouter) executeKG(ctx context.Context, tool models.ToolRef, args map[string]any) (any, error) {
	kgServiceURL := r.routes["kg"]

	// Map KG tool names to KG service endpoints
	var endpoint string
	switch tool.Name {
	case "kg-create-graph":
		endpoint = "/graphs/create"
	case "kg-add-node":
		endpoint = "/nodes/create"
	case "kg-add-edge":
		endpoint = "/edges/create"
	case "kg-query":
		endpoint = "/query"
	case "kg-search":
		endpoint = "/search/nodes"
	default:
		return nil, fmt.Errorf("unknown kg tool: %s", tool.Name)
	}

	body, _ := json.Marshal(args)
	log.Printf("[executeKG %s] URL: %s%s | body: %s", tool.Name, kgServiceURL, endpoint, string(body))

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, kgServiceURL+endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build kg request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	// KG service requires X-Tenant-ID header, extracted from context
	if tenantID, ok := ctx.Value("tenant_id").(string); ok {
		req.Header.Set("X-Tenant-ID", tenantID)
		log.Printf("[executeKG %s] Tenant-ID: %s", tool.Name, tenantID)
	}

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("execute kg tool %s: %w", tool.Name, err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	log.Printf("[executeKG %s] Response status: %d | body (first 300 chars): %.300s", tool.Name, resp.StatusCode, string(respBody))
	log.Printf("[executeKG %s] Full response body: %s", tool.Name, string(respBody))

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		errMsg := string(respBody)
		if errMsg == "" {
			errMsg = fmt.Sprintf("status code %d", resp.StatusCode)
		}
		return nil, fmt.Errorf("kg tool %s returned %d: %s", tool.Name, resp.StatusCode, errMsg)
	}

	// For operations that return no content, return success
	if resp.StatusCode == http.StatusNoContent {
		return map[string]any{"status": "success"}, nil
	}

	var result any
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decode kg response: %w", err)
	}
	log.Printf("[executeKG %s] Parsed result type: %T | value: %+v", tool.Name, result, result)
	return result, nil
}

// --- HTTPWorkflowStarter ---

// HTTPWorkflowStarter starts workflows via the workflow-initiator service.
type HTTPWorkflowStarter struct {
	baseURL string
	client  *http.Client
}

func NewHTTPWorkflowStarter(baseURL string) *HTTPWorkflowStarter {
	return &HTTPWorkflowStarter{
		baseURL: baseURL,
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

func (w *HTTPWorkflowStarter) Start(ctx context.Context, agentID, tenantID string, args map[string]any) (string, any, error) {
	prompt := ""
	if p, ok := args["prompt"].(string); ok {
		prompt = p
	}

	req := models.StartSessionRequest{
		AgentID:   agentID,
		TenantID:  tenantID,
		SessionID: fmt.Sprintf("skill-sess-%d", time.Now().UnixMilli()),
		Prompt:    prompt,
	}
	body, _ := json.Marshal(req)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, w.baseURL+"/api/v1/sessions", bytes.NewReader(body))
	if err != nil {
		return "", nil, fmt.Errorf("build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := w.client.Do(httpReq)
	if err != nil {
		return "", nil, fmt.Errorf("start workflow: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return "", nil, fmt.Errorf("workflow start returned %d", resp.StatusCode)
	}

	var session models.SessionStatus
	if err := json.NewDecoder(resp.Body).Decode(&session); err != nil {
		return "", nil, fmt.Errorf("decode session response: %w", err)
	}

	result := map[string]any{
		"workflow_id": session.WorkflowID,
		"run_id":      session.RunID,
		"status":      session.Status,
	}
	return session.WorkflowID, result, nil
}
