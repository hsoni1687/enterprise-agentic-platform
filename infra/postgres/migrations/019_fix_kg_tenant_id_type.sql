-- Migration 019: Fix KG tenant_id column type
-- Changes tenant_id from UUID to TEXT to match system-wide tenant ID format

-- Drop RLS policies first (they depend on tenant_id type)
DROP POLICY IF EXISTS kg_graphs_access ON kg_graphs;
DROP POLICY IF EXISTS kg_nodes_access ON kg_nodes;
DROP POLICY IF EXISTS kg_edges_access ON kg_edges;

-- Alter kg_graphs table
ALTER TABLE kg_graphs ALTER COLUMN tenant_id TYPE TEXT;
ALTER TABLE kg_graphs ALTER COLUMN shared_with TYPE TEXT[];

-- Alter kg_nodes table
ALTER TABLE kg_nodes ALTER COLUMN tenant_id TYPE TEXT;

-- Alter kg_edges table
ALTER TABLE kg_edges ALTER COLUMN tenant_id TYPE TEXT;

-- Recreate RLS policies
CREATE POLICY kg_graphs_access ON kg_graphs FOR ALL
    USING (
        tenant_id = current_setting('app.tenant_id')
        OR scope = 'global'
        OR (scope = 'shared' AND current_setting('app.tenant_id') = ANY(shared_with))
    );

CREATE POLICY kg_nodes_access ON kg_nodes FOR ALL
    USING (
        tenant_id = current_setting('app.tenant_id')
    );

CREATE POLICY kg_edges_access ON kg_edges FOR ALL
    USING (
        tenant_id = current_setting('app.tenant_id')
    );
