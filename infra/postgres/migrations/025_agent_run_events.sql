-- Migration 025: Agent run events — structured execution log
--
-- Stores every observable event that occurs during an agent workflow run.
-- This is the source of truth for the Logs page in Agent Studio.
--
-- Design:
--   • workflow_id links every event back to the Temporal workflow run AND
--     to the Langfuse trace (we use workflow_id as the Langfuse trace_id).
--   • event_type   — machine-readable category  (agent_started, tool_invoked, …)
--   • level        — display severity            (info | warn | error | success)
--   • source       — originating subsystem       (agent | tool | skill | guardrail | hook | llm | system)
--   • source_id    — specific resource name      (e.g. "web_search", "pii_strip")
--   • details      — arbitrary JSONB payload     (tokens, model, rows_returned, …)
--
-- Append-only: never UPDATE or DELETE rows.

CREATE TABLE IF NOT EXISTS agent_run_events (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id TEXT        NOT NULL,       -- Temporal workflow_id (= Langfuse trace_id)
    run_id      TEXT        NOT NULL DEFAULT '',  -- Temporal run_id
    tenant_id   TEXT        NOT NULL,
    agent_id    TEXT        NOT NULL DEFAULT '',
    event_type  TEXT        NOT NULL,       -- agent_started | task_planned | tool_invoked |
                                            -- skill_invoked | llm_call | guardrail_triggered |
                                            -- hook_fired | agent_completed | agent_failed
    level       TEXT        NOT NULL DEFAULT 'info'
                                CHECK (level IN ('info','warn','error','success')),
    source      TEXT        NOT NULL
                                CHECK (source IN ('agent','tool','skill','guardrail','hook','llm','system')),
    source_id   TEXT        NOT NULL,
    message     TEXT        NOT NULL,
    duration_ms INTEGER,
    details     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast queries for the Logs UI (most recent events per tenant)
CREATE INDEX IF NOT EXISTS agent_run_events_tenant_time_idx
    ON agent_run_events (tenant_id, created_at DESC);

-- Lookup all events for a single workflow run (run-detail view)
CREATE INDEX IF NOT EXISTS agent_run_events_workflow_idx
    ON agent_run_events (workflow_id, created_at);

-- Filter by agent across time (agent health view)
CREATE INDEX IF NOT EXISTS agent_run_events_agent_time_idx
    ON agent_run_events (agent_id, created_at DESC);

-- Error triage — quickly find all errors/warnings
CREATE INDEX IF NOT EXISTS agent_run_events_level_time_idx
    ON agent_run_events (level, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('025')
    ON CONFLICT (version) DO NOTHING;
