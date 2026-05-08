-- Admin Tables: Tenant Settings, Model Access Control, Platform Config

-- Tenant Settings: quota and access management per tenant
CREATE TABLE IF NOT EXISTS tenant_settings (
    tenant_id                 TEXT PRIMARY KEY,
    display_name              TEXT NOT NULL,
    status                    TEXT NOT NULL DEFAULT 'active', -- active | suspended
    max_concurrent_workflows  INTEGER DEFAULT 50,
    token_budget_monthly      BIGINT DEFAULT 10000000,
    created_at                TIMESTAMPTZ DEFAULT NOW(),
    updated_at                TIMESTAMPTZ DEFAULT NOW()
);

-- Per-tenant model access control
CREATE TABLE IF NOT EXISTS tenant_model_access (
    tenant_id         TEXT NOT NULL,
    model_id          TEXT NOT NULL,
    enabled           BOOLEAN DEFAULT TRUE,
    daily_token_limit BIGINT DEFAULT NULL,  -- NULL = no per-model limit
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, model_id)
);

-- Persisted LLM gateway config (survives container restarts)
CREATE TABLE IF NOT EXISTS platform_config (
    key       TEXT PRIMARY KEY,
    value     TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tenant_settings_status ON tenant_settings(status);
CREATE INDEX IF NOT EXISTS idx_tenant_model_access_enabled ON tenant_model_access(enabled);

-- Seed default tenant (idempotent)
INSERT INTO tenant_settings (tenant_id, display_name, status, max_concurrent_workflows, token_budget_monthly, created_at, updated_at)
VALUES ('default-tenant', 'Default Tenant', 'active', 50, 10000000, NOW(), NOW())
ON CONFLICT (tenant_id) DO NOTHING;

-- Seed platform-system tenant for system agents (idempotent)
INSERT INTO tenant_settings (tenant_id, display_name, status, max_concurrent_workflows, token_budget_monthly, created_at, updated_at)
VALUES ('platform-system', 'Platform System', 'active', 100, 50000000, NOW(), NOW())
ON CONFLICT (tenant_id) DO NOTHING;
