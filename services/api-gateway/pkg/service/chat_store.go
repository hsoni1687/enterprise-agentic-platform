package service

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/agent-platform/go-shared/pkg/models"
	_ "github.com/lib/pq" // postgres driver
)

// ChatStore handles persistent chat session storage via Postgres.
type ChatStore struct {
	db *sql.DB
}

// NewChatStore opens a Postgres pool and returns a ready-to-use ChatStore.
// Returns (nil, nil) when POSTGRES_URL is not set — callers must handle gracefully.
func NewChatStore() (*ChatStore, error) {
	dsn := os.Getenv("POSTGRES_URL")
	if dsn == "" {
		dsn = "postgres://postgres:postgres@localhost:5432/agentplatform?sslmode=disable"
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(3)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	log.Println("[ChatStore] Postgres connection established")
	return &ChatStore{db: db}, nil
}

// ── CRUD helpers ──────────────────────────────────────────────────────────────

func (s *ChatStore) createSession(tenantID, agentID, title string) (*models.ChatSession, error) {
	if title == "" {
		title = "New Chat"
	}
	row := s.db.QueryRow(`
		INSERT INTO chat_sessions (tenant_id, agent_id, title)
		VALUES ($1, $2, $3)
		RETURNING id, tenant_id, agent_id, title, created_at, updated_at`,
		tenantID, agentID, title,
	)
	var cs models.ChatSession
	if err := row.Scan(&cs.ID, &cs.TenantID, &cs.AgentID, &cs.Title, &cs.CreatedAt, &cs.UpdatedAt); err != nil {
		return nil, err
	}
	return &cs, nil
}

func (s *ChatStore) listSessions(tenantID, agentID string) ([]models.ChatSession, error) {
	rows, err := s.db.Query(`
		SELECT id, tenant_id, agent_id, title, created_at, updated_at
		FROM   chat_sessions
		WHERE  tenant_id = $1 AND agent_id = $2
		ORDER  BY updated_at DESC
		LIMIT  100`,
		tenantID, agentID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []models.ChatSession
	for rows.Next() {
		var cs models.ChatSession
		if err := rows.Scan(&cs.ID, &cs.TenantID, &cs.AgentID, &cs.Title, &cs.CreatedAt, &cs.UpdatedAt); err != nil {
			return nil, err
		}
		sessions = append(sessions, cs)
	}
	if sessions == nil {
		sessions = []models.ChatSession{}
	}
	return sessions, rows.Err()
}

func (s *ChatStore) getSession(tenantID, agentID, sessionID string) (*models.ChatSession, error) {
	row := s.db.QueryRow(`
		SELECT id, tenant_id, agent_id, title, created_at, updated_at
		FROM   chat_sessions
		WHERE  id = $1 AND tenant_id = $2 AND agent_id = $3`,
		sessionID, tenantID, agentID,
	)
	var cs models.ChatSession
	if err := row.Scan(&cs.ID, &cs.TenantID, &cs.AgentID, &cs.Title, &cs.CreatedAt, &cs.UpdatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	// Load messages
	msgs, err := s.listMessages(sessionID)
	if err != nil {
		return nil, err
	}
	cs.Messages = msgs
	return &cs, nil
}

func (s *ChatStore) listMessages(sessionID string) ([]models.ChatSessionMessage, error) {
	rows, err := s.db.Query(`
		SELECT id, session_id, tenant_id, agent_id, role, content, metadata, created_at
		FROM   chat_messages
		WHERE  session_id = $1
		ORDER  BY created_at ASC`,
		sessionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var msgs []models.ChatSessionMessage
	for rows.Next() {
		var m models.ChatSessionMessage
		var metaRaw []byte
		if err := rows.Scan(&m.ID, &m.SessionID, &m.TenantID, &m.AgentID, &m.Role, &m.Content, &metaRaw, &m.CreatedAt); err != nil {
			return nil, err
		}
		if len(metaRaw) > 0 {
			_ = json.Unmarshal(metaRaw, &m.Metadata)
		}
		msgs = append(msgs, m)
	}
	if msgs == nil {
		msgs = []models.ChatSessionMessage{}
	}
	return msgs, rows.Err()
}

func (s *ChatStore) appendMessages(tenantID, agentID, sessionID string, msgs []models.ChatSessionMessage) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck

	for _, m := range msgs {
		metaJSON, _ := json.Marshal(m.Metadata)
		if metaJSON == nil {
			metaJSON = []byte("{}")
		}
		if _, err := tx.Exec(`
			INSERT INTO chat_messages (session_id, tenant_id, agent_id, role, content, metadata)
			VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
			sessionID, tenantID, agentID, m.Role, m.Content, string(metaJSON),
		); err != nil {
			return err
		}
	}

	// Bump session.updated_at so list stays sorted by most recent activity
	if _, err := tx.Exec(`
		UPDATE chat_sessions SET updated_at = now()
		WHERE  id = $1 AND tenant_id = $2`,
		sessionID, tenantID,
	); err != nil {
		return err
	}

	return tx.Commit()
}

func (s *ChatStore) deleteSession(tenantID, agentID, sessionID string) error {
	_, err := s.db.Exec(`
		DELETE FROM chat_sessions
		WHERE id = $1 AND tenant_id = $2 AND agent_id = $3`,
		sessionID, tenantID, agentID,
	)
	return err
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

// HandleListSessions handles GET /api/v1/agents/{id}/chat/sessions
func (h *GatewayHandler) HandleListSessions(w http.ResponseWriter, r *http.Request) {
	if h.ChatStore == nil {
		jsonOK(w, []models.ChatSession{})
		return
	}
	agentID := r.PathValue("id")
	tenantID := tenantFromReq(r)

	sessions, err := h.ChatStore.listSessions(tenantID, agentID)
	if err != nil {
		log.Printf("[ChatStore] listSessions error: %v", err)
		http.Error(w, "failed to list sessions", http.StatusInternalServerError)
		return
	}
	jsonOK(w, sessions)
}

// HandleCreateSession handles POST /api/v1/agents/{id}/chat/sessions
func (h *GatewayHandler) HandleCreateSession(w http.ResponseWriter, r *http.Request) {
	if h.ChatStore == nil {
		http.Error(w, "chat store unavailable", http.StatusServiceUnavailable)
		return
	}
	agentID := r.PathValue("id")
	tenantID := tenantFromReq(r)

	var req models.CreateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if req.TenantID != "" {
		tenantID = req.TenantID
	}

	cs, err := h.ChatStore.createSession(tenantID, agentID, req.Title)
	if err != nil {
		log.Printf("[ChatStore] createSession error: %v", err)
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(cs) //nolint:errcheck
}

// HandleGetSession handles GET /api/v1/agents/{id}/chat/sessions/{sid}
func (h *GatewayHandler) HandleGetSession(w http.ResponseWriter, r *http.Request) {
	if h.ChatStore == nil {
		http.Error(w, "chat store unavailable", http.StatusServiceUnavailable)
		return
	}
	agentID := r.PathValue("id")
	sessionID := r.PathValue("sid")
	tenantID := tenantFromReq(r)

	cs, err := h.ChatStore.getSession(tenantID, agentID, sessionID)
	if err != nil {
		log.Printf("[ChatStore] getSession error: %v", err)
		http.Error(w, "failed to load session", http.StatusInternalServerError)
		return
	}
	if cs == nil {
		http.Error(w, "session not found", http.StatusNotFound)
		return
	}
	jsonOK(w, cs)
}

// HandleAppendMessages handles POST /api/v1/agents/{id}/chat/sessions/{sid}/messages
func (h *GatewayHandler) HandleAppendMessages(w http.ResponseWriter, r *http.Request) {
	if h.ChatStore == nil {
		http.Error(w, "chat store unavailable", http.StatusServiceUnavailable)
		return
	}
	agentID := r.PathValue("id")
	sessionID := r.PathValue("sid")
	tenantID := tenantFromReq(r)

	var req models.AppendMessagesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	if len(req.Messages) == 0 {
		jsonOK(w, map[string]string{"status": "ok"})
		return
	}

	if err := h.ChatStore.appendMessages(tenantID, agentID, sessionID, req.Messages); err != nil {
		log.Printf("[ChatStore] appendMessages error: %v", err)
		http.Error(w, "failed to save messages", http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]string{"status": "ok"})
}

// HandleDeleteSession handles DELETE /api/v1/agents/{id}/chat/sessions/{sid}
func (h *GatewayHandler) HandleDeleteSession(w http.ResponseWriter, r *http.Request) {
	if h.ChatStore == nil {
		http.Error(w, "chat store unavailable", http.StatusServiceUnavailable)
		return
	}
	agentID := r.PathValue("id")
	sessionID := r.PathValue("sid")
	tenantID := tenantFromReq(r)

	if err := h.ChatStore.deleteSession(tenantID, agentID, sessionID); err != nil {
		log.Printf("[ChatStore] deleteSession error: %v", err)
		http.Error(w, "failed to delete session", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── helpers ───────────────────────────────────────────────────────────────────

func tenantFromReq(r *http.Request) string {
	if t := r.Header.Get("X-Tenant-ID"); t != "" {
		return t
	}
	return "default-tenant"
}

func jsonOK(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}
