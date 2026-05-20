-- =============================================================================
-- Demo seed data for agentplatform DB
-- Safe to re-run (ON CONFLICT DO NOTHING throughout)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tenants (already inserted by migration 011, included here for completeness)
-- ---------------------------------------------------------------------------
INSERT INTO tenant_settings (tenant_id, display_name, status, max_concurrent_workflows, token_budget_monthly)
VALUES
    ('default-tenant',   'Default Tenant',   'active', 50,  10000000),
    ('platform-system',  'Platform System',  'active', 100, 50000000),
    ('demo-tenant',      'Demo Tenant',      'active', 20,  5000000)
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO tenant_model_access (tenant_id, model_id, enabled, daily_token_limit)
VALUES
    ('default-tenant',  'claude-sonnet-4-5',         true, NULL),
    ('default-tenant',  'claude-haiku',               true, 1000000),
    ('default-tenant',  'local-chat',                 true, NULL),
    ('platform-system', 'claude-sonnet-4-5',          true, NULL),
    ('platform-system', 'claude-opus-4-5',            true, NULL),
    ('platform-system', 'local-chat',                 true, NULL),
    ('demo-tenant',     'claude-sonnet-4-5',          true, 500000),
    ('demo-tenant',     'local-chat',                 true, NULL)
ON CONFLICT (tenant_id, model_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- System Tools  (platform-system tenant)
-- ---------------------------------------------------------------------------
INSERT INTO tools (id, tenant_id, name, version, description, auth_level, sandbox_required, input_schema, status, registered_by)
VALUES
    ('system-tool-web-search', 'platform-system', 'web-search', '1.0.0',
     'Search the web for information and retrieve results',
     'read', false,
     '{"type":"object","properties":{"query":{"type":"string"},"max_results":{"type":"integer","default":10}},"required":["query"]}',
     'approved', 'platform-admin'),

    ('system-tool-code-executor', 'platform-system', 'code-executor', '1.0.0',
     'Execute code snippets in a sandboxed environment (Python, JavaScript, Bash)',
     'mutating', true,
     '{"type":"object","properties":{"language":{"type":"string","enum":["python","javascript","bash"]},"code":{"type":"string"},"timeout_seconds":{"type":"integer","default":30}},"required":["language","code"]}',
     'approved', 'platform-admin'),

    ('system-tool-http-request', 'platform-system', 'http-request', '1.0.0',
     'Make HTTP requests to external APIs and endpoints',
     'mutating', false,
     '{"type":"object","properties":{"method":{"type":"string","enum":["GET","POST","PUT","PATCH","DELETE"]},"url":{"type":"string"},"headers":{"type":"object"},"body":{"type":"string"}},"required":["method","url"]}',
     'approved', 'platform-admin'),

    ('system-tool-text-processing', 'platform-system', 'text-processing', '1.0.0',
     'Advanced text processing operations (regex, parsing, transformation)',
     'read', false,
     '{"type":"object","properties":{"operation":{"type":"string","enum":["regex_match","regex_replace","parse_json","parse_csv","extract_urls","extract_emails"]},"text":{"type":"string"},"pattern":{"type":"string"}},"required":["operation","text"]}',
     'approved', 'platform-admin'),

    ('system-tool-data-validation', 'platform-system', 'data-validation', '1.0.0',
     'Validate data against schemas (JSON Schema, type checking, format validation)',
     'read', false,
     '{"type":"object","properties":{"schema_type":{"type":"string","enum":["json_schema","email","url","phone","uuid"]},"data":{"type":"string"}},"required":["schema_type","data"]}',
     'approved', 'platform-admin'),

    ('system-tool-bash', 'platform-system', 'bash', '1.0.0',
     'Execute bash commands with streaming output and signal handling',
     'mutating', true,
     '{"type":"object","properties":{"script":{"type":"string"},"timeout_seconds":{"type":"integer","default":300},"environment":{"type":"object"},"working_dir":{"type":"string"}},"required":["script"]}',
     'approved', 'platform-admin'),

    ('system-tool-kg-create-graph', 'platform-system', 'kg-create-graph', '1.0.0',
     'Create a new knowledge graph for a domain',
     'mutating', false,
     '{"type":"object","properties":{"name":{"type":"string"},"domain":{"type":"string"},"description":{"type":"string"},"scope":{"type":"string","enum":["private","shared","global"],"default":"private"}},"required":["name","domain"]}',
     'approved', 'platform-admin'),

    ('system-tool-kg-add-node', 'platform-system', 'kg-add-node', '1.0.0',
     'Add a node (entity) to a knowledge graph',
     'mutating', false,
     '{"type":"object","properties":{"graph_id":{"type":"string"},"node_type":{"type":"string"},"label":{"type":"string"},"properties":{"type":"object"}},"required":["graph_id","node_type","label"]}',
     'approved', 'platform-admin'),

    ('system-tool-kg-add-edge', 'platform-system', 'kg-add-edge', '1.0.0',
     'Add an edge (relationship) between two nodes in a knowledge graph',
     'mutating', false,
     '{"type":"object","properties":{"graph_id":{"type":"string"},"from_node_id":{"type":"string"},"to_node_id":{"type":"string"},"relationship_type":{"type":"string"}},"required":["graph_id","from_node_id","to_node_id","relationship_type"]}',
     'approved', 'platform-admin'),

    ('system-tool-kg-query', 'platform-system', 'kg-query', '1.0.0',
     'Query a knowledge graph to find related nodes and edges via BFS traversal',
     'read', false,
     '{"type":"object","properties":{"graph_id":{"type":"string"},"start_node_id":{"type":"string"},"max_depth":{"type":"integer","default":3}},"required":["graph_id","start_node_id"]}',
     'approved', 'platform-admin'),

    ('system-tool-kg-search', 'platform-system', 'kg-search', '1.0.0',
     'Search knowledge graph nodes by type or semantic similarity',
     'read', false,
     '{"type":"object","properties":{"graph_id":{"type":"string"},"search_type":{"type":"string","enum":["by_type","by_embedding"]},"node_type":{"type":"string"},"limit":{"type":"integer","default":100}},"required":["graph_id","search_type"]}',
     'approved', 'platform-admin')
ON CONFLICT (id) DO NOTHING;

-- Demo tools (default-tenant)
INSERT INTO tools (id, tenant_id, name, version, description, auth_level, sandbox_required, input_schema, status, registered_by)
VALUES
    ('demo-tool-stock-price', 'default-tenant', 'stock-price', '1.0.0',
     'Fetch real-time stock price for a given ticker symbol',
     'read', false,
     '{"type":"object","properties":{"ticker":{"type":"string"},"exchange":{"type":"string","default":"NSE"}},"required":["ticker"]}',
     'approved', 'demo-admin'),

    ('demo-tool-send-alert', 'default-tenant', 'send-alert', '1.0.0',
     'Send an alert notification to a Slack channel or email',
     'mutating', false,
     '{"type":"object","properties":{"channel":{"type":"string"},"message":{"type":"string"},"severity":{"type":"string","enum":["info","warning","critical"]}},"required":["channel","message"]}',
     'approved', 'demo-admin'),

    ('demo-tool-db-query', 'default-tenant', 'db-query', '1.0.0',
     'Execute a read-only SQL query against the analytics database',
     'read', false,
     '{"type":"object","properties":{"query":{"type":"string"},"database":{"type":"string","default":"analytics"}},"required":["query"]}',
     'pending_review', 'demo-admin')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- System Skills  (platform-system tenant)
-- ---------------------------------------------------------------------------
INSERT INTO skills (id, tenant_id, name, version, description, tools, sop, mutating, approval_required, status, published_by)
VALUES
    ('system-skill-diagnostic-agent', 'platform-system', 'diagnostic-agent', '1.0.0',
     'Performs system diagnostics - collects system information, logs, and health metrics',
     '[{"name":"bash","version":"1.0.0"}]',
     'Collect system diagnostics: OS info, CPU/memory stats, service health, log analysis, resource metrics.',
     false, false, 'active', 'platform-admin'),

    ('system-skill-deployment-checker', 'platform-system', 'deployment-checker', '1.0.0',
     'Validates deployment health - verifies services, checks endpoints, validates configurations',
     '[{"name":"bash","version":"1.0.0"}]',
     'Validate deployment: check service health, validate configs, verify dependencies, run smoke tests.',
     false, false, 'active', 'platform-admin'),

    ('system-skill-log-analyzer', 'platform-system', 'log-analyzer', '1.0.0',
     'Analyzes logs for errors, warnings, and anomalies - extracts patterns and root causes',
     '[{"name":"bash","version":"1.0.0"}]',
     'Analyze logs: detect errors, match patterns, perform root cause analysis, generate recommendations.',
     false, false, 'active', 'platform-admin'),

    ('system-skill-backup-validator', 'platform-system', 'backup-validator', '1.0.0',
     'Validates backup integrity - verifies backups exist and data is consistent',
     '[{"name":"bash","version":"1.0.0"}]',
     'Validate backups: check existence, test restore, verify data consistency, measure recovery metrics.',
     false, false, 'active', 'platform-admin')
ON CONFLICT (id) DO NOTHING;

-- Demo skills (default-tenant)
INSERT INTO skills (id, tenant_id, name, version, description, tools, sop, mutating, approval_required, status, published_by)
VALUES
    ('demo-skill-market-monitor', 'default-tenant', 'market-monitor', '1.0.0',
     'Monitors stock prices and sends alerts when thresholds are breached',
     '[{"name":"stock-price","version":"1.0.0"},{"name":"send-alert","version":"1.0.0"}]',
     'Fetch stock prices for a watchlist, compare against thresholds, send alerts for breaches.',
     false, false, 'active', 'demo-admin'),

    ('demo-skill-analytics-report', 'default-tenant', 'analytics-report', '1.0.0',
     'Runs analytics queries and formats results into a human-readable report',
     '[{"name":"db-query","version":"1.0.0"}]',
     'Execute analytics queries, aggregate results, format as markdown report with tables and summaries.',
     false, false, 'draft', 'demo-admin')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- System Agents  (platform-system tenant)
-- ---------------------------------------------------------------------------
INSERT INTO agents (id, tenant_id, name, version, system_prompt, skills, model, max_iterations, memory_budget_mb, status)
VALUES
    ('kg-architect', 'platform-system', 'KG Architect', '1.0.0',
     'You are the Knowledge Graph Architect. Build domain-specific knowledge graphs from natural language descriptions using kg-* tools.',
     '[]',
     'claude-sonnet-4-5', 30, 256, 'active'),

    ('code-reviewer', 'platform-system', 'Code Reviewer', '1.0.0',
     'You are an expert code reviewer. Analyze code for bugs, security issues, performance problems, and style violations. Provide actionable feedback.',
     '[]',
     'claude-sonnet-4-5', 20, 256, 'active'),

    ('documentation-generator', 'platform-system', 'Documentation Generator', '1.0.0',
     'You are a technical writer. Generate clear, structured documentation from code, APIs, and system descriptions.',
     '[]',
     'claude-sonnet-4-5', 20, 256, 'active'),

    ('test-generator', 'platform-system', 'Test Generator', '1.0.0',
     'You are a QA engineer. Generate comprehensive test cases, unit tests, and integration tests for given code or specifications.',
     '[]',
     'claude-sonnet-4-5', 25, 256, 'active'),

    ('manifest-assistant', 'platform-system', 'Manifest Assistant', '1.0.0',
     'You help users create and validate agent manifests, skill definitions, and tool specifications for the platform.',
     '[]',
     'claude-sonnet-4-5', 20, 256, 'active')
ON CONFLICT (id) DO NOTHING;

-- Demo agents (default-tenant)
INSERT INTO agents (id, tenant_id, name, version, system_prompt, skills, model, max_iterations, memory_budget_mb, status)
VALUES
    ('demo-agent-market-watcher', 'default-tenant', 'Market Watcher', '1.0.0',
     'You monitor financial markets and send alerts when stock prices breach configured thresholds. You are concise and data-driven.',
     '[{"id":"demo-skill-market-monitor"}]',
     'claude-sonnet-4-5', 10, 128, 'active'),

    ('demo-agent-analyst', 'default-tenant', 'Data Analyst', '1.0.0',
     'You are a data analyst who runs SQL queries against the analytics database and produces clear, insightful reports with charts and summaries.',
     '[{"id":"demo-skill-analytics-report"}]',
     'claude-sonnet-4-5', 15, 256, 'active'),

    ('demo-agent-support-bot', 'default-tenant', 'Support Bot', '1.0.0',
     'You are a customer support agent. Answer questions clearly, escalate unresolved issues, and maintain a friendly tone.',
     '[]',
     'local-chat', 20, 128, 'draft')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Workflow Executions  (demo history data)
-- ---------------------------------------------------------------------------
INSERT INTO workflow_executions (workflow_id, tenant_id, agent_id, status, start_time, end_time)
VALUES
    ('wf-demo-001', 'default-tenant', 'demo-agent-market-watcher', 'COMPLETED',
     NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour 55 minutes'),

    ('wf-demo-002', 'default-tenant', 'demo-agent-analyst',        'COMPLETED',
     NOW() - INTERVAL '1 hour 30 minutes', NOW() - INTERVAL '1 hour 20 minutes'),

    ('wf-demo-003', 'default-tenant', 'demo-agent-market-watcher', 'FAILED',
     NOW() - INTERVAL '45 minutes', NOW() - INTERVAL '44 minutes'),

    ('wf-demo-004', 'platform-system', 'kg-architect',             'COMPLETED',
     NOW() - INTERVAL '3 hours', NOW() - INTERVAL '2 hours 45 minutes'),

    ('wf-demo-005', 'default-tenant', 'demo-agent-analyst',        'RUNNING',
     NOW() - INTERVAL '5 minutes', NULL),

    ('wf-demo-006', 'platform-system', 'code-reviewer',            'COMPLETED',
     NOW() - INTERVAL '6 hours', NOW() - INTERVAL '5 hours 50 minutes'),

    ('wf-demo-007', 'default-tenant', 'demo-agent-support-bot',    'CANCELLED',
     NOW() - INTERVAL '20 minutes', NOW() - INTERVAL '18 minutes')
ON CONFLICT (workflow_id) DO NOTHING;
