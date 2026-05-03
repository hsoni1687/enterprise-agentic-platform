package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/agent-platform/go-shared/pkg/models"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.temporal.io/sdk/client"
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
