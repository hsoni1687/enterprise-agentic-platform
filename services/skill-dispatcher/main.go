package main

import (
	"log"
	"log/slog"
	"net/http"
	"os"

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
	engine.Register(hooks.HookRegistration{
		SkillName: "*",
		Phase:     hooks.PhasePre,
		Type:      hooks.HookTypeHITLIntercept,
		Priority:  20,
		// mutatingSkills map is intentionally empty; runtime config will populate it.
		Handler: handlers.NewHITLInterceptHandler(map[string]bool{}),
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
	router := dispatch.NewToolExecutorRouter()
	workflows := dispatch.NewHTTPWorkflowStarter(initiatorURL)
	d := dispatch.New(catalog, engine, router, workflows)

	mux := dispatch.BuildMux(d)

	log.Println("Starting Skill Dispatcher on :8085")
	if err := http.ListenAndServe(":8085", mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
