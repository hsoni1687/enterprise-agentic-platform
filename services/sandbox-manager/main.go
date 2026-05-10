package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/agent-platform/sandbox-manager/pkg/sandbox"
)

func main() {
	executor, err := sandbox.NewExecutor()
	if err != nil {
		log.Fatalf("Failed to initialize Docker executor: %v", err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("POST /api/v1/execute", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Code string `json:"code"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		result, err := executor.ExecutePython(r.Context(), req.Code)
		if err != nil {
			http.Error(w, fmt.Sprintf("Execution failed: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"result": result})
	})

	mux.HandleFunc("POST /api/v1/web-search", handleWebSearch(executor))

	log.Println("Starting Sandbox Manager on :8082")
	if err := http.ListenAndServe(":8082", mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "Sandbox Manager is healthy\n")
}

func handleWebSearch(executor *sandbox.Executor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Args struct {
				Query      string `json:"query"`
				MaxResults int    `json:"max_results"`
			} `json:"args"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		if req.Args.Query == "" {
			http.Error(w, "query is required", http.StatusBadRequest)
			return
		}

		if req.Args.MaxResults == 0 {
			req.Args.MaxResults = 10
		}

		// Web search - return sample results based on query (mock implementation)
		pythonCode := fmt.Sprintf(`
import json

query = %q
max_results = %d

# Mock search results for development
mock_results = {
    "claude": [
        {"title": "Claude AI - Anthropic", "url": "https://claude.ai", "snippet": "Claude is an AI assistant made by Anthropic."},
        {"title": "Claude API Documentation", "url": "https://docs.anthropic.com", "snippet": "Build with Claude using the Anthropic API."},
        {"title": "Claude 3 - Latest Models", "url": "https://anthropic.com/claude", "snippet": "Introducing Claude 3: Opus, Sonnet, and Haiku models."}
    ],
    "default": [
        {"title": "Search Result 1", "url": "https://example.com/1", "snippet": "Result for: " + query},
        {"title": "Search Result 2", "url": "https://example.com/2", "snippet": "More information about: " + query},
        {"title": "Search Result 3", "url": "https://example.com/3", "snippet": "Additional details on: " + query}
    ]
}

# Find best match for query
results = mock_results.get("default")
for key in mock_results:
    if key.lower() in query.lower():
        results = mock_results[key]
        break

output = {
    "results": results[:max_results],
    "total": len(results),
    "query": query,
    "note": "Mock search results (development environment)"
}
print(json.dumps(output))
`, req.Args.Query, req.Args.MaxResults)

		result, err := executor.ExecutePython(r.Context(), pythonCode)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error": fmt.Sprintf("Search failed: %v", err),
				"results": []interface{}{},
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(result))
	}
}
