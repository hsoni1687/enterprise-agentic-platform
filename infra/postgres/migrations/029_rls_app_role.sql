-- Migration 029: Make row-level security real for the knowledge-graph tables.
--
-- Background
-- ----------
-- The kg_graphs/kg_nodes/kg_edges tables have had RLS *enabled* since migration
-- 018, but it was never *enforced*:
--   1. Every service connects as the `postgres` superuser, which bypasses RLS.
--   2. No service ever sets `app.tenant_id`, so the policies could not match.
--   3. The policies used current_setting('app.tenant_id') WITHOUT the missing_ok
--      flag, so they would ERROR (not safely deny) if the setting was unset.
--
-- This migration makes RLS a genuine, fail-closed backstop for these three
-- tables (the pilot service: kg-service). It:
--   • Rewrites the policies to use the missing_ok form so an unset tenant denies
--     all rows instead of erroring, and reconciles read-visibility with what the
--     application layer already returns (own tenant + shared/global + platform).
--   • Adds a strict WITH CHECK so a tenant can only ever WRITE its own rows.
--   • Creates a dedicated, NON-superuser, NON-bypassrls login role (`agent_app`)
--     for the application to connect as, so RLS is actually applied.
--   • FORCEs RLS so it applies even to the table owner.
--
-- Migrations and seed jobs continue to run as `postgres` (superuser) and are
-- intentionally unaffected — they must be able to write platform-system rows.
--
-- Rollout note: only kg-service is switched to the `agent_app` role for now.
-- The other services keep their existing connection until they adopt the same
-- WithTenant() query pattern (expand → backfill → contract).

-- ---------------------------------------------------------------------------
-- 1. Dedicated application role (idempotent)
-- ---------------------------------------------------------------------------
-- NOSUPERUSER + NOBYPASSRLS are the load-bearing attributes: without them the
-- role would silently skip every policy below, which is exactly the bug we are
-- fixing. The password is a local-dev default; production injects its own via
-- secrets and rotates it (the role, not the password, is what matters here).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_app') THEN
        CREATE ROLE agent_app
            LOGIN
            PASSWORD 'agent_app_local_pw'
            NOSUPERUSER
            NOBYPASSRLS
            NOCREATEDB
            NOCREATEROLE;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO agent_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON kg_graphs, kg_nodes, kg_edges TO agent_app;

-- ---------------------------------------------------------------------------
-- 2. Rewrite the KG policies: fail-closed reads + strict writes
-- ---------------------------------------------------------------------------
-- USING governs which rows are visible (SELECT/UPDATE/DELETE).
-- WITH CHECK governs which rows may be written (INSERT/UPDATE).
--
-- Reads are a superset of the app's WHERE clauses (own tenant, global, shared,
-- and platform-system shared) so enforcing RLS never hides a row the app would
-- legitimately return. Writes are strict: tenant_id MUST equal the active
-- tenant, so no tenant can forge rows for another tenant or for platform-system.

DROP POLICY IF EXISTS kg_graphs_access ON kg_graphs;
CREATE POLICY kg_graphs_access ON kg_graphs
    FOR ALL
    USING (
        tenant_id = current_setting('app.tenant_id', TRUE)
        OR scope = 'global'
        OR (scope = 'shared' AND current_setting('app.tenant_id', TRUE) = ANY(shared_with))
        OR (tenant_id = 'platform-system' AND scope = 'shared')
    )
    WITH CHECK (
        tenant_id = current_setting('app.tenant_id', TRUE)
    );

DROP POLICY IF EXISTS kg_nodes_access ON kg_nodes;
CREATE POLICY kg_nodes_access ON kg_nodes
    FOR ALL
    USING (
        tenant_id = current_setting('app.tenant_id', TRUE)
        OR tenant_id = 'platform-system'
    )
    WITH CHECK (
        tenant_id = current_setting('app.tenant_id', TRUE)
    );

DROP POLICY IF EXISTS kg_edges_access ON kg_edges;
CREATE POLICY kg_edges_access ON kg_edges
    FOR ALL
    USING (
        tenant_id = current_setting('app.tenant_id', TRUE)
        OR tenant_id = 'platform-system'
    )
    WITH CHECK (
        tenant_id = current_setting('app.tenant_id', TRUE)
    );

-- ---------------------------------------------------------------------------
-- 3. FORCE RLS so the policies apply even to the table owner
-- ---------------------------------------------------------------------------
-- (Superusers still bypass RLS, which is why the app must NOT be a superuser.)
ALTER TABLE kg_graphs FORCE ROW LEVEL SECURITY;
ALTER TABLE kg_nodes  FORCE ROW LEVEL SECURITY;
ALTER TABLE kg_edges  FORCE ROW LEVEL SECURITY;

-- Track this migration
INSERT INTO schema_migrations (version) VALUES ('029')
    ON CONFLICT (version) DO NOTHING;
