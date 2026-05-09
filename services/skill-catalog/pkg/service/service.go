package service

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/agent-platform/go-shared/pkg/models"
	"github.com/agent-platform/skill-catalog/pkg/store"
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
	mux.HandleFunc("POST /api/v1/skills", h.handleCreate)
	mux.HandleFunc("GET /api/v1/skills", h.handleList)
	mux.HandleFunc("GET /api/v1/skills/{id}", h.handleGetByID)
	mux.HandleFunc("PUT /api/v1/skills/{id}", h.handleUpdate)
	mux.HandleFunc("POST /api/v1/skills/{id}/transition", h.handleTransition)
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
	w.Write([]byte("skill-catalog healthy\n"))
}

func (h *Handler) handleCreate(w http.ResponseWriter, r *http.Request) {
	tid, ok := tenantID(r)
	if !ok {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}

	var sk models.SkillManifest
	if err := json.NewDecoder(r.Body).Decode(&sk); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	sk.TenantID = tid
	sk.Status = models.StatusDraft

	if err := h.store.Create(r.Context(), &sk); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, &sk)
}

func (h *Handler) handleGetByID(w http.ResponseWriter, r *http.Request) {
	tid, ok := tenantID(r)
	if !ok {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}

	id := r.PathValue("id")
	sk, err := h.store.GetByID(r.Context(), id, tid)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, sk)
}

func (h *Handler) handleList(w http.ResponseWriter, r *http.Request) {
	tid, ok := tenantID(r)
	if !ok {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}

	f := store.ListFilter{
		TenantID:      tid,
		Status:        r.URL.Query().Get("status"),
		IncludeSystem: r.URL.Query().Get("include_system") == "true",
	}
	skills, err := h.store.List(r.Context(), f)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if skills == nil {
		skills = []*models.SkillManifest{}
	}
	writeJSON(w, http.StatusOK, skills)
}

func (h *Handler) handleUpdate(w http.ResponseWriter, r *http.Request) {
	tid, ok := tenantID(r)
	if !ok {
		http.Error(w, "X-Tenant-ID header required", http.StatusBadRequest)
		return
	}

	id := r.PathValue("id")
	var sk models.SkillManifest
	if err := json.NewDecoder(r.Body).Decode(&sk); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	sk.ID = id
	sk.TenantID = tid

	if err := h.store.Update(r.Context(), &sk); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if errors.Is(err, store.ErrForbidden) {
			http.Error(w, "forbidden: system resource is immutable", http.StatusForbidden)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, &sk)
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
	err := h.store.Transition(r.Context(), id, tid, target, req.Actor, req.Reason)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if errors.Is(err, store.ErrForbidden) {
			http.Error(w, "forbidden: system resource is immutable", http.StatusForbidden)
			return
		}
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)
		return
	}

	sk, _ := h.store.GetByID(r.Context(), id, tid)
	writeJSON(w, http.StatusOK, sk)
}
