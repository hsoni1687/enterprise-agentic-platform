-- Migration 018: Knowledge Graph schema
-- Introduces kg_graphs, kg_nodes, and kg_edges tables with pgvector support for semantic search

-- kg_graphs: Represents a domain knowledge graph instance
CREATE TABLE IF NOT EXISTS kg_graphs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    domain      TEXT,
    description TEXT,
    scope       TEXT NOT NULL DEFAULT 'private',  -- private, shared, global
    shared_with TEXT[] DEFAULT '{}',              -- tenant IDs with access (for scope='shared')
    schema      JSONB DEFAULT '{}',                -- JSON schema of entity/relationship types
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS kg_graphs_tenant_idx ON kg_graphs(tenant_id);
CREATE INDEX IF NOT EXISTS kg_graphs_scope_idx ON kg_graphs(scope);

-- kg_nodes: Represents entities/nodes in a knowledge graph
CREATE TABLE IF NOT EXISTS kg_nodes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    graph_id    UUID NOT NULL REFERENCES kg_graphs(id) ON DELETE CASCADE,
    tenant_id   TEXT NOT NULL,
    node_type   TEXT NOT NULL,
    label       TEXT NOT NULL,
    properties  JSONB DEFAULT '{}',
    embedding   VECTOR(1536),                     -- For semantic search
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kg_nodes_graph_idx ON kg_nodes(graph_id, tenant_id);
CREATE INDEX IF NOT EXISTS kg_nodes_type_idx ON kg_nodes(graph_id, node_type);
CREATE INDEX IF NOT EXISTS kg_nodes_embedding_idx ON kg_nodes USING hnsw (embedding vector_cosine_ops);

-- kg_edges: Represents relationships between nodes
CREATE TABLE IF NOT EXISTS kg_edges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    graph_id        UUID NOT NULL REFERENCES kg_graphs(id) ON DELETE CASCADE,
    tenant_id       TEXT NOT NULL,
    from_node_id    UUID NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    to_node_id      UUID NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL,
    properties      JSONB DEFAULT '{}',
    weight          FLOAT8 DEFAULT 1.0,           -- For weighted traversal
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kg_edges_graph_idx ON kg_edges(graph_id, tenant_id);
CREATE INDEX IF NOT EXISTS kg_edges_from_node_idx ON kg_edges(from_node_id);
CREATE INDEX IF NOT EXISTS kg_edges_to_node_idx ON kg_edges(to_node_id);
CREATE INDEX IF NOT EXISTS kg_edges_relationship_idx ON kg_edges(graph_id, relationship_type);

-- Row-Level Security: Enforce tenant isolation
ALTER TABLE kg_graphs ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_edges ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Only tenant can access own graphs (or shared/global graphs)
DROP POLICY IF EXISTS kg_graphs_access ON kg_graphs;
CREATE POLICY kg_graphs_access ON kg_graphs
    USING (
        (tenant_id = current_setting('app.tenant_id'))
        OR (scope = 'global')
        OR (scope = 'shared' AND current_setting('app.tenant_id') = ANY(shared_with))
    );

DROP POLICY IF EXISTS kg_nodes_access ON kg_nodes;
CREATE POLICY kg_nodes_access ON kg_nodes
    USING (
        tenant_id = current_setting('app.tenant_id')
    );

DROP POLICY IF EXISTS kg_edges_access ON kg_edges;
CREATE POLICY kg_edges_access ON kg_edges
    USING (
        tenant_id = current_setting('app.tenant_id')
    );

-- Track this migration
INSERT INTO schema_migrations (version) VALUES ('018')
    ON CONFLICT (version) DO NOTHING;
