package service

// lite_handler.go — async execution for AgentTierLite agents.
//
// Architecture (matches the same contract as Temporal-based agents):
//
//   POST /api/v1/sessions  (HandleStartSession)
//     → generates a "lite-wf-<agent>-<session>" ID
//     → fires goroutine to run LLM + tools
//     → returns immediately: {"workflow_id": "lite-wf-...", "status": "RUNNING"}
//
//   GET /api/v1/sessions/{id}/poll  (HandlePollSession — existing)
//     → checks liteStore first; if found, returns cached events + status
//     → api-gateway and frontend poll exactly as they do for Temporal workflows
//
// This means the api-gateway and agent-studio need ZERO changes.

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/agent-platform/go-shared/pkg/models"
)

// ── In-memory store for lite session state ────────────────────────────────────

type liteSession struct {
	events    []models.AgentEvent
	status    string // "RUNNING" | "COMPLETED" | "FAILED"
	mu        sync.RWMutex
}

var (
	liteStore   sync.Map // map[workflowID string]*liteSession
)

// IsLiteSession returns true if the workflow ID belongs to a lite session.
func IsLiteSession(workflowID string) bool {
	_, ok := liteStore.Load(workflowID)
	return ok
}

// GetLiteSessionState returns events from index `from` and current status.
// Returns nil, "" if the session doesn't exist.
func GetLiteSessionState(workflowID string, from int) ([]models.AgentEvent, string) {
	v, ok := liteStore.Load(workflowID)
	if !ok {
		return nil, ""
	}
	s := v.(*liteSession)
	s.mu.RLock()
	defer s.mu.RUnlock()
	if from >= len(s.events) {
		return []models.AgentEvent{}, s.status
	}
	return s.events[from:], s.status
}

// HandleLiteSession starts an async lite execution and returns a session handle.
// The caller (HandleStartSession) returns this to the api-gateway as a normal
// SessionStatus JSON response — no streaming on this path.
func HandleLiteSession(w http.ResponseWriter, _ *http.Request, req models.StartSessionRequest) {
	manifest := req.Manifest

	// ── Execution limits ──────────────────────────────────────────────────────
	// Default 90 s: must be generous enough for a local LLM to process large
	// prompts (e.g. with injected KG context). The HTTP client inside callLiteLLM
	// already allows 60 s per request, so the context deadline must be at least
	// that plus overhead. Agent config can still lower this floor.
	maxDuration := 90 * time.Second
	maxToolCalls := 2
	if manifest != nil {
		cfg := manifest.ExecutionConfig
		if cfg.MaxDurationSeconds > 0 {
			// Respect agent config but floor at 60 s so LLM always has a chance
			// to respond (local models can be slow on first token).
			configured := time.Duration(cfg.MaxDurationSeconds) * time.Second
			if configured > maxDuration {
				maxDuration = configured
			} else if configured >= 60*time.Second {
				maxDuration = configured
			}
			// If < 60 s keep the 90 s default — prevents foot-guns where agents
			// are created with a 10 s limit that breaks when KG context is large.
		}
		if cfg.MaxToolCalls != nil {
			maxToolCalls = *cfg.MaxToolCalls
		}
	}

	workflowID := fmt.Sprintf("lite-wf-%s-%s", req.AgentID, req.SessionID)

	// Register session in store before spawning goroutine
	sess := &liteSession{status: "RUNNING"}
	liteStore.Store(workflowID, sess)

	// ── Fire and forget ───────────────────────────────────────────────────────
	go runLiteSession(workflowID, sess, req, maxDuration, maxToolCalls)

	// ── Return session handle immediately (same shape as Temporal response) ───
	resp := models.SessionStatus{
		WorkflowID: workflowID,
		RunID:      workflowID, // no Temporal run ID; reuse workflow ID
		Status:     "RUNNING",
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(resp)
}

// runLiteSession performs the actual LLM call and appends events to the session.
func runLiteSession(workflowID string, sess *liteSession, req models.StartSessionRequest, maxDuration time.Duration, maxToolCalls int) {
	manifest := req.Manifest

	ctx, cancel := context.WithTimeout(context.Background(), maxDuration)
	defer cancel()

	emit := func(ev models.AgentEvent) {
		sess.mu.Lock()
		sess.events = append(sess.events, ev)
		sess.mu.Unlock()
	}

	markDone := func(status string) {
		sess.mu.Lock()
		sess.status = status
		sess.mu.Unlock()
	}

	// ── Extract manifest fields ───────────────────────────────────────────────
	systemPrompt := "You are a helpful assistant."
	model := ""
	var skills []models.SkillRef

	if manifest != nil {
		if manifest.SystemPrompt != "" {
			systemPrompt = manifest.SystemPrompt
		}
		model = manifest.Model
		skills = manifest.Skills
	}
	if model == "" {
		model = os.Getenv("DEFAULT_MODEL")
	}
	if model == "" {
		model = "gpt-4o-mini"
	}

	prompt := req.Prompt
	if prompt == "" {
		prompt = "Hello"
	}

	log.Printf("[LITE] agent=%s model=%s timeout=%s maxTools=%d workflowID=%s",
		req.AgentID, model, maxDuration, maxToolCalls, workflowID)

	emit(models.AgentEvent{Type: "thinking", Content: "Processing your request..."})

	// ── Resolve tools ─────────────────────────────────────────────────────────
	toolDefs, toolHandlers := resolveLiteTools(ctx, req.AgentID, req.TenantID, skills)

	// ── LLM call ─────────────────────────────────────────────────────────────
	liteLLMURL := os.Getenv("LITELLM_URL")
	if liteLLMURL == "" {
		liteLLMURL = "http://localhost:4000"
	}
	liteLLMKey := os.Getenv("LITELLM_MASTER_KEY")
	if liteLLMKey == "" {
		liteLLMKey = "sk-litellm-dev"
	}

	messages := []map[string]string{
		{"role": "system", "content": systemPrompt},
		{"role": "user", "content": prompt},
	}

	responseText, toolCallsMade, err := callLiteLLM(
		ctx, liteLLMURL, liteLLMKey, model, messages,
		toolDefs, maxToolCalls, emit, toolHandlers,
	)
	if err != nil {
		log.Printf("[LITE] agent=%s failed: %v", req.AgentID, err)
		emit(models.AgentEvent{Type: "error", Content: fmt.Sprintf("Agent failed: %v", err)})
		emit(models.AgentEvent{Type: "done"})
		markDone("FAILED")
		return
	}

	log.Printf("[LITE] agent=%s completed tool_calls=%d response_len=%d", req.AgentID, toolCallsMade, len(responseText))
	emit(models.AgentEvent{Type: "text", Content: responseText})
	emit(models.AgentEvent{Type: "done"})
	markDone("COMPLETED")

	// Clean up store after a TTL so memory doesn't grow unbounded
	go func() {
		time.Sleep(5 * time.Minute)
		liteStore.Delete(workflowID)
	}()
}

// callLiteLLM makes a chat completion call (with optional tool use loop).
func callLiteLLM(
	ctx context.Context,
	baseURL, apiKey, model string,
	messages []map[string]string,
	toolDefs []map[string]any,
	maxToolCalls int,
	emit func(models.AgentEvent),
	toolHandlers map[string]liteToolHandler,
) (string, int, error) {
	toolCallsMade := 0

	// Build a generic message list we can extend with tool results
	var enriched []map[string]any
	for _, m := range messages {
		enriched = append(enriched, map[string]any{"role": m["role"], "content": m["content"]})
	}

	for attempt := 0; attempt <= maxToolCalls; attempt++ {
		body := map[string]any{
			"model":    model,
			"messages": enriched,
		}
		if len(toolDefs) > 0 && toolCallsMade < maxToolCalls {
			body["tools"] = toolDefs
			body["tool_choice"] = "auto"
		}

		respBody, err := postJSON(ctx, baseURL+"/chat/completions", apiKey, body)
		if err != nil {
			return "", toolCallsMade, fmt.Errorf("LLM request: %w", err)
		}

		var resp struct {
			Choices []struct {
				Message struct {
					Role      string `json:"role"`
					Content   string `json:"content"`
					ToolCalls []struct {
						ID       string `json:"id"`
						Function struct {
							Name      string `json:"name"`
							Arguments string `json:"arguments"`
						} `json:"function"`
					} `json:"tool_calls"`
				} `json:"message"`
			} `json:"choices"`
		}
		if err := json.Unmarshal(respBody, &resp); err != nil {
			return "", toolCallsMade, fmt.Errorf("parse LLM response: %w", err)
		}
		if len(resp.Choices) == 0 {
			return "", toolCallsMade, fmt.Errorf("empty choices from LLM")
		}

		choice := resp.Choices[0].Message

		// No tool call → done
		if len(choice.ToolCalls) == 0 {
			return strings.TrimSpace(choice.Content), toolCallsMade, nil
		}

		// Execute one tool call
		tc := choice.ToolCalls[0]
		toolCallsMade++

		var toolArgs map[string]any
		json.Unmarshal([]byte(tc.Function.Arguments), &toolArgs)

		emit(models.AgentEvent{
			Type:     "tool_call",
			ToolName: tc.Function.Name,
			ToolArgs: toolArgs,
		})
		log.Printf("[LITE] tool_call name=%s", tc.Function.Name)

		toolResult := "Tool not available"
		if handler, ok := toolHandlers[tc.Function.Name]; ok {
			if r, herr := handler(ctx, toolArgs); herr != nil {
				toolResult = fmt.Sprintf("Error: %v", herr)
			} else {
				toolResult = r
			}
		}

		emit(models.AgentEvent{
			Type:       "tool_call",
			ToolName:   tc.Function.Name,
			ToolArgs:   toolArgs,
			ToolResult: toolResult,
		})

		// Append assistant message + tool result to history
		enriched = append(enriched,
			map[string]any{
				"role":       "assistant",
				"tool_calls": choice.ToolCalls,
			},
			map[string]any{
				"role":         "tool",
				"tool_call_id": tc.ID,
				"content":      toolResult,
			},
		)
	}

	return "", toolCallsMade, fmt.Errorf("exceeded max tool calls (%d)", maxToolCalls)
}

// liteToolHandler executes a named tool.
type liteToolHandler func(ctx context.Context, args map[string]any) (string, error)

// resolveLiteTools fetches skill definitions from the skill-catalog and returns
// OpenAI-compatible tool schemas + handler closures. Fails gracefully.
func resolveLiteTools(ctx context.Context, agentID, tenantID string, skills []models.SkillRef) ([]map[string]any, map[string]liteToolHandler) {
	if len(skills) == 0 {
		return nil, nil
	}

	toolCtx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()

	skillCatalogURL := os.Getenv("SKILL_CATALOG_URL")
	if skillCatalogURL == "" {
		skillCatalogURL = "http://localhost:8082"
	}

	var toolDefs []map[string]any
	handlers := make(map[string]liteToolHandler)

	for _, skill := range skills {
		url := fmt.Sprintf("%s/api/v1/skills/%s", skillCatalogURL, skill.Name)
		req, err := http.NewRequestWithContext(toolCtx, http.MethodGet, url, nil)
		if err != nil {
			continue
		}
		if tenantID != "" {
			req.Header.Set("X-Tenant-ID", tenantID)
		}

		resp, err := registryHTTPClient.Do(req)
		if err != nil || resp.StatusCode != http.StatusOK {
			log.Printf("[LITE] skill fetch failed for %s: %v", skill.Name, err)
			if resp != nil {
				resp.Body.Close()
			}
			continue
		}
		defer resp.Body.Close()

		var skillDef models.SkillDefinition
		if err := json.NewDecoder(resp.Body).Decode(&skillDef); err != nil {
			continue
		}

		toolDefs = append(toolDefs, map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        skillDef.Name,
				"description": skillDef.Description,
				"parameters":  skillDef.Parameters,
			},
		})

		skillName := skillDef.Name
		handlers[skillName] = func(ctx context.Context, args map[string]any) (string, error) {
			return executeSkillViaDispatcher(ctx, skillName, tenantID, agentID, args)
		}
	}

	return toolDefs, handlers
}

func executeSkillViaDispatcher(ctx context.Context, skillName, tenantID, agentID string, args map[string]any) (string, error) {
	dispatcherURL := os.Getenv("SKILL_CATALOG_URL")
	if dispatcherURL == "" {
		dispatcherURL = "http://localhost:8082"
	}

	payload := map[string]any{
		"skill_name": skillName,
		"agent_id":   agentID,
		"arguments":  args,
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		dispatcherURL+"/api/v1/skills/dispatch", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if tenantID != "" {
		req.Header.Set("X-Tenant-ID", tenantID)
	}

	resp, err := registryHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("skill dispatch: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("skill dispatch returned %d", resp.StatusCode)
	}

	var result struct {
		Output string `json:"output"`
		Result string `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if result.Output != "" {
		return result.Output, nil
	}
	return result.Result, nil
}

func postJSON(ctx context.Context, url, apiKey string, body map[string]any) ([]byte, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("HTTP POST %s: %w", url, err)
	}
	defer resp.Body.Close()

	var buf bytes.Buffer
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	for scanner.Scan() {
		buf.Write(scanner.Bytes())
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("LLM API error %d: %s", resp.StatusCode, buf.String())
	}
	return buf.Bytes(), nil
}
