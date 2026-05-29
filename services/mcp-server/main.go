package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"

	_ "github.com/lib/pq"
	"github.com/a1-agent-engine/mcp-server/pkg/service"
)

func main() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5433/agentplatform"
	}

	skillCatalogURL := os.Getenv("SKILL_CATALOG_URL")
	if skillCatalogURL == "" {
		skillCatalogURL = "http://localhost:8087"
	}

	skillDispatcherURL := os.Getenv("SKILL_DISPATCHER_URL")
	if skillDispatcherURL == "" {
		skillDispatcherURL = "http://localhost:8085"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8091"
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}

	svc := service.NewService(db, skillCatalogURL, skillDispatcherURL)

	// Routes
	// Note: mcp-registry appends /mcp/ (trailing slash) to bare host URLs,
	// so we register both /mcp and /mcp/ to handle both forms.
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", svc.HandleHealth)
	mux.HandleFunc("POST /mcp", svc.HandleMCP)
	mux.HandleFunc("POST /mcp/", svc.HandleMCP)
	mux.HandleFunc("GET /mcp/sse", svc.HandleSSE)

	addr := fmt.Sprintf(":%s", port)
	log.Printf("MCP Server starting on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
