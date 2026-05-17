-- Migration 023: Agent Tiers + missing agents columns
--
-- Also adds columns that the store references but were never in 010_agents.sql:
--   tools, mcp_servers, guardrail_ids, hook_ids
-- Adds tier classification (lite | workflow | deep) and structured execution config
-- to the agents table. All existing agents default to 'deep' (no behaviour change).

-- ── Columns missing from 010_agents.sql ──────────────────────────────────────
ALTER TABLE agents ADD COLUMN IF NOT EXISTS tools        JSONB NOT NULL DEFAULT '[]';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS mcp_servers  JSONB NOT NULL DEFAULT '[]';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS guardrail_ids JSONB NOT NULL DEFAULT '[]';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS hook_ids      JSONB NOT NULL DEFAULT '[]';

-- ── Tier classification ───────────────────────────────────────────────────────
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'deep'
        CHECK (tier IN ('lite', 'workflow', 'deep'));

-- execution_config stores tier-specific runtime settings as JSONB so the
-- shape can evolve without further schema migrations.
-- Canonical shape per tier:
--
--   lite:     { "max_duration_seconds": 10,  "max_tool_calls": 2,
--               "max_tokens": 2000, "max_cost_usd": 0.01 }
--
--   workflow: { "max_duration_seconds": 300, "max_tool_calls": 20,
--               "max_tokens": 10000, "max_cost_usd": 0.10,
--               "steps": [ <WorkflowStep>... ],
--               "hitl_on_mutating": true }
--
--   deep:     { "max_duration_seconds": 3600, "max_tool_calls": null,
--               "max_tokens": 100000, "max_cost_usd": 5.00,
--               "planning_mode": "dynamic", "self_correction": true,
--               "memory_cross_session": true, "hitl_on_mutating": true,
--               "hitl_on_uncertainty": false }
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS execution_config JSONB NOT NULL DEFAULT '{}';

-- autonomy_level is a derived field but stored for fast filtering/display
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS autonomy_level TEXT NOT NULL DEFAULT 'autonomous'
        CHECK (autonomy_level IN ('none', 'supervised', 'autonomous'));

-- template_id tracks which template was used to create this agent (nullable)
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS template_id TEXT;

-- description is a user-facing one-liner shown in listings (distinct from system_prompt)
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS description TEXT;

-- tags for search / filtering (e.g. ["support", "internal"])
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]';

-- Back-fill existing agents: they are all deep + autonomous
UPDATE agents
SET
    tier             = 'deep',
    autonomy_level   = 'autonomous',
    execution_config = '{
        "max_duration_seconds": 3600,
        "max_tool_calls": null,
        "max_tokens": 100000,
        "max_cost_usd": 5.00,
        "planning_mode": "dynamic",
        "self_correction": true,
        "memory_cross_session": true,
        "hitl_on_mutating": true,
        "hitl_on_uncertainty": false
    }'::jsonb
WHERE tier = 'deep';

CREATE INDEX IF NOT EXISTS agents_tier_idx ON agents (tenant_id, tier, status);

INSERT INTO schema_migrations (version) VALUES ('023')
    ON CONFLICT (version) DO NOTHING;
