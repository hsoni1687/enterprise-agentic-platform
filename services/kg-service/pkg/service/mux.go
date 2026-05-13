package service

import "net/http"

func BuildMux(h *Handler) *http.ServeMux {
	mux := http.NewServeMux()

	// Graphs
	mux.HandleFunc("/graphs/create", h.CreateGraph)
	mux.HandleFunc("/graphs/get", h.GetGraph)
	mux.HandleFunc("/graphs/list", h.ListGraphs)
	mux.HandleFunc("/graphs/update", h.UpdateGraph)
	mux.HandleFunc("/graphs/scope", h.UpdateGraphScope)
	mux.HandleFunc("/graphs/delete", h.DeleteGraph)

	// Nodes
	mux.HandleFunc("/nodes/create", h.CreateNode)
	mux.HandleFunc("/nodes/get", h.GetNode)
	mux.HandleFunc("/nodes/list", h.ListNodes)
	mux.HandleFunc("/nodes/delete", h.DeleteNode)
	mux.HandleFunc("/nodes/reembed", h.ReembedNodes)

	// Edges
	mux.HandleFunc("/edges/create", h.CreateEdge)
	mux.HandleFunc("/edges/list", h.ListEdges)
	mux.HandleFunc("/edges/delete", h.DeleteEdge)

	// Query
	mux.HandleFunc("/query", h.QueryGraph)
	mux.HandleFunc("/search/nodes", h.SearchNodes)
	mux.HandleFunc("/search/semantic", h.SemanticSearch)

	// Health
	mux.HandleFunc("/health", h.Health)

	return mux
}
