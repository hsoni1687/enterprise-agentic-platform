-- Migration 017: Add direct tools column to agents table
-- Enables agents to explicitly specify tools they can invoke, separate from skills

ALTER TABLE agents ADD COLUMN IF NOT EXISTS tools JSONB NOT NULL DEFAULT '[]';

-- Track this migration
INSERT INTO schema_migrations (version) VALUES ('017')
    ON CONFLICT (version) DO NOTHING;
