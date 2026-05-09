-- System Scope: Add scope column to tools and skills tables
-- Enables platform-owned system resources visible to all tenants but managed by admins only

ALTER TABLE tools ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'tenant'
  CHECK (scope IN ('tenant', 'system'));

ALTER TABLE skills ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'tenant'
  CHECK (scope IN ('tenant', 'system'));

CREATE INDEX IF NOT EXISTS idx_tools_scope ON tools(scope);
CREATE INDEX IF NOT EXISTS idx_skills_scope ON skills(scope);
