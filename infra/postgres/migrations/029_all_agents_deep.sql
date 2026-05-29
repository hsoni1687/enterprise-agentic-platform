-- Migration 029: Collapse agent tiers — all agents are now deep
--
-- Background: the platform previously exposed three execution tiers:
--   lite     → in-memory goroutine, no Temporal, no HITL, no durable state
--   workflow → static DAG via Temporal WorkflowAgentRun
--   deep     → autonomous planning via Temporal AgentWorkflow
--
-- Decision: remove lite and workflow. Every agent routes through
-- Temporal AgentWorkflow. Tier is kept as a DB column for API
-- compatibility but always normalised to 'deep'.

-- 1. Migrate existing agents
UPDATE agents SET tier = 'deep' WHERE tier IN ('lite', 'workflow');

-- 2. Relax the CHECK constraint to accept only 'deep'
--    (use DROP + ADD so it works on both PG 12 and 15)
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_tier_check;
ALTER TABLE agents ADD CONSTRAINT agents_tier_check CHECK (tier = 'deep');

INSERT INTO schema_migrations (version) VALUES ('029')
    ON CONFLICT (version) DO NOTHING;
