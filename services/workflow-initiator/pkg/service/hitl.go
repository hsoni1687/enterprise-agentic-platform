package service

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
)

// HITLApprovalRequest represents a pending HITL approval
type HITLApprovalRequest struct {
	ID            string                 `json:"id"`
	WorkflowID    string                 `json:"workflow_id"`
	AgentID       string                 `json:"agent_id"`
	TenantID      string                 `json:"tenant_id"`
	ToolName      string                 `json:"tool_name"`
	ToolArgs      map[string]interface{} `json:"tool_args"`
	Reason        string                 `json:"reason"`
	CreatedAt     time.Time              `json:"created_at"`
	Status        string                 `json:"status"` // pending, approved, denied
	ApprovedBy    string                 `json:"approved_by,omitempty"`
	ApprovedAt    time.Time              `json:"approved_at,omitempty"`
	DenialReason  string                 `json:"denial_reason,omitempty"`
}

var (
	hitlApprovals sync.Map // map[string]*HITLApprovalRequest
)

// StoreHITLApproval stores a pending HITL approval request
func StoreHITLApproval(workflowID, agentID, tenantID, toolName, reason string, toolArgs map[string]interface{}) string {
	id := fmt.Sprintf("hitl-%s", uuid.New().String()[:8])

	approval := &HITLApprovalRequest{
		ID:        id,
		WorkflowID: workflowID,
		AgentID:   agentID,
		TenantID:  tenantID,
		ToolName:  toolName,
		ToolArgs:  toolArgs,
		Reason:    reason,
		CreatedAt: time.Now(),
		Status:    "pending",
	}

	hitlApprovals.Store(id, approval)
	return id
}

// GetHITLApproval retrieves a single HITL approval request
func GetHITLApproval(id string) *HITLApprovalRequest {
	val, ok := hitlApprovals.Load(id)
	if !ok {
		return nil
	}
	return val.(*HITLApprovalRequest)
}

// GetPendingHITLApprovals returns all pending approvals for a tenant
func GetPendingHITLApprovals(tenantID string) []*HITLApprovalRequest {
	var pending []*HITLApprovalRequest
	hitlApprovals.Range(func(key, value interface{}) bool {
		approval := value.(*HITLApprovalRequest)
		if approval.TenantID == tenantID && approval.Status == "pending" {
			pending = append(pending, approval)
		}
		return true
	})
	return pending
}

// ApproveHITLRequest approves a pending HITL request
func ApproveHITLRequest(id, approverID string) error {
	approval := GetHITLApproval(id)
	if approval == nil {
		return fmt.Errorf("approval not found: %s", id)
	}
	if approval.Status != "pending" {
		return fmt.Errorf("approval already processed: %s", id)
	}

	approval.Status = "approved"
	approval.ApprovedBy = approverID
	approval.ApprovedAt = time.Now()
	hitlApprovals.Store(id, approval)

	// Send Temporal signal to unblock the agent workflow
	if approval.WorkflowID != "" {
		_ = SendWorkflowSignal(approval.WorkflowID, "hitl_response", map[string]string{
			"decision":    "approved",
			"approval_id": id,
		})
	}
	return nil
}

// DenyHITLRequest denies a pending HITL request
func DenyHITLRequest(id, approverID, reason string) error {
	approval := GetHITLApproval(id)
	if approval == nil {
		return fmt.Errorf("approval not found: %s", id)
	}
	if approval.Status != "pending" {
		return fmt.Errorf("approval already processed: %s", id)
	}

	approval.Status = "denied"
	approval.ApprovedBy = approverID
	approval.ApprovedAt = time.Now()
	approval.DenialReason = reason
	hitlApprovals.Store(id, approval)

	// Send Temporal signal to unblock the agent workflow
	if approval.WorkflowID != "" {
		_ = SendWorkflowSignal(approval.WorkflowID, "hitl_response", map[string]string{
			"decision":    "denied",
			"approval_id": id,
			"reason":      reason,
		})
	}
	return nil
}

// HandleGetPendingApprovals GET /api/v1/approvals/pending
func HandleGetPendingApprovals(w http.ResponseWriter, r *http.Request) {
	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}

	approvals := GetPendingHITLApprovals(tenantID)
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

	if err := ApproveHITLRequest(id, approverID); err != nil {
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

	if err := DenyHITLRequest(id, approverID, req.Reason); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "denied"})
}
