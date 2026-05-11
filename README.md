# A1 Agent Engine

**Enterprise Agentic PaaS** — A production-grade platform for building, deploying, and orchestrating AI-driven agent workflows with durable execution, multi-tenancy, and comprehensive observability.

## 🎯 What is A1 Agent Engine?

A1 Agent Engine is a complete platform for agentic AI applications. It enables:

- **Agent Workflows** — Define AI agents with reasoning loops, memory, and tool access
- **Team Orchestration** — Coordinate multi-agent teams with parallel execution and result synthesis
- **Durable Execution** — All workflows backed by Temporal for crash recovery and HITL integration
- **Multi-Tenancy** — Tenant isolation via PostgreSQL RLS, Redis namespacing, and per-tenant Temporal queues
- **Tool Ecosystem** — Build and compose tools, organize into skills, version-control everything
- **Enterprise Security** — HMAC webhook validation, OIDC token issuance, JIT credential fetching
- **Real-Time Observability** — Stream agent events as Server-Sent Events or WebSocket, monitor via Temporal UI
- **AI-Assisted Agent Design** — Embedded Manifest Assistant helps no-code users design agent manifests conversationally, recommending skills and drafting system prompts in real-time

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Go 1.22+
- Python 3.9+ with venv
- Node.js 18+ with npm

### Setup (5 minutes)

```bash
# 1. Start backing services (Postgres, Redis, Temporal, Admin API)
cd infra/local
docker-compose up -d

# 2. Agent Studio Frontend (Terminal 1)
cd apps/agent-studio
npm run dev
# → http://localhost:3000

# 3. Admin Console Frontend (Terminal 2)
cd apps/admin-console
npm run dev
# → http://localhost:3001 (login with key: dev-admin-key)

# 4. API Gateway (Terminal 3)
cd services/api-gateway
go install github.com/cosmtrek/air@latest
air
# → http://localhost:8080

# 5. Workflow Initiator (Terminal 4)
cd services/workflow-initiator
air

# 6. Agent Workers (Terminal 5)
cd services/agent-workers
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m temporal.worker

# 7. KG Service (Terminal 6)
cd services/kg-service
air

# 8. Verify health
curl http://localhost:8080/health
curl http://localhost:8089/health
curl http://localhost:8093/health
```

**Note:** Frontends run on host, not Docker, for rapid development iteration. Admin API runs in Docker and is automatically started with `docker-compose up -d`.

## 🏗️ Architecture

### Four-Tier Capability Hierarchy

```
Tools (JSON schemas, auth levels, sandbox requirements)
  ↓
Skills (Tool compositions, versioning, hooks)
  ↓
Sub-Agents (Reusable agent contracts, team members)
  ↓
Agent Teams (Orchestration, decomposition, synthesis)
```

### Service Topology

| Service | Port | Language | Role |
|---------|------|----------|------|
| **Orchestration** | | | |
| Temporal | 7233/8233 | - | Durable workflow engine |
| **Execution** | | | |
| API Gateway | 8080 | Go | Entry point; HMAC validation |
| Workflow Initiator | 8081 | Go | Temporal workflow dispatcher |
| Agent Workers | - | Python | Temporal workers; ReAct loop |
| LLM Gateway | 8083 | Go | LLM provider proxy (LiteLLM) |
| Sandbox Manager | 8082 | Go | Ephemeral container lifecycle |
| **Control Plane** | | | |
| Tool Registry | 8086 | Go | Tool CRUD & versioning |
| Skill Catalog | 8087 | Go | Skill composition |
| Skill Dispatcher | 8085 | Go | Tool routing; hooks |
| Sub-Agent Registry | 8084 | Go | Sub-agent contracts |
| Agent Registry | 8088 | Go | Agent manifests |
| **Admin Plane** | | | |
| Admin API | 8089 | Go | Platform admin backend; tenant mgmt |
| **Knowledge Graph** | | | |
| KG Service | 8093 | Go | Knowledge Graph CRUD, traversal, semantic search |
| **MCP Integration** | | | |
| MCP Registry | 8090 | Go | External MCP server hub (client) |
| MCP Server | 8091 | Go | Platform MCP endpoint (server) |
| **Frontend & Observability** | | | |
| Agent Studio | 3000 | Next.js | Builder UI; Ops Dashboard |
| Admin Console | 3001 | Next.js | Platform administration UI |
| Dashboard | 8501 | Streamlit | SRE observability |
| **Data** | | | |
| PostgreSQL | 5433 | - | Primary state store; KG tables; pgvector; RLS |
| Redis | 6379 | - | Session cache; rate limiting |

### Execution Flow

#### Single-Agent Workflow
```
API Gateway → Workflow Initiator → StartAgentWorkflow → Agent Worker (ReAct loop)
  ↓
1. Fetch context from Redis/pgvector + KG Service (structural domain context)
2. LLM reasoning via LLM Gateway
3. Skill dispatch (tool routing)
4. Tool execution (Sandbox Manager or internal)
5. Loop until completion or HITL signal
```

#### Team Workflow
```
API Gateway → Workflow Initiator → StartTeamWorkflow → Team Orchestrator
  ├─ LLM decomposes goal into sub-tasks
  ├─ Fan-out: Each sub-agent runs ReAct loop (parallel)
  ├─ Mutating tool? → Entire team suspends pending HITL
  └─ LLM synthesizes results → Return
```

## 📂 Project Structure

```
a1-agent-engine/
├── services/                    # Core microservices (Go/Python)
│   ├── api-gateway/            # REST API entry point; webhook validation
│   ├── workflow-initiator/      # Temporal workflow dispatcher
│   ├── agent-workers/          # Python Temporal workers; PydanticAI reasoning loops
│   ├── llm-gateway/            # LLM provider proxy (Anthropic/OpenAI compatible)
│   ├── sandbox-manager/        # Ephemeral container lifecycle manager
│   ├── tool-registry/          # Tool registration, versioning, security review
│   ├── skill-catalog/          # Skill composition and management
│   ├── skill-dispatcher/       # Tool routing and execution hooks
│   ├── sub-agent-registry/     # Sub-agent contract definitions
│   ├── agent-registry/         # Agent manifest storage and versioning
│   ├── admin-api/              # Platform governance backend (tenants, LLM config, cost)
│   ├── kg-service/             # Knowledge Graph CRUD, traversal, semantic search
│   ├── mcp-registry/           # External MCP server integration (client)
│   ├── mcp-server/             # Platform MCP endpoint for external clients (server)
│   ├── bash-executor/          # Code execution service for sandboxed operations
│   └── dashboard/              # SRE observability dashboard (Streamlit)
│
├── apps/
│   ├── agent-studio/           # Next.js frontend for agent builders and simulators
│   └── admin-console/          # Next.js frontend for platform administration
│
├── packages/
│   ├── go-shared/              # Shared Go models and utilities
│   ├── webhook-security/       # HMAC-SHA256 signature validation
│   ├── hook-engine/            # Pre/post-execution hook engine
│   ├── py-agent-core/          # Python agent core utilities and base classes
│   └── ui-components/          # Shared React UI components library
│
├── infra/
│   ├── local/                  # Local development Docker Compose setup
│   │   ├── docker-compose.yml
│   │   └── .env
│   ├── postgres/               # Database schema and migrations
│   ├── k8s/                    # Kubernetes manifests and Helm charts
│   ├── platform/               # Platform infrastructure configuration
│   └── certs/                  # TLS certificates for local development
│
├── src/
│   └── lib/                    # Shared library utilities
│
└── .claude/
    └── CLAUDE.md              # Project-specific development guidelines
```

## 🔑 Key Features

### Durability & Crash Recovery
All agent execution backed by Temporal workflows—resumable from last checkpoint on crash.

### Multi-Tenancy
- **PostgreSQL RLS**: Row-level security with `SET LOCAL app.tenant_id`
- **Redis Namespacing**: Per-tenant cache isolation via key prefixes
- **Temporal Task Queues**: Per-tenant queues for isolation and scaling
- **Vector DB Partitioning**: Per-tenant embeddings storage

### Enterprise Security
- **HMAC Webhook Validation**: Secure inbound event verification
- **OIDC Token Issuance**: Industry-standard identity federation
- **JIT Credential Fetching**: Credentials retrieved at activity time, never stored

### Real-Time Streaming
- **Server-Sent Events (SSE)**: Polling-based event streaming
- **WebSocket**: Full-duplex agent communication
- **Event Models**: Structured events for reasoning steps, tool calls, results

### Agent Execution Engines
- **PydanticAI for Default-Tenant Agents**: Default-tenant agents use PydanticAI for full internal reasoning loops with native tool integration. PydanticAI handles all sub-iterations internally; Temporal invokes once per high-level reasoning step.
- **AsyncOpenAI for System Agents**: Platform system agents (Manifest Assistant, etc.) use AsyncOpenAI for compatibility with OpenAI-based LLM providers through the LLM Gateway.

### Observability
- **Temporal UI**: Workflow history, task queue depth, signal monitoring
- **Streamlit Dashboard**: SRE-focused metrics and logs
- **Structured Logging**: JSON logs with tenant context

### Knowledge Graph Foundation

The platform includes a **Knowledge Graph (KG)** system for storing and querying structural domain context:

- **KG Service** (`services/kg-service`, port 8093): PostgreSQL-backed graph storage with semantic search via pgvector. Provides HTTP APIs for CRUD operations (graphs, nodes, edges) and traversal queries.

- **KG System Tools**: Five platform tools for agent-callable KG operations:
  - `kg-create-graph` — Create a new domain knowledge graph
  - `kg-add-node` — Add typed entities to graphs
  - `kg-add-edge` — Add relationships between entities
  - `kg-query` — Traverse graph relationships with depth limits
  - `kg-search` — Semantic search on node properties (pgvector)

- **KG-Architect System Agent**: Platform agent for natural-language knowledge graph construction. Architects describe domain structure conversationally; the agent builds the KG via tool invocations.

- **Multi-Tenant Isolation**: Knowledge graphs are tenant-scoped via PostgreSQL RLS policies (`tenant_id` column). Agents can only access their tenant's KGs.

**Key Benefits:**
- Agents access domain topology without external API calls
- Semantic search surfaces relevant entities by meaning (e.g., "services that depend on the cache")
- KG-Architect simplifies ontology design for non-technical users
- Complements MCP servers (KG = static structural context; MCP = live operational data)

### AI-Assisted Agent Design (Manifest Assistant)

The **Manifest Assistant** is a platform system agent embedded in the Agent Creation UI. It helps no-code users design agent manifests conversationally:

1. **Open Agent Creation Dialog** → Manifest Assistant panel appears on the right
2. **Describe Your Agent** → E.g., "I need a customer support agent that handles ticket routing"
3. **Assistant Recommends**:
   - ✨ **System Prompt Draft** — Persona-driven prompt tailored to your needs
   - 🛠️ **Skill Recommendations** — Exact skills from your catalog with explanations
   - 🔧 **Skill Gaps** — Proposes new skills to create if the catalog lacks capabilities
4. **Real-Time Streaming** → Responses appear as they're computed via Server-Sent Events
5. **One-Click Apply** → Click "Apply to Form" to auto-populate system prompt and skills

**How It Works Internally:**
- Frontend injects the live skill/tool catalog as context (`<catalog>` XML block) into the first message
- Manifest Assistant runs on an isolated `platform-system-agent-queue` (separate from user agent workflows)
- Multi-turn conversation preserves context via session ID
- LLM output is parsed to extract structured sections (`## System Prompt Draft`, `## Recommended Skills`)

### Platform Administration

The A1 Agent Engine includes a dedicated **Admin Plane** for platform operators, consisting of the **Admin API** backend service and **Admin Console** web application.

#### Admin API (`services/admin-api`, port 8089)

A thin Go aggregator service providing RESTful governance APIs. All endpoints (except `/health`) require `Authorization: Bearer <ADMIN_API_KEY>` header validation.

**Key Endpoints:**
- `POST /api/v1/admin/auth/verify` — Validate admin API key
- `GET/POST /api/v1/admin/tenants` — List or create tenants
- `GET/PUT /api/v1/admin/tenants/:id` — Fetch tenant or update quota/status
- `GET/PUT /api/v1/admin/llm/config` — Query or update LLM provider configuration (persisted to DB)
- `GET/PUT /api/v1/admin/llm/access` — Manage per-tenant model access allowlists
- `GET/PUT /api/v1/admin/system-agents` — Query or update platform system agents (e.g., Manifest Assistant)
- `GET /api/v1/admin/executions` — Cross-tenant execution trace queries
- `GET /api/v1/admin/cost` — Per-tenant cost aggregation and attribution
- `GET /api/v1/admin/audit` — Immutable audit log across all resources

**Admin Console** (`apps/admin-console`, port 3001)

A Next.js web application providing graphical administration. Login at http://localhost:3001 with default key: `dev-admin-key`.

**Key Features:**
- **Tenant Management** — Create tenants, set quotas (max concurrent workflows, monthly token budgets), suspend/activate tenants
- **LLM Configuration** — Configure LLM proxy URLs and API keys, manage per-tenant model access allowlists, hot-reload without service restart
- **System Agent Management** — View and edit platform system agent manifests (e.g., Manifest Assistant), manage lifecycle (draft → staged → active)
- **Cross-Tenant Execution Visualizer** — Interactive trace viewer showing execution DAGs, event timelines, and cost annotations across all tenants
- **Cost Tracking & Attribution** — Real-time cost aggregation: tokens, sandbox time, Vector DB operations. Per-tenant, per-agent, per-skill breakdown with monthly forecasting
- **Audit Log** — Immutable record of all lifecycle events and administrative actions with filtering and export
- **Dashboard** — Platform health overview: active tenants, active workflows, LLM mode, service health checks, recent executions

**Admin Pages:**
- `/login` — Admin API key authentication
- `/dashboard` — Platform status, KPI summary, recent activities
- `/tenants` — Tenant CRUD with inline quota editing and status toggles
- `/tenants/[id]` — Tenant detail view (Overview, Agents, Cost, Model Access, Audit tabs)
- `/llm-config` — LLM provider configuration and per-tenant model allowlisting
- `/system-agents` — Platform system agent manifest management and deployment
- `/system-skills` — Platform system skill catalog and lifecycle management (draft → active)
- `/system-tools` — Platform system tool registry and approval workflows
- `/mcp-servers` — Global MCP server registration and management; MCP token issuance for external client access
- `/executions` — Cross-tenant execution trace visualizer with filters and live streaming
- `/cost` — Per-tenant cost breakdown with period selection and CSV export
- `/audit` — Immutable audit log with resource filtering and compliance export

## 🛠️ Development

### Running Tests

```bash
# Unit tests
cd services/api-gateway
go test ./...

# Integration tests (requires docker-compose running)
go test -tags=integration ./...

# Temporal workflow tests
cd services/agent-workers
pytest
```

### Adding a New Service

1. Create `services/my-service/` with Dockerfile
2. Add to `infra/local/docker-compose.yml` (port, env, depends_on)
3. Implement HTTP/gRPC handlers
4. Register activity or workflow with Temporal if needed

### Adding a Tool

```bash
POST /api/v1/tools
Content-Type: application/json

{
  "name": "send-email",
  "description": "Send an email to a recipient",
  "input_schema": {
    "type": "object",
    "properties": {
      "to": {"type": "string"},
      "subject": {"type": "string"},
      "body": {"type": "string"}
    },
    "required": ["to", "subject", "body"]
  },
  "auth_level": "user",
  "sandbox_required": false
}
```

Tool lifecycle: `draft` → `staged` → `active`

## 🔍 Debugging

### Check Service Health
```bash
curl http://localhost:8080/health
```

### Connect to Postgres
```bash
psql -h localhost -p 5433 -U postgres -d agentplatform
SET LOCAL app.tenant_id = 'default-tenant';
SELECT * FROM agents;
```

### Monitor Temporal
- UI: http://localhost:8233
- Check workflow history, task queue depth, pending signals

### Docker Service Logs
```bash
cd infra/local
docker-compose logs -f api-gateway
docker-compose logs -f temporal
```

## 📖 Documentation

- **[CLAUDE.md](./.claude/CLAUDE.md)** — Project setup, conventions, enforcement rules
- **[architecture.md](./architecture.md)** — Detailed system design
- **[requirements.md](./requirements.md)** — Functional & non-functional requirements

## 🧠 Design Decisions

### Temporal as Single Execution Path
All agents (simple and complex) execute through Temporal. Profiling showed ~200ms overhead is negligible for realistic agents (LLM calls dominate). Trade-off: durability and operational consistency win.

### Multi-Tenant by Default
Every resource (agent, skill, tool, memory) belongs to a tenant. Isolation enforced at database, cache, and queue layers.

### Per-Sub-Agent Model Selection
Different sub-agents can target different LLM providers/models via the LLM Gateway, enabling tenant-specific provider preferences without per-tenant infrastructure complexity.

## 🤝 Contributing

1. **Mandatory TDD**: Write tests before code; verify integration before merge
2. **Surgical Precision**: Only modify code strictly related to the task
3. **No Drive-By Refactoring**: Keep diffs minimal and clean
4. **Security First**: Review OWASP top 10 vulnerabilities; validate at system boundaries

## 📝 License

[Add your license here]

## 💬 Support

For issues and feature requests, see the GitHub Issues tab or contact the maintainers.

---

**Built with Go, Python, Next.js, Temporal, PostgreSQL, and Redis.**
