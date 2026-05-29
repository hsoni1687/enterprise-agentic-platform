-- Migration 033: Enforce row-level security on chat history (api-gateway).
--
-- chat_sessions/chat_messages already had RLS ENABLEd with a USING policy
-- (migration 026), but it was inert: the gateway connected as the `postgres`
-- superuser (bypasses RLS) and never set app.tenant_id. The gateway now connects
-- as `agent_app` and routes chat queries through WithTenant, so we add FORCE +
-- a strict WITH CHECK and grant the role access.
--
-- agent_run_events is also written by the gateway (lite-session run logging). It
-- is a shared observability table written by multiple services, so for now it is
-- GRANTed without RLS (tracked as a follow-up to give it tenant RLS once every
-- writer adopts WithTenant). chat data is the sensitive payload and IS enforced.

GRANT SELECT, INSERT, UPDATE, DELETE ON chat_sessions, chat_messages TO agent_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_run_events TO agent_app;

ALTER TABLE chat_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON chat_sessions;
CREATE POLICY tenant_isolation ON chat_sessions
    FOR ALL
    USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
    WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));

DROP POLICY IF EXISTS tenant_isolation ON chat_messages;
CREATE POLICY tenant_isolation ON chat_messages
    FOR ALL
    USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
    WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));

INSERT INTO schema_migrations (version) VALUES ('033')
    ON CONFLICT (version) DO NOTHING;
