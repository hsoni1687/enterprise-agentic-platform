package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/agent-platform/admin-api/pkg/service"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.temporal.io/sdk/client"
)

func main() {
	// Database setup
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5433/agentplatform"
	}

	dbPool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Fatalf("Failed to create db pool: %v", err)
	}
	defer dbPool.Close()

	adminAPIKey := os.Getenv("ADMIN_API_KEY")
	if adminAPIKey == "" {
		adminAPIKey = "dev-admin-key"
	}

	// Temporal client setup
	temporalHostPort := os.Getenv("TEMPORAL_HOSTPORT")
	if temporalHostPort == "" {
		temporalHostPort = "localhost:7233"
	}
	temporalClient, err := client.Dial(client.Options{HostPort: temporalHostPort})
	if err != nil {
		log.Fatalf("Failed to connect to Temporal: %v", err)
	}
	defer temporalClient.Close()

	agentRegistryURL := os.Getenv("AGENT_REGISTRY_URL")
	if agentRegistryURL == "" {
		agentRegistryURL = "http://localhost:8088"
	}

	kgServiceURL := os.Getenv("KG_SERVICE_URL")
	if kgServiceURL == "" {
		kgServiceURL = "http://localhost:8093"
	}

	liteLLMURL := os.Getenv("LITELLM_URL")
	if liteLLMURL == "" {
		liteLLMURL = "http://localhost:4000"
	}

	liteLLMMasterKey := os.Getenv("LITELLM_MASTER_KEY")
	if liteLLMMasterKey == "" {
		liteLLMMasterKey = "sk-litellm-dev"
	}

	handler := &service.AdminHandler{
		DB:               dbPool,
		AdminKey:         adminAPIKey,
		TemporalClient:   temporalClient,
		AgentRegistryURL: agentRegistryURL,
		KGServiceURL:     kgServiceURL,
		LiteLLMURL:       liteLLMURL,
		LiteLLMMasterKey: liteLLMMasterKey,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handler.HandleHealth)
	mux.Handle("POST /api/v1/admin/auth/verify", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleAuthVerify)))

	// Tenant Management
	mux.Handle("GET /api/v1/admin/tenants", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleListTenants)))
	mux.Handle("POST /api/v1/admin/tenants", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleCreateTenant)))
	mux.Handle("GET /api/v1/admin/tenants/{id}", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleGetTenant)))
	mux.Handle("PUT /api/v1/admin/tenants/{id}/quota", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleUpdateTenantQuota)))
	mux.Handle("PUT /api/v1/admin/tenants/{id}/status", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleUpdateTenantStatus)))

	// LLM Configuration
	mux.Handle("GET /api/v1/admin/llm/config", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleGetLLMConfig)))
	mux.Handle("PUT /api/v1/admin/llm/config", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandlePutLLMConfig)))

	// System Agents
	mux.Handle("GET /api/v1/admin/system-agents", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleListSystemAgents)))
	mux.Handle("GET /api/v1/admin/system-agents/{id}", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleGetSystemAgent)))
	mux.Handle("PUT /api/v1/admin/system-agents/{id}", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleUpdateSystemAgent)))

	// Execution Visualizer
	mux.Handle("GET /api/v1/admin/executions", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleListExecutions)))
	mux.Handle("GET /api/v1/admin/executions/{id}", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleGetExecution)))
	mux.Handle("GET /api/v1/admin/executions/{id}/events", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleGetExecutionEvents)))

	// Cost Tracking
	mux.Handle("GET /api/v1/admin/cost", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleGetCostSummary)))
	mux.Handle("GET /api/v1/admin/cost/{tenant_id}", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleGetCostByTenant)))

	// Audit Log
	mux.Handle("GET /api/v1/admin/audit", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleGetAuditLog)))

	// System Tools Management
	mux.Handle("GET /api/v1/admin/system-tools", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleListSystemTools)))
	mux.Handle("POST /api/v1/admin/system-tools", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleCreateSystemTool)))
	mux.Handle("PUT /api/v1/admin/system-tools/{id}", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleUpdateSystemTool)))
	mux.Handle("POST /api/v1/admin/system-tools/{id}/transition", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleTransitionSystemTool)))

	// System Skills Management
	mux.Handle("GET /api/v1/admin/system-skills", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleListSystemSkills)))
	mux.Handle("POST /api/v1/admin/system-skills", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleCreateSystemSkill)))
	mux.Handle("PUT /api/v1/admin/system-skills/{id}", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleUpdateSystemSkill)))
	mux.Handle("POST /api/v1/admin/system-skills/{id}/transition", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleTransitionSystemSkill)))

	// MCP Server Management
	mux.Handle("POST /api/v1/admin/mcp/servers", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleCreateGlobalMCPServer)))
	mux.Handle("GET /api/v1/admin/mcp/servers", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleListGlobalMCPServers)))
	mux.Handle("DELETE /api/v1/admin/mcp/servers/{id}", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleDeleteGlobalMCPServer)))

	// Cookbook Management
	mux.Handle("GET /api/v1/admin/cookbooks", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleListCookbooks)))
	mux.Handle("GET /api/v1/admin/cookbooks/{id}", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleGetCookbook)))
	mux.Handle("PUT /api/v1/admin/cookbooks/{id}/files", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleUpdateCookbookFile)))
	mux.Handle("POST /api/v1/admin/cookbooks/{id}/import", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleImportCookbook)))

	// Platform Guardrails
	mux.Handle("GET /api/v1/admin/guardrails", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleListGuardrails)))
	mux.Handle("POST /api/v1/admin/guardrails", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleCreateGuardrail)))
	mux.Handle("PUT /api/v1/admin/guardrails/{id}", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleUpdateGuardrail)))
	mux.Handle("POST /api/v1/admin/guardrails/{id}/toggle", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleToggleGuardrail)))

	// Platform Hooks
	mux.Handle("GET /api/v1/admin/hooks", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleListHooks)))
	mux.Handle("POST /api/v1/admin/hooks", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleCreateHook)))
	mux.Handle("PUT /api/v1/admin/hooks/{id}", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleUpdateHook)))
	mux.Handle("POST /api/v1/admin/hooks/{id}/toggle", authMiddleware(adminAPIKey, http.HandlerFunc(handler.HandleToggleHook)))

	// Public read-only catalog (no admin key — used by agent-studio)
	mux.HandleFunc("GET /api/v1/platform/guardrails", handler.HandlePublicListGuardrails)
	mux.HandleFunc("GET /api/v1/platform/hooks", handler.HandlePublicListHooks)

	log.Printf("Starting Admin API on :8089 (Admin Key: %s...)", adminAPIKey[:10])
	if err := http.ListenAndServe(":8089", withCORS(mux)); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Key, X-Tenant-ID")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func authMiddleware(expectedKey string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			authHeader = r.Header.Get("X-Admin-Key")
		}

		if authHeader == "" {
			http.Error(w, "Unauthorized: missing Authorization header", http.StatusUnauthorized)
			return
		}

		// Expect "Bearer <key>" format
		if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
			authHeader = authHeader[7:]
		}

		if authHeader != expectedKey {
			http.Error(w, "Unauthorized: invalid key", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}
