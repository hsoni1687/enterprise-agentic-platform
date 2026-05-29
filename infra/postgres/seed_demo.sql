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
INSERT INTO tools (id, tenant_id, name, version, description, auth_level, sandbox_required, input_schema, status, registered_by, scope)
VALUES
    ('system-tool-web-search', 'platform-system', 'web-search', '1.0.0',
     'Search the web for information and retrieve results',
     'read', false,
     '{"type":"object","properties":{"query":{"type":"string"},"max_results":{"type":"integer","default":10}},"required":["query"]}',
     'approved', 'platform-admin', 'system'),

    ('system-tool-code-executor', 'platform-system', 'code-executor', '1.0.0',
     'Execute code snippets in a sandboxed environment (Python, JavaScript, Bash)',
     'mutating', true,
     '{"type":"object","properties":{"language":{"type":"string","enum":["python","javascript","bash"]},"code":{"type":"string"},"timeout_seconds":{"type":"integer","default":30}},"required":["language","code"]}',
     'approved', 'platform-admin', 'system'),

    ('system-tool-http-request', 'platform-system', 'http-request', '1.0.0',
     'Make HTTP requests to external APIs and endpoints',
     'mutating', false,
     '{"type":"object","properties":{"method":{"type":"string","enum":["GET","POST","PUT","PATCH","DELETE"]},"url":{"type":"string"},"headers":{"type":"object"},"body":{"type":"string"}},"required":["method","url"]}',
     'approved', 'platform-admin', 'system'),

    ('system-tool-text-processing', 'platform-system', 'text-processing', '1.0.0',
     'Advanced text processing operations (regex, parsing, transformation)',
     'read', false,
     '{"type":"object","properties":{"operation":{"type":"string","enum":["regex_match","regex_replace","parse_json","parse_csv","extract_urls","extract_emails"]},"text":{"type":"string"},"pattern":{"type":"string"}},"required":["operation","text"]}',
     'approved', 'platform-admin', 'system'),

    ('system-tool-data-validation', 'platform-system', 'data-validation', '1.0.0',
     'Validate data against schemas (JSON Schema, type checking, format validation)',
     'read', false,
     '{"type":"object","properties":{"schema_type":{"type":"string","enum":["json_schema","email","url","phone","uuid"]},"data":{"type":"string"}},"required":["schema_type","data"]}',
     'approved', 'platform-admin', 'system'),

    ('system-tool-bash', 'platform-system', 'bash', '1.0.0',
     'Execute bash commands with streaming output and signal handling',
     'mutating', true,
     '{"type":"object","properties":{"script":{"type":"string"},"timeout_seconds":{"type":"integer","default":300},"environment":{"type":"object"},"working_dir":{"type":"string"}},"required":["script"]}',
     'approved', 'platform-admin', 'system'),

    ('system-tool-kg-create-graph', 'platform-system', 'kg-create-graph', '1.0.0',
     'Create a new knowledge graph for a domain',
     'mutating', false,
     '{"type":"object","properties":{"name":{"type":"string"},"domain":{"type":"string"},"description":{"type":"string"},"scope":{"type":"string","enum":["private","shared","global"],"default":"private"}},"required":["name","domain"]}',
     'approved', 'platform-admin', 'system'),

    ('system-tool-kg-add-node', 'platform-system', 'kg-add-node', '1.0.0',
     'Add a node (entity) to a knowledge graph',
     'mutating', false,
     '{"type":"object","properties":{"graph_id":{"type":"string"},"node_type":{"type":"string"},"label":{"type":"string"},"properties":{"type":"object"}},"required":["graph_id","node_type","label"]}',
     'approved', 'platform-admin', 'system'),

    ('system-tool-kg-add-edge', 'platform-system', 'kg-add-edge', '1.0.0',
     'Add an edge (relationship) between two nodes in a knowledge graph',
     'mutating', false,
     '{"type":"object","properties":{"graph_id":{"type":"string"},"from_node_id":{"type":"string"},"to_node_id":{"type":"string"},"relationship_type":{"type":"string"}},"required":["graph_id","from_node_id","to_node_id","relationship_type"]}',
     'approved', 'platform-admin', 'system'),

    ('system-tool-kg-query', 'platform-system', 'kg-query', '1.0.0',
     'Query a knowledge graph to find related nodes and edges via BFS traversal',
     'read', false,
     '{"type":"object","properties":{"graph_id":{"type":"string"},"start_node_id":{"type":"string"},"max_depth":{"type":"integer","default":3}},"required":["graph_id","start_node_id"]}',
     'approved', 'platform-admin', 'system'),

    ('system-tool-kg-search', 'platform-system', 'kg-search', '1.0.0',
     'Search knowledge graph nodes by type or semantic similarity',
     'read', false,
     '{"type":"object","properties":{"graph_id":{"type":"string"},"search_type":{"type":"string","enum":["by_type","by_embedding"]},"node_type":{"type":"string"},"limit":{"type":"integer","default":100}},"required":["graph_id","search_type"]}',
     'approved', 'platform-admin', 'system')
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
-- scope='system' + visibility='public' makes them discoverable by all tenants
-- ---------------------------------------------------------------------------
INSERT INTO skills (id, tenant_id, name, version, description, tools, sop, mutating, approval_required, status, published_by, scope, visibility)
VALUES
    ('system-skill-diagnostic-agent', 'platform-system', 'diagnostic-agent', '1.0.0',
     'Performs system diagnostics - collects system information, logs, and health metrics',
     '[{"name":"bash","version":"1.0.0"}]',
     'Collect system diagnostics: OS info, CPU/memory stats, service health, log analysis, resource metrics.',
     false, false, 'active', 'platform-admin', 'system', 'public'),

    ('system-skill-deployment-checker', 'platform-system', 'deployment-checker', '1.0.0',
     'Validates deployment health - verifies services, checks endpoints, validates configurations',
     '[{"name":"bash","version":"1.0.0"}]',
     'Validate deployment: check service health, validate configs, verify dependencies, run smoke tests.',
     false, false, 'active', 'platform-admin', 'system', 'public'),

    ('system-skill-log-analyzer', 'platform-system', 'log-analyzer', '1.0.0',
     'Analyzes logs for errors, warnings, and anomalies - extracts patterns and root causes',
     '[{"name":"bash","version":"1.0.0"}]',
     'Analyze logs: detect errors, match patterns, perform root cause analysis, generate recommendations.',
     false, false, 'active', 'platform-admin', 'system', 'public'),

    ('system-skill-backup-validator', 'platform-system', 'backup-validator', '1.0.0',
     'Validates backup integrity - verifies backups exist and data is consistent',
     '[{"name":"bash","version":"1.0.0"}]',
     'Validate backups: check existence, test restore, verify data consistency, measure recovery metrics.',
     false, false, 'active', 'platform-admin', 'system', 'public')
ON CONFLICT (id) DO UPDATE SET scope = 'system', visibility = 'public';

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
-- Additional System Tools
-- ---------------------------------------------------------------------------
INSERT INTO tools (id, tenant_id, name, version, description, auth_level, sandbox_required, input_schema, status, registered_by, scope)
VALUES
    ('system-tool-web-fetch', 'platform-system', 'web-fetch', '1.0.0',
     'Fetch a web page and return its full text content for research and documentation tasks',
     'read', false,
     '{"type":"object","properties":{"url":{"type":"string","description":"URL to fetch"},"max_chars":{"type":"integer","default":8000,"description":"Max characters to return"}},"required":["url"]}',
     'approved', 'platform-admin', 'system')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Additional System Skills (6 new skills for the 8 platform agents)
-- scope='system' + visibility='public' makes them discoverable by all tenants
-- ---------------------------------------------------------------------------
INSERT INTO skills (id, tenant_id, name, version, description, tools, sop, mutating, approval_required, status, published_by, scope, visibility)
VALUES
    -- web-research: General Assistant, Documentation Generator, Manifest Assistant
    ('system-skill-web-research', 'platform-system', 'web-research', '1.0.0',
     'Research any topic by searching the web and fetching authoritative pages',
     '[{"name":"web-search","version":"1.0.0"},{"name":"web-fetch","version":"1.0.0"},{"name":"text-processing","version":"1.0.0"}]',
     'Web Research SOP: 1) Formulate targeted search query. 2) Call web-search to get top results. 3) Call web-fetch on 1-3 most relevant URLs. 4) Use text-processing to extract key facts. 5) Synthesize into a coherent answer with source citations.',
     false, false, 'active', 'platform-admin', 'system', 'public'),

    -- code-analysis: Code Helper, Code Reviewer, Test Generator
    ('system-skill-code-analysis', 'platform-system', 'code-analysis', '1.0.0',
     'Analyze code for quality, security, performance and correctness using execution and pattern lookup',
     '[{"name":"code-executor","version":"1.0.0"},{"name":"web-search","version":"1.0.0"}]',
     'Code Analysis SOP: 1) Parse code structure and identify language/framework. 2) Run static checks via code-executor (linting, type checks). 3) Search web for known CVEs or anti-patterns if suspicious constructs found. 4) Categorize findings: Critical (security/correctness), Important (performance), Suggestions (style). 5) Return structured report.',
     false, false, 'active', 'platform-admin', 'system', 'public'),

    -- sql-analysis: Data Analyst
    ('system-skill-sql-analysis', 'platform-system', 'sql-analysis', '1.0.0',
     'Execute SQL queries, analyze results, and produce human-readable data reports',
     '[{"name":"db-query","version":"1.0.0"},{"name":"text-processing","version":"1.0.0"}]',
     'SQL Analysis SOP: 1) Validate query syntax before execution. 2) Execute via db-query tool. 3) Parse raw results with text-processing. 4) Calculate summary statistics (counts, averages, percentiles). 5) Format as markdown report with tables, key insights, and recommended next steps.',
     false, false, 'active', 'platform-admin', 'system', 'public'),

    -- document-research: Documentation Generator
    ('system-skill-document-research', 'platform-system', 'document-research', '1.0.0',
     'Research documentation standards, examples, and specifications from the web',
     '[{"name":"web-search","version":"1.0.0"},{"name":"web-fetch","version":"1.0.0"}]',
     'Document Research SOP: 1) Search for official docs, RFCs, or standards relevant to the topic. 2) Fetch 2-3 canonical reference pages. 3) Extract structure: headings, parameters, examples, warnings. 4) Return organized reference material ready for documentation generation.',
     false, false, 'active', 'platform-admin', 'system', 'public'),

    -- test-runner: Test Generator
    ('system-skill-test-runner', 'platform-system', 'test-runner', '1.0.0',
     'Execute generated test suites in a sandbox and report pass/fail results with coverage',
     '[{"name":"code-executor","version":"1.0.0"}]',
     'Test Runner SOP: 1) Set up test environment (install deps if needed). 2) Execute test suite via code-executor with appropriate test runner (pytest, jest, go test). 3) Parse output for PASSED/FAILED/ERROR counts. 4) Extract failure messages and stack traces. 5) Report coverage percentage and list failing test names.',
     false, false, 'active', 'platform-admin', 'system', 'public'),

    -- kg-builder: KG Architect
    ('system-skill-kg-builder', 'platform-system', 'kg-builder', '1.0.0',
     'Build, populate, and query knowledge graphs using the platform kg-* tools',
     '[{"name":"kg-create-graph","version":"1.0.0"},{"name":"kg-add-node","version":"1.0.0"},{"name":"kg-add-edge","version":"1.0.0"},{"name":"kg-query","version":"1.0.0"},{"name":"kg-search","version":"1.0.0"}]',
     'KG Builder SOP: 1) Call kg-create-graph with domain and description. 2) For each entity: call kg-add-node with type, label, and properties. 3) For each relationship: call kg-add-edge with from_id, to_id, and relationship_type. 4) Call kg-query from key root nodes to verify connectivity. 5) Report graph summary: node count by type, edge count by relationship.',
     true, false, 'active', 'platform-admin', 'system', 'public')
ON CONFLICT (id) DO UPDATE SET scope = 'system', visibility = 'public';

-- ---------------------------------------------------------------------------
-- Platform Knowledge Graphs
-- 6 domain KGs with stable UUIDs — referenced by agents at runtime.
-- Scope = shared so all tenants can read them.
-- ---------------------------------------------------------------------------
INSERT INTO kg_graphs (id, tenant_id, name, domain, description, scope)
VALUES
    ('00000000-0000-0000-0001-000000000000', 'platform-system',
     'Programming Languages & Frameworks', 'engineering',
     'Reference graph of programming languages, web frameworks, databases, and infrastructure tools with compatibility and usage relationships. Used by Code Helper, Code Reviewer, and Test Generator.',
     'shared'),

    ('00000000-0000-0000-0002-000000000000', 'platform-system',
     'Security Best Practices', 'security',
     'Knowledge graph of OWASP vulnerabilities, security controls, and mitigation strategies. Used by Code Reviewer to check for known vulnerability patterns.',
     'shared'),

    ('00000000-0000-0000-0003-000000000000', 'platform-system',
     'Testing Patterns & Frameworks', 'engineering',
     'Testing strategies, frameworks, and patterns for unit, integration, E2E, and performance testing across all major languages. Used by Test Generator.',
     'shared'),

    ('00000000-0000-0000-0004-000000000000', 'platform-system',
     'SQL & Data Patterns', 'data',
     'SQL query patterns, optimization techniques, schema design, and analytics patterns across PostgreSQL, MySQL, Snowflake, and BigQuery. Used by Data Analyst.',
     'shared'),

    ('00000000-0000-0000-0005-000000000000', 'platform-system',
     'Agent Capabilities Catalog', 'platform',
     'Catalog of all platform agents, skills, tools, and guardrails with their relationships and usage guidance. Used by Manifest Assistant and KG Architect.',
     'shared'),

    ('00000000-0000-0000-0006-000000000000', 'platform-system',
     'Platform Architecture', 'platform',
     'Architecture graph of all EAP services, databases, and frontends with request-flow and persistence relationships. Used by General Assistant and Manifest Assistant.',
     'shared')
ON CONFLICT (tenant_id, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- KG Nodes — Graph 1: Programming Languages & Frameworks
-- ---------------------------------------------------------------------------
INSERT INTO kg_nodes (id, graph_id, tenant_id, node_type, label, properties) VALUES
    ('00000000-0001-0000-0000-000000000001','00000000-0000-0000-0001-000000000000','platform-system','Language','Python','{"version":"3.12","paradigm":"multi-paradigm","use_cases":["web","data-science","ml","automation","scripting"],"typing":"dynamic"}'),
    ('00000000-0001-0000-0000-000000000002','00000000-0000-0000-0001-000000000000','platform-system','Language','JavaScript','{"version":"ES2024","paradigm":"multi-paradigm","runtime":"browser+node","typing":"dynamic"}'),
    ('00000000-0001-0000-0000-000000000003','00000000-0000-0000-0001-000000000000','platform-system','Language','TypeScript','{"version":"5.x","paradigm":"multi-paradigm","typing":"static","superset_of":"JavaScript"}'),
    ('00000000-0001-0000-0000-000000000004','00000000-0000-0000-0001-000000000000','platform-system','Language','Go','{"version":"1.22","paradigm":"concurrent","typing":"static","use_cases":["microservices","cli","networking"]}'),
    ('00000000-0001-0000-0000-000000000005','00000000-0000-0000-0001-000000000000','platform-system','Language','Java','{"version":"21","paradigm":"oop","typing":"static","use_cases":["enterprise","android","big-data"]}'),
    ('00000000-0001-0000-0000-000000000006','00000000-0000-0000-0001-000000000000','platform-system','Language','Rust','{"version":"1.78","paradigm":"systems","typing":"static","use_cases":["systems","wasm","performance"]}'),
    ('00000000-0001-0000-0000-000000000007','00000000-0000-0000-0001-000000000000','platform-system','Framework','FastAPI','{"language":"Python","type":"web","async":true,"openapi":true,"version":"0.111"}'),
    ('00000000-0001-0000-0000-000000000008','00000000-0000-0000-0001-000000000000','platform-system','Framework','Django','{"language":"Python","type":"web","async":false,"orm":true,"version":"5.x"}'),
    ('00000000-0001-0000-0000-000000000009','00000000-0000-0000-0001-000000000000','platform-system','Framework','Next.js','{"language":"TypeScript","type":"fullstack","ssr":true,"version":"15.x"}'),
    ('00000000-0001-0000-0000-00000000000a','00000000-0000-0000-0001-000000000000','platform-system','Framework','Express.js','{"language":"JavaScript","type":"web","minimalist":true,"version":"5.x"}'),
    ('00000000-0001-0000-0000-00000000000b','00000000-0000-0000-0001-000000000000','platform-system','Framework','Gin','{"language":"Go","type":"web","performance":"high","version":"1.10"}'),
    ('00000000-0001-0000-0000-00000000000c','00000000-0000-0000-0001-000000000000','platform-system','Framework','Spring Boot','{"language":"Java","type":"web","enterprise":true,"version":"3.x"}'),
    ('00000000-0001-0000-0000-00000000000d','00000000-0000-0000-0001-000000000000','platform-system','Database','PostgreSQL','{"type":"relational","version":"16","extensions":["pgvector","pg_trgm"],"acid":true}'),
    ('00000000-0001-0000-0000-00000000000e','00000000-0000-0000-0001-000000000000','platform-system','Database','Redis','{"type":"key-value","version":"7.x","use_cases":["cache","pubsub","session"],"in_memory":true}'),
    ('00000000-0001-0000-0000-00000000000f','00000000-0000-0000-0001-000000000000','platform-system','Database','MongoDB','{"type":"document","version":"7.x","schema":"flexible","use_cases":["content","catalog"]}'),
    ('00000000-0001-0000-0000-000000000010','00000000-0000-0000-0001-000000000000','platform-system','Infrastructure','Docker','{"type":"containerization","version":"25.x","use_cases":["local-dev","ci","packaging"]}'),
    ('00000000-0001-0000-0000-000000000011','00000000-0000-0000-0001-000000000000','platform-system','Infrastructure','Kubernetes','{"type":"orchestration","version":"1.30","use_cases":["production","scaling","self-healing"]}'),
    ('00000000-0001-0000-0000-000000000012','00000000-0000-0000-0001-000000000000','platform-system','Infrastructure','GitHub Actions','{"type":"ci-cd","use_cases":["build","test","deploy"],"trigger":"git-events"}')
ON CONFLICT (graph_id, label) DO NOTHING;

-- KG Edges — Graph 1
INSERT INTO kg_edges (graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties)
SELECT '00000000-0000-0000-0001-000000000000','platform-system', a.id, b.id, rel, props::jsonb
FROM (VALUES
    ('Python',    'FastAPI',         'has_framework',   '{"maturity":"production"}'),
    ('Python',    'Django',          'has_framework',   '{"maturity":"production"}'),
    ('Python',    'PostgreSQL',      'commonly_uses',   '{"adapter":"psycopg2"}'),
    ('Python',    'Redis',           'commonly_uses',   '{"adapter":"redis-py"}'),
    ('TypeScript','Next.js',         'has_framework',   '{"maturity":"production"}'),
    ('JavaScript','Express.js',      'has_framework',   '{"maturity":"production"}'),
    ('JavaScript','Next.js',         'has_framework',   '{"maturity":"production"}'),
    ('Go',        'Gin',             'has_framework',   '{"maturity":"production"}'),
    ('Go',        'PostgreSQL',      'commonly_uses',   '{"adapter":"pgx"}'),
    ('Java',      'Spring Boot',     'has_framework',   '{"maturity":"production"}'),
    ('Docker',    'Kubernetes',      'managed_by',      '{"description":"K8s orchestrates Docker containers"}'),
    ('FastAPI',   'PostgreSQL',      'integrates_with', '{"orm":"SQLAlchemy"}'),
    ('Next.js',   'TypeScript',      'built_with',      '{"default":true}'),
    ('Gin',       'PostgreSQL',      'integrates_with', '{"driver":"database/sql"}')
) AS t(a_label, b_label, rel, props)
JOIN kg_nodes a ON a.graph_id = '00000000-0000-0000-0001-000000000000' AND a.label = t.a_label
JOIN kg_nodes b ON b.graph_id = '00000000-0000-0000-0001-000000000000' AND b.label = t.b_label
ON CONFLICT (graph_id, from_node_id, to_node_id, relationship_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- KG Nodes — Graph 2: Security Best Practices
-- ---------------------------------------------------------------------------
INSERT INTO kg_nodes (id, graph_id, tenant_id, node_type, label, properties) VALUES
    ('00000000-0002-0000-0000-000000000001','00000000-0000-0000-0002-000000000000','platform-system','VulnerabilityType','SQL Injection','{"owasp_rank":3,"cwe":"CWE-89","severity":"Critical","description":"Attacker-controlled SQL alters query logic"}'),
    ('00000000-0002-0000-0000-000000000002','00000000-0000-0000-0002-000000000000','platform-system','VulnerabilityType','Cross-Site Scripting (XSS)','{"owasp_rank":3,"cwe":"CWE-79","severity":"High","description":"Malicious scripts injected into trusted web pages"}'),
    ('00000000-0002-0000-0000-000000000003','00000000-0000-0000-0002-000000000000','platform-system','VulnerabilityType','Broken Access Control','{"owasp_rank":1,"cwe":"CWE-284","severity":"Critical","description":"Users act outside their intended permissions"}'),
    ('00000000-0002-0000-0000-000000000004','00000000-0000-0000-0002-000000000000','platform-system','VulnerabilityType','Cryptographic Failures','{"owasp_rank":2,"cwe":"CWE-327","severity":"High","description":"Weak or absent encryption exposes sensitive data"}'),
    ('00000000-0002-0000-0000-000000000005','00000000-0000-0000-0002-000000000000','platform-system','VulnerabilityType','Security Misconfiguration','{"owasp_rank":5,"cwe":"CWE-16","severity":"High","description":"Default configs, open cloud storage, verbose errors"}'),
    ('00000000-0002-0000-0000-000000000006','00000000-0000-0000-0002-000000000000','platform-system','VulnerabilityType','SSRF','{"owasp_rank":10,"cwe":"CWE-918","severity":"High","description":"Server makes requests to attacker-controlled URLs"}'),
    ('00000000-0002-0000-0000-000000000007','00000000-0000-0000-0002-000000000000','platform-system','SecurityControl','Input Validation','{"type":"preventive","applies_to":["SQL Injection","XSS","Command Injection"],"implementation":"allowlist preferred"}'),
    ('00000000-0002-0000-0000-000000000008','00000000-0000-0000-0002-000000000000','platform-system','SecurityControl','Output Encoding','{"type":"preventive","applies_to":["XSS"],"implementation":"context-aware encoding (HTML, JS, URL, CSS)"}'),
    ('00000000-0002-0000-0000-000000000009','00000000-0000-0000-0002-000000000000','platform-system','SecurityControl','Parameterized Queries','{"type":"preventive","applies_to":["SQL Injection"],"implementation":"prepared statements or ORM"}'),
    ('00000000-0002-0000-0000-00000000000a','00000000-0000-0000-0002-000000000000','platform-system','SecurityControl','JWT Best Practices','{"type":"preventive","applies_to":["Auth Bypass"],"rules":["use RS256 not HS256","short expiry","validate aud/iss"]}'),
    ('00000000-0002-0000-0000-00000000000b','00000000-0000-0000-0002-000000000000','platform-system','SecurityControl','Secrets Management','{"type":"preventive","applies_to":["Credential Leak"],"tools":["AWS Secrets Manager","Vault","env vars (no hardcode)"]}'),
    ('00000000-0002-0000-0000-00000000000c','00000000-0000-0000-0002-000000000000','platform-system','Standard','OWASP Top 10 2023','{"version":"2023","url":"https://owasp.org/Top10","categories":10}'),
    ('00000000-0002-0000-0000-00000000000d','00000000-0000-0000-0002-000000000000','platform-system','Standard','NIST CSF','{"version":"2.0","functions":["Identify","Protect","Detect","Respond","Recover"]}')
ON CONFLICT (graph_id, label) DO NOTHING;

-- KG Edges — Graph 2
INSERT INTO kg_edges (graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties)
SELECT '00000000-0000-0000-0002-000000000000','platform-system', a.id, b.id, rel, props::jsonb
FROM (VALUES
    ('SQL Injection',            'Input Validation',       'mitigated_by',   '{"priority":"P0"}'),
    ('SQL Injection',            'Parameterized Queries',  'mitigated_by',   '{"priority":"P0"}'),
    ('Cross-Site Scripting (XSS)','Input Validation',      'mitigated_by',   '{"priority":"P0"}'),
    ('Cross-Site Scripting (XSS)','Output Encoding',       'mitigated_by',   '{"priority":"P0"}'),
    ('Cryptographic Failures',   'Secrets Management',     'mitigated_by',   '{"priority":"P1"}'),
    ('SQL Injection',            'OWASP Top 10 2023',      'listed_in',      '{"rank":3}'),
    ('Broken Access Control',    'OWASP Top 10 2023',      'listed_in',      '{"rank":1}'),
    ('Cryptographic Failures',   'OWASP Top 10 2023',      'listed_in',      '{"rank":2}'),
    ('JWT Best Practices',       'Broken Access Control',  'prevents',       '{"scope":"auth-bypass"}'),
    ('Secrets Management',       'Cryptographic Failures', 'prevents',       '{"scope":"key-exposure"}')
) AS t(a_label, b_label, rel, props)
JOIN kg_nodes a ON a.graph_id = '00000000-0000-0000-0002-000000000000' AND a.label = t.a_label
JOIN kg_nodes b ON b.graph_id = '00000000-0000-0000-0002-000000000000' AND b.label = t.b_label
ON CONFLICT (graph_id, from_node_id, to_node_id, relationship_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- KG Nodes — Graph 3: Testing Patterns & Frameworks
-- ---------------------------------------------------------------------------
INSERT INTO kg_nodes (id, graph_id, tenant_id, node_type, label, properties) VALUES
    ('00000000-0003-0000-0000-000000000001','00000000-0000-0000-0003-000000000000','platform-system','Strategy','Unit Testing','{"scope":"single function/class","isolation":"full mocking","speed":"fast","coverage_target":"80%+"}'),
    ('00000000-0003-0000-0000-000000000002','00000000-0000-0000-0003-000000000000','platform-system','Strategy','Integration Testing','{"scope":"multiple components","isolation":"partial","speed":"medium","database":"real or testcontainers"}'),
    ('00000000-0003-0000-0000-000000000003','00000000-0000-0000-0003-000000000000','platform-system','Strategy','End-to-End Testing','{"scope":"full user flow","isolation":"none","speed":"slow","browser":"real"}'),
    ('00000000-0003-0000-0000-000000000004','00000000-0000-0000-0003-000000000000','platform-system','Strategy','Contract Testing','{"scope":"service boundaries","tool":"Pact","ensures":"API compatibility"}'),
    ('00000000-0003-0000-0000-000000000005','00000000-0000-0000-0003-000000000000','platform-system','Strategy','Load Testing','{"scope":"performance","tools":["k6","Locust","JMeter"],"metrics":["p95","p99","RPS"]}'),
    ('00000000-0003-0000-0000-000000000006','00000000-0000-0000-0003-000000000000','platform-system','Framework','pytest','{"language":"Python","style":"function-based","plugins":["pytest-mock","pytest-asyncio","pytest-cov"]}'),
    ('00000000-0003-0000-0000-000000000007','00000000-0000-0000-0003-000000000000','platform-system','Framework','Jest','{"language":"JavaScript","style":"describe/it","built_in_mocking":true,"coverage":true}'),
    ('00000000-0003-0000-0000-000000000008','00000000-0000-0000-0003-000000000000','platform-system','Framework','Vitest','{"language":"TypeScript","style":"describe/it","vite_native":true,"compat":"Jest API"}'),
    ('00000000-0003-0000-0000-000000000009','00000000-0000-0000-0003-000000000000','platform-system','Framework','Playwright','{"language":"TypeScript","scope":"E2E","browsers":["Chrome","Firefox","Safari"],"codegen":true}'),
    ('00000000-0003-0000-0000-00000000000a','00000000-0000-0000-0003-000000000000','platform-system','Framework','Go testing','{"language":"Go","built_in":true,"style":"TestXxx functions","subtests":true}'),
    ('00000000-0003-0000-0000-00000000000b','00000000-0000-0000-0003-000000000000','platform-system','Pattern','AAA (Arrange-Act-Assert)','{"description":"Structure every test: setup state, execute, verify outcome"}'),
    ('00000000-0003-0000-0000-00000000000c','00000000-0000-0000-0003-000000000000','platform-system','Pattern','Test Doubles','{"types":["Mock","Stub","Fake","Spy","Dummy"],"principle":"isolate system under test"}'),
    ('00000000-0003-0000-0000-00000000000d','00000000-0000-0000-0003-000000000000','platform-system','Pattern','Table-Driven Tests','{"languages":["Go","Python"],"description":"Parameterize test cases as data rows"}'),
    ('00000000-0003-0000-0000-00000000000e','00000000-0000-0000-0003-000000000000','platform-system','Tool','Testcontainers','{"description":"Spin up real Docker containers for DB/queue in tests","languages":["Java","Go","Python"]}')
ON CONFLICT (graph_id, label) DO NOTHING;

-- KG Edges — Graph 3
INSERT INTO kg_edges (graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties)
SELECT '00000000-0000-0000-0003-000000000000','platform-system', a.id, b.id, rel, props::jsonb
FROM (VALUES
    ('Unit Testing',       'pytest',           'primary_framework_python','{}'),
    ('Unit Testing',       'Jest',             'primary_framework_js',   '{}'),
    ('Unit Testing',       'Go testing',       'primary_framework_go',   '{}'),
    ('Unit Testing',       'AAA (Arrange-Act-Assert)','follows_pattern', '{}'),
    ('Unit Testing',       'Test Doubles',     'uses_pattern',           '{}'),
    ('Integration Testing','Testcontainers',   'uses_tool',              '{"why":"real db/queue in CI"}'),
    ('End-to-End Testing', 'Playwright',       'primary_framework',      '{}'),
    ('Go testing',         'Table-Driven Tests','recommends_pattern',    '{}'),
    ('pytest',             'Test Doubles',     'supports_via',           '{"library":"pytest-mock"}'),
    ('Vitest',             'Unit Testing',     'used_for',               '{"ecosystem":"Vite/Vue/React"}')
) AS t(a_label, b_label, rel, props)
JOIN kg_nodes a ON a.graph_id = '00000000-0000-0000-0003-000000000000' AND a.label = t.a_label
JOIN kg_nodes b ON b.graph_id = '00000000-0000-0000-0003-000000000000' AND b.label = t.b_label
ON CONFLICT (graph_id, from_node_id, to_node_id, relationship_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- KG Nodes — Graph 4: SQL & Data Patterns
-- ---------------------------------------------------------------------------
INSERT INTO kg_nodes (id, graph_id, tenant_id, node_type, label, properties) VALUES
    ('00000000-0004-0000-0000-000000000001','00000000-0000-0000-0004-000000000000','platform-system','QueryType','SELECT','{"description":"Retrieve rows from one or more tables","variants":["DISTINCT","TOP/LIMIT","FOR UPDATE"]}'),
    ('00000000-0004-0000-0000-000000000002','00000000-0000-0000-0004-000000000000','platform-system','QueryType','INNER JOIN','{"description":"Return rows matching in both tables","performance":"fastest join type when indexes exist"}'),
    ('00000000-0004-0000-0000-000000000003','00000000-0000-0000-0004-000000000000','platform-system','QueryType','LEFT JOIN','{"description":"All rows from left table, matched rows from right","null_handling":"right side NULLs when no match"}'),
    ('00000000-0004-0000-0000-000000000004','00000000-0000-0000-0004-000000000000','platform-system','AdvancedFeature','Window Functions','{"examples":["ROW_NUMBER()","RANK()","LAG()","LEAD()","SUM() OVER()"],"use_case":"analytics without GROUP BY aggregation"}'),
    ('00000000-0004-0000-0000-000000000005','00000000-0000-0000-0004-000000000000','platform-system','AdvancedFeature','Common Table Expressions (CTEs)','{"syntax":"WITH name AS (...)","use_cases":["readability","recursion","temp results"],"recursive":true}'),
    ('00000000-0004-0000-0000-000000000006','00000000-0000-0000-0004-000000000000','platform-system','AdvancedFeature','Indexes','{"types":["B-Tree","Hash","GIN","GIST","BRIN"],"when_to_use":"high-cardinality filter/join columns","trade_off":"faster reads, slower writes"}'),
    ('00000000-0004-0000-0000-000000000007','00000000-0000-0000-0004-000000000000','platform-system','AdvancedFeature','EXPLAIN / EXPLAIN ANALYZE','{"purpose":"inspect query plan","key_metrics":["Seq Scan vs Index Scan","rows","cost","actual time"]}'),
    ('00000000-0004-0000-0000-000000000008','00000000-0000-0000-0004-000000000000','platform-system','Database','PostgreSQL','{"version":"16","strengths":["ACID","JSON","pgvector","window functions","CTEs"],"use_cases":["oltp","analytics","vector search"]}'),
    ('00000000-0004-0000-0000-000000000009','00000000-0000-0000-0004-000000000000','platform-system','Database','Snowflake','{"type":"cloud-dwh","strengths":["auto-scale","time-travel","zero-copy cloning"],"use_case":"analytics at scale"}'),
    ('00000000-0004-0000-0000-00000000000a','00000000-0000-0000-0004-000000000000','platform-system','Database','BigQuery','{"vendor":"Google","type":"serverless-dwh","strengths":["petabyte scale","ML integration","columnar"],"pricing":"per-query"}'),
    ('00000000-0004-0000-0000-00000000000b','00000000-0000-0000-0004-000000000000','platform-system','SchemaPattern','Star Schema','{"description":"Fact table at center, dimension tables around it","use_case":"OLAP/BI reporting","join_performance":"high"}'),
    ('00000000-0004-0000-0000-00000000000c','00000000-0000-0000-0004-000000000000','platform-system','SchemaPattern','Normalization (3NF)','{"description":"Eliminate redundancy via foreign key relationships","use_case":"OLTP write-heavy workloads","trade_off":"more joins"}')
ON CONFLICT (graph_id, label) DO NOTHING;

-- KG Edges — Graph 4
INSERT INTO kg_edges (graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties)
SELECT '00000000-0000-0000-0004-000000000000','platform-system', a.id, b.id, rel, props::jsonb
FROM (VALUES
    ('Window Functions',              'SELECT',           'extends',          '{"via":"OVER() clause"}'),
    ('Common Table Expressions (CTEs)','SELECT',          'wraps',            '{"via":"WITH keyword"}'),
    ('INNER JOIN',                    'Indexes',          'benefits_from',    '{"on":"join columns"}'),
    ('EXPLAIN / EXPLAIN ANALYZE',     'Indexes',          'diagnoses_need_for','{}'),
    ('Star Schema',                   'PostgreSQL',       'implemented_in',   '{}'),
    ('Star Schema',                   'Snowflake',        'implemented_in',   '{}'),
    ('Normalization (3NF)',           'PostgreSQL',       'best_suited_for',  '{"workload":"OLTP"}'),
    ('Window Functions',              'Snowflake',        'supported_by',     '{}'),
    ('Window Functions',              'BigQuery',         'supported_by',     '{}'),
    ('EXPLAIN / EXPLAIN ANALYZE',     'PostgreSQL',       'available_in',     '{"command":"EXPLAIN ANALYZE SELECT..."}')
) AS t(a_label, b_label, rel, props)
JOIN kg_nodes a ON a.graph_id = '00000000-0000-0000-0004-000000000000' AND a.label = t.a_label
JOIN kg_nodes b ON b.graph_id = '00000000-0000-0000-0004-000000000000' AND b.label = t.b_label
ON CONFLICT (graph_id, from_node_id, to_node_id, relationship_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- KG Nodes — Graph 5: Agent Capabilities Catalog
-- ---------------------------------------------------------------------------
INSERT INTO kg_nodes (id, graph_id, tenant_id, node_type, label, properties) VALUES
    -- Agents
    ('00000000-0005-0000-0000-000000000001','00000000-0000-0000-0005-000000000000','platform-system','Agent','General Assistant','{"tenant":"default-tenant","tier":"deep","purpose":"General Q&A and research using web search"}'),
    ('00000000-0005-0000-0000-000000000002','00000000-0000-0000-0005-000000000000','platform-system','Agent','Code Helper','{"tenant":"default-tenant","tier":"deep","purpose":"Code writing, debugging, and explanation"}'),
    ('00000000-0005-0000-0000-000000000003','00000000-0000-0000-0005-000000000000','platform-system','Agent','Data Analyst','{"tenant":"default-tenant","tier":"deep","purpose":"SQL queries, analytics, and data insights"}'),
    ('00000000-0005-0000-0000-000000000004','00000000-0000-0000-0005-000000000000','platform-system','Agent','Market Watcher','{"tenant":"default-tenant","tier":"deep","purpose":"Stock price monitoring and threshold alerts"}'),
    ('00000000-0005-0000-0000-000000000005','00000000-0000-0000-0005-000000000000','platform-system','Agent','Code Reviewer','{"tenant":"platform-system","tier":"deep","purpose":"Code quality, security, and performance review"}'),
    ('00000000-0005-0000-0000-000000000006','00000000-0000-0000-0005-000000000000','platform-system','Agent','Documentation Generator','{"tenant":"platform-system","tier":"deep","purpose":"API docs, guides, and specifications"}'),
    ('00000000-0005-0000-0000-000000000007','00000000-0000-0000-0005-000000000000','platform-system','Agent','Test Generator','{"tenant":"platform-system","tier":"deep","purpose":"Unit, integration, and E2E test suites"}'),
    ('00000000-0005-0000-0000-000000000008','00000000-0000-0000-0005-000000000000','platform-system','Agent','KG Architect','{"tenant":"platform-system","tier":"deep","purpose":"Build domain knowledge graphs from natural language"}'),
    ('00000000-0005-0000-0000-000000000009','00000000-0000-0000-0005-000000000000','platform-system','Agent','Manifest Assistant','{"tenant":"platform-system","tier":"deep","purpose":"Design agent system prompts and skill recommendations"}'),
    -- Skills
    ('00000000-0005-0000-0000-00000000000a','00000000-0000-0000-0005-000000000000','platform-system','Skill','web-research','{"tools":["web-search","web-fetch","text-processing"],"use_case":"Research topics from the web"}'),
    ('00000000-0005-0000-0000-00000000000b','00000000-0000-0000-0005-000000000000','platform-system','Skill','code-analysis','{"tools":["code-executor","web-search"],"use_case":"Analyze code for quality and security"}'),
    ('00000000-0005-0000-0000-00000000000c','00000000-0000-0000-0005-000000000000','platform-system','Skill','sql-analysis','{"tools":["db-query","text-processing"],"use_case":"Execute SQL and produce reports"}'),
    ('00000000-0005-0000-0000-00000000000d','00000000-0000-0000-0005-000000000000','platform-system','Skill','document-research','{"tools":["web-search","web-fetch"],"use_case":"Research documentation standards"}'),
    ('00000000-0005-0000-0000-00000000000e','00000000-0000-0000-0005-000000000000','platform-system','Skill','test-runner','{"tools":["code-executor"],"use_case":"Execute test suites and report results"}'),
    ('00000000-0005-0000-0000-00000000000f','00000000-0000-0000-0005-000000000000','platform-system','Skill','kg-builder','{"tools":["kg-create-graph","kg-add-node","kg-add-edge","kg-query"],"use_case":"Build and traverse knowledge graphs"}'),
    -- Guardrails
    ('00000000-0005-0000-0000-000000000010','00000000-0000-0000-0005-000000000000','platform-system','Guardrail','PII Detection','{"id":"gr-pii-block","action":"redact","applies_to":"output","enabled":true}'),
    ('00000000-0005-0000-0000-000000000011','00000000-0000-0000-0005-000000000000','platform-system','Guardrail','Prompt Injection Guard','{"id":"gr-prompt-injection","action":"block","applies_to":"input","enabled":true}'),
    ('00000000-0005-0000-0000-000000000012','00000000-0000-0000-0005-000000000000','platform-system','Guardrail','Secret Leakage Prevention','{"id":"gr-secret-leak","action":"redact","applies_to":"output","enabled":true}'),
    ('00000000-0005-0000-0000-000000000013','00000000-0000-0000-0005-000000000000','platform-system','Guardrail','Toxic Content Filter','{"id":"gr-toxic-content","action":"block","applies_to":"output","enabled":true}')
ON CONFLICT (graph_id, label) DO NOTHING;

-- KG Edges — Graph 5 (Agent → Skill, Agent → Guardrail)
INSERT INTO kg_edges (graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties)
SELECT '00000000-0000-0000-0005-000000000000','platform-system', a.id, b.id, rel, '{}'::jsonb
FROM (VALUES
    ('General Assistant',       'web-research',              'uses_skill'),
    ('General Assistant',       'PII Detection',             'protected_by'),
    ('General Assistant',       'Prompt Injection Guard',    'protected_by'),
    ('Code Helper',             'code-analysis',             'uses_skill'),
    ('Code Helper',             'Prompt Injection Guard',    'protected_by'),
    ('Code Helper',             'Secret Leakage Prevention', 'protected_by'),
    ('Data Analyst',            'sql-analysis',              'uses_skill'),
    ('Data Analyst',            'PII Detection',             'protected_by'),
    ('Data Analyst',            'Secret Leakage Prevention', 'protected_by'),
    ('Code Reviewer',           'code-analysis',             'uses_skill'),
    ('Code Reviewer',           'web-research',              'uses_skill'),
    ('Code Reviewer',           'Secret Leakage Prevention', 'protected_by'),
    ('Code Reviewer',           'Prompt Injection Guard',    'protected_by'),
    ('Documentation Generator', 'document-research',         'uses_skill'),
    ('Documentation Generator', 'Prompt Injection Guard',    'protected_by'),
    ('Test Generator',          'test-runner',               'uses_skill'),
    ('Test Generator',          'code-analysis',             'uses_skill'),
    ('Test Generator',          'Secret Leakage Prevention', 'protected_by'),
    ('KG Architect',            'kg-builder',                'uses_skill'),
    ('KG Architect',            'Prompt Injection Guard',    'protected_by'),
    ('Manifest Assistant',      'web-research',              'uses_skill'),
    ('Manifest Assistant',      'Prompt Injection Guard',    'protected_by')
) AS t(a_label, b_label, rel)
JOIN kg_nodes a ON a.graph_id = '00000000-0000-0000-0005-000000000000' AND a.label = t.a_label
JOIN kg_nodes b ON b.graph_id = '00000000-0000-0000-0005-000000000000' AND b.label = t.b_label
ON CONFLICT (graph_id, from_node_id, to_node_id, relationship_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- KG Nodes — Graph 6: Platform Architecture
-- ---------------------------------------------------------------------------
INSERT INTO kg_nodes (id, graph_id, tenant_id, node_type, label, properties) VALUES
    ('00000000-0006-0000-0000-000000000001','00000000-0000-0000-0006-000000000000','platform-system','Service','API Gateway','{"port":"8080","lang":"Go","role":"entry-point","description":"Single entry point for all client requests"}'),
    ('00000000-0006-0000-0000-000000000002','00000000-0000-0000-0006-000000000000','platform-system','Service','Workflow Initiator','{"port":"8081","lang":"Go","role":"dispatcher","description":"Validates manifests and dispatches Temporal workflows"}'),
    ('00000000-0006-0000-0000-000000000003','00000000-0000-0000-0006-000000000000','platform-system','Service','Agent Registry','{"port":"8088","lang":"Go","role":"registry","description":"Stores agent manifests, versions, and lifecycle states"}'),
    ('00000000-0006-0000-0000-000000000004','00000000-0000-0000-0006-000000000000','platform-system','Service','Agent Workers','{"lang":"Python","role":"executor","description":"Temporal workers that execute agent steps via LLM + tools"}'),
    ('00000000-0006-0000-0000-000000000005','00000000-0000-0000-0006-000000000000','platform-system','Service','LiteLLM Proxy','{"port":"4000","lang":"Python","role":"llm-gateway","description":"Unified LLM API supporting Anthropic, OpenAI, Ollama"}'),
    ('00000000-0006-0000-0000-000000000006','00000000-0000-0000-0006-000000000000','platform-system','Service','Temporal','{"port":"7233","role":"orchestrator","description":"Durable workflow engine — guarantees exactly-once execution"}'),
    ('00000000-0006-0000-0000-000000000007','00000000-0000-0000-0006-000000000000','platform-system','Database','PostgreSQL','{"port":"5432","extensions":["pgvector","pg_trgm"],"features":["RLS","JSONB","pgvector"],"role":"primary-db"}'),
    ('00000000-0006-0000-0000-000000000008','00000000-0000-0000-0006-000000000000','platform-system','Service','KG Service','{"port":"8093","lang":"Go","role":"knowledge","description":"Knowledge graph storage and semantic search"}'),
    ('00000000-0006-0000-0000-000000000009','00000000-0000-0000-0006-000000000000','platform-system','Service','Skill Catalog','{"port":"8087","lang":"Go","role":"catalog","description":"Registry of skills available to agents"}'),
    ('00000000-0006-0000-0000-00000000000a','00000000-0000-0000-0006-000000000000','platform-system','Service','Skill Dispatcher','{"port":"8085","lang":"Go","role":"dispatcher","description":"Executes skill invocations and routes tool calls"}'),
    ('00000000-0006-0000-0000-00000000000b','00000000-0000-0000-0006-000000000000','platform-system','Service','Tool Registry','{"port":"8086","lang":"Go","role":"registry","description":"Central registry of all available tools"}'),
    ('00000000-0006-0000-0000-00000000000c','00000000-0000-0000-0006-000000000000','platform-system','Service','MCP Registry','{"port":"8090","lang":"Go","role":"mcp-hub","description":"Model Context Protocol server hub"}'),
    ('00000000-0006-0000-0000-00000000000d','00000000-0000-0000-0006-000000000000','platform-system','Service','Admin API','{"port":"8089","lang":"Go","role":"admin","description":"Administrative API for platform management"}'),
    ('00000000-0006-0000-0000-00000000000e','00000000-0000-0000-0006-000000000000','platform-system','Frontend','Agent Studio','{"port":"3000","lang":"Next.js","role":"ui","description":"Developer-facing UI for chatting with agents and managing KGs"}'),
    ('00000000-0006-0000-0000-00000000000f','00000000-0000-0000-0006-000000000000','platform-system','Frontend','Admin Console','{"port":"3001","lang":"Next.js","role":"ui","description":"Admin-facing UI for platform administration"}')
ON CONFLICT (graph_id, label) DO NOTHING;

-- KG Edges — Graph 6
INSERT INTO kg_edges (graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties)
SELECT '00000000-0000-0000-0006-000000000000','platform-system', a.id, b.id, rel, props::jsonb
FROM (VALUES
    ('API Gateway',      'Workflow Initiator',  'routes_to',        '{"for":"agent runs"}'),
    ('Workflow Initiator','Temporal',           'dispatches_to',    '{"description":"starts durable workflows"}'),
    ('Workflow Initiator','Agent Registry',     'fetches_manifest', '{"before":"dispatch"}'),
    ('Agent Workers',    'Temporal',            'polls',            '{"queue":"tenant task queue"}'),
    ('Agent Workers',    'LiteLLM Proxy',       'calls_llm',        '{"all_llm_calls":"routed here"}'),
    ('Agent Workers',    'KG Service',          'queries_graph',    '{"for":"context injection"}'),
    ('Agent Workers',    'Skill Dispatcher',    'invokes_skill',    '{"during":"agent steps"}'),
    ('Skill Dispatcher', 'Skill Catalog',       'resolves_skill',   '{}'),
    ('Skill Dispatcher', 'Tool Registry',       'fetches_tool',     '{}'),
    ('Skill Catalog',    'MCP Registry',        'delegates_mcp',    '{}'),
    ('Agent Registry',   'PostgreSQL',          'persists_data',    '{}'),
    ('KG Service',       'PostgreSQL',          'persists_data',    '{"extension":"pgvector"}'),
    ('LiteLLM Proxy',    'PostgreSQL',          'persists_spend',   '{}'),
    ('Skill Catalog',    'PostgreSQL',          'persists_data',    '{}'),
    ('Agent Studio',     'API Gateway',         'api_calls',        '{"for":"chat and runs"}'),
    ('Agent Studio',     'Agent Registry',      'api_calls',        '{"for":"agent management"}'),
    ('Agent Studio',     'KG Service',          'api_calls',        '{"for":"KG browsing"}'),
    ('Admin Console',    'Admin API',           'api_calls',        '{"for":"platform admin"}')
) AS t(a_label, b_label, rel, props)
JOIN kg_nodes a ON a.graph_id = '00000000-0000-0000-0006-000000000000' AND a.label = t.a_label
JOIN kg_nodes b ON b.graph_id = '00000000-0000-0000-0006-000000000000' AND b.label = t.b_label
ON CONFLICT (graph_id, from_node_id, to_node_id, relationship_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- System Agents — full manifests with skills, guardrails, KGs
-- Using ON CONFLICT DO UPDATE to patch agents that already exist from
-- earlier simplified seeds.
-- ---------------------------------------------------------------------------
INSERT INTO agents (
    id, tenant_id, name, version, system_prompt, skills,
    model, max_iterations, memory_budget_mb, status,
    guardrail_ids, knowledge_graph_ids, tier, autonomy_level, description, tags
) VALUES
    -- ── KG Architect (platform-system) ──────────────────────────────────────
    ('kg-architect', 'platform-system', 'KG Architect', '1.0.0',
     'You are the Knowledge Graph Architect. Your role is to build domain-specific knowledge graphs from natural language descriptions using kg-* tools.

## Workflow
1. **Parse Requirements**: Understand the domain description provided by the user
2. **Identify Entities**: Extract entity types (nouns) and relationship types (verbs)
3. **Create Graph**: Call kg-create-graph with domain name and schema
4. **Add Nodes**: For each entity mentioned, call kg-add-node with type and label
5. **Add Edges**: For each relationship, call kg-add-edge from source to target
6. **Verify**: Call kg-query from a root node to verify connectivity
7. **Summarize**: Report back the graph structure (N nodes, M edges, types discovered)

## Domain Knowledge
- **DevOps**: Service, Deployment, Environment, Alert, Incident, Runbook, Team → depends_on, triggers_alert, owned_by, resolved_by
- **Fintech**: Account, Transaction, Portfolio, RiskPolicy, Trader → holds_account, executes_transaction, subject_to
- **Healthcare**: Patient, Provider, Procedure, Medication → has_diagnosis, prescribed_by, performed_at

Use meaningful node labels, infer reasonable types, and validate connectivity before summarizing.',
     '[{"id":"system-skill-kg-builder","name":"kg-builder","version":"1.0.0"}]',
     'claude-sonnet-4-5', 30, 256, 'active',
     '["gr-prompt-injection","gr-hallucination"]',
     '["00000000-0000-0000-0005-000000000000"]',
     'deep', 'autonomous', 'Builds domain knowledge graphs from natural language descriptions using kg-* tools',
     '["knowledge-graph","platform","meta-agent"]'),

    -- ── Code Reviewer (platform-system) ─────────────────────────────────────
    ('code-reviewer', 'platform-system', 'Code Reviewer', '1.0.0',
     'You are an expert Code Reviewer. Analyze code submissions and provide actionable, constructive feedback.

## Review Dimensions
1. **Correctness**: Logic errors, off-by-one, null handling, race conditions
2. **Security**: SQL injection, XSS, hardcoded secrets, insecure deserialization, SSRF (reference the Security Best Practices knowledge graph)
3. **Performance**: N+1 queries, missing indexes, unnecessary allocations, blocking I/O
4. **Maintainability**: Naming, DRY violations, cyclomatic complexity, missing error handling
5. **Testing**: Coverage gaps, missing edge cases, untestable design

## Output Format
- **Critical Issues**: Must fix before merge (security/correctness)
- **Important Issues**: Should fix (performance/maintainability)
- **Suggestions**: Nice to have (style/docs)
- **Approved ✓**: When no Critical/Important issues found

Use web-research to look up known CVE patterns or best practices when reviewing unfamiliar libraries. Use code-analysis to validate syntax and run linters.',
     '[{"id":"system-skill-code-analysis","name":"code-analysis","version":"1.0.0"},{"id":"system-skill-web-research","name":"web-research","version":"1.0.0"}]',
     'claude-sonnet-4-5', 20, 512, 'active',
     '["gr-prompt-injection","gr-secret-leak","gr-hallucination"]',
     '["00000000-0000-0000-0001-000000000000","00000000-0000-0000-0002-000000000000"]',
     'deep', 'autonomous', 'Reviews code for quality, security, performance, and best practices with web-backed CVE lookup',
     '["code","security","review","platform"]'),

    -- ── Documentation Generator (platform-system) ───────────────────────────
    ('documentation-generator', 'platform-system', 'Documentation Generator', '1.0.0',
     'You are the Documentation Generator. Produce clear, comprehensive, and well-structured technical documentation.

## Responsibilities
1. Parse technical specifications, code, and API definitions
2. Generate well-formatted Markdown documentation
3. Create consistent API references with request/response examples
4. Produce user guides with quick-start sections before detailed references
5. Include troubleshooting, FAQ, and error code sections

## Guidelines
- Always include a Table of Contents for documents > 500 words
- Lead with a 2-sentence summary of what the thing is and why it exists
- Code examples must be runnable (not pseudocode) with correct syntax highlighting
- Use document-research to look up industry standards (OpenAPI, RFC specs, etc.) when applicable
- Target both technical and non-technical audiences: explain jargon on first use

## Output
Deliver raw Markdown unless another format is requested.',
     '[{"id":"system-skill-document-research","name":"document-research","version":"1.0.0"}]',
     'claude-sonnet-4-5', 15, 256, 'active',
     '["gr-prompt-injection","gr-off-topic","gr-length-limit"]',
     '["00000000-0000-0000-0001-000000000000"]',
     'deep', 'autonomous', 'Generates API documentation, guides, and specifications with web-backed standards research',
     '["documentation","writing","platform"]'),

    -- ── Test Generator (platform-system) ────────────────────────────────────
    ('test-generator', 'platform-system', 'Test Generator', '1.0.0',
     'You are the Test Generator. Create comprehensive, high-quality test suites that actually run and pass.

## Test Strategy (per request)
1. **Unit Tests**: Isolated, fast, mocked dependencies — 80%+ coverage target
2. **Integration Tests**: Real components, real DB via Testcontainers, test critical paths
3. **E2E Tests**: Full user flows, use Playwright for browser or supertest for HTTP
4. **Edge Cases**: Null inputs, empty collections, boundary values, error paths

## Per-Test Quality Rules
- Follow AAA pattern: Arrange (setup), Act (execute), Assert (verify)
- Test names describe behaviour: `test_refund_fails_when_amount_exceeds_balance`
- One assertion concept per test (multiple assertions OK if they verify the same thing)
- Use Table-Driven Tests for Go; parametrize in pytest; describe blocks in Jest

## Execution
After generating tests, use test-runner to execute them in a sandbox. If tests fail, fix them before returning. Only return passing test suites.',
     '[{"id":"system-skill-test-runner","name":"test-runner","version":"1.0.0"},{"id":"system-skill-code-analysis","name":"code-analysis","version":"1.0.0"}]',
     'claude-sonnet-4-5', 25, 384, 'active',
     '["gr-prompt-injection","gr-secret-leak"]',
     '["00000000-0000-0000-0003-000000000000","00000000-0000-0000-0001-000000000000"]',
     'deep', 'autonomous', 'Generates and validates unit, integration, and E2E test suites that actually run and pass',
     '["testing","quality","platform"]'),

    -- ── Manifest Assistant (platform-system) ────────────────────────────────
    ('manifest-assistant', 'platform-system', 'Manifest Assistant', '1.0.0',
     'You are the Manifest Assistant. Help users design comprehensive agent system prompts and recommend appropriate skills based on their requirements.

When a user describes an agent they want to build, respond with EXACTLY these three sections:

## System Prompt Draft
Create a system prompt that:
- Starts with "You are" (role, persona, purpose)
- Explains key responsibilities and constraints (3-5 bullet points)
- Is specific and actionable, not generic
- References any domain KG the agent should consult

## Recommended Skills
List 2-5 skills from the platform catalog that match the agent purpose:
- web-research: For agents that need current information from the web
- code-analysis: For agents reviewing or generating code
- sql-analysis: For data-intensive agents
- kg-builder: For agents that construct domain knowledge
- test-runner: For agents that validate code
- document-research: For documentation-focused agents

## Skills/Tools to Create
Only if custom tools are needed that do not exist in the catalog. Otherwise: "None required — use platform skills above."

## Critical Rules
1. Always output all three sections
2. Never invent skill names — use only the catalog above
3. Recommend the Agent Capabilities Catalog KG for agents that need to understand platform capabilities
4. Respond immediately — do not ask clarifying questions unless the domain is completely undefined',
     '[{"id":"system-skill-web-research","name":"web-research","version":"1.0.0"}]',
     'claude-sonnet-4-5', 15, 128, 'active',
     '["gr-prompt-injection","gr-off-topic"]',
     '["00000000-0000-0000-0005-000000000000","00000000-0000-0000-0006-000000000000"]',
     'deep', 'autonomous', 'Designs agent system prompts and recommends skills from the platform catalog',
     '["meta-agent","platform","onboarding"]')
ON CONFLICT (id) DO UPDATE SET
    system_prompt       = EXCLUDED.system_prompt,
    skills              = EXCLUDED.skills,
    guardrail_ids       = EXCLUDED.guardrail_ids,
    knowledge_graph_ids = EXCLUDED.knowledge_graph_ids,
    tier                = EXCLUDED.tier,
    autonomy_level      = EXCLUDED.autonomy_level,
    description         = EXCLUDED.description,
    tags                = EXCLUDED.tags;

-- ---------------------------------------------------------------------------
-- Demo Agents (default-tenant) — full manifests
-- These are the starter agents any user sees when they first open the platform.
-- ---------------------------------------------------------------------------
-- Rename the old demo-agent-analyst ("Data Analyst") to "Analytics Agent" so
-- the new demo-data-analyst can use "Data Analyst" as its canonical name.
UPDATE agents SET name = 'Analytics Agent'
WHERE id = 'demo-agent-analyst' AND tenant_id = 'default-tenant' AND name = 'Data Analyst';

INSERT INTO agents (
    id, tenant_id, name, version, system_prompt, skills,
    model, max_iterations, memory_budget_mb, status,
    guardrail_ids, knowledge_graph_ids, tier, autonomy_level, description, tags
) VALUES
    -- ── General Assistant ────────────────────────────────────────────────────
    ('demo-general-assistant', 'default-tenant', 'General Assistant', '1.0.0',
     'You are a helpful, friendly, and knowledgeable General Assistant.

You can answer questions on a wide range of topics including science, history, technology, culture, mathematics, and everyday tasks. When you need current information or want to verify facts, use web-research to search and fetch authoritative sources.

## Behaviour
- Be concise but thorough. Prefer bullet points and headers for complex answers.
- If unsure about something, say so and offer to research it.
- For multi-step tasks, break them down and work through each step explicitly.
- Cite sources when using web-research results.
- Format code in appropriate markdown code fences.

## Limitations
- Do not make up facts. Research before claiming current statistics or recent events.
- Do not assist with harmful, deceptive, or illegal requests.',
     '[{"id":"system-skill-web-research","name":"web-research","version":"1.0.0"}]',
     'claude-sonnet-4-5', 15, 128, 'active',
     '["gr-pii-block","gr-prompt-injection","gr-toxic-content","gr-off-topic"]',
     '["00000000-0000-0000-0006-000000000000"]',
     'deep', 'autonomous', 'General-purpose assistant with web research capabilities for accurate, sourced answers',
     '["general","research","starter"]'),

    -- ── Code Helper ──────────────────────────────────────────────────────────
    ('demo-code-helper', 'default-tenant', 'Code Helper', '1.0.0',
     'You are an expert Code Helper — a senior software engineer who assists with writing, debugging, reviewing, and explaining code in any language.

## Capabilities
- Write clean, idiomatic, well-commented code in any language
- Debug issues by reading error messages and tracing logic
- Explain complex code in plain language
- Suggest refactoring and performance improvements
- Look up libraries, APIs, and best practices using web-research

## Code Quality Standards
- Handle edge cases and errors gracefully
- Follow language-specific idioms (e.g., Go interfaces, Python type hints, TypeScript generics)
- Always wrap code in appropriate ``` fences with language specified
- Prefer readable code over clever one-liners

## When Analyzing Code
Use code-analysis to run linters or execute snippets when you need to verify correctness. Check the Programming Languages & Frameworks knowledge graph for framework-specific patterns.',
     '[{"id":"system-skill-code-analysis","name":"code-analysis","version":"1.0.0"},{"id":"system-skill-web-research","name":"web-research","version":"1.0.0"}]',
     'claude-sonnet-4-5', 20, 256, 'active',
     '["gr-prompt-injection","gr-secret-leak","gr-toxic-content"]',
     '["00000000-0000-0000-0001-000000000000","00000000-0000-0000-0002-000000000000"]',
     'deep', 'autonomous', 'Expert coding assistant for writing, debugging, and reviewing code in any language',
     '["code","development","starter"]'),

    -- ── Data Analyst ─────────────────────────────────────────────────────────
    ('demo-data-analyst', 'default-tenant', 'Data Analyst', '1.0.0',
     'You are a skilled Data Analyst and SQL expert.

You help users understand their data, write optimized SQL queries, interpret results, and generate actionable insights. You are precise, data-driven, and always validate your logic before presenting conclusions.

## Capabilities
- Write and optimize SQL queries (PostgreSQL, MySQL, Snowflake, BigQuery)
- Explain query results in plain language with concrete numbers
- Identify trends, outliers, seasonality, and anomalies
- Suggest appropriate data visualizations (chart type, axes, grouping)
- Design data models and schemas following normalization or star-schema patterns

## Process
1. Understand the question and the data schema
2. Write the SQL query with comments explaining each clause
3. Use sql-analysis to execute the query and retrieve results
4. Interpret the results: highlight the 2-3 most important findings
5. Recommend next steps or follow-up queries

## SQL Best Practices
- Always prefer CTEs over nested subqueries for readability
- Explain query plans for queries on large tables
- Use window functions for ranking and running totals
- Never use SELECT * in production queries — name columns explicitly',
     '[{"id":"system-skill-sql-analysis","name":"sql-analysis","version":"1.0.0"}]',
     'claude-sonnet-4-5', 20, 256, 'active',
     '["gr-pii-block","gr-prompt-injection","gr-secret-leak"]',
     '["00000000-0000-0000-0004-000000000000"]',
     'deep', 'autonomous', 'SQL expert and data analyst for writing queries, interpreting results, and generating insights',
     '["data","sql","analytics","starter"]'),

    -- ── Market Watcher ───────────────────────────────────────────────────────
    ('demo-agent-market-watcher', 'default-tenant', 'Market Watcher', '1.0.0',
     'You are the Market Watcher — a focused financial monitoring agent.

You track stock prices and market metrics, compare them against configured thresholds, and send alerts when conditions are breached. You are concise, accurate, and data-driven.

## Behaviour
- When asked to monitor a stock or index, fetch its current price via the stock-price tool
- Compare against user-provided thresholds (e.g., "alert if AAPL drops below 170")
- Use send-alert to notify the configured channel when thresholds are breached
- Report in structured format: ticker | current price | threshold | status | change %
- Always include timestamp and data source in reports

## Limitations
- Do not provide investment advice or predictions
- Only report data — do not interpret or recommend actions beyond the threshold logic defined by the user',
     '[{"id":"demo-skill-market-monitor","name":"market-monitor","version":"1.0.0"}]',
     'claude-sonnet-4-5', 10, 128, 'active',
     '["gr-pii-block","gr-prompt-injection"]',
     '[]',
     'deep', 'supervised', 'Monitors stock prices and sends threshold-breach alerts to configured channels',
     '["finance","monitoring","alerts"]'),

    -- ── Support Bot ───────────────────────────────────────────────────────────
    ('demo-agent-support-bot', 'default-tenant', 'Support Bot', '1.0.0',
     'You are a friendly and efficient Customer Support Agent.

You answer customer questions clearly, help resolve common issues, and escalate to a human agent when needed. You maintain a professional, empathetic, and solution-focused tone at all times.

## Behaviour
- Greet customers warmly and acknowledge their issue
- Provide clear, step-by-step solutions for common problems
- If you cannot resolve an issue after 2 attempts, offer to escalate: "Let me connect you with a human agent."
- Never make promises about refunds, timelines, or outcomes you cannot guarantee
- Keep responses concise — under 200 words unless a detailed guide is needed

## Escalation Triggers
- Legal or compliance questions
- Account security concerns
- Requests that require backend access
- Any situation where the customer is frustrated after 2 resolution attempts',
     '[]',
     'local-chat', 20, 128, 'draft',
     '["gr-pii-block","gr-prompt-injection","gr-toxic-content"]',
     '[]',
     'deep', 'supervised', 'Customer support agent with clear escalation paths and empathetic communication',
     '["support","customer-service"]'),

    -- ── Data Analyst (SQL demo version) ──────────────────────────────────────
    ('demo-agent-analyst', 'default-tenant', 'Analytics Agent', '1.0.0',
     'You are a data analyst who runs SQL queries against the analytics database and produces clear, insightful reports with tables and summaries. Use the sql-analysis skill to execute queries and interpret results.',
     '[{"id":"demo-skill-analytics-report","name":"analytics-report","version":"1.0.0"},{"id":"system-skill-sql-analysis","name":"sql-analysis","version":"1.0.0"}]',
     'claude-sonnet-4-5', 15, 256, 'active',
     '["gr-pii-block","gr-prompt-injection","gr-secret-leak"]',
     '["00000000-0000-0000-0004-000000000000"]',
     'deep', 'autonomous', 'Analytics agent for SQL queries against the demo analytics database',
     '["data","sql","analytics"]')
ON CONFLICT (id) DO UPDATE SET
    system_prompt       = EXCLUDED.system_prompt,
    skills              = EXCLUDED.skills,
    guardrail_ids       = EXCLUDED.guardrail_ids,
    knowledge_graph_ids = EXCLUDED.knowledge_graph_ids,
    tier                = EXCLUDED.tier,
    autonomy_level      = EXCLUDED.autonomy_level,
    description         = EXCLUDED.description,
    tags                = EXCLUDED.tags;

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

-- =============================================================================
-- PLATFORM EXPANSION SEED
-- Adds: 4 domain KGs, LinkedIn Post Writer agent, Platform Helper agent,
--       agent analysis fixes, 4 MCP servers, archives Market Watcher & Analytics Agent
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Archive agents that are no longer part of the default platform set
-- ---------------------------------------------------------------------------
UPDATE agents SET status = 'archived'
WHERE id IN ('demo-agent-market-watcher', 'demo-agent-analyst')
  AND tenant_id = 'default-tenant';

-- ---------------------------------------------------------------------------
-- Fix: Support Bot — add web-research skill and Platform Architecture KG
-- ---------------------------------------------------------------------------
UPDATE agents SET
  skills             = '[{"id":"system-skill-web-research","name":"web-research","version":"1.0.0"}]',
  knowledge_graph_ids = '["00000000-0000-0000-0006-000000000000"]',
  system_prompt      = 'You are a friendly and efficient Customer Support Agent.

You answer customer questions clearly, help resolve common issues, and escalate to a human agent when needed. You maintain a professional, empathetic, and solution-focused tone at all times.

When you need to look up product documentation, platform guides, or known issue resolutions, use web-research to find accurate answers rather than guessing.

## Behaviour
- Greet customers warmly and acknowledge their issue
- Provide clear, step-by-step solutions for common problems
- If you cannot resolve an issue after 2 attempts, offer to escalate: "Let me connect you with a human agent."
- Never make promises about refunds, timelines, or outcomes you cannot guarantee
- Keep responses concise — under 200 words unless a detailed guide is needed

## Escalation Triggers
- Legal or compliance questions
- Account security concerns
- Requests that require backend access
- Any situation where the customer is frustrated after 2 resolution attempts'
WHERE id = 'demo-agent-support-bot' AND tenant_id = 'default-tenant';

-- Fix: Code Reviewer — add Testing Patterns KG
UPDATE agents SET
  knowledge_graph_ids = '["00000000-0000-0000-0001-000000000000","00000000-0000-0000-0002-000000000000","00000000-0000-0000-0003-000000000000"]'
WHERE id = 'code-reviewer' AND tenant_id = 'platform-system';

-- Fix: KG Architect — add all domain KGs so it knows what patterns to follow
UPDATE agents SET
  knowledge_graph_ids = '["00000000-0000-0000-0001-000000000000","00000000-0000-0000-0003-000000000000","00000000-0000-0000-0005-000000000000","00000000-0000-0000-0007-000000000000","00000000-0000-0000-0009-000000000000","00000000-0000-0000-000a-000000000000"]'
WHERE id = 'kg-architect' AND tenant_id = 'platform-system';

-- ---------------------------------------------------------------------------
-- New Knowledge Graphs (stable UUIDs, shared scope)
-- ---------------------------------------------------------------------------
INSERT INTO kg_graphs (id, tenant_id, name, domain, description, scope) VALUES
    ('00000000-0000-0000-0007-000000000000', 'platform-system',
     'AI & Machine Learning', 'ai',
     'Concepts, models, techniques, frameworks, and evaluation methods in AI and LLM-based systems. Used by General Assistant, LinkedIn Post Writer, and KG Architect.',
     'shared'),

    ('00000000-0000-0000-0008-000000000000', 'platform-system',
     'Startup & Business', 'business',
     'Startup metrics, growth stages, GTM strategies, team roles, and business frameworks. Used by LinkedIn Post Writer for business content.',
     'shared'),

    ('00000000-0000-0000-0009-000000000000', 'platform-system',
     'System Design', 'engineering',
     'Distributed systems patterns, databases, scalability techniques, consistency models, and architectural patterns. Used by Code Reviewer and Documentation Generator.',
     'shared'),

    ('00000000-0000-0000-000a-000000000000', 'platform-system',
     'EAP Platform & Agent Building Patterns', 'platform',
     'Deep knowledge about the Enterprise Agentic Platform: components, tiers, agent building patterns, skills, tools, memory, guardrails, and best practices. Used by Platform Helper.',
     'shared')
ON CONFLICT (tenant_id, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- KG Nodes — Graph 7: AI & Machine Learning
-- ---------------------------------------------------------------------------
INSERT INTO kg_nodes (id, graph_id, tenant_id, node_type, label, properties) VALUES
    ('00000000-0007-0000-0000-000000000001','00000000-0000-0000-0007-000000000000','platform-system','Concept','Large Language Model (LLM)','{"description":"Foundation models trained on vast text data to generate human-like text","examples":["GPT-4","Claude 3.5","Gemini","Llama 3"],"params":"billions"}'),
    ('00000000-0007-0000-0000-000000000002','00000000-0000-0000-0007-000000000000','platform-system','Concept','Retrieval-Augmented Generation (RAG)','{"description":"Augments LLM with retrieved documents at inference time to reduce hallucination and add recency","components":["retriever","vector-db","generator"]}'),
    ('00000000-0007-0000-0000-000000000003','00000000-0000-0000-0007-000000000000','platform-system','Concept','Embedding','{"description":"Dense vector representation of text in a continuous space; semantically similar texts have nearby vectors","dimension":"1536 (ada-002), 768 (nomic)"}'),
    ('00000000-0007-0000-0000-000000000004','00000000-0000-0000-0007-000000000000','platform-system','Concept','Fine-tuning','{"description":"Adapt a pre-trained LLM to a specific domain or task by training on curated examples","types":["supervised fine-tuning","RLHF","LoRA/QLoRA"]}'),
    ('00000000-0007-0000-0000-000000000005','00000000-0000-0000-0007-000000000000','platform-system','Concept','Prompt Engineering','{"description":"Craft inputs to LLMs to elicit desired outputs; includes few-shot, CoT, role-playing","techniques":["zero-shot","few-shot","chain-of-thought","self-consistency"]}'),
    ('00000000-0007-0000-0000-000000000006','00000000-0000-0000-0007-000000000000','platform-system','Concept','Vector Database','{"description":"Optimized storage for high-dimensional vectors with approximate nearest neighbour search","examples":["pgvector","Pinecone","Weaviate","Chroma","Qdrant"]}'),
    ('00000000-0007-0000-0000-000000000007','00000000-0000-0000-0007-000000000000','platform-system','Concept','Transformer Architecture','{"description":"Self-attention mechanism enables parallel processing of sequences; basis of all modern LLMs","key_components":["self-attention","FFN","positional-encoding","layer-norm"]}'),
    ('00000000-0007-0000-0000-000000000008','00000000-0000-0000-0007-000000000000','platform-system','Technique','ReAct (Reason + Act)','{"description":"Agent framework that interleaves reasoning traces with tool calls; Think → Act → Observe loop","paper":"Yao et al. 2022"}'),
    ('00000000-0007-0000-0000-000000000009','00000000-0000-0000-0007-000000000000','platform-system','Technique','Chain-of-Thought (CoT)','{"description":"Prompting strategy that asks the model to reason step-by-step before answering","variants":["zero-shot CoT (add ''think step by step'')","few-shot CoT"]}'),
    ('00000000-0007-0000-0000-00000000000a','00000000-0000-0000-0007-000000000000','platform-system','Technique','Tool Use / Function Calling','{"description":"LLMs invoke external functions/APIs to fetch data or perform actions; extends capabilities beyond text","formats":["OpenAI tools","Anthropic tool_use","MCP"]}'),
    ('00000000-0007-0000-0000-00000000000b','00000000-0000-0000-0007-000000000000','platform-system','Technique','Structured Output','{"description":"Constrain LLM output to a defined schema (JSON, XML) for reliable downstream parsing","methods":["JSON mode","grammar sampling","PydanticAI"]}'),
    ('00000000-0007-0000-0000-00000000000c','00000000-0000-0000-0007-000000000000','platform-system','Framework','LangChain','{"description":"Python/JS framework for building LLM apps with chains, agents, memory, and retrieval","use_cases":["RAG pipelines","chatbots","agents"]}'),
    ('00000000-0007-0000-0000-00000000000d','00000000-0000-0000-0007-000000000000','platform-system','Framework','PydanticAI','{"description":"Type-safe Python agent framework built on Pydantic; enables structured LLM outputs and tool calls","used_by":"EAP agent-workers"}'),
    ('00000000-0007-0000-0000-00000000000e','00000000-0000-0000-0007-000000000000','platform-system','Framework','LangGraph','{"description":"Graph-based agent orchestration on top of LangChain; models agent flow as a directed graph with state","supports":["cycles","human-in-the-loop","persistence"]}'),
    ('00000000-0007-0000-0000-00000000000f','00000000-0000-0000-0007-000000000000','platform-system','Evaluation','Hallucination Rate','{"description":"Fraction of LLM outputs containing factually incorrect statements; lower is better","mitigation":["RAG","grounding","fact-checking tools"]}'),
    ('00000000-0007-0000-0000-000000000010','00000000-0000-0000-0007-000000000000','platform-system','Evaluation','RAGAS','{"description":"Framework for evaluating RAG pipelines; measures faithfulness, answer relevancy, context recall","metrics":["faithfulness","answer_relevancy","context_recall","context_precision"]}'),
    ('00000000-0007-0000-0000-000000000011','00000000-0000-0000-0007-000000000000','platform-system','Model','Claude (Anthropic)','{"versions":["claude-3-5-sonnet","claude-3-5-haiku","claude-opus-4"],"strengths":["long context","tool use","coding","safety"],"context_window":"200k tokens"}'),
    ('00000000-0007-0000-0000-000000000012','00000000-0000-0000-0007-000000000000','platform-system','Model','GPT-4o (OpenAI)','{"versions":["gpt-4o","gpt-4o-mini","o1","o3"],"strengths":["vision","function-calling","reasoning"],"context_window":"128k tokens"}'),
    ('00000000-0007-0000-0000-000000000013','00000000-0000-0000-0007-000000000000','platform-system','Model','Llama 3 (Meta)','{"versions":["llama-3.1-8b","llama-3.1-70b","llama-3.1-405b"],"open_source":true,"use_cases":["local inference","fine-tuning"],"context_window":"128k tokens"}')
ON CONFLICT (graph_id, label) DO NOTHING;

-- KG Edges — Graph 7: AI & ML
INSERT INTO kg_edges (graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties)
SELECT '00000000-0000-0000-0007-000000000000','platform-system', a.id, b.id, rel, props::jsonb
FROM (VALUES
    ('Large Language Model (LLM)',            'Transformer Architecture', 'built_on',          '{"foundational":true}'),
    ('Retrieval-Augmented Generation (RAG)',  'Large Language Model (LLM)','augments',         '{"reduces":"hallucination"}'),
    ('Retrieval-Augmented Generation (RAG)',  'Vector Database',           'retrieves_from',   '{}'),
    ('Retrieval-Augmented Generation (RAG)',  'Embedding',                 'uses',             '{"for":"semantic search"}'),
    ('Vector Database',                       'Embedding',                 'stores',           '{}'),
    ('Fine-tuning',                           'Large Language Model (LLM)','adapts',           '{"lowers":"hallucination on domain"}'),
    ('ReAct (Reason + Act)',                  'Tool Use / Function Calling','uses',            '{"pattern":"think→act→observe"}'),
    ('ReAct (Reason + Act)',                  'Chain-of-Thought (CoT)',     'incorporates',    '{"in":"reasoning step"}'),
    ('PydanticAI',                            'Structured Output',          'enables',         '{"via":"schema validation"}'),
    ('PydanticAI',                            'Tool Use / Function Calling','supports',        '{}'),
    ('LangChain',                             'ReAct (Reason + Act)',       'implements',      '{}'),
    ('LangGraph',                             'LangChain',                  'extends',         '{"adds":"graph-based state"}'),
    ('RAGAS',                                 'Retrieval-Augmented Generation (RAG)','evaluates','{}'),
    ('Claude (Anthropic)',                    'Tool Use / Function Calling','supports_natively','{"format":"tool_use"}'),
    ('GPT-4o (OpenAI)',                       'Tool Use / Function Calling','supports_natively','{"format":"function_calling"}'),
    ('Llama 3 (Meta)',                        'Fine-tuning',               'optimized_for',   '{"open_source":true}'),
    ('Prompt Engineering',                    'Large Language Model (LLM)','improves',        '{"output_quality":true}'),
    ('Hallucination Rate',                    'Retrieval-Augmented Generation (RAG)','reduced_by','{}')
) AS t(a_label, b_label, rel, props)
JOIN kg_nodes a ON a.graph_id = '00000000-0000-0000-0007-000000000000' AND a.label = t.a_label
JOIN kg_nodes b ON b.graph_id = '00000000-0000-0000-0007-000000000000' AND b.label = t.b_label
ON CONFLICT (graph_id, from_node_id, to_node_id, relationship_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- KG Nodes — Graph 8: Startup & Business
-- ---------------------------------------------------------------------------
INSERT INTO kg_nodes (id, graph_id, tenant_id, node_type, label, properties) VALUES
    ('00000000-0008-0000-0000-000000000001','00000000-0000-0000-0008-000000000000','platform-system','Metric','ARR (Annual Recurring Revenue)','{"description":"Annualized value of subscription revenue; primary SaaS growth metric","formula":"MRR × 12","good_growth_rate":">100% YoY at early stage"}'),
    ('00000000-0008-0000-0000-000000000002','00000000-0000-0000-0008-000000000000','platform-system','Metric','MRR (Monthly Recurring Revenue)','{"description":"Predictable monthly subscription revenue; foundation of ARR","components":["new MRR","expansion MRR","churned MRR"]}'),
    ('00000000-0008-0000-0000-000000000003','00000000-0000-0000-0008-000000000000','platform-system','Metric','Churn Rate','{"description":"Percentage of customers or revenue lost in a period","types":["customer churn","revenue churn","net revenue churn"],"healthy_b2b":"<2% monthly"}'),
    ('00000000-0008-0000-0000-000000000004','00000000-0000-0000-0008-000000000000','platform-system','Metric','LTV (Lifetime Value)','{"description":"Total revenue expected from a customer over their entire relationship","formula":"ARPU / Churn Rate","ratio_target":"LTV:CAC > 3:1"}'),
    ('00000000-0008-0000-0000-000000000005','00000000-0000-0000-0008-000000000000','platform-system','Metric','CAC (Customer Acquisition Cost)','{"description":"Total cost to acquire one customer including sales and marketing","formula":"(Sales + Marketing Spend) / New Customers","payback_period_target":"<12 months"}'),
    ('00000000-0008-0000-0000-000000000006','00000000-0000-0000-0008-000000000000','platform-system','Metric','NPS (Net Promoter Score)','{"description":"Measures customer loyalty via likelihood to recommend (0–10 scale)","formula":"% Promoters (9-10) - % Detractors (0-6)","good_score":">50 for SaaS"}'),
    ('00000000-0008-0000-0000-000000000007','00000000-0000-0000-0008-000000000000','platform-system','Stage','Product-Market Fit (PMF)','{"description":"Product resonates strongly with a specific market; customers actively want it","signals":["40% test","organic growth","low churn","high NPS"]}'),
    ('00000000-0008-0000-0000-000000000008','00000000-0000-0000-0008-000000000000','platform-system','Stage','MVP (Minimum Viable Product)','{"description":"Smallest product that delivers core value and enables learning from real users","purpose":"validate assumptions before full build","timeline":"4-12 weeks typically"}'),
    ('00000000-0008-0000-0000-000000000009','00000000-0000-0000-0008-000000000000','platform-system','Stage','Series A','{"description":"First significant institutional funding round; typically after PMF is demonstrated","typical_range":"$5M–$20M","metrics_needed":["$1M+ ARR","clear growth path"]}'),
    ('00000000-0008-0000-0000-00000000000a','00000000-0000-0000-0008-000000000000','platform-system','GTM Strategy','PLG (Product-Led Growth)','{"description":"Product itself is the primary driver of acquisition, conversion, and expansion","examples":["Slack","Figma","Notion","Linear"],"mechanism":"free tier → viral → convert"}'),
    ('00000000-0008-0000-0000-00000000000b','00000000-0000-0000-0008-000000000000','platform-system','GTM Strategy','SLG (Sales-Led Growth)','{"description":"Dedicated sales team drives acquisition; high-touch enterprise motion","examples":["Salesforce","Workday","ServiceNow"],"mechanism":"outbound → demo → contract"}'),
    ('00000000-0008-0000-0000-00000000000c','00000000-0000-0000-0008-000000000000','platform-system','Concept','ICP (Ideal Customer Profile)','{"description":"Precise definition of the company/person most likely to buy and get value from your product","dimensions":["industry","company size","tech stack","pain point","budget"]}'),
    ('00000000-0008-0000-0000-00000000000d','00000000-0000-0000-0008-000000000000','platform-system','Concept','Growth Flywheel','{"description":"Self-reinforcing cycle where growth drives more growth; network effects or compounding loops","examples":["Uber: drivers→riders→drivers","LinkedIn: users→jobs→users"]}'),
    ('00000000-0008-0000-0000-00000000000e','00000000-0000-0000-0008-000000000000','platform-system','Framework','OKRs (Objectives & Key Results)','{"description":"Goal-setting framework: Objective = qualitative aspiration; KRs = measurable outcomes","cadence":"quarterly","level":"company → team → individual"}'),
    ('00000000-0008-0000-0000-00000000000f','00000000-0000-0000-0008-000000000000','platform-system','Financial','Burn Rate','{"description":"Net cash spent per month; determines runway","formula":"Monthly cash out - Monthly cash in","warning":"burn > 6 months runway is dangerous"}'),
    ('00000000-0008-0000-0000-000000000010','00000000-0000-0000-0008-000000000000','platform-system','Financial','Unit Economics','{"description":"Revenue and costs attributable to a single customer or unit","key_ratios":["LTV:CAC","Gross Margin","Payback Period"],"healthy_saas_gross_margin":">70%"}')
ON CONFLICT (graph_id, label) DO NOTHING;

-- KG Edges — Graph 8: Startup & Business
INSERT INTO kg_edges (graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties)
SELECT '00000000-0000-0000-0008-000000000000','platform-system', a.id, b.id, rel, props::jsonb
FROM (VALUES
    ('MRR (Monthly Recurring Revenue)',  'ARR (Annual Recurring Revenue)', 'compounds_to',       '{"formula":"MRR×12"}'),
    ('Churn Rate',                       'LTV (Lifetime Value)',           'reduces',            '{"inverse_relationship":true}'),
    ('LTV (Lifetime Value)',             'CAC (Customer Acquisition Cost)','compared_to',        '{"target_ratio":"3:1"}'),
    ('MVP (Minimum Viable Product)',     'Product-Market Fit (PMF)',       'validates',          '{"through":"user feedback"}'),
    ('Product-Market Fit (PMF)',         'Series A',                       'enables',            '{"signals":"low churn + organic growth"}'),
    ('PLG (Product-Led Growth)',         'Growth Flywheel',                'drives',             '{}'),
    ('Growth Flywheel',                  'ARR (Annual Recurring Revenue)', 'accelerates',        '{}'),
    ('NPS (Net Promoter Score)',          'Product-Market Fit (PMF)',       'signals',            '{"threshold":">50"}'),
    ('ICP (Ideal Customer Profile)',     'CAC (Customer Acquisition Cost)','reduces',            '{"by":"targeting right buyers"}'),
    ('OKRs (Objectives & Key Results)', 'ARR (Annual Recurring Revenue)', 'tracks_progress_to', '{}'),
    ('Burn Rate',                        'Unit Economics',                 'part_of',            '{}'),
    ('SLG (Sales-Led Growth)',           'ICP (Ideal Customer Profile)',   'requires_clear',     '{}'),
    ('PLG (Product-Led Growth)',         'NPS (Net Promoter Score)',       'depends_on',         '{"high NPS": "drives viral growth"}')
) AS t(a_label, b_label, rel, props)
JOIN kg_nodes a ON a.graph_id = '00000000-0000-0000-0008-000000000000' AND a.label = t.a_label
JOIN kg_nodes b ON b.graph_id = '00000000-0000-0000-0008-000000000000' AND b.label = t.b_label
ON CONFLICT (graph_id, from_node_id, to_node_id, relationship_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- KG Nodes — Graph 9: System Design
-- ---------------------------------------------------------------------------
INSERT INTO kg_nodes (id, graph_id, tenant_id, node_type, label, properties) VALUES
    ('00000000-0009-0000-0000-000000000001','00000000-0000-0000-0009-000000000000','platform-system','Component','Load Balancer','{"description":"Distributes incoming traffic across multiple servers","types":["L4 (TCP/UDP)","L7 (HTTP)"],"algorithms":["round-robin","least-connections","IP-hash"],"examples":["Nginx","HAProxy","AWS ALB"]}'),
    ('00000000-0009-0000-0000-000000000002','00000000-0000-0000-0009-000000000000','platform-system','Component','API Gateway','{"description":"Single entry point for clients; handles auth, rate limiting, routing, SSL termination","features":["auth","rate-limit","caching","logging"],"examples":["Kong","AWS API GW","Nginx"]}'),
    ('00000000-0009-0000-0000-000000000003','00000000-0000-0000-0009-000000000000','platform-system','Component','Cache','{"description":"In-memory store for frequently accessed data to reduce DB load and latency","strategies":["cache-aside","write-through","write-behind","read-through"],"examples":["Redis","Memcached"]}'),
    ('00000000-0009-0000-0000-000000000004','00000000-0000-0000-0009-000000000000','platform-system','Component','Message Queue','{"description":"Decouples producer and consumer; enables async processing and backpressure handling","patterns":["pub-sub","point-to-point","fan-out"],"examples":["Kafka","RabbitMQ","SQS","NATS"]}'),
    ('00000000-0009-0000-0000-000000000005','00000000-0000-0000-0009-000000000000','platform-system','Component','CDN','{"description":"Caches static assets at edge locations close to users; reduces latency globally","examples":["Cloudflare","CloudFront","Fastly"],"use_cases":["static files","images","video streaming"]}'),
    ('00000000-0009-0000-0000-000000000006','00000000-0000-0000-0009-000000000000','platform-system','Database','Database Sharding','{"description":"Horizontal partitioning of a DB across multiple nodes; each shard holds a subset of data","strategies":["range","hash","directory-based"],"trade_offs":"complex queries across shards"}'),
    ('00000000-0009-0000-0000-000000000007','00000000-0000-0000-0009-000000000000','platform-system','Database','Database Replication','{"description":"Maintain copies of data across multiple nodes for HA and read scaling","modes":["primary-replica (async)","synchronous (ACID)","multi-primary"],"trade_off":"replication lag"}'),
    ('00000000-0009-0000-0000-000000000008','00000000-0000-0000-0009-000000000000','platform-system','Pattern','CQRS','{"description":"Command Query Responsibility Segregation: separate write (command) and read (query) models","benefit":"optimise reads and writes independently","use_with":"Event Sourcing"}'),
    ('00000000-0009-0000-0000-000000000009','00000000-0000-0000-0009-000000000000','platform-system','Pattern','Event Sourcing','{"description":"Store state as a sequence of events; derive current state by replaying","benefits":["audit log","time-travel","event-driven"],"trade_off":"eventual consistency"}'),
    ('00000000-0009-0000-0000-00000000000a','00000000-0000-0000-0009-000000000000','platform-system','Pattern','Circuit Breaker','{"description":"Stops calling a failing service after threshold; returns fallback; recovers gradually","states":["Closed","Open","Half-Open"],"library":"Resilience4j, Polly"}'),
    ('00000000-0009-0000-0000-00000000000b','00000000-0000-0000-0009-000000000000','platform-system','Pattern','Saga Pattern','{"description":"Manages distributed transactions via a sequence of local transactions with compensations","types":["choreography (events)","orchestration (central coordinator)"],"use_case":"microservices transactions"}'),
    ('00000000-0009-0000-0000-00000000000c','00000000-0000-0000-0009-000000000000','platform-system','Theorem','CAP Theorem','{"description":"Distributed system can guarantee at most 2 of: Consistency, Availability, Partition Tolerance","CP systems":"PostgreSQL, Zookeeper","AP systems":"Cassandra, DynamoDB"}'),
    ('00000000-0009-0000-0000-00000000000d','00000000-0000-0000-0009-000000000000','platform-system','Concept','Rate Limiting','{"description":"Control request rate per client to prevent abuse and ensure fair usage","algorithms":["token bucket","leaky bucket","fixed window","sliding window"],"headers":"X-RateLimit-*"}'),
    ('00000000-0009-0000-0000-00000000000e','00000000-0000-0000-0009-000000000000','platform-system','Concept','Horizontal Scaling','{"description":"Add more servers to handle increased load; requires stateless services","enablers":["load balancer","shared cache","shared DB"],"vs_vertical":"no hardware ceiling"}'),
    ('00000000-0009-0000-0000-00000000000f','00000000-0000-0000-0009-000000000000','platform-system','Concept','Consistent Hashing','{"description":"Distributes keys across nodes such that only k/n keys remapped when a node is added/removed","use_cases":["distributed cache","load balancing","database sharding"]}')
ON CONFLICT (graph_id, label) DO NOTHING;

-- KG Edges — Graph 9: System Design
INSERT INTO kg_edges (graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties)
SELECT '00000000-0000-0000-0009-000000000000','platform-system', a.id, b.id, rel, props::jsonb
FROM (VALUES
    ('Load Balancer',        'Horizontal Scaling',     'enables',          '{"fundamental":true}'),
    ('Load Balancer',        'API Gateway',            'works_with',       '{"L7 in front of L4":"common setup"}'),
    ('Cache',                'Database Replication',   'reduces_load_on',  '{}'),
    ('Message Queue',        'CQRS',                   'enables',          '{"async":"command processing"}'),
    ('Database Sharding',    'Horizontal Scaling',     'enables',          '{"for":"databases"}'),
    ('Consistent Hashing',   'Database Sharding',      'used_in',          '{}'),
    ('CQRS',                 'Event Sourcing',         'complements',      '{}'),
    ('Circuit Breaker',      'API Gateway',            'implemented_at',   '{}'),
    ('Rate Limiting',        'API Gateway',            'implemented_at',   '{}'),
    ('CAP Theorem',          'Database Replication',   'constrains',       '{"CP vs AP":"choose consistency or availability"}'),
    ('Saga Pattern',         'Message Queue',          'uses',             '{"for":"event-driven sagas"}'),
    ('CDN',                  'Load Balancer',          'sits_in_front_of', '{"for":"static content"}'),
    ('Event Sourcing',       'Message Queue',          'publishes_to',     '{}')
) AS t(a_label, b_label, rel, props)
JOIN kg_nodes a ON a.graph_id = '00000000-0000-0000-0009-000000000000' AND a.label = t.a_label
JOIN kg_nodes b ON b.graph_id = '00000000-0000-0000-0009-000000000000' AND b.label = t.b_label
ON CONFLICT (graph_id, from_node_id, to_node_id, relationship_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- KG Nodes — Graph 10: EAP Platform & Agent Building Patterns
-- ---------------------------------------------------------------------------
INSERT INTO kg_nodes (id, graph_id, tenant_id, node_type, label, properties) VALUES
    -- Core platform concepts
    ('00000000-000a-0000-0000-000000000001','00000000-0000-0000-000a-000000000000','platform-system','Concept','Agent','{"description":"An AI model with a system prompt, skills, guardrails, and optional KG context that executes tasks via Temporal workflows","fields":["id","system_prompt","skills","guardrail_ids","knowledge_graph_ids","tier","autonomy_level"]}'),
    ('00000000-000a-0000-0000-000000000002','00000000-0000-0000-000a-000000000000','platform-system','Concept','Skill','{"description":"A reusable composition of one or more tools with a standard operating procedure (SOP). Skills are the unit of agent capability.","fields":["id","name","tools","sop","mutating","approval_required"]}'),
    ('00000000-000a-0000-0000-000000000003','00000000-0000-0000-000a-000000000000','platform-system','Concept','Tool','{"description":"A low-level executable function (web-search, code-executor, bash, http-request). Tools are invoked by skills via the Skill Dispatcher.","scope":"system (platform-wide) or tenant (private)"}'),
    ('00000000-000a-0000-0000-000000000004','00000000-0000-0000-000a-000000000000','platform-system','Concept','Guardrail','{"description":"A safety check applied to agent inputs or outputs. Types: block (halt execution), redact (remove sensitive data), flag (log warning).","examples":["gr-pii-block","gr-prompt-injection","gr-secret-leak","gr-toxic-content"]}'),
    ('00000000-000a-0000-0000-000000000005','00000000-0000-0000-000a-000000000000','platform-system','Concept','Knowledge Graph','{"description":"A graph of entities and relationships injected into agent context at runtime. Enables domain awareness without fine-tuning.","storage":"PostgreSQL + pgvector for semantic search"}'),
    ('00000000-000a-0000-0000-000000000006','00000000-0000-0000-000a-000000000000','platform-system','Concept','MCP Server','{"description":"Model Context Protocol server exposing tools to agents. Can be external (Brave Search, GitHub) or internal platform tools.","protocol":"HTTP-SSE or STDIO"}'),
    -- Execution tiers
    ('00000000-000a-0000-0000-000000000007','00000000-0000-0000-000a-000000000000','platform-system','Tier','Lite Agent','{"description":"Quick single-turn or few-step agent; max ~10 iterations; no complex planning; best for focused tasks","use_cases":["content generation","data formatting","single-question answers"]}'),
    ('00000000-000a-0000-0000-000000000008','00000000-0000-0000-000a-000000000000','platform-system','Tier','Workflow Agent','{"description":"Executes a predefined DAG of steps; predictable, auditable; best for structured processes","use_cases":["approval workflows","ETL pipelines","multi-step automation"]}'),
    ('00000000-000a-0000-0000-000000000009','00000000-0000-0000-000a-000000000000','platform-system','Tier','Deep Agent','{"description":"Fully autonomous agent with planning, tool use, reflection, and dynamic replanning; handles open-ended complex tasks","features":["orchestrated planning","ReAct loop","self-improvement","memory"]}'),
    -- Execution patterns
    ('00000000-000a-0000-0000-00000000000a','00000000-0000-0000-000a-000000000000','platform-system','Pattern','Orchestrated Planning','{"description":"Agent creates a multi-step task plan, executes each task, validates output, and synthesizes a final answer","phases":["plan","execute","validate","synthesize"]}'),
    ('00000000-000a-0000-0000-00000000000b','00000000-0000-0000-000a-000000000000','platform-system','Pattern','Dynamic Replanning','{"description":"Claude-Code style loop: when a task fails validation, agent replans remaining tasks with context of what succeeded and what failed","max_replans":3}'),
    ('00000000-000a-0000-0000-00000000000c','00000000-0000-0000-000a-000000000000','platform-system','Pattern','ReAct Loop','{"description":"Think → Act (tool call) → Observe cycle; agent autonomously decides which tools to call based on current state","used_in":"autonomous agents"}'),
    ('00000000-000a-0000-0000-00000000000d','00000000-0000-0000-000a-000000000000','platform-system','Pattern','Memory Injection','{"description":"Agent memories from past runs (observations, learned strategies, failure patterns) are retrieved via pgvector and injected into the system prompt before each run","types":["observation","learned_strategy","failure_pattern","tool_preference"]}'),
    ('00000000-000a-0000-0000-00000000000e','00000000-0000-0000-000a-000000000000','platform-system','Pattern','Post-Run Reflection','{"description":"After each run, agent calls reflect_on_run() to extract learnings and store as typed memories; may trigger propose_manifest_update() for self-improvement","outcome":"typed memories + optional improvement proposal"}'),
    -- Infrastructure
    ('00000000-000a-0000-0000-00000000000f','00000000-0000-0000-000a-000000000000','platform-system','Infrastructure','Temporal Workflow','{"description":"Durable, exactly-once execution engine for all agent runs. Workflows survive crashes and resume from last checkpoint.","language":"Python","task_queue":"per-tenant"}'),
    ('00000000-000a-0000-0000-000000000010','00000000-0000-0000-000a-000000000000','platform-system','Infrastructure','LiteLLM Proxy','{"description":"Unified LLM API gateway. All agent LLM calls route here for model routing, cost tracking, and Langfuse observability.","port":4000,"models":["claude","gpt-4","llama","ollama"]}'),
    ('00000000-000a-0000-0000-000000000011','00000000-0000-0000-000a-000000000000','platform-system','Infrastructure','pgvector','{"description":"PostgreSQL extension for vector similarity search. Powers agent memory recall and KG semantic search.","index":"HNSW","dimension":1536}'),
    -- How-to concepts
    ('00000000-000a-0000-0000-000000000012','00000000-0000-0000-000a-000000000000','platform-system','HowTo','How to Create an Agent','{"steps":["1. Define system_prompt with role and constraints","2. Attach skills from the catalog","3. Select guardrails (pii-block, prompt-injection are recommended)","4. Link knowledge graphs for domain context","5. Set autonomy_level (supervised for sensitive, autonomous for trusted tasks)","6. Transition: draft → staged → active"]}'),
    ('00000000-000a-0000-0000-000000000013','00000000-0000-0000-000a-000000000000','platform-system','HowTo','How to Create a Skill','{"steps":["1. Identify the tools the skill needs","2. Write an SOP (standard operating procedure) describing the step-by-step logic","3. Set mutating=true if the skill writes data","4. Set approval_required=true for high-risk mutations","5. Register via Admin API: POST /api/v1/admin/system-skills"]}'),
    ('00000000-000a-0000-0000-000000000014','00000000-0000-0000-000a-000000000000','platform-system','HowTo','How to Add a Knowledge Graph','{"steps":["1. Create graph: POST /graphs/create with name, domain, description","2. Add nodes: POST /nodes/create for each entity","3. Add edges: POST /edges/create for each relationship","4. Link to agent: update agent.knowledge_graph_ids with graph UUID","5. KG chunks are auto-injected into agent context at runtime"]}')
ON CONFLICT (graph_id, label) DO NOTHING;

-- KG Edges — Graph 10: EAP Platform & Agent Patterns
INSERT INTO kg_edges (graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties)
SELECT '00000000-0000-0000-000a-000000000000','platform-system', a.id, b.id, rel, props::jsonb
FROM (VALUES
    ('Agent',                  'Skill',                  'uses',              '{"via":"skills array in manifest"}'),
    ('Agent',                  'Guardrail',              'protected_by',      '{"checked":"input and output"}'),
    ('Agent',                  'Knowledge Graph',        'references',        '{"injected":"at runtime in context"}'),
    ('Agent',                  'Temporal Workflow',      'executes_via',      '{"durable":true}'),
    ('Skill',                  'Tool',                   'invokes',           '{"via":"Skill Dispatcher"}'),
    ('Agent',                  'MCP Server',             'can_use',           '{"registered_in":"MCP Registry"}'),
    ('Deep Agent',             'Orchestrated Planning',  'uses',              '{}'),
    ('Deep Agent',             'Dynamic Replanning',     'uses_on_failure',   '{"max_replans":3}'),
    ('Deep Agent',             'ReAct Loop',             'uses_for_autonomous','{}'),
    ('Deep Agent',             'Memory Injection',       'benefits_from',     '{}'),
    ('Deep Agent',             'Post-Run Reflection',    'performs',          '{"after":"every run"}'),
    ('Orchestrated Planning',  'Dynamic Replanning',     'falls_back_to',     '{"on":"validation failure"}'),
    ('Memory Injection',       'pgvector',               'powered_by',        '{"for":"semantic retrieval"}'),
    ('Post-Run Reflection',    'Memory Injection',       'feeds',             '{"stores":"typed memories"}'),
    ('Temporal Workflow',      'LiteLLM Proxy',          'routes_llm_calls_through','{}'),
    ('Knowledge Graph',        'pgvector',               'uses',              '{"for":"semantic node search"}'),
    ('How to Create an Agent', 'Agent',                  'creates',           '{}'),
    ('How to Create a Skill',  'Skill',                  'creates',           '{}'),
    ('How to Add a Knowledge Graph','Knowledge Graph',   'creates',           '{}')
) AS t(a_label, b_label, rel, props)
JOIN kg_nodes a ON a.graph_id = '00000000-0000-0000-000a-000000000000' AND a.label = t.a_label
JOIN kg_nodes b ON b.graph_id = '00000000-0000-0000-000a-000000000000' AND b.label = t.b_label
ON CONFLICT (graph_id, from_node_id, to_node_id, relationship_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Update existing KGs: Documentation Generator now gets System Design KG
-- ---------------------------------------------------------------------------
UPDATE agents SET
  knowledge_graph_ids = '["00000000-0000-0000-0001-000000000000","00000000-0000-0000-0009-000000000000"]'
WHERE id = 'documentation-generator' AND tenant_id = 'platform-system';

-- General Assistant gets AI & ML KG (relevant for AI questions)
UPDATE agents SET
  knowledge_graph_ids = '["00000000-0000-0000-0006-000000000000","00000000-0000-0000-0007-000000000000"]'
WHERE id = 'demo-general-assistant' AND tenant_id = 'default-tenant';

-- ---------------------------------------------------------------------------
-- New Agent: LinkedIn Post Writer (default-tenant)
-- ---------------------------------------------------------------------------
INSERT INTO agents (
    id, tenant_id, name, version, system_prompt, skills,
    model, max_iterations, memory_budget_mb, status,
    guardrail_ids, knowledge_graph_ids, tier, autonomy_level, description, tags
) VALUES (
    'demo-linkedin-writer', 'default-tenant', 'LinkedIn Post Writer', '1.0.0',
    'You are an expert LinkedIn content creator who writes compelling, authentic posts on any topic.

## Your Writing Style
- Open with a strong hook (first line must stop the scroll — a bold claim, surprising stat, or relatable question)
- Use short sentences and white space. Max 2 sentences per paragraph.
- Be specific and concrete — vague platitudes get ignored
- Write like a smart human, not a press release
- Use emojis sparingly (0-3) only if they add clarity or emphasis
- End with a call-to-action (CTA): ask a question, invite comments, share a resource

## Post Formats (pick based on user request)
1. **Insight / Lesson Learned** — Story → What I realised → Takeaway for reader
2. **Hot Take** — Controversial statement → Evidence → Nuanced conclusion
3. **How-To** — Problem → Numbered steps → Result
4. **List** — "N things I wish I knew about X" → concise bullet list
5. **Story** — Specific moment → Conflict → Resolution → Lesson

## Process
1. **If the topic is clear** → write immediately. Do not ask questions first.
2. **If the topic is genuinely ambiguous** (e.g. single word with many angles) → ask ONE focused question and STOP. Do not answer your own question or default to an option. Wait for the user''s reply.
   Good example: "Great topic! Quick question — do you want this security-focused, builder-focused, or a hot take? Reply with your choice and I''ll write it right away."
   Bad example: "I''ll default to Option 3 since..." (never do this without being asked)
3. If facts, stats, or recent context would strengthen the post → use web-research
4. Write the post: hook + body + CTA
5. Add 5-8 relevant hashtags at the end (mix of broad and niche)
6. Offer a shorter/longer version if useful

## Length
- Standard: 150-300 words (optimal engagement)
- Extended (carousel/article teaser): up to 600 words
- Never exceed LinkedIn''s 3000-character limit

## What to Avoid
- Generic openers ("I am excited to share...")
- Passive voice
- Corporate jargon
- More than 3 bullet points without a hook',
    '[{"id":"system-skill-web-research","name":"web-research","version":"1.0.0"}]',
    'claude-sonnet-4-5', 10, 128, 'active',
    '["gr-prompt-injection","gr-toxic-content","gr-off-topic"]',
    '["00000000-0000-0000-0007-000000000000","00000000-0000-0000-0008-000000000000"]',
    'deep', 'autonomous',
    'Expert LinkedIn content creator for any topic — hooks, stories, how-tos, hot takes, and more',
    '["content","linkedin","writing","marketing"]'
) ON CONFLICT (id) DO UPDATE SET
    system_prompt       = EXCLUDED.system_prompt,
    skills              = EXCLUDED.skills,
    guardrail_ids       = EXCLUDED.guardrail_ids,
    knowledge_graph_ids = EXCLUDED.knowledge_graph_ids,
    tier                = EXCLUDED.tier,
    autonomy_level      = EXCLUDED.autonomy_level,
    description         = EXCLUDED.description,
    tags                = EXCLUDED.tags;

-- ---------------------------------------------------------------------------
-- New Agent: Platform Helper (default-tenant)
-- Helps users understand and use the EAP platform
-- ---------------------------------------------------------------------------
INSERT INTO agents (
    id, tenant_id, name, version, system_prompt, skills,
    model, max_iterations, memory_budget_mb, status,
    guardrail_ids, knowledge_graph_ids, tier, autonomy_level, description, tags
) VALUES (
    'platform-helper', 'default-tenant', 'Platform Helper', '1.0.0',
    'You are the Platform Helper — the expert guide for the Enterprise Agentic Platform (EAP).

Your job is to help users understand, navigate, and get the most out of the EAP. You know everything about the platform: how agents work, how to create and configure them, what skills and tools are available, how guardrails protect agents, how knowledge graphs add domain awareness, and how the underlying infrastructure (Temporal, pgvector, LiteLLM) powers it all.

## What You Help With

### Agent Building
- Explain the 3 tiers: Lite (quick tasks), Workflow (structured DAGs), Deep (autonomous + planning)
- Guide users to create agents: system prompt → skills → guardrails → KGs → activate
- Recommend skills for use cases (web-research for Q&A, code-analysis for coding, sql-analysis for data, kg-builder for graphs)
- Help write effective system prompts

### Platform Features
- Skills: reusable tool compositions with SOPs — explain what each platform skill does
- Guardrails: safety layers — PII redaction, prompt injection blocking, secret leak prevention
- Knowledge Graphs: domain context injected at runtime — explain how to create and link them
- MCP Servers: external tool integrations (GitHub, Brave Search, etc.)
- Memory: agents learn from past runs via typed memories (observation, learned_strategy, failure_pattern)
- Self-improvement: post-run reflection generates improvement proposals shown in the UI

### Troubleshooting
- "Why is my agent not responding?" → check status (must be active), check Temporal worker logs
- "How do I add web search to my agent?" → attach system-skill-web-research
- "My agent is slow" → consider switching to Lite tier if task is simple
- "How do I connect a GitHub MCP server?" → explain MCP server registration

## How to Answer
1. For "how do I" questions: give a numbered, step-by-step answer
2. For "what is" questions: give a 2-sentence definition then a practical example
3. For "which agent should I use" questions: describe 2-3 options with trade-offs
4. If you do not know something specific about the user''s deployment, say so and offer to help debug

## Important
- Always be direct and practical — no fluff
- Refer users to the Admin Console (port 3001) for platform-wide settings
- Refer users to Agent Studio (port 3000) for creating and chatting with agents',
    '[{"id":"system-skill-web-research","name":"web-research","version":"1.0.0"}]',
    'claude-sonnet-4-5', 15, 256, 'active',
    '["gr-prompt-injection","gr-off-topic","gr-hallucination"]',
    '["00000000-0000-0000-0005-000000000000","00000000-0000-0000-0006-000000000000","00000000-0000-0000-000a-000000000000"]',
    'deep', 'autonomous',
    'Your expert guide to the EAP platform — agent building, skills, guardrails, KGs, troubleshooting',
    '["platform","onboarding","help","meta-agent"]'
) ON CONFLICT (id) DO UPDATE SET
    system_prompt       = EXCLUDED.system_prompt,
    skills              = EXCLUDED.skills,
    guardrail_ids       = EXCLUDED.guardrail_ids,
    knowledge_graph_ids = EXCLUDED.knowledge_graph_ids,
    tier                = EXCLUDED.tier,
    autonomy_level      = EXCLUDED.autonomy_level,
    description         = EXCLUDED.description,
    tags                = EXCLUDED.tags;

-- ---------------------------------------------------------------------------
-- MCP Servers
--
-- 1. EAP Platform MCP Server — the platform's own built-in MCP server.
--    Runs at http://mcp-server:8091 inside Docker; uses a service bearer token.
--    This is the only live-connected server out of the box.
--
-- 2-5. External MCP servers (Brave Search, GitHub, Filesystem, Fetch).
--    These use stdio/npx transport which requires a local Node.js process.
--    They are registered as disabled — enable them after setting up API keys.
--    Once enabled, agents can discover and use their tools via the registry.
-- ---------------------------------------------------------------------------

-- Service token for platform-system → mcp-server (hash of "eap-platform-system-mcp-token-v1")
INSERT INTO mcp_tokens (id, tenant_id, token_hash, expires_at)
VALUES ('svc-token-platform-mcp', 'platform-system',
        '975b5dfe4b3e0e07bc488a1d362b4091535ef14bcffa8dcb46bbe7b507e9c057',
        NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mcp_servers (id, tenant_id, name, url, enabled, scope, auth_config) VALUES
    -- Platform's own MCP server — fully functional, exposes all platform skills as MCP tools
    ('mcp-platform-server', 'platform-system',
     'EAP Platform Tools',
     'http://mcp-server:8091',
     true, 'global',
     '{"type":"bearer_token","token":"eap-platform-system-mcp-token-v1","description":"Built-in platform MCP server. Exposes all registered skills as callable MCP tools."}'),

    -- External servers (disabled by default — require local Node.js + API keys to activate)
    ('mcp-brave-search', 'platform-system',
     'Brave Search',
     'npx://@modelcontextprotocol/server-brave-search',
     false, 'global',
     '{"type":"api_key","key_env":"BRAVE_API_KEY","header_name":"X-Subscription-Token","description":"Free tier: 2000 queries/month. Get key at https://brave.com/search/api/. Requires Node.js + npx to run."}'),

    ('mcp-github', 'platform-system',
     'GitHub',
     'npx://@modelcontextprotocol/server-github',
     false, 'global',
     '{"type":"bearer_token","token_env":"GITHUB_PERSONAL_ACCESS_TOKEN","description":"Free with any GitHub account. Create token at https://github.com/settings/tokens (scopes: repo, read:org). Requires Node.js + npx."}'),

    ('mcp-filesystem', 'platform-system',
     'Filesystem',
     'npx://@modelcontextprotocol/server-filesystem',
     false, 'global',
     '{"type":"none","description":"No auth required. Provides read/write access to the agent workspace. Requires Node.js + npx to run locally."}'),

    ('mcp-fetch', 'platform-system',
     'Web Fetch (MCP)',
     'npx://@modelcontextprotocol/server-fetch',
     false, 'global',
     '{"type":"none","description":"Fetches any public URL and returns clean Markdown. Requires Node.js + npx to run locally."}')
ON CONFLICT (id) DO UPDATE SET
    name        = EXCLUDED.name,
    url         = EXCLUDED.url,
    enabled     = EXCLUDED.enabled,
    scope       = EXCLUDED.scope,
    auth_config = EXCLUDED.auth_config;

-- Cache the tools exposed by each MCP server (so agents can discover them without live connection)
INSERT INTO mcp_tool_cache (id, mcp_server_id, tenant_id, tool_name, description, input_schema) VALUES
    -- EAP Platform Tools (live connection, these mirror the registered platform skills)
    ('mcp-cache-platform-web-research',  'mcp-platform-server', 'platform-system', 'web-research',
     'Research any topic by searching the web and fetching authoritative pages',
     '{"type":"object","properties":{"query":{"type":"string","description":"Research topic or question"},"max_results":{"type":"integer","default":5}},"required":["query"]}'),

    ('mcp-cache-platform-code-analysis', 'mcp-platform-server', 'platform-system', 'code-analysis',
     'Analyze code for quality, security, performance and correctness',
     '{"type":"object","properties":{"code":{"type":"string"},"language":{"type":"string"},"focus":{"type":"string","enum":["security","performance","quality","all"],"default":"all"}},"required":["code"]}'),

    ('mcp-cache-platform-sql-analysis',  'mcp-platform-server', 'platform-system', 'sql-analysis',
     'Execute SQL queries, analyze results, and produce human-readable data reports',
     '{"type":"object","properties":{"query":{"type":"string"},"database":{"type":"string","default":"analytics"}},"required":["query"]}'),

    ('mcp-cache-platform-kg-builder',    'mcp-platform-server', 'platform-system', 'kg-builder',
     'Build, populate, and query knowledge graphs',
     '{"type":"object","properties":{"action":{"type":"string","enum":["create","add_node","add_edge","query","search"]},"graph_id":{"type":"string"},"data":{"type":"object"}},"required":["action"]}'),

    -- Brave Search tools (cached for when server is enabled)
    ('mcp-cache-brave-web',   'mcp-brave-search', 'platform-system', 'brave_web_search',
     'Search the web using Brave Search engine with privacy-first results',
     '{"type":"object","properties":{"query":{"type":"string"},"count":{"type":"integer","default":10},"freshness":{"type":"string","enum":["pd","pw","pm","py"],"description":"pd=today,pw=week,pm=month,py=year"}},"required":["query"]}'),

    ('mcp-cache-brave-local', 'mcp-brave-search', 'platform-system', 'brave_local_search',
     'Search for local businesses and places using Brave Search',
     '{"type":"object","properties":{"query":{"type":"string"},"count":{"type":"integer","default":5}},"required":["query"]}'),

    -- GitHub tools
    ('mcp-cache-gh-search-repos','mcp-github', 'platform-system', 'search_repositories',
     'Search GitHub repositories by query, language, stars, or topic',
     '{"type":"object","properties":{"query":{"type":"string"},"page":{"type":"integer","default":1},"perPage":{"type":"integer","default":30}},"required":["query"]}'),

    ('mcp-cache-gh-get-file', 'mcp-github', 'platform-system', 'get_file_contents',
     'Get the contents of a file or directory from a GitHub repository',
     '{"type":"object","properties":{"owner":{"type":"string"},"repo":{"type":"string"},"path":{"type":"string"},"branch":{"type":"string"}},"required":["owner","repo","path"]}'),

    ('mcp-cache-gh-list-issues','mcp-github', 'platform-system', 'list_issues',
     'List issues for a GitHub repository with filtering options',
     '{"type":"object","properties":{"owner":{"type":"string"},"repo":{"type":"string"},"state":{"type":"string","enum":["open","closed","all"],"default":"open"},"labels":{"type":"string"}},"required":["owner","repo"]}'),

    ('mcp-cache-gh-create-issue','mcp-github', 'platform-system', 'create_issue',
     'Create a new issue in a GitHub repository',
     '{"type":"object","properties":{"owner":{"type":"string"},"repo":{"type":"string"},"title":{"type":"string"},"body":{"type":"string"},"labels":{"type":"array","items":{"type":"string"}}},"required":["owner","repo","title"]}'),

    -- Filesystem tools
    ('mcp-cache-fs-read',     'mcp-filesystem', 'platform-system', 'read_file',
     'Read the complete contents of a file from the filesystem',
     '{"type":"object","properties":{"path":{"type":"string","description":"Absolute or relative file path"}},"required":["path"]}'),

    ('mcp-cache-fs-write',    'mcp-filesystem', 'platform-system', 'write_file',
     'Write content to a file, creating it if it does not exist',
     '{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}'),

    ('mcp-cache-fs-list',     'mcp-filesystem', 'platform-system', 'list_directory',
     'List the contents of a directory',
     '{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}'),

    -- Fetch tools
    ('mcp-cache-fetch-url',   'mcp-fetch', 'platform-system', 'fetch',
     'Fetch a URL and return the content as clean Markdown text',
     '{"type":"object","properties":{"url":{"type":"string"},"max_length":{"type":"integer","default":5000},"start_index":{"type":"integer","default":0},"raw":{"type":"boolean","default":false}},"required":["url"]}')
ON CONFLICT (mcp_server_id, tool_name) DO UPDATE SET
    description  = EXCLUDED.description,
    input_schema = EXCLUDED.input_schema;
