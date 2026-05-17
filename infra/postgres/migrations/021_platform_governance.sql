-- Platform Governance: Guardrails and Hooks

-- ─── platform_guardrails ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_guardrails (
    id            TEXT PRIMARY KEY DEFAULT ('gr-' || gen_random_uuid()::text),
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    category      TEXT NOT NULL DEFAULT 'Quality',  -- Privacy | Security | Content Safety | Quality
    action        TEXT NOT NULL DEFAULT 'flag',      -- block | redact | flag
    scope         TEXT NOT NULL DEFAULT 'platform',
    admin_managed BOOLEAN NOT NULL DEFAULT FALSE,
    enabled       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_guardrails_category ON platform_guardrails(category);
CREATE INDEX IF NOT EXISTS idx_platform_guardrails_enabled  ON platform_guardrails(enabled);

-- Seed default platform guardrails (idempotent)
INSERT INTO platform_guardrails (id, name, description, category, action, scope, admin_managed, enabled) VALUES
  ('gr-pii-block',        'PII Detection',              'Detect and redact SSNs, credit card numbers, phone numbers, and email addresses from agent outputs.',          'Privacy',        'redact', 'platform', TRUE,  TRUE),
  ('gr-prompt-injection', 'Prompt Injection Guard',     'Block attempts to override agent instructions via adversarial input patterns.',                                'Security',       'block',  'platform', TRUE,  TRUE),
  ('gr-toxic-content',    'Toxic Content Filter',       'Block generation of harmful, hateful, or violent content.',                                                   'Content Safety', 'block',  'platform', TRUE,  TRUE),
  ('gr-secret-leak',      'Secret Leakage Prevention',  'Detect and redact API keys, tokens, and passwords from outputs.',                                             'Security',       'redact', 'platform', TRUE,  TRUE),
  ('gr-off-topic',        'Off-Topic Deflection',       'Flag responses that stray significantly from the agent''s stated purpose.',                                   'Quality',        'flag',   'platform', FALSE, FALSE),
  ('gr-length-limit',     'Response Length Limiter',    'Flag responses exceeding configured token thresholds.',                                                       'Quality',        'flag',   'platform', FALSE, FALSE),
  ('gr-hallucination',    'Hallucination Detector',     'Flag responses that contain unsupported factual claims.',                                                     'Quality',        'flag',   'platform', FALSE, FALSE)
ON CONFLICT (id) DO NOTHING;

-- ─── platform_hooks ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_hooks (
    id            TEXT PRIMARY KEY DEFAULT ('hook-' || gen_random_uuid()::text),
    name          TEXT NOT NULL,
    type          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    phase         TEXT NOT NULL DEFAULT 'post',  -- pre | post | both
    category      TEXT NOT NULL DEFAULT 'Observability', -- Observability | Governance | Privacy | Integration
    admin_managed BOOLEAN NOT NULL DEFAULT FALSE,
    enabled       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_hooks_category ON platform_hooks(category);
CREATE INDEX IF NOT EXISTS idx_platform_hooks_enabled  ON platform_hooks(enabled);

-- Seed default platform hooks (idempotent)
INSERT INTO platform_hooks (id, name, type, description, phase, category, admin_managed, enabled) VALUES
  ('hook-audit-log',  'Audit Log',         'audit_log',      'Record every skill invocation with inputs, outputs, duration, and tenant context.',                             'both', 'Observability', TRUE,  TRUE),
  ('hook-cost-meter', 'Cost Meter',        'cost_meter',     'Track token usage and estimated cost per invocation, aggregated per agent and tenant.',                         'post', 'Observability', TRUE,  TRUE),
  ('hook-hitl',       'HITL Intercept',    'hitl_intercept', 'Pause execution on mutating skills and wait for human approval before proceeding.',                             'pre',  'Governance',    FALSE, FALSE),
  ('hook-rate-limit', 'Rate Limiter',      'rate_limit',     'Enforce per-tenant invocation rate limits to prevent abuse and cost overruns.',                                 'pre',  'Governance',    FALSE, FALSE),
  ('hook-pii-strip',  'PII Stripper',      'pii_strip',      'Strip PII from skill inputs before logging to ensure compliance.',                                              'pre',  'Privacy',       TRUE,  TRUE),
  ('hook-webhook',    'Webhook Notifier',  'webhook',        'POST skill results to a configured webhook URL for external integrations.',                                      'post', 'Integration',   FALSE, FALSE)
ON CONFLICT (id) DO NOTHING;
