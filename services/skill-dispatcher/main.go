package main

import (
	"log"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/agent-platform/go-shared/pkg/models"
	"github.com/agent-platform/hook-engine/pkg/handlers"
	"github.com/agent-platform/hook-engine/pkg/hooks"
	"github.com/agent-platform/skill-dispatcher/pkg/dispatch"
)

func main() {
	engine := hooks.New()

	// Register default cross-cutting hooks.
	engine.Register(hooks.HookRegistration{
		SkillName: "*",
		Phase:     hooks.PhasePre,
		Type:      hooks.HookTypeAuditLog,
		Priority:  10,
		Handler:   handlers.NewAuditLogHandler(slog.Default()),
	})
	// Mutating skills/tools that require HITL approval
	mutatingSkills := map[string]bool{
		// Skills
		"diagnostic-agent":       true, // System diagnostics (infrastructure access)
		"deployment-checker":     true, // Deployment validation
		"log-analyzer":           false, // Read-only analysis
		"backup-validator":       false, // Read-only validation
		"code-review":            false, // Read-only review
		"test-generation":        false, // Read-only test generation
		// Tools (when invoked directly)
		"bash":                   true, // Shell commands (mutating)
		"http-request":           true, // HTTP requests (can be mutating)
		"code-executor":          true, // Code execution (can be mutating)
		// KG tools (mutating)
		"kg-create-graph":        true, // Creates KG (mutating)
		"kg-add-node":            true, // Modifies KG (mutating)
		"kg-add-edge":            true, // Modifies KG (mutating)
		// KG tools (read-only)
		"kg-query":               false, // Read-only query
		"kg-search":              false, // Read-only search
		"kg-semantic-search":     false, // Semantic search (read-only)
	}

	engine.Register(hooks.HookRegistration{
		SkillName: "*",
		Phase:     hooks.PhasePre,
		Type:      hooks.HookTypeHITLIntercept,
		Priority:  20,
		// mutatingSkills map marks which skills require human approval
		Handler: handlers.NewHITLInterceptHandler(mutatingSkills),
	})
	engine.Register(hooks.HookRegistration{
		SkillName: "*",
		Phase:     hooks.PhasePost,
		Type:      hooks.HookTypeCostMeter,
		Priority:  10,
		Handler:   handlers.NewCostMeterHandler(),
	})

	initiatorURL := os.Getenv("WORKFLOW_INITIATOR_URL")
	if initiatorURL == "" {
		initiatorURL = "http://localhost:8081"
	}

	catalog := dispatch.NewInMemoryCatalog()
	// Bootstrap system skills for dev/testing
	bootstrapSystemSkills(catalog)

	router := dispatch.NewToolExecutorRouter()
	workflows := dispatch.NewHTTPWorkflowStarter(initiatorURL)
	d := dispatch.New(catalog, engine, router, workflows)

	mux := dispatch.BuildMux(d)

	log.Println("Starting Skill Dispatcher on :8085")
	if err := http.ListenAndServe(":8085", mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

// bootstrapSystemSkills registers system skills in the in-memory catalog for dev/testing
func bootstrapSystemSkills(catalog *dispatch.InMemoryCatalog) {
	systemSkills := []struct {
		name     string
		version  string
		mutating bool
	}{
		{name: "diagnostic-agent", version: "1.0.0", mutating: true},
		{name: "deployment-checker", version: "1.0.0", mutating: true},
		{name: "log-analyzer", version: "1.0.0", mutating: false},
		{name: "backup-validator", version: "1.0.0", mutating: false},
		{name: "kg-semantic-search", version: "1.0.0", mutating: false},
	}

	// Register system skills for both platform-system and all default tenants (for dev testing)
	tenantIDs := []string{"platform-system", "default-tenant"}

	for i, skill := range systemSkills {
		for _, tenantID := range tenantIDs {
			// Determine tool for this skill
			toolName := "bash"
			if skill.name == "kg-semantic-search" {
				toolName = "kg-semantic-search"
			}

			manifest := &models.SkillManifest{
				ID:       "system-skill-" + skill.name,
				TenantID: tenantID,
				Name:     skill.name,
				Version:  skill.version,
				Tools: []models.ToolRef{
					{Name: toolName, Version: "1.0.0"},
				},
				Mutating:         skill.mutating,
				ApprovalRequired: skill.mutating,
				Status:           models.StatusActive,
				PublishedBy:      "platform-seed",
				CreatedAt:        time.Now().Add(time.Duration(i) * time.Second),
				Scope:            "system",
			}
			catalog.Register(manifest)
		}
	}
	log.Printf("Bootstrapped %d system skills into dispatcher catalog", len(systemSkills))
}
