package service

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/agent-platform/go-shared/pkg/models"
	"github.com/agent-platform/agent-registry/pkg/store"
)

type Handler struct {
	store store.Store
}

func NewHandler(s store.Store) *Handler {
	return &Handler{store: s}
}

func BuildMux(h *Handler) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.handleHealth)
	mux.HandleFunc("POST /api/v1/agents", h.handleCreate)
	mux.HandleFunc("GET /api/v1/agents", h.handleList)
	mux.HandleFunc("GET /api/v1/agents/{id}", h.handleGetByID)
	mux.HandleFunc("PUT /api/v1/agents/{id}", h.handleUpdate)
	mux.HandleFunc("POST /api/v1/agents/{id}/transition", h.handleTransition)
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
