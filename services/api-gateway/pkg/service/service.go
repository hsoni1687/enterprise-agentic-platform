package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/agent-platform/go-shared/pkg/models"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

// IdempotencyStore deduplicates inbound webhook events by idempotency key.
type IdempotencyStore interface {
	Get(key string) (*models.IdempotencyEntry, bool)
	Set(key string, entry models.IdempotencyEntry)
}

// InMemoryIdempotencyStore is a thread-safe, sync.Map-backed implementation.
// Keys are never evicted; use a Redis-backed store in production for TTL support.
type InMemoryIdempotencyStore struct {
	m sync.Map
}

func NewInMemoryIdempotencyStore() *InMemoryIdempotencyStore {
	return &InMemoryIdempotencyStore{}
}

func (s *InMemoryIdempotencyStore) Get(key string) (*models.IdempotencyEntry, bool) {
	v, ok := s.m.Load(key)
	if !ok {
		return nil, false
	}
	e := v.(models.IdempotencyEntry)
	return &e, true
}

func (s *InMemoryIdempotencyStore) Set(key string, entry models.IdempotencyEntry) {
	s.m.Store(key, entry)
}

// GatewayHandler handles requests to the API Gateway.
type GatewayHandler struct {
	InitiatorURL     string
	IdempotencyStore IdempotencyStore
}

// HandleTriggerAgent handles triggering an agent workflow.
func (h *GatewayHandler) HandleTriggerAgent(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("agent_id")
	if agentID == "" {
		http.Error(w, "agent_id is required", http.StatusBadRequest)
		return
	}

	var triggerReq models.TriggerRequest
	if err := json.NewDecoder(r.Body).Decode(&triggerReq); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Return cached workflow ID for duplicate idempotency keys (NFR9).
	if h.IdempotencyStore != nil && triggerReq.IdempotencyKey != "" {
		if cached, ok := h.IdempotencyStore.Get(triggerReq.IdempotencyKey); ok {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(models.TriggerResponse{
				WorkflowID: cached.WorkflowID,
				RunID:      cached.RunID,
				Status:     "RUNNING",
			})
			return
		}
	}

	startReq := models.StartSessionRequest{
		AgentID:        agentID,
		SessionID:      fmt.Sprintf("sess-%d", time.Now().UnixMilli()),
		IdempotencyKey: triggerReq.IdempotencyKey,
		Context:        map[string]string{"source": triggerReq.EventSource},
	}
	body, _ := json.Marshal(startReq)

	resp, err := http.Post(fmt.Sprintf("%s/api/v1/sessions", h.InitiatorURL), "application/json", bytes.NewBuffer(body))
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to call initiator: %v", err), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		var errBody bytes.Buffer
		errBody.ReadFrom(resp.Body)
		http.Error(w, fmt.Sprintf("Initiator failed: %s", errBody.String()), http.StatusBadGateway)
		return
	}

	var sessionStatus models.SessionStatus
	if err := json.NewDecoder(resp.Body).Decode(&sessionStatus); err != nil {
		http.Error(w, "Failed to decode initiator response", http.StatusInternalServerError)
		return
	}

	triggerResp := models.TriggerResponse{
		WorkflowID: sessionStatus.WorkflowID,
		RunID:      sessionStatus.RunID,
		Status:     sessionStatus.Status,
	}

	// Cache the result for future duplicate requests.
	if h.IdempotencyStore != nil && triggerReq.IdempotencyKey != "" {
		h.IdempotencyStore.Set(triggerReq.IdempotencyKey, models.IdempotencyEntry{
			WorkflowID: sessionStatus.WorkflowID,
			RunID:      sessionStatus.RunID,
			CreatedAt:  time.Now(),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(triggerResp)
}

// HandleGetSessionStatus proxies the status request to the Workflow Initiator.
func (h *GatewayHandler) HandleGetSessionStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "workflow id is required", http.StatusBadRequest)
		return
	}

	resp, err := http.Get(fmt.Sprintf("%s/api/v1/sessions/%s", h.InitiatorURL, id))
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to call initiator: %v", err), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		http.Error(w, "Initiator failed to find session", http.StatusNotFound)
		return
	}

	var status models.SessionStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		http.Error(w, "Failed to decode response", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// HandleChatStream starts an agent workflow for the given agent ID and streams
// its events back to the caller as Server-Sent Events.
// Supports both GET (query params) and POST (JSON body) for message input.
func (h *GatewayHandler) HandleChatStream(w http.ResponseWriter, r *http.Request) {
	agentID := r.PathValue("id")
	if agentID == "" {
		http.Error(w, "agent id is required", http.StatusBadRequest)
		return
	}

	var message, tenantID string

	if r.Method == http.MethodPost {
		var chatReq models.ChatRequest
		if err := json.NewDecoder(r.Body).Decode(&chatReq); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		message = chatReq.Message
		tenantID = chatReq.TenantID
	} else {
		// GET: read from query params
		message = r.URL.Query().Get("message")
		tenantID = r.URL.Query().Get("tenant_id")
	}

	if message == "" {
		http.Error(w, "message is required", http.StatusBadRequest)
		return
	}

	if tenantID == "" {
		tenantID = r.Header.Get("X-Tenant-ID")
	}
	if tenantID == "" {
		tenantID = "default-tenant"
	}

	// Start the workflow.
	startReq := models.StartSessionRequest{
		AgentID:   agentID,
		SessionID: fmt.Sprintf("chat-%d", time.Now().UnixMilli()),
		TenantID:  tenantID,
		Prompt:    message,
	}
	body, _ := json.Marshal(startReq)
	initiatorResp, err := http.Post(
		fmt.Sprintf("%s/api/v1/sessions", h.InitiatorURL),
		"application/json",
		bytes.NewBuffer(body),
	)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to start session: %v", err), http.StatusBadGateway)
		return
	}
	defer initiatorResp.Body.Close()
	if initiatorResp.StatusCode != http.StatusCreated {
		var buf bytes.Buffer
		buf.ReadFrom(initiatorResp.Body)
		http.Error(w, fmt.Sprintf("initiator error: %s", buf.String()), http.StatusBadGateway)
		return
	}
	var session models.SessionStatus
	if err := json.NewDecoder(initiatorResp.Body).Decode(&session); err != nil {
		http.Error(w, "failed to decode session", http.StatusInternalServerError)
		return
	}

	// Set SSE response headers.
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	// Commit headers immediately so the client sees the stream open.
	fmt.Fprintf(w, ": connected\n\n")
	flusher.Flush()

	poll := &http.Client{Timeout: 5 * time.Second}
	cursor := 0
	terminal := map[string]bool{
		"COMPLETED": true, "FAILED": true,
		"CANCELED": true, "TIMED_OUT": true, "TERMINATED": true,
	}

	writeEvent := func(ev models.AgentEvent) {
		data, _ := json.Marshal(ev)
		fmt.Fprintf(w, "data: %s\n\n", data)
	}

	for {
		select {
		case <-r.Context().Done():
			return
		default:
		}

		// Fetch events and status in a single poll call.
		pollURL := fmt.Sprintf("%s/api/v1/sessions/%s/poll?from=%d", h.InitiatorURL, session.WorkflowID, cursor)
		if pollResp, err := poll.Get(pollURL); err == nil {
			var pr models.PollResponse
			if json.NewDecoder(pollResp.Body).Decode(&pr) == nil {
				// Stream any new events.
				if len(pr.Events) > 0 {
					for _, ev := range pr.Events {
						writeEvent(ev)
						cursor++
					}
					flusher.Flush()
				}
				// Check if workflow is terminal.
				if terminal[pr.Status] {
					if pr.Status != "COMPLETED" {
						writeEvent(models.AgentEvent{Type: "error", Content: pr.Status})
					}
					flusher.Flush()
					pollResp.Body.Close()
					return
				}
			}
			pollResp.Body.Close()
		}

		time.Sleep(50 * time.Millisecond)
	}
}

// HandleChatWS upgrades to WebSocket and streams agent events using the /poll endpoint.
func (h *GatewayHandler) HandleChatWS(w http.ResponseWriter, r *http.Request) {
	_ = r
	agentID := r.PathValue("id")
	if agentID == "" {
		http.Error(w, "agent id is required", http.StatusBadRequest)
		return
	}

	// Upgrade to WebSocket
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{"localhost:3000", "localhost:3001", "127.0.0.1:*"},
	})
	if err != nil {
		fmt.Printf("WebSocket upgrade failed for %s: %v\n", r.URL.Path, err)
		http.Error(w, fmt.Sprintf("WebSocket upgrade failed: %v", err), http.StatusBadRequest)
		return
	}
	defer conn.Close(websocket.StatusInternalError, "")

	// Read initial chat request
	// Use Background context instead of request context since WebSocket takes over the connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var chatReq models.ChatRequest
	if err := wsjson.Read(ctx, conn, &chatReq); err != nil {
		conn.Close(websocket.StatusProtocolError, fmt.Sprintf("read error: %v", err))
		return
	}

	message := chatReq.Message
	if message == "" {
		message = "Hello"
	}
	tenantID := chatReq.TenantID
	if tenantID == "" {
		tenantID = r.Header.Get("X-Tenant-ID")
	}
	if tenantID == "" {
		tenantID = "default-tenant"
	}

	// Start the workflow
	startReq := models.StartSessionRequest{
		AgentID:   agentID,
		SessionID: fmt.Sprintf("chat-%d", time.Now().UnixMilli()),
		TenantID:  tenantID,
		Prompt:    message,
	}
	body, _ := json.Marshal(startReq)
	initiatorResp, err := http.Post(
		fmt.Sprintf("%s/api/v1/sessions", h.InitiatorURL),
		"application/json",
		bytes.NewBuffer(body),
	)
	if err != nil {
		wsjson.Write(r.Context(), conn, models.AgentEvent{Type: "error", Content: fmt.Sprintf("failed to start session: %v", err)})
		conn.Close(websocket.StatusInternalError, "")
		return
	}
	defer initiatorResp.Body.Close()

	if initiatorResp.StatusCode != http.StatusCreated {
		var buf bytes.Buffer
		buf.ReadFrom(initiatorResp.Body)
		wsjson.Write(r.Context(), conn, models.AgentEvent{Type: "error", Content: fmt.Sprintf("initiator error: %s", buf.String())})
		conn.Close(websocket.StatusInternalError, "")
		return
	}

	var session models.SessionStatus
	if err := json.NewDecoder(initiatorResp.Body).Decode(&session); err != nil {
		wsjson.Write(r.Context(), conn, models.AgentEvent{Type: "error", Content: "failed to decode session"})
		conn.Close(websocket.StatusInternalError, "")
		return
	}

	poll := &http.Client{Timeout: 5 * time.Second}
	cursor := 0
	terminal := map[string]bool{
		"COMPLETED": true, "FAILED": true,
		"CANCELED": true, "TIMED_OUT": true, "TERMINATED": true,
	}

	// Poll loop
	for {
		select {
		case <-r.Context().Done():
			conn.Close(websocket.StatusNormalClosure, "")
			return
		default:
		}

		// Fetch events and status in a single poll call
		pollURL := fmt.Sprintf("%s/api/v1/sessions/%s/poll?from=%d", h.InitiatorURL, session.WorkflowID, cursor)
		if pollResp, err := poll.Get(pollURL); err == nil {
			var pr models.PollResponse
			if json.NewDecoder(pollResp.Body).Decode(&pr) == nil {
				// Stream any new events
				for _, ev := range pr.Events {
					if err := wsjson.Write(r.Context(), conn, ev); err != nil {
						pollResp.Body.Close()
						conn.Close(websocket.StatusInternalError, "")
						return
					}
					cursor++
				}

				// Check if workflow is terminal
				if terminal[pr.Status] {
					if pr.Status != "COMPLETED" {
						wsjson.Write(r.Context(), conn, models.AgentEvent{Type: "error", Content: pr.Status})
					}
					pollResp.Body.Close()
					conn.Close(websocket.StatusNormalClosure, "")
					return
				}
			}
			pollResp.Body.Close()
		}

		time.Sleep(50 * time.Millisecond)
	}
}

// HandleManifestAssistantChat handles manifest assistant chat requests via a system agent.
func (h *GatewayHandler) HandleManifestAssistantChat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Message  string `json:"message"`
		TenantID string `json:"tenant_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Message == "" {
		http.Error(w, "message is required", http.StatusBadRequest)
		return
	}

	if req.TenantID == "" {
		req.TenantID = "platform-system"
	}

	// Start a manifest assistant workflow session
	sessionID := fmt.Sprintf("manifest-assist-%d", time.Now().UnixMilli())
	startReq := models.StartSessionRequest{
		AgentID:   "manifest-assistant",
		SessionID: sessionID,
		Context: map[string]string{
			"mode":    "manifest-assistant",
			"message": req.Message,
		},
		TenantID: req.TenantID,
	}
	body, _ := json.Marshal(startReq)

	resp, err := http.Post(fmt.Sprintf("%s/api/v1/sessions", h.InitiatorURL), "application/json", bytes.NewBuffer(body))
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to start manifest assistant: %v", err), http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		var errBody bytes.Buffer
		errBody.ReadFrom(resp.Body)
		http.Error(w, fmt.Sprintf("Manifest assistant failed: %s", errBody.String()), http.StatusBadGateway)
		return
	}

	var session models.SessionStatus
	if err := json.NewDecoder(resp.Body).Decode(&session); err != nil {
		http.Error(w, "Failed to parse session response", http.StatusInternalServerError)
		return
	}

	// Stream events from the workflow
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming not supported", http.StatusInternalServerError)
		return
	}

	// Connect message
	fmt.Fprintf(w, ": connected\n\n")
	flusher.Flush()

	// Poll for events
	poll := &http.Client{Timeout: 5 * time.Second}
	cursor := 0
	terminal := map[string]bool{
		"COMPLETED": true, "FAILED": true,
		"CANCELED": true, "TIMED_OUT": true, "TERMINATED": true,
	}

	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		default:
		}

		pollURL := fmt.Sprintf("%s/api/v1/sessions/%s/poll?from=%d", h.InitiatorURL, session.WorkflowID, cursor)
		if pollResp, err := poll.Get(pollURL); err == nil {
			var pr models.PollResponse
			if json.NewDecoder(pollResp.Body).Decode(&pr) == nil {
				// Stream any new events
				if len(pr.Events) > 0 {
					for _, evt := range pr.Events {
						data, _ := json.Marshal(evt)
						fmt.Fprintf(w, "data: %s\n\n", data)
						flusher.Flush()
					}
					cursor += len(pr.Events)
				}

				// Check if workflow is terminal
				if terminal[pr.Status] {
					if pr.Status != "COMPLETED" {
						fmt.Fprintf(w, "data: {\"type\":\"error\",\"content\":\"%s\"}\n\n", pr.Status)
					}
					fmt.Fprintf(w, "data: {\"type\":\"done\"}\n\n")
					flusher.Flush()
					pollResp.Body.Close()
					return
				}
			}
			pollResp.Body.Close()
		}

		time.Sleep(50 * time.Millisecond)
	}
}

// HandleHealth returns the health status of the service.
func (h *GatewayHandler) HandleHealth(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "API Gateway is healthy\n")
}
