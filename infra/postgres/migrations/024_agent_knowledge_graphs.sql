-- Migration 024: Agent ↔ Knowledge Graph attachment
-- Adds knowledge_graph_ids to the agents manifest so agents can reference
-- one or more KG graphs whose chunks are injected into LLM context at runtime.

ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS knowledge_graph_ids JSONB NOT NULL DEFAULT '[]';

-- Index for fast look-up of agents that use a specific graph
-- (queries the JSONB array membership)
CREATE INDEX IF NOT EXISTS agents_knowledge_graph_ids_idx
    ON agents USING gin (knowledge_graph_ids);

-- Track this migration
INSERT INTO schema_migrations (version) VALUES ('024')
    ON CONFLICT (version) DO NOTHING;
