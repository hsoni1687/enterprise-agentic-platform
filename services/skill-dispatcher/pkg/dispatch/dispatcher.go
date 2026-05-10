package dispatch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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
		http.Error(w, fmt.Sprintf("skill %q not found", skillName), http.StatusNotFound)
		return
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

	return &ToolExecutorRouter{
		client: &http.Client{Timeout: 5 * time.Minute},
		routes: map[string]string{
			"bash": bashExecutorURL,
		},
		defaultURL: sandboxManagerURL,
	}
}

func (r *ToolExecutorRouter) Route(ctx context.Context, tool models.ToolRef, args map[string]any) (any, error) {
	// Route bash tool to bash-executor
	if tool.Name == "bash" {
		return r.executeBash(ctx, tool, args)
	}

	// Route other tools to sandbox-manager
	return r.executeSandbox(ctx, tool, args)
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
	payload := map[string]any{"tool": tool.Name, "version": tool.Version, "args": args}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.defaultURL+"/api/v1/execute", bytes.NewReader(body))
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
