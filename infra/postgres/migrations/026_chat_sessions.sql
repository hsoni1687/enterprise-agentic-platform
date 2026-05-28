-- Migration 026: Persistent chat sessions and messages
--
-- Stores full conversation history for every agent chat session so users can
-- resume past conversations from any browser/device.
--
-- Design:
--   chat_sessions — one row per conversation thread (created on first message)
--   chat_messages — one row per message; metadata JSONB carries token counts,
--                   model name, step count, and the full SSE events array
--                   so the UI can re-render thinking blocks and tool calls.
--
-- Tenant-safe: both tables carry tenant_id; RLS policies enforce isolation.
-- Append-only: messages are never updated or deleted (only sessions can be deleted).

CREATE TABLE IF NOT EXISTS chat_sessions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   TEXT        NOT NULL,
    agent_id    TEXT        NOT NULL,
    title       TEXT        NOT NULL DEFAULT 'New Chat',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Most recent sessions per agent (sidebar list query)
CREATE INDEX IF NOT EXISTS chat_sessions_agent_time_idx
    ON chat_sessions (tenant_id, agent_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    tenant_id   TEXT        NOT NULL,
    agent_id    TEXT        NOT NULL,
    role        TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
    content     TEXT        NOT NULL,
    -- Stores: tokens_in, tokens_out, steps, model, events (full SSE event array)
    metadata    JSONB       NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Load all messages for a session in order
CREATE INDEX IF NOT EXISTS chat_messages_session_time_idx
    ON chat_messages (session_id, created_at ASC);

-- RLS policies (mirrors pattern used in agents table)
ALTER TABLE chat_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chat_sessions' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON chat_sessions
        USING (tenant_id = current_setting('app.tenant_id', TRUE));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chat_messages' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON chat_messages
        USING (tenant_id = current_setting('app.tenant_id', TRUE));
  END IF;
END
$$;

INSERT INTO schema_migrations (version) VALUES ('026')
    ON CONFLICT (version) DO NOTHING;
