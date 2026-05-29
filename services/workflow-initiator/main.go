package main

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"time"

	_ "github.com/lib/pq"

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

// dbURL returns the configured Postgres DSN, preferring DATABASE_URL and
// falling back to POSTGRES_URL (the name used by the migrate job).
func dbURL() string {
	if v := os.Getenv("DATABASE_URL"); v != "" {
		return v
	}
	return os.Getenv("POSTGRES_URL")
}

func main() {
	// Initialize Temporal client
	if err := service.InitTemporalClient(); err != nil {
		log.Fatalf("Failed to initialize Temporal client: %v", err)
	}

	// HITL approval store: durable Postgres when a DB URL is configured, else the
	// per-replica in-memory fallback. Non-fatal if the DB is unreachable.
	if dsn := dbURL(); dsn != "" {
		db, err := sql.Open("postgres", dsn)
		if err != nil {
			log.Printf("WARNING: HITL approvals in-memory (open postgres failed): %v", err)
		} else {
			db.SetMaxOpenConns(10)
			db.SetMaxIdleConns(3)
			db.SetConnMaxLifetime(5 * time.Minute)
			if err := db.Ping(); err != nil {
				log.Printf("WARNING: HITL approvals in-memory (ping failed): %v", err)
			} else {
				service.InitHITLStore(db)
				log.Println("[workflow-initiator] HITL approval store: Postgres")
			}
		}
	}

	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", service.HandleHealth)
	mux.HandleFunc("POST /api/v1/sessions", service.HandleStartSession)
	mux.HandleFunc("GET /api/v1/sessions/{id}", service.HandleGetSessionStatus)
	mux.HandleFunc("GET /api/v1/sessions/{id}/events", service.HandleGetSessionEvents)
	mux.HandleFunc("GET /api/v1/sessions/{id}/poll", service.HandlePollSession)

	// HITL Approval endpoints (mutating-action approve/deny)
	mux.HandleFunc("POST /api/v1/approvals", service.HandleStoreHITLApproval)
	mux.HandleFunc("GET /api/v1/approvals/pending", service.HandleGetPendingApprovals)
	mux.HandleFunc("POST /api/v1/approvals/{id}/approve", service.HandleApproveRequest)
	mux.HandleFunc("POST /api/v1/approvals/{id}/deny", service.HandleDenyRequest)

	// Clarification endpoint — sends a free-text answer back to a paused workflow
	mux.HandleFunc("POST /api/v1/sessions/{id}/clarify", service.HandleClarifySession)

	log.Println("Starting Workflow Initiator on :8081")
	if err := http.ListenAndServe(":8081", corsMiddleware(mux)); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
