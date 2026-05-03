-- Migration 014: Add scope to MCP servers
-- Adds support for global (platform-level) MCP servers alongside tenant-specific ones

ALTER TABLE mcp_servers
    ADD COLUMN scope TEXT NOT NULL DEFAULT 'tenant'
        CHECK (scope IN ('tenant', 'global'));

-- Index for efficient global server queries
CREATE INDEX IF NOT EXISTS idx_mcp_servers_scope ON mcp_servers(scope) WHERE scope = 'global';

-- Index for combined scope + tenant lookups (tenant list should include globals)
CREATE INDEX IF NOT EXISTS idx_mcp_servers_tenant_scope ON mcp_servers(tenant_id, scope);
