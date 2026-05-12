package service

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strconv"

	"github.com/agent-platform/kg-service/pkg/store"
)

type Handler struct {
	store store.Store
}

func NewHandler(s store.Store) *Handler {
	return &Handler{store: s}
}

// ============== Graphs ==============

func (h *Handler) CreateGraph(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, _ := io.ReadAll(r.Body)
	log.Printf("[CreateGraph] Request body: %s", string(body))

	var g store.Graph
	if err := json.Unmarshal(body, &g); err != nil {
		log.Printf("[CreateGraph] Decode error: %v", err)
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}
	log.Printf("[CreateGraph] Decoded graph: %+v", g)

	g.TenantID = r.Header.Get("X-Tenant-ID")
	if g.TenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	ctx := context.WithValue(r.Context(), "tenant_id", g.TenantID)
	result, err := h.store.CreateGraph(ctx, &g)
	if err != nil {
		log.Printf("[CreateGraph] Store error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	log.Printf("[CreateGraph] Result: %+v", result)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) GetGraph(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	graphID := r.URL.Query().Get("id")
	if graphID == "" {
		http.Error(w, "Missing id parameter", http.StatusBadRequest)
		return
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	g, err := h.store.GetGraph(ctx, tenantID, graphID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(g)
}

func (h *Handler) ListGraphs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	graphs, err := h.store.ListGraphs(ctx, tenantID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if graphs == nil {
		graphs = []*store.Graph{}
	}
	json.NewEncoder(w).Encode(graphs)
}

func (h *Handler) UpdateGraph(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var g store.Graph
	if err := json.NewDecoder(r.Body).Decode(&g); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if tenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	g.TenantID = tenantID
	ctx := r.Context()
	result, err := h.store.UpdateGraph(ctx, &g)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) UpdateGraphScope(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Scope      string   `json:"scope"`
		SharedWith []string `json:"shared_with"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	graphID := r.URL.Query().Get("id")
	tenantID := r.Header.Get("X-Tenant-ID")
	if graphID == "" || tenantID == "" {
		http.Error(w, "Missing id or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	if err := h.store.UpdateGraphScope(ctx, tenantID, graphID, req.Scope, req.SharedWith); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteGraph(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	graphID := r.URL.Query().Get("id")
	tenantID := r.Header.Get("X-Tenant-ID")
	if graphID == "" || tenantID == "" {
		http.Error(w, "Missing id or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	if err := h.store.DeleteGraph(ctx, tenantID, graphID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ============== Nodes ==============

func (h *Handler) CreateNode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var n store.Node
	if err := json.NewDecoder(r.Body).Decode(&n); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	n.TenantID = r.Header.Get("X-Tenant-ID")
	if n.TenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	result, err := h.store.CreateNode(ctx, &n)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) GetNode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	nodeID := r.URL.Query().Get("id")
	tenantID := r.Header.Get("X-Tenant-ID")
	if nodeID == "" || tenantID == "" {
		http.Error(w, "Missing id or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	n, err := h.store.GetNode(ctx, tenantID, nodeID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(n)
}

func (h *Handler) ListNodes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	graphID := r.URL.Query().Get("graph_id")
	tenantID := r.Header.Get("X-Tenant-ID")
	if graphID == "" || tenantID == "" {
		http.Error(w, "Missing graph_id or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	nodes, err := h.store.ListNodes(ctx, tenantID, graphID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if nodes == nil {
		nodes = []*store.Node{}
	}
	json.NewEncoder(w).Encode(nodes)
}

func (h *Handler) DeleteNode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	nodeID := r.URL.Query().Get("id")
	tenantID := r.Header.Get("X-Tenant-ID")
	if nodeID == "" || tenantID == "" {
		http.Error(w, "Missing id or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	if err := h.store.DeleteNode(ctx, tenantID, nodeID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ============== Edges ==============

func (h *Handler) CreateEdge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var e store.Edge
	if err := json.NewDecoder(r.Body).Decode(&e); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	e.TenantID = r.Header.Get("X-Tenant-ID")
	if e.TenantID == "" {
		http.Error(w, "Missing X-Tenant-ID header", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	result, err := h.store.CreateEdge(ctx, &e)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) ListEdges(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	graphID := r.URL.Query().Get("graph_id")
	tenantID := r.Header.Get("X-Tenant-ID")
	if graphID == "" || tenantID == "" {
		http.Error(w, "Missing graph_id or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	edges, err := h.store.ListEdges(ctx, tenantID, graphID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if edges == nil {
		edges = []*store.Edge{}
	}
	json.NewEncoder(w).Encode(edges)
}

func (h *Handler) DeleteEdge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	edgeID := r.URL.Query().Get("id")
	tenantID := r.Header.Get("X-Tenant-ID")
	if edgeID == "" || tenantID == "" {
		http.Error(w, "Missing id or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	if err := h.store.DeleteEdge(ctx, tenantID, edgeID); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ============== Query ==============

func (h *Handler) QueryGraph(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var graphID, startNodeID string
	var maxDepth = 3

	if r.Method == http.MethodPost {
		var queryReq struct {
			GraphID     string `json:"graph_id"`
			StartNodeID string `json:"start_node_id"`
			MaxDepth    int    `json:"max_depth,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&queryReq); err == nil {
			graphID = queryReq.GraphID
			startNodeID = queryReq.StartNodeID
			if queryReq.MaxDepth > 0 {
				maxDepth = queryReq.MaxDepth
			}
		}
	} else {
		graphID = r.URL.Query().Get("graph_id")
		startNodeID = r.URL.Query().Get("start_node_id")
		if d := r.URL.Query().Get("max_depth"); d != "" {
			if parsed, err := strconv.Atoi(d); err == nil {
				maxDepth = parsed
			}
		}
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if graphID == "" || startNodeID == "" || tenantID == "" {
		http.Error(w, "Missing graph_id, start_node_id, or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	nodes, edges, err := h.store.QueryGraph(ctx, tenantID, graphID, startNodeID, maxDepth)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	result := map[string]interface{}{
		"nodes": nodes,
		"edges": edges,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) SearchNodes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var graphID, nodeType string
	var limit = 100

	if r.Method == http.MethodPost {
		var searchReq struct {
			GraphID string `json:"graph_id"`
			Type    string `json:"type"`
			Limit   int    `json:"limit,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&searchReq); err == nil {
			graphID = searchReq.GraphID
			nodeType = searchReq.Type
			if searchReq.Limit > 0 {
				limit = searchReq.Limit
			}
		}
	} else {
		graphID = r.URL.Query().Get("graph_id")
		nodeType = r.URL.Query().Get("node_type")
		if l := r.URL.Query().Get("limit"); l != "" {
			if parsed, err := strconv.Atoi(l); err == nil {
				limit = parsed
			}
		}
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if graphID == "" || nodeType == "" || tenantID == "" {
		http.Error(w, "Missing graph_id, node_type, or X-Tenant-ID", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	nodes, err := h.store.SearchNodes(ctx, tenantID, graphID, nodeType, limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if nodes == nil {
		nodes = []*store.Node{}
	}
	json.NewEncoder(w).Encode(nodes)
}

// ============== Health ==============

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if err := h.store.Health(ctx); err != nil {
		http.Error(w, "Health check failed", http.StatusServiceUnavailable)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
}
