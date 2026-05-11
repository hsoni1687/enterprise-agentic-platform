package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/agent-platform/go-shared/pkg/models"
	enumspb "go.temporal.io/api/enums/v1"
	workflowservice "go.temporal.io/api/workflowservice/v1"
	"go.temporal.io/sdk/client"
)

type cachedManifest struct {
	manifest  *models.AgentManifest
	expiresAt time.Time
}

var (
	manifestStore      sync.Map
	registryHTTPClient = &http.Client{
		Timeout: 5 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
		},
	}
	manifestTTL = 5 * time.Minute
)

// EncodedQueryValue wraps a Temporal query result so it can be decoded into a Go value.
type EncodedQueryValue interface {
	Get(valuePtr interface{}) error
}

// TemporalClient defines the subset of Temporal client methods used by this service.
type TemporalClient interface {
	ExecuteWorkflow(ctx context.Context, options client.StartWorkflowOptions, workflow interface{}, args ...interface{}) (client.WorkflowRun, error)
	DescribeWorkflowExecution(ctx context.Context, workflowID, runID string) (*workflowservice.DescribeWorkflowExecutionResponse, error)
	QueryWorkflow(ctx context.Context, workflowID, runID, queryType string, args ...interface{}) (EncodedQueryValue, error)
	SignalWorkflow(ctx context.Context, workflowID, runID, signalName string, arg interface{}) error
}

// realTemporalClient wraps the Temporal SDK client to satisfy TemporalClient.
type realTemporalClient struct{ c client.Client }

func (r *realTemporalClient) ExecuteWorkflow(ctx context.Context, options client.StartWorkflowOptions, workflow interface{}, args ...interface{}) (client.WorkflowRun, error) {
	return r.c.ExecuteWorkflow(ctx, options, workflow, args...)
}

func (r *realTemporalClient) DescribeWorkflowExecution(ctx context.Context, workflowID, runID string) (*workflowservice.DescribeWorkflowExecutionResponse, error) {
	return r.c.DescribeWorkflowExecution(ctx, workflowID, runID)
}

func (r *realTemporalClient) QueryWorkflow(ctx context.Context, workflowID, runID, queryType string, args ...interface{}) (EncodedQueryValue, error) {
	return r.c.QueryWorkflow(ctx, workflowID, runID, queryType, args...)
}

func (r *realTemporalClient) SignalWorkflow(ctx context.Context, workflowID, runID, signalName string, arg interface{}) error {
	return r.c.SignalWorkflow(ctx, workflowID, runID, signalName, arg)
}

var temporalClient TemporalClient

// InitTemporalClient initializes the shared Temporal client.
func InitTemporalClient() error {
	hostPort := os.Getenv("TEMPORAL_HOSTPORT")
	if hostPort == "" {
		hostPort = "localhost:7233"
	}
	c, err := client.Dial(client.Options{HostPort: hostPort})
	if err != nil {
		return fmt.Errorf("unable to create temporal client: %w", err)
	}
	temporalClient = &realTemporalClient{c}
	log.Printf("Connected to Temporal at %s", hostPort)
	return nil
}

// SetTemporalClient allows injecting a mock client in tests.
func SetTemporalClient(c TemporalClient) { temporalClient = c }

// SendWorkflowSignal sends a Temporal signal to the given workflow.
func SendWorkflowSignal(workflowID, signalName string, payload interface{}) error {
	if temporalClient == nil {
		return fmt.Errorf("temporal client not initialized")
	}
	return temporalClient.SignalWorkflow(context.Background(), workflowID, "", signalName, payload)
}

// HandleStartSession dispatches a new AgentWorkflow to Temporal.
// If the request does not include a manifest, it fetches it from the agent-registry.
func HandleStartSession(w http.ResponseWriter, r *http.Request) {
	var req models.StartSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.AgentID == "" {
		http.Error(w, "agent_id is required", http.StatusBadRequest)
		return
	}
	if temporalClient == nil {
		http.Error(w, "Temporal client not connected", http.StatusServiceUnavailable)
		return
	}

	// Fetch manifest from agent-registry when not supplied by caller.
	log.Printf("[INITIATOR] Received request: agent_id=%s, tenant_id=%s, manifest_provided=%v",
		req.AgentID, req.TenantID, req.Manifest != nil)

	if req.Manifest == nil {
		log.Printf("[INITIATOR] Manifest not provided, fetching from registry for agent_id=%s, tenant_id=%s",
			req.AgentID, req.TenantID)
		if manifest := fetchManifest(r.Context(), req.AgentID, req.TenantID); manifest != nil {
			log.Printf("[INITIATOR] Manifest fetched successfully: model=%s, system_prompt_len=%d, max_iterations=%d",
				manifest.Model, len(manifest.SystemPrompt), manifest.MaxIterations)
			req.Manifest = manifest
		} else {
			log.Printf("[INITIATOR] Failed to fetch manifest, using nil (workflow will use defaults)")
		}
	} else {
		log.Printf("[INITIATOR] Manifest provided in request: model=%s, system_prompt_len=%d",
			req.Manifest.Model, len(req.Manifest.SystemPrompt))
	}

	taskQueue := "agent-task-queue"
	if req.TenantID != "" {
		taskQueue = fmt.Sprintf("%s-agent-queue", req.TenantID)
	}

	workflowOptions := client.StartWorkflowOptions{
		ID:        fmt.Sprintf("agent-wf-%s-%s", req.AgentID, req.SessionID),
		TaskQueue: taskQueue,
	}

	we, err := temporalClient.ExecuteWorkflow(context.Background(), workflowOptions, "AgentWorkflow", req)
	if err != nil {
		log.Printf("Failed to dispatch workflow: %v", err)
		http.Error(w, fmt.Sprintf("Failed to dispatch workflow: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("Started workflow: ID=%s, RunID=%s", we.GetID(), we.GetRunID())

	resp := models.SessionStatus{
		WorkflowID: we.GetID(),
		RunID:      we.GetRunID(),
		Status:     "RUNNING",
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(resp)
}

// HandleGetSessionStatus returns the current execution status of a workflow.
func HandleGetSessionStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "workflow id is required", http.StatusBadRequest)
		return
	}
	if temporalClient == nil {
		http.Error(w, "Temporal client not connected", http.StatusServiceUnavailable)
		return
	}

	desc, err := temporalClient.DescribeWorkflowExecution(context.Background(), id, "")
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to describe workflow: %v", err), http.StatusInternalServerError)
		return
	}

	resp := models.SessionStatus{
		WorkflowID: id,
		Status:     mapTemporalStatus(desc.WorkflowExecutionInfo.Status),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// HandleGetSessionEvents queries the workflow for its accumulated events list and
// returns events starting at the index given by the ?from= query parameter.
func HandleGetSessionEvents(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	log.Printf("[REST_API] HandleGetSessionEvents called for workflow_id=%s", id)
	if id == "" {
		http.Error(w, "workflow id is required", http.StatusBadRequest)
		return
	}
	if temporalClient == nil {
		http.Error(w, "Temporal client not connected", http.StatusServiceUnavailable)
		return
	}

	from := 0
	if s := r.URL.Query().Get("from"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			from = n
		}
	}

	val, err := temporalClient.QueryWorkflow(r.Context(), id, "", "get_events")
	if err != nil {
		// Workflow not yet running or query not registered — return empty.
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]models.AgentEvent{})
		return
	}

	var all []models.AgentEvent
	if err := val.Get(&all); err != nil || from >= len(all) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]models.AgentEvent{})
		return
	}

	// Debug: log approval events
	for i, ev := range all {
		if ev.Type == "approval" {
			log.Printf("[REST_EVENTS] Event %d: Type=%s, ApprovalID=%s, Reason=%s, ToolName=%s",
				i, ev.Type, ev.ApprovalID, ev.Reason, ev.ToolName)
			// Also marshal to see JSON representation
			data, _ := json.Marshal(ev)
			log.Printf("[REST_EVENTS] Event %d JSON: %s", i, string(data))
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(all[from:])
}

// HandlePollSession returns both events (from cursor) and workflow status in a single response.
func HandlePollSession(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	log.Printf("[REST_API] HandlePollSession called for workflow_id=%s", id)
	if id == "" {
		http.Error(w, "workflow id is required", http.StatusBadRequest)
		return
	}
	if temporalClient == nil {
		http.Error(w, "Temporal client not connected", http.StatusServiceUnavailable)
		return
	}

	from := 0
	if s := r.URL.Query().Get("from"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			from = n
		}
	}

	// Query events
	val, err := temporalClient.QueryWorkflow(r.Context(), id, "", "get_events")
	events := []models.AgentEvent{}
	if err == nil {
		var all []models.AgentEvent
		if err := val.Get(&all); err == nil {
			log.Printf("[POLL_DEBUG] Got %d total events, from=%d", len(all), from)
			if from < len(all) {
				events = all[from:]
				log.Printf("[POLL_DEBUG] Returning %d events from index %d", len(events), from)
				// Log what we're returning
				for i, ev := range events {
					log.Printf("[POLL_DEBUG] Event %d: Type=%s, ApprovalID='%s'", i, ev.Type, ev.ApprovalID)
					if ev.Type == "approval" {
						log.Printf("[POLL_RETURN] Approval event at index %d: Type=%s, ApprovalID=%s, Reason=%s",
							from+i, ev.Type, ev.ApprovalID, ev.Reason)
						data, _ := json.Marshal(ev)
						log.Printf("[POLL_RETURN] JSON: %s", string(data))
					}
				}
			}
		} else {
			log.Printf("[POLL_DEBUG] Error unmarshalling events: %v", err)
		}
	} else {
		log.Printf("[POLL_DEBUG] Query error: %v", err)
	}

	// Query status
	desc, err := temporalClient.DescribeWorkflowExecution(context.Background(), id, "")
	status := "UNKNOWN"
	if err == nil {
		status = mapTemporalStatus(desc.WorkflowExecutionInfo.Status)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(models.PollResponse{
		Events: events,
		Status: status,
	})
}

// HandleHealth returns service health.
func HandleHealth(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "Workflow Initiator is healthy\n")
}

// fetchManifest retrieves the AgentManifest for agentID, using a cache with TTL.
func fetchManifest(ctx context.Context, agentID, tenantID string) *models.AgentManifest {
	cacheKey := agentID
	if tenantID != "" {
		cacheKey = fmt.Sprintf("%s:%s", tenantID, agentID)
	}

	// Check cache
	if cached, ok := manifestStore.Load(cacheKey); ok {
		cm := cached.(cachedManifest)
		if time.Now().Before(cm.expiresAt) {
			log.Printf("[FETCH_MANIFEST] Cache hit for key=%s, model=%s", cacheKey, cm.manifest.Model)
			return cm.manifest
		}
		log.Printf("[FETCH_MANIFEST] Cache expired for key=%s, refetching", cacheKey)
	}

	// Cache miss or expired — fetch from registry
	registryURL := os.Getenv("AGENT_REGISTRY_URL")
	if registryURL == "" {
		registryURL = "http://localhost:8088"
	}

	url := fmt.Sprintf("%s/api/v1/agents/%s", registryURL, agentID)
	log.Printf("[FETCH_MANIFEST] Fetching from %s (tenant=%s)", url, tenantID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		log.Printf("[FETCH_MANIFEST] Request creation failed: %v", err)
		return nil
	}
	if tenantID != "" {
		req.Header.Set("X-Tenant-ID", tenantID)
	}

	resp, err := registryHTTPClient.Do(req)
	if err != nil {
		log.Printf("[FETCH_MANIFEST] HTTP request failed: %v", err)
		return nil
	}
	if resp.StatusCode != http.StatusOK {
		log.Printf("[FETCH_MANIFEST] Registry returned status %d", resp.StatusCode)
		resp.Body.Close()
		return nil
	}
	defer resp.Body.Close()

	var manifest models.AgentManifest
	if err := json.NewDecoder(resp.Body).Decode(&manifest); err != nil {
		log.Printf("[FETCH_MANIFEST] JSON decode failed: %v", err)
		return nil
	}

	log.Printf("[FETCH_MANIFEST] Successfully fetched: model=%s, system_prompt_len=%d, max_iterations=%d",
		manifest.Model, len(manifest.SystemPrompt), manifest.MaxIterations)

	// Store in cache with TTL
	manifestStore.Store(cacheKey, cachedManifest{
		manifest:  &manifest,
		expiresAt: time.Now().Add(manifestTTL),
	})

	return &manifest
}

func mapTemporalStatus(s enumspb.WorkflowExecutionStatus) string {
	switch s {
	case enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING:
		return "RUNNING"
	case enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED:
		return "COMPLETED"
	case enumspb.WORKFLOW_EXECUTION_STATUS_FAILED:
		return "FAILED"
	case enumspb.WORKFLOW_EXECUTION_STATUS_CANCELED:
		return "CANCELED"
	case enumspb.WORKFLOW_EXECUTION_STATUS_TIMED_OUT:
		return "TIMED_OUT"
	case enumspb.WORKFLOW_EXECUTION_STATUS_TERMINATED:
		return "TERMINATED"
	default:
		return "UNKNOWN"
	}
}

// HandleStoreHITLApproval POST /api/v1/approvals - stores a pending HITL approval
func HandleStoreHITLApproval(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}

	var req struct {
		WorkflowID string                 `json:"workflow_id"`
		AgentID    string                 `json:"agent_id"`
		ToolName   string                 `json:"tool_name"`
		ToolArgs   map[string]interface{} `json:"tool_args"`
		Reason     string                 `json:"reason"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	approvalID := StoreHITLApproval(req.WorkflowID, req.AgentID, tenantID, req.ToolName, req.Reason, req.ToolArgs)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"approval_id": approvalID})
}
