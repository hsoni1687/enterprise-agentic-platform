-- Migration 027: Agent self-improvement — typed memories + improvement proposals
--
-- Two additions:
--   1. memory_type column on agent_memories so the worker can tag what kind of
--      learning was stored (observation | learned_strategy | failure_pattern | tool_preference).
--      Defaults to 'observation' so all existing rows remain valid.
--
--   2. agent_improvement_proposals table — each row is an LLM-generated
--      suggestion to improve an agent's manifest (system_prompt tweak, skill addition,
--      max_iterations change, etc.).  Proposals start 'pending'; the agent owner can
--      'accept' (triggers a manifest update) or 'dismiss' them.
--
-- Append-only philosophy: accepted proposals are recorded here for audit; the
-- actual manifest is updated via the normal agent PUT endpoint.

-- ── 1. Typed memories ─────────────────────────────────────────────────────────

ALTER TABLE agent_memories
    ADD COLUMN IF NOT EXISTS memory_type TEXT NOT NULL DEFAULT 'observation'
        CHECK (memory_type IN ('observation','learned_strategy','failure_pattern','tool_preference'));

CREATE INDEX IF NOT EXISTS agent_memories_type_idx
    ON agent_memories (agent_id, memory_type, created_at DESC);

-- ── 2. Improvement proposals ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_improvement_proposals (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT        NOT NULL,
    agent_id        TEXT        NOT NULL
                                REFERENCES agents(id) ON DELETE CASCADE,
    -- What the LLM suggests changing
    field           TEXT        NOT NULL,   -- 'system_prompt' | 'max_iterations' | 'skills' | 'general'
    current_value   TEXT,                   -- snapshot of the field at proposal time (nullable)
    proposed_value  TEXT        NOT NULL,   -- the recommended new value (always text; caller parses)
    rationale       TEXT        NOT NULL,   -- human-readable explanation of why
    -- Evidence: which memories triggered this proposal
    evidence_ids    UUID[]      NOT NULL DEFAULT '{}',
    -- Lifecycle
    status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','accepted','dismissed')),
    resolved_at     TIMESTAMPTZ,
    resolved_by     TEXT,                   -- user id or 'auto'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_improvement_proposals_agent_idx
    ON agent_improvement_proposals (agent_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_improvement_proposals_tenant_idx
    ON agent_improvement_proposals (tenant_id, created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('027')
    ON CONFLICT (version) DO NOTHING;
