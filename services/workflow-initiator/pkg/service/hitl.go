package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
)

// HITLApprovalRequest represents a pending HITL approval
type HITLApprovalRequest struct {
	ID           string                 `json:"id"`
	WorkflowID   string                 `json:"workflow_id"`
	AgentID      string                 `json:"agent_id"`
	TenantID     string                 `json:"tenant_id"`
	ToolName     string                 `json:"tool_name"`
	ToolArgs     map[string]interface{} `json:"tool_args"`
	Reason       string                 `json:"reason"`
	CreatedAt    time.Time              `json:"created_at"`
	Status       string                 `json:"status"` // pending, approved, denied
	ApprovedBy   string                 `json:"approved_by,omitempty"`
	ApprovedAt   time.Time              `json:"approved_at,omitempty"`
	DenialReason string                 `json:"denial_reason,omitempty"`
}

// ErrApprovalNotFound is returned when no approval matches the id within the
// caller's tenant. It is deliberately indistinguishable from a wrong-tenant
// lookup so callers cannot probe the existence of other tenants' approvals.
var ErrApprovalNotFound = errors.New("approval not found")

// ErrApprovalProcessed is returned when an approval has already been decided.
var ErrApprovalProcessed = errors.New("approval already processed")

// HITLStore is the persistence contract for HITL approvals. The default
// implementation is in-memory (per-replica); InitHITLStore swaps in a durable,
// shared Postgres-backed implementation when a database is configured.
type HITLStore interface {
	// Store inserts a pending approval. The id is caller-supplied so the value
	// the workflow emits over SSE is the same value the operator approves.
	Store(ctx context.Context, a *HITLApprovalRequest) error
	Get(ctx context.Context, id, tenantID string) (*HITLApprovalRequest, error)
	ListPending(ctx context.Context, tenantID string) ([]*HITLApprovalRequest, error)
	// Transition atomically moves a pending approval to newStatus, but only if
	// it belongs to tenantID. Returns ErrApprovalNotFound (missing or wrong
	// tenant) or ErrApprovalProcessed (already decided).
	Transition(ctx context.Context, id, tenantID, newStatus, approverID, denialReason string) (*HITLApprovalRequest, error)
}

// approvalStore is the active store. Defaults to in-memory so behaviour is
// unchanged until InitHITLStore is called at startup.
var approvalStore HITLStore = newInMemoryHITLStore()

// InitHITLStore switches the active store to Postgres. Call once at startup; if
// db is nil the in-memory store remains in effect.
func InitHITLStore(db *sql.DB) {
	if db != nil {
		approvalStore = &postgresHITLStore{db: db}
	}
}

// ── Package-level API (delegates to the active store) ─────────────────────────

// StoreHITLApproval stores a pending HITL approval request and returns its id.
// If id is empty a new one is generated (legacy callers); the workflow path
// passes its own deterministic approval_id so the SSE event and the store agree.
func StoreHITLApproval(ctx context.Context, id, workflowID, agentID, tenantID, toolName, reason string, toolArgs map[string]interface{}) string {
	if id == "" {
		id = fmt.Sprintf("hitl-%s", uuid.New().String()[:8])
	}
	a := &HITLApprovalRequest{
		ID:         id,
		WorkflowID: workflowID,
		AgentID:    agentID,
		TenantID:   tenantID,
		ToolName:   toolName,
		ToolArgs:   toolArgs,
		Reason:     reason,
		CreatedAt:  time.Now(),
		Status:     "pending",
	}
	if err := approvalStore.Store(ctx, a); err != nil {
		// Non-fatal for the caller, but log so the failure is observable.
		fmt.Printf("[HITL] failed to store approval %s: %v\n", id, err)
	}
	return id
}

func GetPendingHITLApprovals(ctx context.Context, tenantID string) []*HITLApprovalRequest {
	pending, err := approvalStore.ListPending(ctx, tenantID)
	if err != nil {
		fmt.Printf("[HITL] failed to list pending approvals for tenant %s: %v\n", tenantID, err)
		return nil
	}
	return pending
}

// ApproveHITLRequest approves a pending HITL request owned by tenantID.
func ApproveHITLRequest(ctx context.Context, id, tenantID, approverID string) error {
	approval, err := approvalStore.Transition(ctx, id, tenantID, "approved", approverID, "")
	if err != nil {
		return err
	}
	if approval.WorkflowID != "" {
		_ = SendWorkflowSignal(approval.WorkflowID, "hitl_response", map[string]string{
			"decision":    "approved",
			"approval_id": id,
		})
	}
	return nil
}

// DenyHITLRequest denies a pending HITL request owned by tenantID.
func DenyHITLRequest(ctx context.Context, id, tenantID, approverID, reason string) error {
	approval, err := approvalStore.Transition(ctx, id, tenantID, "denied", approverID, reason)
	if err != nil {
		return err
	}
	if approval.WorkflowID != "" {
		_ = SendWorkflowSignal(approval.WorkflowID, "hitl_response", map[string]string{
			"decision":    "denied",
			"approval_id": id,
			"reason":      reason,
		})
	}
	return nil
}

// ── In-memory implementation (per-replica fallback) ───────────────────────────

type inMemoryHITLStore struct {
	mu sync.Mutex
	m  map[string]*HITLApprovalRequest
}

func newInMemoryHITLStore() *inMemoryHITLStore {
	return &inMemoryHITLStore{m: make(map[string]*HITLApprovalRequest)}
}

func (s *inMemoryHITLStore) Store(_ context.Context, a *HITLApprovalRequest) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[a.ID] = a
	return nil
}

func (s *inMemoryHITLStore) Get(_ context.Context, id, tenantID string) (*HITLApprovalRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.m[id]
	if !ok || a.TenantID != tenantID {
		return nil, ErrApprovalNotFound
	}
	return a, nil
}

func (s *inMemoryHITLStore) ListPending(_ context.Context, tenantID string) ([]*HITLApprovalRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var pending []*HITLApprovalRequest
	for _, a := range s.m {
		if a.TenantID == tenantID && a.Status == "pending" {
			pending = append(pending, a)
		}
	}
	return pending, nil
}

func (s *inMemoryHITLStore) Transition(_ context.Context, id, tenantID, newStatus, approverID, denialReason string) (*HITLApprovalRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.m[id]
	if !ok || a.TenantID != tenantID {
		return nil, ErrApprovalNotFound
	}
	if a.Status != "pending" {
		return nil, ErrApprovalProcessed
	}
	a.Status = newStatus
	a.ApprovedBy = approverID
	a.ApprovedAt = time.Now()
	if denialReason != "" {
		a.DenialReason = denialReason
	}
	return a, nil
}

// ── Postgres implementation (durable, shared) ─────────────────────────────────

type postgresHITLStore struct {
	db *sql.DB
}

func (s *postgresHITLStore) Store(ctx context.Context, a *HITLApprovalRequest) error {
	argsJSON, err := json.Marshal(a.ToolArgs)
	if err != nil {
		argsJSON = []byte("{}")
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO hitl_approvals (id, workflow_id, agent_id, tenant_id, tool_name, tool_args, reason, status, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'pending', $8)
		 ON CONFLICT (id) DO NOTHING`,
		a.ID, a.WorkflowID, a.AgentID, a.TenantID, a.ToolName, string(argsJSON), a.Reason, a.CreatedAt,
	)
	return err
}

func scanApproval(row interface {
	Scan(dest ...interface{}) error
}) (*HITLApprovalRequest, error) {
	a := &HITLApprovalRequest{}
	var argsJSON []byte
	var approvedAt sql.NullTime
	if err := row.Scan(&a.ID, &a.WorkflowID, &a.AgentID, &a.TenantID, &a.ToolName,
		&argsJSON, &a.Reason, &a.Status, &a.ApprovedBy, &approvedAt, &a.DenialReason, &a.CreatedAt); err != nil {
		return nil, err
	}
	if len(argsJSON) > 0 {
		json.Unmarshal(argsJSON, &a.ToolArgs)
	}
	if approvedAt.Valid {
		a.ApprovedAt = approvedAt.Time
	}
	return a, nil
}

const hitlCols = `id, workflow_id, agent_id, tenant_id, tool_name, tool_args, reason, status, approved_by, approved_at, denial_reason, created_at`

func (s *postgresHITLStore) Get(ctx context.Context, id, tenantID string) (*HITLApprovalRequest, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+hitlCols+` FROM hitl_approvals WHERE id = $1 AND tenant_id = $2`, id, tenantID)
	a, err := scanApproval(row)
	if err == sql.ErrNoRows {
		return nil, ErrApprovalNotFound
	}
	return a, err
}

func (s *postgresHITLStore) ListPending(ctx context.Context, tenantID string) ([]*HITLApprovalRequest, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+hitlCols+` FROM hitl_approvals WHERE tenant_id = $1 AND status = 'pending' ORDER BY created_at ASC`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var pending []*HITLApprovalRequest
	for rows.Next() {
		a, err := scanApproval(rows)
		if err != nil {
			return nil, err
		}
		pending = append(pending, a)
	}
	return pending, rows.Err()
}

func (s *postgresHITLStore) Transition(ctx context.Context, id, tenantID, newStatus, approverID, denialReason string) (*HITLApprovalRequest, error) {
	// Atomic: only a row that is still pending AND owned by tenantID is updated.
	row := s.db.QueryRowContext(ctx,
		`UPDATE hitl_approvals
		 SET status = $3, approved_by = $4, approved_at = now(), denial_reason = $5
		 WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
		 RETURNING `+hitlCols,
		id, tenantID, newStatus, approverID, denialReason)
	a, err := scanApproval(row)
	if err == nil {
		return a, nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}
	// No row updated: distinguish "already processed" from "missing/wrong tenant".
	existing, getErr := s.Get(ctx, id, tenantID)
	if getErr != nil {
		return nil, ErrApprovalNotFound
	}
	if existing.Status != "pending" {
		return nil, ErrApprovalProcessed
	}
	return nil, ErrApprovalNotFound
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

// HandleGetPendingApprovals GET /api/v1/approvals/pending
func HandleGetPendingApprovals(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}

	approvals := GetPendingHITLApprovals(r.Context(), tenantID)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(approvals)
}

// HandleApproveRequest POST /api/v1/approvals/{id}/approve
func HandleApproveRequest(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}

	id := r.PathValue("id")
	approverID := r.Header.Get("X-User-ID")
	if approverID == "" {
		approverID = "anonymous"
	}

	if err := ApproveHITLRequest(r.Context(), id, tenantID, approverID); err != nil {
		if errors.Is(err, ErrApprovalNotFound) {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "approved"})
}

// HandleDenyRequest POST /api/v1/approvals/{id}/deny
func HandleDenyRequest(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}

	id := r.PathValue("id")
	approverID := r.Header.Get("X-User-ID")
	if approverID == "" {
		approverID = "anonymous"
	}

	var req struct {
		Reason string `json:"reason"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	if err := DenyHITLRequest(r.Context(), id, tenantID, approverID, req.Reason); err != nil {
		if errors.Is(err, ErrApprovalNotFound) {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "denied"})
}
