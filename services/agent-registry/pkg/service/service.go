package service

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/agent-platform/go-shared/pkg/models"
	"github.com/agent-platform/agent-registry/pkg/store"
)

type Handler struct {
	store store.Store
	db    *sql.DB // raw DB for proposal queries (not in the Store interface)
}

func NewHandler(s store.Store) *Handler {
	return &Handler{store: s}
}

// NewHandlerWithDB creates a Handler that also has direct DB access for
// improvement-proposal queries that live outside the Store interface.
func NewHandlerWithDB(s store.Store, db *sql.DB) *Handler {
	return &Handler{store: s, db: db}
}

func BuildMux(h *Handler) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.handleHealth)
	mux.HandleFunc("POST /api/v1/agents", h.handleCreate)
	mux.HandleFunc("GET /api/v1/agents", h.handleList)
	mux.HandleFunc("GET /api/v1/agents/{id}", h.handleGetByID)
	mux.HandleFunc("PUT /api/v1/agents/{id}", h.handleUpdate)
	mux.HandleFunc("POST /api/v1/agents/{id}/transition", h.handleTransition)
	// Self-improvement: proposal management
	mux.HandleFunc("GET /api/v1/agents/{id}/improvements", h.handleListImprovements)
	mux.HandleFunc("POST /api/v1/agents/{id}/improvements/{proposal_id}/accept", h.handleAcceptImprovement)
	mux.HandleFunc("POST /api/v1/agents/{id}/improvements/{proposal_id}/dismiss", h.handleDismissImprovement)
	return mux
}

func tenantID(r *http.Request) (string, bool) {
	tid := r.Header.Get("X-Tenant-ID")
	return tid, tid != ""
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func (h *Handler) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("agent-registry healthy\n"))
}

func (h *Handler) handleCreate(w http.ResponseWriter, r *http.Request) {
	tid, ok := tenantID(r)
	if !ok {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}

	var manifest models.AgentManifest
	if err := json.NewDecoder(r.Body).Decode(&manifest); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	manifest.TenantID = tid

	rec := &store.AgentRecord{
		AgentManifest: manifest,
		Status:        models.StatusDraft,
		CreatedAt:     time.Now(),
	}

	if err := h.store.Create(r.Context(), rec); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, rec)
}

func (h *Handler) handleGetByID(w http.ResponseWriter, r *http.Request) {
	tid, ok := tenantID(r)
	if !ok {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}

	id := r.PathValue("id")
	rec, err := h.store.GetByID(r.Context(), id, tid)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

func (h *Handler) handleList(w http.ResponseWriter, r *http.Request) {
	tid, ok := tenantID(r)
	if !ok {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}

	f := store.ListFilter{
		TenantID: tid,
		Status:   r.URL.Query().Get("status"),
		Tier:     r.URL.Query().Get("tier"),
	}
	records, err := h.store.List(r.Context(), f)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if records == nil {
		records = []*store.AgentRecord{}
	}
	writeJSON(w, http.StatusOK, records)
}

func (h *Handler) handleUpdate(w http.ResponseWriter, r *http.Request) {
	tid, ok := tenantID(r)
	if !ok {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}

	id := r.PathValue("id")

	existing, err := h.store.GetByID(r.Context(), id, tid)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var manifest models.AgentManifest
	if err := json.NewDecoder(r.Body).Decode(&manifest); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	manifest.ID = id
	manifest.TenantID = tid

	rec := &store.AgentRecord{
		AgentManifest: manifest,
		Status:        existing.Status,
		CreatedAt:     existing.CreatedAt,
	}

	if err := h.store.Update(r.Context(), rec); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

func (h *Handler) handleTransition(w http.ResponseWriter, r *http.Request) {
	tid, ok := tenantID(r)
	if !ok {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}

	id := r.PathValue("id")
	var req models.TransitionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	target := models.ResourceStatus(req.TargetState)
	err := h.store.Transition(r.Context(), id, tid, target, req.Actor)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}

	rec, _ := h.store.GetByID(r.Context(), id, tid)
	writeJSON(w, http.StatusOK, rec)
}

// ── Improvement proposal types ────────────────────────────────────────────────

type ImprovementProposal struct {
	ID            string     `json:"id"`
	AgentID       string     `json:"agent_id"`
	TenantID      string     `json:"tenant_id"`
	Field         string     `json:"field"`
	CurrentValue  string     `json:"current_value"`
	ProposedValue string     `json:"proposed_value"`
	Rationale     string     `json:"rationale"`
	Status        string     `json:"status"`
	ResolvedAt    *time.Time `json:"resolved_at,omitempty"`
	ResolvedBy    string     `json:"resolved_by,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

// ── GET /api/v1/agents/{id}/improvements ─────────────────────────────────────

func (h *Handler) handleListImprovements(w http.ResponseWriter, r *http.Request) {
	tid, ok := tenantID(r)
	if !ok {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}
	agentID := r.PathValue("id")

	// Verify agent belongs to tenant
	if _, err := h.store.GetByID(r.Context(), agentID, tid); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// No DB connection → return empty list gracefully (in-memory store mode)
	if h.db == nil {
		writeJSON(w, http.StatusOK, []ImprovementProposal{})
		return
	}

	statusFilter := r.URL.Query().Get("status") // optional: pending | accepted | dismissed
	query := `
		SELECT id, agent_id, tenant_id, field,
		       COALESCE(current_value,''), proposed_value, rationale,
		       status, resolved_at, COALESCE(resolved_by,''), created_at
		FROM agent_improvement_proposals
		WHERE agent_id = $1 AND tenant_id = $2`
	args := []any{agentID, tid}
	if statusFilter != "" {
		query += " AND status = $3"
		args = append(args, statusFilter)
	}
	query += " ORDER BY created_at DESC LIMIT 50"

	rows, err := h.db.QueryContext(r.Context(), query, args...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	proposals := []ImprovementProposal{}
	for rows.Next() {
		var p ImprovementProposal
		if err := rows.Scan(
			&p.ID, &p.AgentID, &p.TenantID, &p.Field,
			&p.CurrentValue, &p.ProposedValue, &p.Rationale,
			&p.Status, &p.ResolvedAt, &p.ResolvedBy, &p.CreatedAt,
		); err != nil {
			continue
		}
		proposals = append(proposals, p)
	}
	writeJSON(w, http.StatusOK, proposals)
}

// ── POST /api/v1/agents/{id}/improvements/{proposal_id}/accept ───────────────

func (h *Handler) handleAcceptImprovement(w http.ResponseWriter, r *http.Request) {
	tid, ok := tenantID(r)
	if !ok {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}
	agentID    := r.PathValue("id")
	proposalID := r.PathValue("proposal_id")

	if h.db == nil {
		http.Error(w, "database not available", http.StatusServiceUnavailable)
		return
	}

	// Fetch proposal
	var p ImprovementProposal
	err := h.db.QueryRowContext(r.Context(), `
		SELECT id, agent_id, tenant_id, field,
		       COALESCE(current_value,''), proposed_value, rationale, status
		FROM agent_improvement_proposals
		WHERE id = $1 AND agent_id = $2 AND tenant_id = $3`,
		proposalID, agentID, tid,
	).Scan(&p.ID, &p.AgentID, &p.TenantID, &p.Field,
		&p.CurrentValue, &p.ProposedValue, &p.Rationale, &p.Status)
	if err == sql.ErrNoRows {
		http.Error(w, "proposal not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if p.Status != "pending" {
		http.Error(w, "proposal already resolved", http.StatusConflict)
		return
	}

	// Apply the change to the agent manifest
	existing, err := h.store.GetByID(r.Context(), agentID, tid)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	switch p.Field {
	case "system_prompt":
		existing.SystemPrompt = p.ProposedValue
	case "max_iterations":
		var v int
		if _, scanErr := json.Number(p.ProposedValue).Int64(); scanErr == nil {
			json.Unmarshal([]byte(p.ProposedValue), &v)
			if v > 0 {
				existing.MaxIterations = v
			}
		}
	// skills and general: record accepted but don't auto-apply (requires human review)
	}

	if p.Field == "system_prompt" || p.Field == "max_iterations" {
		if updateErr := h.store.Update(r.Context(), existing); updateErr != nil {
			http.Error(w, updateErr.Error(), http.StatusInternalServerError)
			return
		}
	}

	// Mark proposal as accepted
	now := time.Now()
	h.db.ExecContext(r.Context(), `
		UPDATE agent_improvement_proposals
		SET status = 'accepted', resolved_at = $1, resolved_by = 'user'
		WHERE id = $2`, now, proposalID)

	p.Status     = "accepted"
	p.ResolvedAt = &now
	p.ResolvedBy = "user"
	writeJSON(w, http.StatusOK, p)
}

// ── POST /api/v1/agents/{id}/improvements/{proposal_id}/dismiss ───────────────

func (h *Handler) handleDismissImprovement(w http.ResponseWriter, r *http.Request) {
	tid, ok := tenantID(r)
	if !ok {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}
	agentID    := r.PathValue("id")
	proposalID := r.PathValue("proposal_id")

	if h.db == nil {
		http.Error(w, "database not available", http.StatusServiceUnavailable)
		return
	}

	now := time.Now()
	result, err := h.db.ExecContext(r.Context(), `
		UPDATE agent_improvement_proposals
		SET status = 'dismissed', resolved_at = $1, resolved_by = 'user'
		WHERE id = $2 AND agent_id = $3 AND tenant_id = $4 AND status = 'pending'`,
		now, proposalID, agentID, tid)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		http.Error(w, "proposal not found or already resolved", http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
