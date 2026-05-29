-- Migration 032: Enforce row-level security on the registry tables.
--
-- Extends the kg-service pilot (migration 029) to the agent/skill/tool/sub-agent
-- registries and the shared lifecycle_events audit table. Each service now
-- connects as the non-superuser `agent_app` role and runs queries through the
-- WithTenant helper (SET LOCAL app.tenant_id), so these policies are enforced.
--
-- Read visibility mirrors each table's existing application WHERE clauses so
-- enforcing RLS never hides a row the app legitimately returns:
--   • agents / sub_agent_contracts : own tenant only
--   • tools                        : own tenant OR scope='system'
--   • skills                       : own tenant OR scope='system' OR visibility='public'
--   • lifecycle_events             : own tenant only
-- Writes are strict everywhere: WITH CHECK (tenant_id = the active tenant), so a
-- tenant can never forge a row for another tenant or for a system scope.
--
-- Migrations and seed jobs keep running as the `postgres` superuser, which
-- bypasses RLS, so seeding system-scoped rows is unaffected.

-- ── GRANTs for the application role ───────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON
    agents, tools, skills, sub_agent_contracts, lifecycle_events
    TO agent_app;

-- The api-gateway connects as agent_app and uses this table (no RLS — it is not
-- tenant-sensitive and is already keyed by (tenant_id, key)); it just needs access.
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO agent_app;

-- Helper note: current_setting('app.tenant_id', TRUE) returns NULL (not an error)
-- when unset, so a query that forgets to set the tenant returns zero rows.

-- ── agents ────────────────────────────────────────────────────────────────────
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agents_tenant_isolation ON agents;
CREATE POLICY agents_tenant_isolation ON agents
    FOR ALL
    USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
    WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));

-- ── tools (own tenant + system-scope readable) ────────────────────────────────
ALTER TABLE tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE tools FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tools_tenant_isolation ON tools;
CREATE POLICY tools_tenant_isolation ON tools
    FOR ALL
    USING (tenant_id::text = current_setting('app.tenant_id', TRUE) OR scope = 'system')
    WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));

-- ── skills (own tenant + system-scope + public visibility readable) ───────────
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS skills_tenant_isolation ON skills;
CREATE POLICY skills_tenant_isolation ON skills
    FOR ALL
    USING (
        tenant_id::text = current_setting('app.tenant_id', TRUE)
        OR scope = 'system'
        OR visibility = 'public'
    )
    WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));

-- ── sub_agent_contracts ───────────────────────────────────────────────────────
ALTER TABLE sub_agent_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_agent_contracts FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sub_agent_contracts_tenant_isolation ON sub_agent_contracts;
CREATE POLICY sub_agent_contracts_tenant_isolation ON sub_agent_contracts
    FOR ALL
    USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
    WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));

-- ── lifecycle_events (shared audit table, written by every registry) ──────────
ALTER TABLE lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE lifecycle_events FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lifecycle_events_tenant_isolation ON lifecycle_events;
CREATE POLICY lifecycle_events_tenant_isolation ON lifecycle_events
    FOR ALL
    USING (tenant_id::text = current_setting('app.tenant_id', TRUE))
    WITH CHECK (tenant_id::text = current_setting('app.tenant_id', TRUE));

INSERT INTO schema_migrations (version) VALUES ('032')
    ON CONFLICT (version) DO NOTHING;
