package main

import (
	"log"
	"net/http"

	"github.com/agent-platform/workflow-initiator/pkg/service"
)

// corsMiddleware adds CORS headers to allow browser requests from localhost:3000
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Tenant-ID, X-User-ID, Authorization")
		w.Header().Set("Access-Control-Max-Age", "3600")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func main() {
	// Initialize Temporal client
	if err := service.InitTemporalClient(); err != nil {
		log.Fatalf("Failed to initialize Temporal client: %v", err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", service.HandleHealth)
	mux.HandleFunc("POST /api/v1/sessions", service.HandleStartSession)
	mux.HandleFunc("GET /api/v1/sessions/{id}", service.HandleGetSessionStatus)
	mux.HandleFunc("GET /api/v1/sessions/{id}/events", service.HandleGetSessionEvents)
	mux.HandleFunc("GET /api/v1/sessions/{id}/poll", service.HandlePollSession)

	// HITL Approval endpoints
	mux.HandleFunc("POST /api/v1/approvals", service.HandleStoreHITLApproval)
	mux.HandleFunc("GET /api/v1/approvals/pending", service.HandleGetPendingApprovals)
	mux.HandleFunc("POST /api/v1/approvals/{id}/approve", service.HandleApproveRequest)
	mux.HandleFunc("POST /api/v1/approvals/{id}/deny", service.HandleDenyRequest)

	log.Println("Starting Workflow Initiator on :8081")
	if err := http.ListenAndServe(":8081", corsMiddleware(mux)); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
