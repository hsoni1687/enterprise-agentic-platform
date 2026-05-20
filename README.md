# A1 Agent Platform

**Enterprise Agentic Platform** — Build, deploy, and operate production-grade AI agents in minutes. Define skills, wire tools, set guardrails — all from a clean visual interface. No boilerplate. No glue code. Just agents that work.

---

## Assemble Your Agent in Minutes

Creating a powerful AI agent on A1 is a five-step wizard — not a multi-week engineering project.

```
① Pick a tier      →  ② Name your agent  →  ③ Attach skills
④ Set guardrails   →  ⑤ Deploy & chat
```

That's it. The platform handles routing, durable execution, multi-tenancy, tool security, and observability automatically. You focus on what your agent should *do*.

### What you configure with a few clicks

| What | How easy |
|------|----------|
| **Skills** | Browse the catalog → click Attach. Each skill bundles the right tools, SOPs, and approval policies. |
| **Tools** | Fill a name + JSON schema form. Tools go through `draft → staged → active` lifecycle automatically. |
| **Guardrails** | Toggle on/off: PII detection, harmful content filter, prompt injection protection, custom checks. |
| **Hooks** | Checkboxes: audit log, cost meter, HITL intercept, rate limit. Applied to every tool call. |
| **Model** | Pick any model from your LiteLLM config. Swap anytime — no code changes. |
| **System prompt** | Write your own or click **AI Assist** and describe what your agent should do in plain English. |

---

## Platform Overview

A1 Agent Platform is a **full-stack agentic PaaS** purpose-built for enterprise operations. It gives organizations a production-grade foundation — durable execution, multi-tenancy, domain knowledge graphs, and end-to-end observability — so teams can ship AI agents without building the infrastructure from scratch.

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 3: DOMAIN SOLUTIONS (Cookbooks)                              │
│                                                                     │
│  DevOps/SRE Cookbook    Fintech Cookbook     Healthcare Cookbook   │
│  • Agent templates       • Agent templates    • Agent templates    │
│  • KG ontology           • KG ontology        • KG ontology        │
│  • MCP recommendations   • MCP recs           • MCP recs           │
│  • Seed data             • Seed data          • Seed data          │
│  → Deploy production-ready agents in under 2 hours                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (architect customizes cookbook)
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 2: DOMAIN KNOWLEDGE & CONTEXT                                │
│                                                                     │
│  Knowledge Graph          KG-Architect Agent    MCP Servers        │
│  • Structural ontology    • Builds KGs from     • PagerDuty        │
│  • Entity relationships   natural language      • Jira/GitHub      │
│  • pgvector search        • Iterative refinement• Bloomberg        │
│  • RLS multi-tenancy      • No-code interaction • Custom APIs      │
│  → Static domain structure + Live operational context              │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (agents are wired to both layers)
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 1: PLATFORM PRIMITIVES (4-Tier Capability Hierarchy)         │
│                                                                     │
│  Tools → Skills → Sub-Agents → Agent Teams                         │
│  • bash, web-search      • Tool bundles       • Contracts          │
│  • kg-* operations       • SOPs & hooks       • Orchestration      │
│  • Custom APIs           • Versioning         • Parallelization    │
│  → Governed composition without lock-in                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ Agent Tiers

Pick the tier that matches your use case. The platform routes execution automatically — your frontend and API calls never change.

| Property | ⚡ Lite | 🔗 Workflow | 🧠 Deep |
|---|---|---|---|
| **Execution engine** | In-process goroutine | Temporal `WorkflowAgentRun` | Temporal `AgentWorkflow` |
| **Typical latency** | < 2 s | Seconds → minutes | Minutes → hours |
| **Max duration** | 10 s (configurable) | 300 s (configurable) | 3 600 s (configurable) |
| **Max tool calls** | 2 (configurable) | 20 (configurable) | Unlimited |
| **Max tokens** | 2 000 | 10 000 | 100 000 |
| **Max cost** | $0.01 | $0.10 | $5.00 |
| **HITL on mutating** | ✗ | ✓ | ✓ |
| **Planning mode** | None | Static | Dynamic |
| **Cross-session memory** | ✗ | ✗ | ✓ |
| **Self-correction** | ✗ | ✗ | ✓ |
| **Autonomy level** | None (supervised) | Supervised | Autonomous |
| **Durable execution** | ✗ | ✓ | ✓ |
| **Best for** | FAQ bots, classifiers, quick lookups | Multi-step pipelines, approvals, DAG flows | Long-horizon reasoning, research, planning |

```
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ ⚡ Lite           │  │ 🔗 Workflow       │  │ 🧠 Deep           │
│ Instant response │  │ Durable pipeline │  │ Autonomous agent │
│ < 2 s            │  │ Seconds–minutes  │  │ Minutes–hours    │
│                  │  │                  │  │                  │
│ • FAQ bots       │  │ • Support router │  │ • Incident resp. │
│ • Classifiers    │  │ • Data pipeline  │  │ • Research agent │
│ • Quick lookups  │  │ • Approval flow  │  │ • Code review    │
│                  │  │                  │  │                  │
│ Speed  ████░░░   │  │ Speed  ██░░░░░   │  │ Speed  █░░░░░░   │
│ Cost   █░░░░░░   │  │ Cost   ███░░░░   │  │ Cost   ██████░   │
│ Power  ██░░░░░   │  │ Power  █████░    │  │ Power  ███████   │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

### ⚡ Lite — Zero-latency agents

Run entirely inside the workflow-initiator service — no Temporal overhead. Ideal for chat assistants, classifiers, and simple Q&A.

```
POST /api/v1/sessions
  ↓
HandleStartSession (reads manifest.Tier == "lite")
  ↓
HandleLiteSession
  ├─ Registers in-memory liteStore (sync.Map)
  ├─ Returns 201 + JSON {workflow_id, status: "RUNNING"} immediately
  └─ Spawns goroutine → runLiteSession
       ├─ Calls LiteLLM /chat/completions
       ├─ Executes ≤ maxToolCalls via Skill Dispatcher
       ├─ Appends events: thinking → tool_call → text → done
       └─ Marks session COMPLETED/FAILED
```

### 🔗 Workflow — Durable pipelines

Run as `WorkflowAgentRun` in Temporal. Support static DAGs with ordered steps, HITL intercepts on mutating operations, and condition branching.

- **Step types**: `llm`, `tool`, `skill`, `condition`, `approval`, `loop`
- **HITL intercepts**: Mutating steps automatically gate behind human approval signals
- **Condition branching**: `contains:`, `regex:`, `eq:`, `llm:` evaluation strategies

### 🧠 Deep — Autonomous agents

Run as `AgentWorkflow` in Temporal — a full ReAct loop with:
- **Dynamic planning**: LLM decomposes goals into sub-plans at runtime
- **Self-correction**: Retries with updated context on failures
- **Cross-session memory**: pgvector recall from previous sessions
- **Unconstrained tool use**: No per-run tool call limit
- **Multi-agent teams**: Delegates to sub-agents and synthesizes results

---

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Go 1.22+
- Python 3.9+ with venv
- Node.js 18+ with npm
- Ollama (for local model serving)

### 1 · Start infrastructure (2 min)

```bash
# Pull local models first
ollama serve              # Terminal 1 — keep running
ollama pull llama3.1:8b
ollama pull nomic-embed-text

# Start all backing services
cd infra/local
docker compose up -d
```

This starts: PostgreSQL, Redis, Temporal, LiteLLM, Admin API, all platform microservices, and the Temporal worker.

Verify with:

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-litellm-dev" \
  -H "Content-Type: application/json" \
  -d '{"model":"local-chat","messages":[{"role":"user","content":"Say hello"}]}'
```

### 2 · Start frontends (1 min)

```bash
# Agent Studio — where you build and test agents
cd apps/agent-studio && npm install && npm run dev
# → http://localhost:3000

# Admin Console — platform administration
cd apps/admin-console && npm install && npm run dev
# → http://localhost:3001  (key: dev-admin-key)
```

### 3 · Build your first agent (3 min, no code)

1. Open **http://localhost:3000**
2. Click **Agents → Create Agent**
3. Choose **⚡ Lite** tier
4. Fill in: Name, Model, System Prompt
5. Optionally click **AI Assist** — describe your agent in plain English and let the platform generate the prompt and recommend skills
6. Click **Create**
7. Open the agent → **Chat** — send any message

The agent responds in < 2 seconds.

---

## 🏗️ Platform Architecture

### Service Topology

| Service | Port | Language | Role |
|---------|------|----------|------|
| **API Gateway** | 8080 | Go | Entry point; HMAC validation; SSE proxy |
| **Workflow Initiator** | 8081 | Go | Tier routing; Temporal dispatcher; lite runner |
| **Agent Workers** | — | Python | Temporal workers; ReAct loop |
| **LiteLLM Proxy** | 4000 | Python | Unified LLM provider gateway (OpenAI-compatible) |
| **Agent Registry** | 8088 | Go | Agent manifest storage and versioning |
| **Tool Registry** | 8086 | Go | Tool registration, versioning, security review |
| **Skill Catalog** | 8087 | Go | Skill composition and management |
| **Skill Dispatcher** | 8085 | Go | Tool routing and execution hooks |
| **Sub-Agent Registry** | 8084 | Go | Sub-agent contract definitions |
| **Sandbox Manager** | 8082 | Go | Ephemeral container lifecycle |
| **KG Service** | 8093 | Go | Knowledge Graph CRUD, traversal, semantic search |
| **MCP Registry** | 8090 | Go | External MCP server hub (client) |
| **MCP Server** | 8091 | Go | Platform MCP endpoint (server) |
| **Admin API** | 8089 | Go | Platform governance; tenant management |
| **Agent Studio** | 3000 | Next.js | Builder UI; agent simulator; ops dashboard |
| **Admin Console** | 3001 | Next.js | Platform administration UI |
| **Dashboard** | 8501 | Streamlit | SRE observability |
| **Temporal** | 7233/8233 | — | Durable workflow engine |
| **PostgreSQL** | 5433 | — | Two databases: `agentplatform` (platform) · `litellm` (LiteLLM isolated) |
| **Redis** | 6379 | — | Session cache; rate limiting |

### Execution Flow

```
                    ┌─────────────┐
User/Webhook ──────▶│ API Gateway │
                    └──────┬──────┘
                           │ POST /api/v1/sessions
                           ▼
                    ┌──────────────────┐
                    │Workflow Initiator│
                    │                  │
          tier=lite │  tier=workflow   │ tier=deep
         ┌──────────┤  ┌──────────────┤──────────────┐
         │          │  │              │              │
         ▼          │  ▼              │              ▼
   In-process   Temporal          Temporal      Temporal
   goroutine    WorkflowAgentRun  WorkflowAgentRun  AgentWorkflow
   (liteStore)  (static DAG)      (static DAG)  (ReAct loop)
         │          │              │              │
         └──────────┴──────────────┴──────────────┘
                           │
                           ▼ tool calls
                    ┌──────────────────┐
                    │ Skill Dispatcher  │
                    └──────┬───────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         Tool Registry  KG Service  MCP Registry
         (custom tools) (kg-query)  (PagerDuty, etc.)
```

### Agent Event Stream (SSE)

All agent executions emit a structured event stream consumed by Agent Studio's chat UI:

```
thinking    → Model's live reasoning (shown as Thinking block)
plan        → "Breaking into N sub-tasks..."
task_start  → {step_id, step_name}
tool_call   → {tool_name, tool_args, tool_result}
approval    → {approval_id, reason}   ← HITL gate; workflow pauses
text        → Final response text
done        → Session terminal event
error       → {message}
```

### Four-Tier Capability Hierarchy

```
Tools  — JSON schemas, auth levels, sandbox requirements
  ↓
Skills — Tool compositions, versioning, pre/post hooks, SOPs
  ↓
Sub-Agents — Reusable agent contracts, team member definitions
  ↓
Agent Teams — Orchestration, goal decomposition, result synthesis
```

---

## 🔑 Key Platform Features

### Click-to-Create Skills

Skills are the primary unit of agent capability. Each skill is a named bundle of tools with a built-in SOP. Create one from the catalog UI:

1. **Tools section** → Register a tool (name + JSON schema, 30 seconds)
2. **Skills section** → Create skill → pick tools → write SOP
3. **Agent wizard** → Attach skill → done

The same skill can be reused across any number of agents. Version it, stage it, promote it — all through the UI.

### Click-to-Toggle Guardrails

Every agent has a **Safety** tab with individually toggleable guardrails:

- **PII Detection & Redaction** — strips sensitive data before it leaves the platform
- **Harmful Content Filter** — LLM-based check on all inputs and outputs
- **Prompt Injection Protection** — catches adversarial instruction injection
- **Custom Checks** — regex or LLM-based rules you define

Admin-managed guardrails are marked with a badge and cannot be disabled by tenant users.

### Durable Execution

All workflow and deep agent runs are backed by Temporal — resumable from the last checkpoint after crashes, deployments, or network partitions. Lite agents trade durability for zero latency.

### Human-in-the-Loop (HITL)

Workflow and deep agents automatically pause on mutating tool calls and emit an `approval` event. Approve or reject via:
- Agent Studio UI (real-time approval widget)
- Webhook integration (programmatic approval)
- Temporal signal (`approve_step` / `reject_step`)

### Multi-Tenancy

- **PostgreSQL RLS**: Row-level security via `SET LOCAL app.tenant_id` — no cross-tenant leakage
- **Redis Namespacing**: Per-tenant key prefixes for session and rate limit caches
- **Temporal Task Queues**: Per-tenant queues for isolation and independent scaling
- **Vector DB Partitioning**: Per-tenant pgvector embeddings

### AI-Assisted Agent Design (Manifest Assistant)

Embedded in the Create Agent wizard:
1. Reads your tenant's live skill and tool catalog
2. Accepts a plain-English description of what your agent should do
3. Recommends a system prompt, relevant skills, and highlights capability gaps
4. Streams results via SSE — one click applies recommendations to the form

### MCP Integration

Connect external data sources as Model Context Protocol servers:
- Register per-tenant MCP endpoints (PagerDuty, GitHub, Jira, Datadog, Bloomberg)
- MCP Registry auto-discovers available tools from each server
- Agents call MCP tools identically to platform tools — same Skill Dispatcher path
- Platform MCP Server (port 8091) exposes platform capabilities to external MCP clients

### Enterprise Security

- **HMAC Webhook Validation**: SHA-256 signed inbound events
- **OIDC Token Issuance**: Industry-standard identity federation
- **JIT Credential Fetching**: Credentials retrieved at activity time, never stored at rest
- **Tenant Isolation**: Every resource scoped to a tenant; RLS enforced at database layer

---

## 🧠 Knowledge Graph Workspace

The **Knowledge Graphs** section lets domain architects design, visualize, and manage their tenant's knowledge graphs — structural context that agents query during reasoning.

### KG Builder (AI-Assisted)

Describe your domain in plain English and the KG-Architect system agent builds the graph:

```
You: "We have 3 services. api-gateway depends on both
     user-service and product-service. They share a
     Postgres cluster. Each has a runbook."

KG-Architect:
  • kg-create-graph: DevOps-Infra
  • kg-add-node: api-gateway (Service)
  • kg-add-node: user-service (Service)
  • kg-add-node: product-service (Service)
  • kg-add-node: shared-postgres (Database)
  • kg-add-edge: api-gateway → user-service (depends_on)
  • kg-add-edge: api-gateway → product-service (depends_on)
  • kg-add-edge: user-service → shared-postgres (uses_database)
  • kg-add-edge: product-service → shared-postgres (uses_database)

Done! 4 nodes, 4 edges. Graph preview updated →
```

### KG Visualizer

Interactive graph canvas: pan, zoom, drag nodes, click to inspect, traverse N-hop subgraphs, search by name/type/property, export as JSON or PNG.

### Agent-Callable KG Tools

| Tool | Description |
|------|-------------|
| `kg-create-graph` | Create a new domain knowledge graph |
| `kg-add-node` | Add typed entities with properties |
| `kg-add-edge` | Add typed relationships between entities |
| `kg-query` | Traverse graph with depth limits |
| `kg-search` | Semantic search via pgvector embeddings |

---

## 🍳 Domain Cookbook System

Import a vertical solution in one click and have production-ready agents running in under 2 hours:

1. **Agent Studio → Cookbooks**
2. Select vertical (DevOps/SRE, Fintech, Healthcare)
3. One-click import → agent templates, skills, KG schema, seed KG created in your tenant
4. Customize system prompts and attach your MCP credentials
5. Deploy

Each cookbook ships with pre-built agent manifests, domain skill bundles, KG ontology, MCP recommendations, and a starter knowledge graph with common entities pre-populated.

---

## 💡 Examples

### FAQ Bot (Lite tier)

```bash
curl -X POST http://localhost:8080/api/v1/sessions \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme-corp" \
  -d '{"agent_id": "<agent-id>", "prompt": "What is your return policy?"}'
# Returns: {"workflow_id":"lite-wf-...", "status":"RUNNING"}
# Poll: GET /api/v1/sessions/{id}/poll
```

### Support Ticket Router (Workflow tier)

```json
{
  "name": "Support Router",
  "tier": "workflow",
  "model": "gpt-4o",
  "skills": ["ticket-classifier", "crm-updater"],
  "execution_config": {
    "hitl_on_mutating": true,
    "steps": [
      {"id": "s1", "type": "skill", "skill_id": "ticket-classifier"},
      {"id": "s2", "type": "approval", "approval_message": "Route to Tier 2?", "depends_on": ["s1"]},
      {"id": "s3", "type": "skill", "skill_id": "crm-updater", "depends_on": ["s2"]}
    ]
  }
}
```

### Incident Response Agent (Deep tier)

Autonomous SRE agent — triggered by a PagerDuty P1 alert:

```
1. kg-query(api-gateway, depth=2)
   → [user-service, product-service, shared-postgres]

2. MCP: PagerDuty.get_active_alerts(services=[...])
   → 2 P1 alerts on product-service

3. MCP: Datadog.query_metrics(service=product-service)
   → postgres connection pool at 99%

4. LLM synthesis:
   "Root cause: postgres connection pool saturation.
    api-gateway → product-service → shared-postgres chain.
    Recommend: increase pool size or scale postgres replicas."

5. HITL signal emitted → human approves remediation
6. k8s-remediation skill executes
```

### Multi-Agent Team

```
Goal: "Analyze Q3 performance across sales, engineering, and support"

Team Orchestrator decomposes:
  ├─ Sales Agent    → Queries CRM MCP + KG for territory mapping
  ├─ Eng Agent      → Queries GitHub MCP + deployment KG for velocity
  └─ Support Agent  → Queries Zendesk MCP + SLA KG for ticket trends

All three run in parallel (Temporal child workflows).
Orchestrator synthesizes: "Q3 synthesis report across all three domains."
```

---

## 🏛️ Platform Administration (Admin Console)

Access at **http://localhost:3001** with key `dev-admin-key`.

| Page | What you do here |
|------|-----------------|
| `/dashboard` | Platform health: active tenants, live workflows, service status |
| `/tenants` | Create tenants, set quotas (token budget, concurrent workflows), suspend |
| `/tenants/[id]` | Per-tenant detail: agents, costs, model access, audit log |
| `/llm-config` | Configure LLM provider URLs and API keys; hot-reload without restart |
| `/system-agents` | Manage platform system agents (Manifest Assistant, KG-Architect) |
| `/system-skills` | Platform skill catalog lifecycle (`draft → staged → active`) |
| `/system-tools` | Tool registry and approval workflows |
| `/mcp-servers` | Register global MCP servers; issue MCP tokens |
| `/executions` | Cross-tenant execution trace visualizer with live streaming |
| `/cost` | Per-tenant cost breakdown: tokens, sandbox time, vector ops |
| `/audit` | Immutable audit log with compliance export |

---

## 📂 Project Structure

```
enterprise-agentic-platform/
├── services/                     # Core microservices (Go/Python)
│   ├── api-gateway/              # Entry point; HMAC validation; SSE proxy       :8080
│   ├── workflow-initiator/       # Tier routing; Temporal dispatcher; lite runner :8081
│   ├── agent-workers/            # Temporal workers; ReAct loop
│   │   ├── workflows_agent.py    # AgentWorkflow (deep tier)
│   │   ├── workflows_workflow_agent.py  # WorkflowAgentRun (workflow tier)
│   │   ├── activities_agent.py   # Deep tier activities
│   │   └── activities_workflow_agent.py # Workflow tier activities
│   ├── agent-registry/           # Agent manifest CRUD & versioning             :8088
│   ├── tool-registry/            # Tool registration & security review           :8086
│   ├── skill-catalog/            # Skill composition & management                :8087
│   ├── skill-dispatcher/         # Tool routing & pre/post hooks                 :8085
│   ├── sub-agent-registry/       # Sub-agent contracts                           :8084
│   ├── sandbox-manager/          # Ephemeral container lifecycle                 :8082
│   ├── kg-service/               # Knowledge Graph CRUD, traversal, pgvector     :8093
│   ├── mcp-registry/             # External MCP server hub (client)              :8090
│   ├── mcp-server/               # Platform MCP endpoint (server)                :8091
│   ├── admin-api/                # Platform governance backend                   :8089
│   ├── bash-executor/            # Sandboxed code execution
│   └── dashboard/                # SRE observability (Streamlit)                 :8501
│
├── apps/
│   ├── agent-studio/             # Next.js agent builder, simulator, ops UI      :3000
│   └── admin-console/            # Next.js platform administration UI            :3001
│
├── packages/
│   ├── go-shared/                # Shared Go models (AgentManifest, AgentTier…)
│   ├── webhook-security/         # HMAC-SHA256 signature validation
│   ├── hook-engine/              # Pre/post-execution hook middleware
│   ├── py-agent-core/            # Python agent base classes and utilities
│   └── ui-components/            # Shared React component library
│
├── infra/
│   ├── local/                    # Docker Compose + .env for local development
│   │   ├── docker-compose.yml    # All backing services + microservices
│   │   └── litellm.config.yaml   # LiteLLM provider routing config
│   ├── postgres/migrations/      # Numbered SQL migrations (001 → 023+)
│   ├── k8s/                      # Kubernetes Helm charts
│   ├── platform/cookbooks/       # Domain vertical cookbook bundles
│   └── terraform/                # AWS infrastructure (EKS, RDS, ElastiCache)
│
└── .claude/CLAUDE.md             # Project-specific development guidelines
```

---

## 🛠️ Development

### Running Services Locally

```bash
# All backing services in Docker
cd infra/local && docker compose up -d

# Individual services with hot-reload (air)
cd services/api-gateway        && air   # :8080
cd services/workflow-initiator && air   # :8081
cd services/agent-registry     && air   # :8088
cd services/kg-service         && air   # :8093

# Python worker
cd services/agent-workers
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python main.py                          # Temporal worker
```

### Database Migrations

Migrations run automatically on every `docker compose up` via the `migrate` service.
The runner (`infra/postgres/migrate.sh`) tracks applied files in a `_migration_history` table using SHA-256 checksums — it only runs new files, skips already-applied ones, and **fails loudly** if an applied file is modified (fix forward with a new file).

```bash
# Migrations apply automatically — nothing to do manually.
# To write a new migration, add a file to infra/postgres/migrations/:
#   025_my_change.sql   ← next number in sequence

# To reset and reapply everything from scratch:
docker compose down -v postgres && docker compose up -d

# Inspect the platform DB with tenant context:
psql -h localhost -p 5433 -U postgres -d agentplatform
SET LOCAL app.tenant_id = 'default-tenant';
SELECT id, name, status FROM agents;

# Load demo seed data (break-glass — normally seeded automatically):
psql -h localhost -p 5433 -U postgres -d agentplatform \
  -f infra/postgres/seed_demo.sql
```

> **Two databases on the same Postgres instance:**
> - `agentplatform` — all platform tables (agents, skills, tools, KG, etc.)
> - `litellm` — LiteLLM's internal Prisma tables (virtual keys, spend tracking). Kept separate so LiteLLM's migrations never touch platform data.

### Adding a Tool

```bash
curl -X POST http://localhost:8086/api/v1/tools \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: default-tenant" \
  -d '{
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
    "auth_level": "mutating",
    "sandbox_required": false
  }'
# Lifecycle: draft → staged → active (requires admin approval)
```

### Adding a Skill

```bash
curl -X POST http://localhost:8087/api/v1/skills \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: default-tenant" \
  -d '{
    "name": "email-notifier",
    "version": "1.0.0",
    "description": "Sends email notifications",
    "tools": [{"name": "send-email", "version": "1.0.0"}],
    "sop": "Always confirm recipient before sending. Include ticket ID in subject.",
    "mutating": true,
    "approval_required": true
  }'
```

### Running Tests

```bash
# Go unit tests
cd services/api-gateway && go test ./...

# Integration tests (requires docker compose running)
go test -tags=integration ./...

# Python / Temporal workflow tests
cd services/agent-workers && pytest

# Frontend
cd apps/agent-studio && npm test
```

---

## 🔍 Debugging

### Service Health

```bash
curl http://localhost:8080/health    # API Gateway
curl http://localhost:8081/health    # Workflow Initiator
curl http://localhost:8088/health    # Agent Registry
curl http://localhost:8093/health    # KG Service
curl http://localhost:8089/health    # Admin API
```

### Temporal UI

Open **http://localhost:8233** to browse workflow executions, inspect event histories step by step, check task queue depths, and signal workflows (e.g., `approve_step`).

### Postgres (with RLS)

```bash
psql -h localhost -p 5433 -U postgres -d agentplatform

# Must set tenant context before queries
SET LOCAL app.tenant_id = 'default-tenant';
SELECT id, name, tier, status, created_at FROM agents ORDER BY created_at DESC LIMIT 10;
SELECT id, graph_id, label, node_type FROM kg_nodes LIMIT 20;
```

### Docker Logs

```bash
cd infra/local
docker compose logs -f api-gateway
docker compose logs -f workflow-initiator
docker compose logs -f temporal
docker compose logs -f litellm
```

---

## 🏗️ Technology Stack

| Layer | Technology |
|-------|-----------|
| **Workflow orchestration** | Temporal (durable execution, HITL signals, task queues) |
| **LLM gateway** | LiteLLM (OpenAI-compatible; routes to any provider) |
| **Agent reasoning** | ReAct loop (deep/workflow tier) with native Ollama support |
| **Backend services** | Go 1.22 (microservices, HTTP APIs) |
| **Agent workers** | Python 3.11 (Temporal SDK, AsyncOpenAI) |
| **Frontend** | Next.js 14, React, Tailwind CSS, shadcn/ui |
| **Primary database** | PostgreSQL 15 + pgvector (state, KG, embeddings, RLS) |
| **Cache** | Redis 7 (session cache, rate limiting) |
| **Container runtime** | Docker Compose (local), Kubernetes/Helm (production) |
| **Observability** | Temporal UI, Streamlit dashboard, structured JSON logging |
| **Local models** | Ollama (llama3.1:8b, qwen3, nomic-embed-text) |

---

## 🔒 Multi-Tenancy & Security

Every resource in A1 Agent Platform is **tenant-scoped** with multiple isolation layers:

1. **Database**: PostgreSQL RLS with `SET LOCAL app.tenant_id` — queries automatically filtered
2. **Cache**: Redis keys prefixed with `tenant:<id>:` — no cross-contamination
3. **Temporal**: Per-tenant task queues — one tenant's queue depth doesn't affect another
4. **Vectors**: pgvector rows include `tenant_id` column — semantic search never crosses tenants
5. **API**: All requests require `X-Tenant-ID` header — validated at API Gateway
6. **MCP Servers**: Per-tenant credentials for external integrations (PagerDuty, GitHub, etc.)

---

## 🤝 Contributing

1. **Mandatory TDD** — Write tests before code; verify integration before merge
2. **Surgical Precision** — Only modify code strictly related to the task; no drive-by refactoring
3. **No RLS Bypass** — Never use raw SQL that skips the tenant context
4. **No Direct Tool Calls** — Route all tool execution through the Skill Dispatcher
5. **No Secrets in Git** — Use environment variables locally; AWS Secrets Manager in production
6. **HMAC Validation** — Always enabled in production; disable locally with `WEBHOOK_HMAC_DISABLED=true`

---

## 📖 Documentation

- **[CLAUDE.md](./.claude/CLAUDE.md)** — Project setup, conventions, enforcement rules
- **[architecture.md](./architecture.md)** — Detailed system design and data flows
- **[requirements.md](./requirements.md)** — Functional and non-functional requirements
- **[Temporal Docs](https://docs.temporal.io)** — Workflow patterns and SDK reference

---

## 📝 License

[Add your license here]

---

**Built with Go · Python · Next.js · Temporal · PostgreSQL · Redis · LiteLLM · pgvector**
