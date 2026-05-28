SHELL := /bin/bash
.PHONY: up down restart-llm rebuild-workers seed migrate logs ps

# ── Load .env so all targets see the right values ─────────────────────────────
ifneq (,$(wildcard .env))
  include .env
  export
endif

# ── Start the full platform ────────────────────────────────────────────────────
# --build: Docker reuses existing images by default; without this, agent-workers and
# other built services keep running stale code after you edit the repo.
up:
	@echo "==> Starting platform..."
	docker compose up -d --build
	@echo "==> Running migrations..."
	docker rm -f migrate 2>/dev/null; docker compose run --rm migrate
	@echo "==> Waiting for services..."
	@until curl -sf http://localhost:8088/health >/dev/null 2>&1; do sleep 2; done
	@echo "==> Seeding data..."
	bash seed_system_agents.sh ../../infra/platform/system-agents
	bash seed_demo_data.sh
	@echo ""
	@echo "✓ Platform ready → http://localhost:3000"

# ── Stop everything ───────────────────────────────────────────────────────────
down:
	docker compose down

# ── Restart LiteLLM only (safe — never touches postgres) ─────────────────────
restart-llm:
	bash restart-litellm.sh

# ── Rebuild and restart only Temporal Python workers (faster than full stack rebuild)
rebuild-workers:
	docker compose build agent-workers agent-workers-system
	docker compose up -d agent-workers agent-workers-system

# ── Re-seed without restarting containers ────────────────────────────────────
seed:
	@until curl -sf http://localhost:8088/health >/dev/null 2>&1; do \
	  echo "  waiting for agent-registry..."; sleep 2; done
	bash seed_system_agents.sh ../../infra/platform/system-agents
	bash seed_demo_data.sh

# ── Run migrations only ───────────────────────────────────────────────────────
migrate:
	docker rm -f migrate 2>/dev/null; docker compose run --rm migrate

# ── Shortcuts ─────────────────────────────────────────────────────────────────
logs:
	docker compose logs -f --tail=50 $(filter-out $@,$(MAKECMDGOALS))

ps:
	docker compose ps
