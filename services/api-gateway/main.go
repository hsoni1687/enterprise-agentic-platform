package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/agent-platform/api-gateway/pkg/service"
	hmacpkg "github.com/agent-platform/webhook-security/pkg/hmac"
	"github.com/agent-platform/webhook-security/pkg/middleware"
)

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		logMsg := fmt.Sprintf("[CORS] Request: method=%s, path=%s, upgrade=%s\n", r.Method, r.URL.Path, r.Header.Get("Upgrade"))
		os.WriteFile("/tmp/cors.log", []byte(logMsg), 0644)
		log.Printf("[CORS] Request: method=%s, path=%s, upgrade=%s", r.Method, r.URL.Path, r.Header.Get("Upgrade"))
		if r.URL.Path == "/api/v1/agents/test-agent-valid/ws" {
			log.Printf("WebSocket request: method=%s, upgrade=%s, connection=%s", r.Method, r.Header.Get("Upgrade"), r.Header.Get("Connection"))
		}
		// Skip CORS handling for WebSocket upgrade requests
		if r.Header.Get("Upgrade") == "websocket" {
			log.Printf("[CORS] WebSocket upgrade requested for %s", r.URL.Path)
			os.WriteFile("/tmp/cors.log", []byte(fmt.Sprintf("[CORS] WebSocket upgrade for %s\n", r.URL.Path)), 0644)
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Tenant-ID")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	initiatorURL := os.Getenv("WORKFLOW_INITIATOR_URL")
	if initiatorURL == "" {
		initiatorURL = "http://localhost:8081"
	}

	hmacSecret := []byte(os.Getenv("WEBHOOK_HMAC_SECRET"))
	if len(hmacSecret) == 0 {
		hmacSecret = []byte("dev-secret")
	}

	hmacMW := middleware.ValidateHMAC(
		hmacpkg.New(300),
		func(_ *http.Request) ([]byte, error) { return hmacSecret, nil },
	)

	// Idempotency store: Postgres-backed (shared across replicas) when a DB URL
	// is configured, otherwise a per-replica in-memory fallback for local dev.
	var store service.IdempotencyStore = service.NewInMemoryIdempotencyStore()
	if pgStore, err := service.NewPostgresIdempotencyStoreFromEnv(); err != nil {
		log.Printf("WARNING: idempotency falling back to in-memory (Postgres unreachable): %v", err)
	} else if pgStore != nil {
		store = pgStore
		log.Println("[gateway] idempotency store: Postgres")
	}

	// Chat history store — non-fatal if Postgres is unreachable at startup.
	chatStore, err := service.NewChatStore()
	if err != nil {
		log.Printf("WARNING: chat history unavailable (Postgres unreachable): %v", err)
		chatStore = nil
	}

	h := &service.GatewayHandler{
		InitiatorURL:     initiatorURL,
		IdempotencyStore: store,
		ChatStore:        chatStore,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.HandleHealth)
	mux.Handle("POST /api/v1/agents/{agent_id}/trigger", hmacMW(http.HandlerFunc(h.HandleTriggerAgent)))
	mux.HandleFunc("GET /api/v1/sessions/{id}/status", h.HandleGetSessionStatus)
	mux.HandleFunc("POST /api/v1/agents/manifest-assistant/chat", h.HandleManifestAssistantChat)
	mux.HandleFunc("GET /api/v1/agents/{id}/chat", h.HandleChatStream)
	mux.HandleFunc("POST /api/v1/agents/{id}/chat", h.HandleChatStream)
	mux.HandleFunc("GET /api/v1/agents/{id}/ws", h.HandleChatWS)

	// Chat session history endpoints
	mux.HandleFunc("GET /api/v1/agents/{id}/chat/sessions", h.HandleListSessions)
	mux.HandleFunc("POST /api/v1/agents/{id}/chat/sessions", h.HandleCreateSession)
	mux.HandleFunc("GET /api/v1/agents/{id}/chat/sessions/{sid}", h.HandleGetSession)
	mux.HandleFunc("POST /api/v1/agents/{id}/chat/sessions/{sid}/messages", h.HandleAppendMessages)
	mux.HandleFunc("DELETE /api/v1/agents/{id}/chat/sessions/{sid}", h.HandleDeleteSession)

	log.Printf("Starting API Gateway on :8080 (Initiator: %s)", initiatorURL)
	if err := http.ListenAndServe(":8080", withCORS(mux)); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
