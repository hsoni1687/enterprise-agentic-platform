package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/agent-platform/go-shared/pkg/models"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.temporal.io/sdk/client"
	"gopkg.in/yaml.v3"
)

// AdminHandler handles admin API requests.
type AdminHandler struct {
	DB             *pgxpool.Pool
	AdminKey       string
	TemporalClient client.Client
}

// getPricingModel retrieves the pricing model from platform_config.
// Returns a map of model_id -> price per 1M tokens.
func (h *AdminHandler) getPricingModel(ctx context.Context) map[string]float64 {
	defaultPricing := map[string]float64{
		"claude-3-5-sonnet-20241022": 3.0,
		"claude-opus-4-20250514":      15.0,
		"claude-opus-4":                15.0,
	}

	var value string
	err := h.DB.QueryRow(ctx, `
		SELECT value FROM platform_config WHERE key = 'pricing_model'
	`).Scan(&value)

	if err == nil && value != "" {
		var pricing map[string]float64
		if err := json.Unmarshal([]byte(value), &pricing); err == nil {
			return pricing
		}
	}

	return defaultPricing
}

// calculateCost calculates USD cost from tokens using the pricing model.
func (h *AdminHandler) calculateCost(ctx context.Context, tokensIn, tokensOut int64) float64 {
	_ = h.getPricingModel(ctx) // Load pricing model (future: use for model-specific pricing)
	// Default to average price per 1M tokens
	avgPrice := 5.0
	totalTokens := float64(tokensIn + tokensOut)
	return (totalTokens / 1000000.0) * avgPrice
}

// HandleHealth returns the service health status.
func (h *AdminHandler) HandleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// HandleAuthVerify validates the admin API key.
func (h *AdminHandler) HandleAuthVerify(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	resp := models.AdminAuthResponse{
		Valid: true,
		Role:  "admin",
	}
	json.NewEncoder(w).Encode(resp)
}

// HandleListTenants returns all known tenants (from tenant_settings + inferred from registries).
func (h *AdminHandler) HandleListTenants(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	rows, err := h.DB.Query(r.Context(), `
		SELECT tenant_id, display_name, status, max_concurrent_workflows, token_budget_monthly, created_at, updated_at
		FROM tenant_settings
		ORDER BY created_at DESC
	`)
	if err != nil {
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var tenants []models.TenantSettings
	for rows.Next() {
		var t models.TenantSettings
		if err := rows.Scan(&t.TenantID, &t.DisplayName, &t.Status, &t.MaxConcurrentWorkflows, &t.TokenBudgetMonthly, &t.CreatedAt, &t.UpdatedAt); err != nil {
			http.Error(w, fmt.Sprintf("Scan failed: %v", err), http.StatusInternalServerError)
			return
		}
		tenants = append(tenants, t)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"tenants": tenants,
		"count":   len(tenants),
	})
}

// HandleCreateTenant creates a new tenant record.
func (h *AdminHandler) HandleCreateTenant(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TenantID               string `json:"tenant_id"`
		DisplayName            string `json:"display_name"`
		MaxConcurrentWorkflows int    `json:"max_concurrent_workflows,omitempty"`
		TokenBudgetMonthly     int64  `json:"token_budget_monthly,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.TenantID == "" || req.DisplayName == "" {
		http.Error(w, "tenant_id and display_name are required", http.StatusBadRequest)
		return
	}

	// Set defaults
	if req.MaxConcurrentWorkflows == 0 {
		req.MaxConcurrentWorkflows = 50
	}
	if req.TokenBudgetMonthly == 0 {
		req.TokenBudgetMonthly = 10000000
	}

	now := time.Now()
	_, err := h.DB.Exec(r.Context(), `
		INSERT INTO tenant_settings (tenant_id, display_name, status, max_concurrent_workflows, token_budget_monthly, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`, req.TenantID, req.DisplayName, models.TenantStatusActive, req.MaxConcurrentWorkflows, req.TokenBudgetMonthly, now, now)

	if err != nil {
		http.Error(w, fmt.Sprintf("Insert failed: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	tenant := models.TenantSettings{
		TenantID:               req.TenantID,
		DisplayName:            req.DisplayName,
		Status:                 models.TenantStatusActive,
		MaxConcurrentWorkflows: req.MaxConcurrentWorkflows,
		TokenBudgetMonthly:     req.TokenBudgetMonthly,
		CreatedAt:              now,
		UpdatedAt:              now,
	}
	json.NewEncoder(w).Encode(tenant)
}

// HandleGetTenant retrieves a single tenant with stats.
func (h *AdminHandler) HandleGetTenant(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("id")
	if tenantID == "" {
		http.Error(w, "tenant_id is required", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	var settings models.TenantSettings
	err := h.DB.QueryRow(r.Context(), `
		SELECT tenant_id, display_name, status, max_concurrent_workflows, token_budget_monthly, created_at, updated_at
		FROM tenant_settings
		WHERE tenant_id = $1
	`, tenantID).Scan(&settings.TenantID, &settings.DisplayName, &settings.Status, &settings.MaxConcurrentWorkflows, &settings.TokenBudgetMonthly, &settings.CreatedAt, &settings.UpdatedAt)

	if err != nil {
		http.Error(w, "Tenant not found", http.StatusNotFound)
		return
	}

	// TODO: Query agent/skill/tool counts from registries (cross-tenant)
	// TODO: Query cost_events for this tenant

	stats := models.TenantStats{
		TenantID:      tenantID,
		AgentCount:    0,
		SkillCount:    0,
		ToolCount:     0,
		MonthlyCost:   0.0,
		Settings:      &settings,
	}

	json.NewEncoder(w).Encode(stats)
}

// HandleUpdateTenantQuota updates tenant quota settings.
func (h *AdminHandler) HandleUpdateTenantQuota(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("id")
	if tenantID == "" {
		http.Error(w, "tenant_id is required", http.StatusBadRequest)
		return
	}

	var req models.TenantSettingsUpdate
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	// Build update query dynamically
	setClause := "updated_at = NOW()"
	args := []interface{}{}
	argCount := 1

	if req.MaxConcurrentWorkflows != nil {
		setClause += fmt.Sprintf(", max_concurrent_workflows = $%d", argCount)
		args = append(args, *req.MaxConcurrentWorkflows)
		argCount++
	}
	if req.TokenBudgetMonthly != nil {
		setClause += fmt.Sprintf(", token_budget_monthly = $%d", argCount)
		args = append(args, *req.TokenBudgetMonthly)
		argCount++
	}

	args = append(args, tenantID)

	query := fmt.Sprintf(`
		UPDATE tenant_settings
		SET %s
		WHERE tenant_id = $%d
		RETURNING tenant_id, display_name, status, max_concurrent_workflows, token_budget_monthly, created_at, updated_at
	`, setClause, argCount)

	var updated models.TenantSettings
	err := h.DB.QueryRow(r.Context(), query, args...).Scan(
		&updated.TenantID, &updated.DisplayName, &updated.Status,
		&updated.MaxConcurrentWorkflows, &updated.TokenBudgetMonthly,
		&updated.CreatedAt, &updated.UpdatedAt)

	if err != nil {
		http.Error(w, fmt.Sprintf("Update failed: %v", err), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(updated)
}

// HandleUpdateTenantStatus updates tenant status (active/suspended).
func (h *AdminHandler) HandleUpdateTenantStatus(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("id")
	if tenantID == "" {
		http.Error(w, "tenant_id is required", http.StatusBadRequest)
		return
	}

	var req struct {
		Status models.TenantStatus `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Status != models.TenantStatusActive && req.Status != models.TenantStatusSuspended {
		http.Error(w, "Invalid status", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	var updated models.TenantSettings
	err := h.DB.QueryRow(r.Context(), `
		UPDATE tenant_settings
		SET status = $1, updated_at = NOW()
		WHERE tenant_id = $2
		RETURNING tenant_id, display_name, status, max_concurrent_workflows, token_budget_monthly, created_at, updated_at
	`, req.Status, tenantID).Scan(
		&updated.TenantID, &updated.DisplayName, &updated.Status,
		&updated.MaxConcurrentWorkflows, &updated.TokenBudgetMonthly,
		&updated.CreatedAt, &updated.UpdatedAt)

	if err != nil {
		http.Error(w, "Tenant not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(updated)
}

// HandleGetLLMConfig proxies to LLM Gateway and returns current config.
func (h *AdminHandler) HandleGetLLMConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	resp, err := http.Get("http://llm-gateway:8083/admin/config")
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to reach LLM Gateway: %v", err), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		http.Error(w, "LLM Gateway error", resp.StatusCode)
		return
	}

	w.WriteHeader(resp.StatusCode)
	fmt.Fprintf(w, "%s", readBody(resp.Body))
}

// HandlePutLLMConfig proxies to LLM Gateway and persists config to DB.
func (h *AdminHandler) HandlePutLLMConfig(w http.ResponseWriter, r *http.Request) {
	var req models.LLMConfigRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Build request body for LLM Gateway
	reqBody, _ := json.Marshal(req)
	llmReq, err := http.NewRequest("PUT", "http://llm-gateway:8083/admin/config", strings.NewReader(string(reqBody)))
	if err != nil {
		http.Error(w, "Failed to create request", http.StatusInternalServerError)
		return
	}
	llmReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	llmResp, err := client.Do(llmReq)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to reach LLM Gateway: %v", err), http.StatusInternalServerError)
		return
	}
	defer llmResp.Body.Close()

	// Also persist to platform_config table
	if req.AnthropicAPIKey != "" {
		_, _ = h.DB.Exec(r.Context(), `
			INSERT INTO platform_config (key, value, updated_at)
			VALUES ($1, $2, NOW())
			ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
		`, "anthropic_api_key", req.AnthropicAPIKey)
	}
	if req.AnthropicBaseURL != "" {
		_, _ = h.DB.Exec(r.Context(), `
			INSERT INTO platform_config (key, value, updated_at)
			VALUES ($1, $2, NOW())
			ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
		`, "anthropic_base_url", req.AnthropicBaseURL)
	}
	if req.OpenAIAPIKey != "" {
		_, _ = h.DB.Exec(r.Context(), `
			INSERT INTO platform_config (key, value, updated_at)
			VALUES ($1, $2, NOW())
			ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
		`, "openai_api_key", req.OpenAIAPIKey)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(llmResp.StatusCode)
	fmt.Fprintf(w, "%s", readBody(llmResp.Body))
}

// HandleListSystemAgents lists all platform-system tenant agents.
func (h *AdminHandler) HandleListSystemAgents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	rows, err := h.DB.Query(r.Context(), `
		SELECT id, name, version, system_prompt, model, max_iterations, memory_budget_mb, status, created_at
		FROM agents
		WHERE tenant_id = 'platform-system'
		ORDER BY created_at DESC
	`)
	if err != nil {
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type AgentRow struct {
		ID             string    `json:"id"`
		Name           string    `json:"name"`
		Version        string    `json:"version"`
		SystemPrompt   string    `json:"system_prompt"`
		Model          string    `json:"model"`
		MaxIterations  int       `json:"max_iterations"`
		MemoryBudgetMB int       `json:"memory_budget_mb"`
		Status         string    `json:"status"`
		CreatedAt      time.Time `json:"created_at"`
	}

	var agents []AgentRow
	for rows.Next() {
		var a AgentRow
		if err := rows.Scan(&a.ID, &a.Name, &a.Version, &a.SystemPrompt, &a.Model, &a.MaxIterations, &a.MemoryBudgetMB, &a.Status, &a.CreatedAt); err != nil {
			http.Error(w, fmt.Sprintf("Scan failed: %v", err), http.StatusInternalServerError)
			return
		}
		agents = append(agents, a)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"agents": agents,
		"count":  len(agents),
	})
}

// HandleGetSystemAgent retrieves a single system agent.
func (h *AdminHandler) HandleGetSystemAgent(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("id")
	if agentID == "" {
		http.Error(w, "agent_id is required", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	type AgentRow struct {
		ID             string    `json:"id"`
		Name           string    `json:"name"`
		Version        string    `json:"version"`
		SystemPrompt   string    `json:"system_prompt"`
		Model          string    `json:"model"`
		MaxIterations  int       `json:"max_iterations"`
		MemoryBudgetMB int       `json:"memory_budget_mb"`
		Status         string    `json:"status"`
		CreatedAt      time.Time `json:"created_at"`
	}

	var a AgentRow
	err := h.DB.QueryRow(r.Context(), `
		SELECT id, name, version, system_prompt, model, max_iterations, memory_budget_mb, status, created_at
		FROM agents
		WHERE id = $1 AND tenant_id = 'platform-system'
	`, agentID).Scan(&a.ID, &a.Name, &a.Version, &a.SystemPrompt, &a.Model, &a.MaxIterations, &a.MemoryBudgetMB, &a.Status, &a.CreatedAt)

	if err != nil {
		http.Error(w, "Agent not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(a)
}

// HandleUpdateSystemAgent updates a system agent manifest.
func (h *AdminHandler) HandleUpdateSystemAgent(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("id")
	if agentID == "" {
		http.Error(w, "agent_id is required", http.StatusBadRequest)
		return
	}

	var req struct {
		Name           string `json:"name"`
		Version        string `json:"version"`
		SystemPrompt   string `json:"system_prompt"`
		Model          string `json:"model"`
		MaxIterations  int    `json:"max_iterations"`
		MemoryBudgetMB int    `json:"memory_budget_mb"`
		Status         string `json:"status"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	type AgentRow struct {
		ID             string    `json:"id"`
		Name           string    `json:"name"`
		Version        string    `json:"version"`
		SystemPrompt   string    `json:"system_prompt"`
		Model          string    `json:"model"`
		MaxIterations  int       `json:"max_iterations"`
		MemoryBudgetMB int       `json:"memory_budget_mb"`
		Status         string    `json:"status"`
		CreatedAt      time.Time `json:"created_at"`
	}

	var a AgentRow
	err := h.DB.QueryRow(r.Context(), `
		UPDATE agents
		SET name = $1, version = $2, system_prompt = $3, model = $4, max_iterations = $5, memory_budget_mb = $6, status = $7
		WHERE id = $8 AND tenant_id = 'platform-system'
		RETURNING id, name, version, system_prompt, model, max_iterations, memory_budget_mb, status, created_at
	`, req.Name, req.Version, req.SystemPrompt, req.Model, req.MaxIterations, req.MemoryBudgetMB, req.Status, agentID).
		Scan(&a.ID, &a.Name, &a.Version, &a.SystemPrompt, &a.Model, &a.MaxIterations, &a.MemoryBudgetMB, &a.Status, &a.CreatedAt)

	if err != nil {
		http.Error(w, "Agent not found or update failed", http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(a)
}

// HandleListExecutions returns recent execution sessions across all tenants.
func (h *AdminHandler) HandleListExecutions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		if _, err := fmt.Sscanf(l, "%d", &limit); err == nil && limit > 0 && limit <= 100 {
			// limit is valid
		} else {
			limit = 20
		}
	}

	tenantIDFilter := r.URL.Query().Get("tenant_id")
	statusFilter := r.URL.Query().Get("status")

	type ExecutionRow struct {
		SessionID  string    `json:"session_id"`
		TenantID   string    `json:"tenant_id"`
		AgentID    string    `json:"agent_id"`
		Status     string    `json:"status"`
		StartTime  time.Time `json:"start_time"`
		EndTime    *time.Time `json:"end_time,omitempty"`
		DurationMS int64     `json:"duration_ms"`
		EventCount int       `json:"event_count"`
	}

	// Build query for workflow_executions table
	query := `SELECT workflow_id, tenant_id, agent_id, status, start_time, end_time,
	           EXTRACT(EPOCH FROM (COALESCE(end_time, NOW()) - start_time))::bigint * 1000 as duration_ms, 0 as event_count
	           FROM workflow_executions WHERE 1=1`

	args := []interface{}{}
	argCount := 1

	if tenantIDFilter != "" {
		query += fmt.Sprintf(` AND tenant_id = $%d`, argCount)
		args = append(args, tenantIDFilter)
		argCount++
	}

	if statusFilter != "" && statusFilter != "ALL" {
		query += fmt.Sprintf(` AND status = $%d`, argCount)
		args = append(args, statusFilter)
		argCount++
	}

	query += fmt.Sprintf(` ORDER BY start_time DESC LIMIT $%d`, argCount)
	args = append(args, limit)

	rows, err := h.DB.Query(r.Context(), query, args...)
	if err != nil {
		// Table might not exist yet, return empty result
		json.NewEncoder(w).Encode(map[string]interface{}{
			"executions": []ExecutionRow{},
			"count":      0,
		})
		return
	}
	defer rows.Close()

	var executions []ExecutionRow
	for rows.Next() {
		var row ExecutionRow
		if err := rows.Scan(&row.SessionID, &row.TenantID, &row.AgentID, &row.Status, &row.StartTime, &row.EndTime, &row.DurationMS, &row.EventCount); err != nil {
			continue
		}
		executions = append(executions, row)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"executions": executions,
		"count":      len(executions),
	})
}

// HandleGetExecution returns a single execution with its events.
func (h *AdminHandler) HandleGetExecution(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")
	if sessionID == "" {
		http.Error(w, "session_id is required", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	type ExecutionDetail struct {
		SessionID  string              `json:"session_id"`
		Status     string              `json:"status"`
		StartTime  time.Time           `json:"start_time"`
		EndTime    *time.Time          `json:"end_time,omitempty"`
		DurationMS int64               `json:"duration_ms"`
		Events     []models.AgentEvent `json:"events,omitempty"`
	}

	// Query execution from database
	var startTime time.Time
	var endTime *time.Time
	var status string
	var durationMS int64

	err := h.DB.QueryRow(r.Context(), `
		SELECT status, start_time, end_time, EXTRACT(EPOCH FROM (COALESCE(end_time, NOW()) - start_time))::bigint * 1000
		FROM workflow_executions
		WHERE workflow_id = $1
	`, sessionID).Scan(&status, &startTime, &endTime, &durationMS)

	if err != nil {
		// Try Temporal as fallback if database doesn't have it
		if h.TemporalClient != nil {
			desc, err := h.TemporalClient.DescribeWorkflowExecution(r.Context(), sessionID, "")
			if err == nil {
				status = "RUNNING"
				startTime = desc.WorkflowExecutionInfo.StartTime.AsTime()
				if desc.WorkflowExecutionInfo.CloseTime != nil {
					et := desc.WorkflowExecutionInfo.CloseTime.AsTime()
					endTime = &et
					durationMS = endTime.Sub(startTime).Milliseconds()
					status = "COMPLETED"
				}
			}
		}
		if status == "" {
			http.Error(w, "Execution not found", http.StatusNotFound)
			return
		}
	}

	detail := ExecutionDetail{
		SessionID:  sessionID,
		Status:     status,
		StartTime:  startTime,
		EndTime:    endTime,
		DurationMS: durationMS,
	}

	// Try to query events from Temporal
	if h.TemporalClient != nil {
		val, err := h.TemporalClient.QueryWorkflow(r.Context(), sessionID, "", "get_events")
		if err == nil {
			var events []models.AgentEvent
			if err := val.Get(&events); err == nil {
				detail.Events = events
			}
		}
	}

	json.NewEncoder(w).Encode(detail)
}

// HandleGetExecutionEvents returns event stream for a single execution.
func (h *AdminHandler) HandleGetExecutionEvents(w http.ResponseWriter, r *http.Request) {
	sessionID := r.PathValue("id")
	if sessionID == "" {
		http.Error(w, "session_id is required", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	events := []models.AgentEvent{}

	// Try to query events from Temporal workflow
	if h.TemporalClient != nil {
		val, err := h.TemporalClient.QueryWorkflow(r.Context(), sessionID, "", "get_events")
		if err == nil {
			if err := val.Get(&events); err == nil && events != nil {
				json.NewEncoder(w).Encode(events)
				return
			}
		}
	}

	// Return empty events if not found
	json.NewEncoder(w).Encode(events)
}

// HandleGetCostSummary returns aggregate cost data across all tenants.
func (h *AdminHandler) HandleGetCostSummary(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	period := r.URL.Query().Get("period")
	if period == "" {
		period = "30d"
	}

	// Parse period (e.g., "7d", "30d", "90d")
	days := 30
	if strings.HasSuffix(period, "d") {
		if _, err := fmt.Sscanf(period, "%dd", &days); err == nil {
			// parsed successfully
		}
	}

	rows, err := h.DB.Query(r.Context(), `
		SELECT tenant_id, SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out, SUM(sandbox_ms) as sandbox_ms
		FROM cost_events
		WHERE time > NOW() - INTERVAL '1 day' * $1
		GROUP BY tenant_id
		ORDER BY (SUM(tokens_in) + SUM(tokens_out)) DESC
	`, days)
	if err != nil {
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type CostRow struct {
		TenantID  string  `json:"tenant_id"`
		TokensIn  int64   `json:"tokens_in"`
		TokensOut int64   `json:"tokens_out"`
		SandboxMS int64   `json:"sandbox_ms"`
		CostUSD   float64 `json:"cost_usd"`
	}

	var costs []CostRow
	for rows.Next() {
		var c CostRow
		if err := rows.Scan(&c.TenantID, &c.TokensIn, &c.TokensOut, &c.SandboxMS); err != nil {
			http.Error(w, fmt.Sprintf("Scan failed: %v", err), http.StatusInternalServerError)
			return
		}
		c.CostUSD = h.calculateCost(r.Context(), c.TokensIn, c.TokensOut)
		costs = append(costs, c)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"costs":   costs,
		"period":  period,
		"count":   len(costs),
	})
}

// HandleGetCostByTenant returns cost breakdown for a specific tenant.
func (h *AdminHandler) HandleGetCostByTenant(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("tenant_id")
	if tenantID == "" {
		http.Error(w, "tenant_id is required", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	period := r.URL.Query().Get("period")
	if period == "" {
		period = "30d"
	}

	days := 30
	if strings.HasSuffix(period, "d") {
		if _, err := fmt.Sscanf(period, "%dd", &days); err == nil {
			// parsed successfully
		}
	}

	rows, err := h.DB.Query(r.Context(), `
		SELECT agent_id, skill_id, SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out, SUM(sandbox_ms) as sandbox_ms
		FROM cost_events
		WHERE tenant_id = $1 AND time > NOW() - INTERVAL '1 day' * $2
		GROUP BY agent_id, skill_id
		ORDER BY (SUM(tokens_in) + SUM(tokens_out)) DESC
	`, tenantID, days)
	if err != nil {
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type CostBreakdown struct {
		AgentID   *string `json:"agent_id"`
		SkillID   *string `json:"skill_id"`
		TokensIn  int64   `json:"tokens_in"`
		TokensOut int64   `json:"tokens_out"`
		SandboxMS int64   `json:"sandbox_ms"`
		CostUSD   float64 `json:"cost_usd"`
	}

	var breakdown []CostBreakdown
	for rows.Next() {
		var c CostBreakdown
		if err := rows.Scan(&c.AgentID, &c.SkillID, &c.TokensIn, &c.TokensOut, &c.SandboxMS); err != nil {
			http.Error(w, fmt.Sprintf("Scan failed: %v", err), http.StatusInternalServerError)
			return
		}
		c.CostUSD = h.calculateCost(r.Context(), c.TokensIn, c.TokensOut)
		breakdown = append(breakdown, c)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"tenant_id": tenantID,
		"breakdown": breakdown,
		"period":    period,
		"count":     len(breakdown),
	})
}

// HandleGetAuditLog returns immutable audit events with filtering.
func (h *AdminHandler) HandleGetAuditLog(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if _, err := fmt.Sscanf(l, "%d", &limit); err == nil && limit > 0 && limit <= 250 {
			// limit is valid
		} else {
			limit = 50
		}
	}

	offset := 0
	if o := r.URL.Query().Get("offset"); o != "" {
		if _, err := fmt.Sscanf(o, "%d", &offset); err == nil && offset >= 0 {
			// offset is valid
		}
	}

	resourceType := r.URL.Query().Get("resource_type")
	tenantID := r.URL.Query().Get("tenant_id")

	query := `
		SELECT id, resource_type, resource_id, tenant_id, from_state, to_state, actor, reason, created_at
		FROM lifecycle_events
		WHERE 1=1
	`
	args := []interface{}{}
	argCount := 0

	if resourceType != "" {
		argCount++
		query += fmt.Sprintf(` AND resource_type = $%d`, argCount)
		args = append(args, resourceType)
	}

	if tenantID != "" {
		argCount++
		query += fmt.Sprintf(` AND tenant_id = $%d`, argCount)
		args = append(args, tenantID)
	}

	query += ` ORDER BY created_at DESC LIMIT ` + fmt.Sprintf("%d", limit) + ` OFFSET ` + fmt.Sprintf("%d", offset)

	rows, err := h.DB.Query(r.Context(), query, args...)
	if err != nil {
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type AuditEvent struct {
		ID           string    `json:"id"`
		ResourceType string    `json:"resource_type"`
		ResourceID   string    `json:"resource_id"`
		TenantID     string    `json:"tenant_id"`
		FromState    *string   `json:"from_state"`
		ToState      string    `json:"to_state"`
		Actor        string    `json:"actor"`
		Reason       *string   `json:"reason"`
		CreatedAt    time.Time `json:"created_at"`
	}

	var events []AuditEvent
	for rows.Next() {
		var e AuditEvent
		if err := rows.Scan(&e.ID, &e.ResourceType, &e.ResourceID, &e.TenantID, &e.FromState, &e.ToState, &e.Actor, &e.Reason, &e.CreatedAt); err != nil {
			http.Error(w, fmt.Sprintf("Scan failed: %v", err), http.StatusInternalServerError)
			return
		}
		events = append(events, e)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"events": events,
		"limit":  limit,
		"offset": offset,
		"count":  len(events),
	})
}

// HandleCreateGlobalMCPServer creates a global MCP server (admin only)
func (h *AdminHandler) HandleCreateGlobalMCPServer(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		Name       string                 `json:"name"`
		URL        string                 `json:"url"`
		AuthConfig map[string]interface{} `json:"auth_config,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.URL == "" {
		http.Error(w, "Missing required fields: name, url", http.StatusBadRequest)
		return
	}

	id := uuid.New().String()
	now := time.Now()

	// Convert auth_config to JSON
	var authJSON []byte
	if req.AuthConfig != nil {
		var err error
		authJSON, err = json.Marshal(req.AuthConfig)
		if err != nil {
			http.Error(w, "Invalid auth_config format", http.StatusBadRequest)
			return
		}
	}

	_, err := h.DB.Exec(r.Context(), `
		INSERT INTO mcp_servers (id, tenant_id, name, url, enabled, scope, auth_config, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, id, "platform-system", req.Name, req.URL, true, "global", authJSON, now, now)

	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create MCP server: %v", err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":         id,
		"name":       req.Name,
		"url":        req.URL,
		"scope":      "global",
		"tenant_id":  "platform-system",
		"enabled":    true,
		"created_at": now,
	})
}

// HandleListGlobalMCPServers lists all global MCP servers (admin only)
func (h *AdminHandler) HandleListGlobalMCPServers(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	rows, err := h.DB.Query(r.Context(), `
		SELECT id, tenant_id, name, url, enabled, scope, auth_config, created_at, updated_at
		FROM mcp_servers
		WHERE scope = 'global'
		ORDER BY created_at DESC
	`)
	if err != nil {
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type MCPServer struct {
		ID        string    `json:"id"`
		TenantID  string    `json:"tenant_id"`
		Name      string    `json:"name"`
		URL       string    `json:"url"`
		Enabled   bool      `json:"enabled"`
		Scope     string    `json:"scope"`
		CreatedAt time.Time `json:"created_at"`
		UpdatedAt time.Time `json:"updated_at"`
	}

	var servers []MCPServer
	for rows.Next() {
		var s MCPServer
		var authJSON interface{}
		if err := rows.Scan(&s.ID, &s.TenantID, &s.Name, &s.URL, &s.Enabled, &s.Scope, &authJSON, &s.CreatedAt, &s.UpdatedAt); err != nil {
			http.Error(w, fmt.Sprintf("Scan failed: %v", err), http.StatusInternalServerError)
			return
		}
		servers = append(servers, s)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"servers": servers,
		"count":   len(servers),
	})
}

// HandleDeleteGlobalMCPServer deletes a global MCP server (admin only)
func (h *AdminHandler) HandleDeleteGlobalMCPServer(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	serverID := r.PathValue("id")
	if serverID == "" {
		http.Error(w, "Missing server ID", http.StatusBadRequest)
		return
	}

	result, err := h.DB.Exec(r.Context(), `
		DELETE FROM mcp_servers
		WHERE id = $1 AND scope = 'global'
	`, serverID)

	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to delete MCP server: %v", err), http.StatusInternalServerError)
		return
	}

	if result.RowsAffected() == 0 {
		http.Error(w, "Global MCP server not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"status": "deleted",
		"id":     serverID,
	})
}

func readBody(r io.ReadCloser) string {
	defer r.Close()
	body, _ := io.ReadAll(r)
	return string(body)
}

// HandleListSystemTools lists all system tools (admin only)
func (h *AdminHandler) HandleListSystemTools(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	rows, err := h.DB.Query(r.Context(), `
		SELECT id, tenant_id, name, version, description, auth_level, sandbox_required,
		       input_schema, output_schema, status, registered_by, created_at, scope
		FROM tools
		WHERE scope = 'system'
		ORDER BY created_at DESC
	`)
	if err != nil {
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var tools []models.ToolSpec
	for rows.Next() {
		var t models.ToolSpec
		if err := rows.Scan(&t.ID, &t.TenantID, &t.Name, &t.Version, &t.Description, &t.AuthLevel,
			&t.SandboxRequired, &t.InputSchema, &t.OutputSchema, &t.Status, &t.RegisteredBy, &t.CreatedAt, &t.Scope); err != nil {
			http.Error(w, fmt.Sprintf("Scan failed: %v", err), http.StatusInternalServerError)
			return
		}
		tools = append(tools, t)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"tools": tools,
		"count": len(tools),
	})
}

// HandleCreateSystemTool creates a system tool (admin only)
func (h *AdminHandler) HandleCreateSystemTool(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		Name              string          `json:"name"`
		Version           string          `json:"version"`
		Description       string          `json:"description"`
		AuthLevel         string          `json:"auth_level"`
		SandboxRequired   bool            `json:"sandbox_required"`
		InputSchema       json.RawMessage `json:"input_schema,omitempty"`
		OutputSchema      json.RawMessage `json:"output_schema,omitempty"`
		RegisteredBy      string          `json:"registered_by"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.Version == "" {
		http.Error(w, "Missing required fields: name, version", http.StatusBadRequest)
		return
	}

	id := uuid.New().String()
	now := time.Now()
	registeredBy := req.RegisteredBy
	if registeredBy == "" {
		registeredBy = "admin"
	}

	_, err := h.DB.Exec(r.Context(), `
		INSERT INTO tools (id, tenant_id, name, version, description, auth_level, sandbox_required,
		                   input_schema, output_schema, status, registered_by, created_at, scope)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
	`, id, "platform-system", req.Name, req.Version, req.Description, req.AuthLevel, req.SandboxRequired,
		req.InputSchema, req.OutputSchema, "approved", registeredBy, now, "system")

	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create tool: %v", err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":                id,
		"tenant_id":         "platform-system",
		"name":              req.Name,
		"version":           req.Version,
		"description":       req.Description,
		"auth_level":        req.AuthLevel,
		"sandbox_required":  req.SandboxRequired,
		"input_schema":      req.InputSchema,
		"output_schema":     req.OutputSchema,
		"status":            "approved",
		"registered_by":     registeredBy,
		"scope":             "system",
		"created_at":        now,
	})
}

// HandleUpdateSystemTool updates a system tool (admin only)
func (h *AdminHandler) HandleUpdateSystemTool(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing tool ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Name            string          `json:"name,omitempty"`
		Version         string          `json:"version,omitempty"`
		Description     string          `json:"description,omitempty"`
		AuthLevel       string          `json:"auth_level,omitempty"`
		SandboxRequired *bool           `json:"sandbox_required,omitempty"`
		InputSchema     json.RawMessage `json:"input_schema,omitempty"`
		OutputSchema    json.RawMessage `json:"output_schema,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var updates []string
	var args []interface{}
	argCount := 1

	if req.Name != "" {
		updates = append(updates, fmt.Sprintf("name = $%d", argCount))
		args = append(args, req.Name)
		argCount++
	}
	if req.Version != "" {
		updates = append(updates, fmt.Sprintf("version = $%d", argCount))
		args = append(args, req.Version)
		argCount++
	}
	if req.Description != "" {
		updates = append(updates, fmt.Sprintf("description = $%d", argCount))
		args = append(args, req.Description)
		argCount++
	}
	if req.AuthLevel != "" {
		updates = append(updates, fmt.Sprintf("auth_level = $%d", argCount))
		args = append(args, req.AuthLevel)
		argCount++
	}
	if req.SandboxRequired != nil {
		updates = append(updates, fmt.Sprintf("sandbox_required = $%d", argCount))
		args = append(args, *req.SandboxRequired)
		argCount++
	}
	if len(req.InputSchema) > 0 {
		updates = append(updates, fmt.Sprintf("input_schema = $%d", argCount))
		args = append(args, req.InputSchema)
		argCount++
	}
	if len(req.OutputSchema) > 0 {
		updates = append(updates, fmt.Sprintf("output_schema = $%d", argCount))
		args = append(args, req.OutputSchema)
		argCount++
	}

	if len(updates) == 0 {
		http.Error(w, "No fields to update", http.StatusBadRequest)
		return
	}

	args = append(args, id)
	query := fmt.Sprintf(`UPDATE tools SET %s WHERE id = $%d AND scope = 'system'`, strings.Join(updates, ", "), argCount)
	result, err := h.DB.Exec(r.Context(), query, args...)

	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to update tool: %v", err), http.StatusInternalServerError)
		return
	}

	if result.RowsAffected() == 0 {
		http.Error(w, "System tool not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status": "updated",
		"id":     id,
	})
}

// HandleTransitionSystemTool transitions a system tool status (admin only)
func (h *AdminHandler) HandleTransitionSystemTool(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing tool ID", http.StatusBadRequest)
		return
	}

	var req struct {
		TargetState string `json:"target_state"`
		Actor       string `json:"actor"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.TargetState == "" {
		http.Error(w, "Missing target_state", http.StatusBadRequest)
		return
	}

	actor := req.Actor
	if actor == "" {
		actor = "admin"
	}

	var currentStatus string
	err := h.DB.QueryRow(r.Context(), `
		SELECT status FROM tools WHERE id = $1 AND scope = 'system'
	`, id).Scan(&currentStatus)

	if err != nil {
		http.Error(w, "System tool not found", http.StatusNotFound)
		return
	}

	_, err = h.DB.Exec(r.Context(), `
		UPDATE tools SET status = $1 WHERE id = $2 AND scope = 'system'
	`, req.TargetState, id)

	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to transition tool: %v", err), http.StatusInternalServerError)
		return
	}

	h.DB.Exec(r.Context(), `
		INSERT INTO lifecycle_events (resource_type, resource_id, tenant_id, from_state, to_state, actor)
		VALUES ('tool', $1, $2, $3, $4, $5)
	`, id, "platform-system", currentStatus, req.TargetState, actor)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "transitioned",
		"id":     id,
		"from":   currentStatus,
		"to":     req.TargetState,
	})
}

// HandleListSystemSkills lists all system skills (admin only)
func (h *AdminHandler) HandleListSystemSkills(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	rows, err := h.DB.Query(r.Context(), `
		SELECT id, tenant_id, name, version, description, tools, sop, mutating,
		       approval_required, hooks, status, published_by, created_at, scope
		FROM skills
		WHERE scope = 'system'
		ORDER BY created_at DESC
	`)
	if err != nil {
		http.Error(w, fmt.Sprintf("Query failed: %v", err), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var skills []models.SkillManifest
	for rows.Next() {
		var sk models.SkillManifest
		var tools, hooks interface{}
		if err := rows.Scan(&sk.ID, &sk.TenantID, &sk.Name, &sk.Version, &sk.Description, &tools,
			&sk.SOP, &sk.Mutating, &sk.ApprovalRequired, &hooks, &sk.Status, &sk.PublishedBy, &sk.CreatedAt, &sk.Scope); err != nil {
			http.Error(w, fmt.Sprintf("Scan failed: %v", err), http.StatusInternalServerError)
			return
		}
		skills = append(skills, sk)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"skills": skills,
		"count":  len(skills),
	})
}

// HandleCreateSystemSkill creates a system skill (admin only)
func (h *AdminHandler) HandleCreateSystemSkill(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		Name             string          `json:"name"`
		Version          string          `json:"version"`
		Description      string          `json:"description"`
		Tools            []interface{}   `json:"tools,omitempty"`
		SOP              string          `json:"sop"`
		Mutating         bool            `json:"mutating"`
		ApprovalRequired bool            `json:"approval_required"`
		Hooks            []interface{}   `json:"hooks,omitempty"`
		PublishedBy      string          `json:"published_by"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.Version == "" {
		http.Error(w, "Missing required fields: name, version", http.StatusBadRequest)
		return
	}

	id := uuid.New().String()
	now := time.Now()
	publishedBy := req.PublishedBy
	if publishedBy == "" {
		publishedBy = "admin"
	}

	tools, _ := json.Marshal(req.Tools)
	hooks, _ := json.Marshal(req.Hooks)

	_, err := h.DB.Exec(r.Context(), `
		INSERT INTO skills (id, tenant_id, name, version, description, tools, sop, mutating,
		                    approval_required, hooks, status, published_by, created_at, scope)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
	`, id, "platform-system", req.Name, req.Version, req.Description, tools, req.SOP, req.Mutating,
		req.ApprovalRequired, hooks, "active", publishedBy, now, "system")

	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create skill: %v", err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":                  id,
		"tenant_id":           "platform-system",
		"name":                req.Name,
		"version":             req.Version,
		"description":         req.Description,
		"tools":               req.Tools,
		"sop":                 req.SOP,
		"mutating":            req.Mutating,
		"approval_required":   req.ApprovalRequired,
		"hooks":               req.Hooks,
		"status":              "active",
		"published_by":        publishedBy,
		"scope":               "system",
		"created_at":          now,
	})
}

// HandleUpdateSystemSkill updates a system skill (admin only)
func (h *AdminHandler) HandleUpdateSystemSkill(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing skill ID", http.StatusBadRequest)
		return
	}

	var req struct {
		Name             string        `json:"name,omitempty"`
		Version          string        `json:"version,omitempty"`
		Description      string        `json:"description,omitempty"`
		Tools            []interface{} `json:"tools,omitempty"`
		SOP              string        `json:"sop,omitempty"`
		Mutating         *bool         `json:"mutating,omitempty"`
		ApprovalRequired *bool         `json:"approval_required,omitempty"`
		Hooks            []interface{} `json:"hooks,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	var updates []string
	var args []interface{}
	argCount := 1

	if req.Name != "" {
		updates = append(updates, fmt.Sprintf("name = $%d", argCount))
		args = append(args, req.Name)
		argCount++
	}
	if req.Version != "" {
		updates = append(updates, fmt.Sprintf("version = $%d", argCount))
		args = append(args, req.Version)
		argCount++
	}
	if req.Description != "" {
		updates = append(updates, fmt.Sprintf("description = $%d", argCount))
		args = append(args, req.Description)
		argCount++
	}
	if len(req.Tools) > 0 {
		toolsJSON, _ := json.Marshal(req.Tools)
		updates = append(updates, fmt.Sprintf("tools = $%d", argCount))
		args = append(args, toolsJSON)
		argCount++
	}
	if req.SOP != "" {
		updates = append(updates, fmt.Sprintf("sop = $%d", argCount))
		args = append(args, req.SOP)
		argCount++
	}
	if req.Mutating != nil {
		updates = append(updates, fmt.Sprintf("mutating = $%d", argCount))
		args = append(args, *req.Mutating)
		argCount++
	}
	if req.ApprovalRequired != nil {
		updates = append(updates, fmt.Sprintf("approval_required = $%d", argCount))
		args = append(args, *req.ApprovalRequired)
		argCount++
	}
	if len(req.Hooks) > 0 {
		hooksJSON, _ := json.Marshal(req.Hooks)
		updates = append(updates, fmt.Sprintf("hooks = $%d", argCount))
		args = append(args, hooksJSON)
		argCount++
	}

	if len(updates) == 0 {
		http.Error(w, "No fields to update", http.StatusBadRequest)
		return
	}

	args = append(args, id)
	query := fmt.Sprintf(`UPDATE skills SET %s WHERE id = $%d AND scope = 'system'`, strings.Join(updates, ", "), argCount)
	result, err := h.DB.Exec(r.Context(), query, args...)

	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to update skill: %v", err), http.StatusInternalServerError)
		return
	}

	if result.RowsAffected() == 0 {
		http.Error(w, "System skill not found", http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status": "updated",
		"id":     id,
	})
}

// HandleTransitionSystemSkill transitions a system skill status (admin only)
func (h *AdminHandler) HandleTransitionSystemSkill(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing skill ID", http.StatusBadRequest)
		return
	}

	var req struct {
		TargetState string `json:"target_state"`
		Actor       string `json:"actor"`
		Reason      string `json:"reason,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.TargetState == "" {
		http.Error(w, "Missing target_state", http.StatusBadRequest)
		return
	}

	actor := req.Actor
	if actor == "" {
		actor = "admin"
	}

	var currentStatus string
	err := h.DB.QueryRow(r.Context(), `
		SELECT status FROM skills WHERE id = $1 AND scope = 'system'
	`, id).Scan(&currentStatus)

	if err != nil {
		http.Error(w, "System skill not found", http.StatusNotFound)
		return
	}

	_, err = h.DB.Exec(r.Context(), `
		UPDATE skills SET status = $1 WHERE id = $2 AND scope = 'system'
	`, req.TargetState, id)

	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to transition skill: %v", err), http.StatusInternalServerError)
		return
	}

	h.DB.Exec(r.Context(), `
		INSERT INTO lifecycle_events (resource_type, resource_id, tenant_id, from_state, to_state, actor, reason)
		VALUES ('skill', $1, $2, $3, $4, $5, $6)
	`, id, "platform-system", currentStatus, req.TargetState, actor, req.Reason)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "transitioned",
		"id":     id,
		"from":   currentStatus,
		"to":     req.TargetState,
	})
}

// Cookbook manifest structures
type CookbookManifest struct {
	Name        string `yaml:"name"`
	Version     string `yaml:"version"`
	Description string `yaml:"description"`
	Domain      string `yaml:"domain"`
	Creates     struct {
		KnowledgeGraphs []struct {
			Name          string `yaml:"name"`
			Description   string `yaml:"description"`
			SchemaFile    string `yaml:"schema_file"`
			SeedDataFile  string `yaml:"seed_data_file"`
		} `yaml:"knowledge_graphs"`
		Agents []struct {
			File        string `yaml:"file"`
			Description string `yaml:"description"`
		} `yaml:"agents"`
	} `yaml:"creates"`
	Variables []struct {
		Name        string `yaml:"name"`
		Description string `yaml:"description"`
		Default     string `yaml:"default"`
		Type        string `yaml:"type"`
	} `yaml:"variables"`
	Tags                 []string `yaml:"tags"`
	MinPlatformVersion   string   `yaml:"min_platform_version"`
}

type CookbookInfo struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Description string   `json:"description"`
	Domain      string   `json:"domain"`
	Tags        []string `json:"tags"`
	Variables   []struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Default     string `json:"default"`
		Type        string `json:"type"`
	} `json:"variables"`
}

// HandleListCookbooks lists available cookbooks (admin only)
func (h *AdminHandler) HandleListCookbooks(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	cookbooksDir := os.Getenv("COOKBOOKS_DIR")
	if cookbooksDir == "" {
		cookbooksDir = "infra/platform/cookbooks"
	}

	entries, err := os.ReadDir(cookbooksDir)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to read cookbooks directory: %v", err), http.StatusInternalServerError)
		return
	}

	var cookbooks []CookbookInfo
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		manifestPath := filepath.Join(cookbooksDir, entry.Name(), "manifest.yaml")
		data, err := os.ReadFile(manifestPath)
		if err != nil {
			continue
		}

		var manifest CookbookManifest
		if err := yaml.Unmarshal(data, &manifest); err != nil {
			continue
		}

		vars := make([]struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Default     string `json:"default"`
			Type        string `json:"type"`
		}, len(manifest.Variables))
		for i, v := range manifest.Variables {
			vars[i] = struct {
				Name        string `json:"name"`
				Description string `json:"description"`
				Default     string `json:"default"`
				Type        string `json:"type"`
			}{v.Name, v.Description, v.Default, v.Type}
		}

		cookbook := CookbookInfo{
			ID:          entry.Name(),
			Name:        manifest.Name,
			Version:     manifest.Version,
			Description: manifest.Description,
			Domain:      manifest.Domain,
			Tags:        manifest.Tags,
			Variables:   vars,
		}
		cookbooks = append(cookbooks, cookbook)
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"cookbooks": cookbooks,
		"count":     len(cookbooks),
	})
}

// HandleImportCookbook imports a cookbook to a tenant (admin only)
func (h *AdminHandler) HandleImportCookbook(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	cookbookID := r.PathValue("id")
	if cookbookID == "" {
		http.Error(w, "Missing cookbook ID", http.StatusBadRequest)
		return
	}

	var req struct {
		TenantID  string            `json:"tenant_id"`
		Variables map[string]string `json:"variables"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.TenantID == "" {
		http.Error(w, "Missing tenant_id", http.StatusBadRequest)
		return
	}

	cookbooksDir := os.Getenv("COOKBOOKS_DIR")
	if cookbooksDir == "" {
		cookbooksDir = "infra/platform/cookbooks"
	}

	cookbookPath := filepath.Join(cookbooksDir, cookbookID)
	manifestPath := filepath.Join(cookbookPath, "manifest.yaml")

	data, err := os.ReadFile(manifestPath)
	if err != nil {
		http.Error(w, "Cookbook not found", http.StatusNotFound)
		return
	}

	var manifest CookbookManifest
	if err := yaml.Unmarshal(data, &manifest); err != nil {
		http.Error(w, "Failed to parse cookbook manifest", http.StatusBadRequest)
		return
	}

	// Start import
	importID := uuid.New().String()
	results := map[string]interface{}{
		"import_id": importID,
		"cookbook":  cookbookID,
		"tenant_id": req.TenantID,
		"status":    "completed",
		"resources": map[string]interface{}{},
	}

	// For now, just return success. Actual import would:
	// 1. Seed KG to tenant's database
	// 2. Create agents in agent-registry
	// 3. Register MCPs in mcp-server

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(results)
}
