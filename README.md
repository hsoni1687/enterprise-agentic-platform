# A1 Agent Engine

**Enterprise Agentic PaaS** — A production-grade platform for building, deploying, and orchestrating AI-driven agent workflows with durable execution, multi-tenancy, domain-oriented knowledge graphs, and comprehensive observability.

## 🎯 Platform Vision

A1 Agent Engine transforms how enterprises build and operate AI-driven automation. It provides a **full-stack agentic solution factory** for vertical domains—enabling organizations to deploy sophisticated multi-agent systems in hours rather than weeks.

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
│  → Deploy production-ready agents in minutes                       │
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

Every agent in A1 is classified into one of three **execution tiers**. The tier controls the runtime engine used, the latency budget, tool call depth, and compliance level.

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

### ⚡ Lite — Zero-latency agents

Lite agents run entirely inside the **workflow-initiator** service with no Temporal dependency. They are ideal for chat assistants, classifiers, and simple question-answering agents that need fast responses.

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

GET /api/v1/sessions/{id}/poll
  ↓
Checks IsLiteSession() → returns events from liteStore
  (compatible with the exact same poll loop as Temporal sessions)
```

### 🔗 Workflow — Durable pipelines

Workflow agents run as `WorkflowAgentRun` in Temporal. They support:
- **Static DAGs**: Ordered steps with `depends_on` lists and topological execution
- **Step types**: `llm`, `tool`, `skill`, `condition`, `approval`, `loop`
- **HITL intercepts**: Mutating steps are automatically gated behind human approval signals
- **Condition branching**: `contains:`, `regex:`, `eq:`, `llm:` evaluation strategies

### 🧠 Deep — Autonomous agents

Deep agents run as `AgentWorkflow` in Temporal — the full PydanticAI ReAct loop with:
- **Dynamic planning**: LLM decomposes goals into sub-plans at runtime
- **Self-correction**: Retries with updated context on failures
- **Cross-session memory**: pgvector recall from previous sessions
- **Unconstrained tool use**: No per-run tool call limit
- **Multi-agent teams**: Can delegate to sub-agents and synthesize results

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

### 3 · Create your first agent (3 min)

1. Open **http://localhost:3000**
2. Click **Agents → Create Agent**
3. Choose **⚡ Lite** tier (fast, no Temporal needed)
4. Fill in: Name = `FAQ Bot`, Model = `gpt-4o-mini`, System Prompt = `You are a helpful assistant.`
5. Click **Create**
6. Open the agent and click **Chat** — send any message

The agent responds in < 2 seconds via the in-process goroutine path.

---

## 🏗️ Platform Architecture

### Service Topology

| Service | Port | Language | Role |
|---------|------|----------|------|
| **API Gateway** | 8080 | Go | Entry point; HMAC validation; SSE proxy |
| **Workflow Initiator** | 8081 | Go | Tier routing; Temporal dispatcher; lite runner |
| **Agent Workers** | — | Python | Temporal workers; PydanticAI ReAct loop |
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
| **PostgreSQL** | 5433 | — | Primary store; KG tables; pgvector; RLS |
| **Redis** | 6379 | — | Session cache; rate limiting |

### Agent Event Stream (SSE)

All agent executions emit a structured event stream, consumed by Agent Studio's chat UI:

```
thinking    → "Processing your request..."
plan        → "Breaking into N sub-tasks..."
task_start  → {step_id, step_name}
tool_call   → {tool_name, tool_args}
tool_result → {tool_name, tool_result}
approval    → {approval_id, reason}   ← HITL gate; workflow pauses
text        → "Final response text"
done        → session terminal event
error       → {message}
```

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
   (liteStore)  (static DAG)      (static DAG)  (PydanticAI ReAct)
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

## 📋 Platform Walkthrough

### Building an Agent (Agent Studio)

#### Step 1 — Choose your tier

When creating an agent, the **Tier Picker** presents all three tiers with visual comparison cards showing speed, cost, and power indicators, example use-cases, and recommended defaults.

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

#### Step 2 — Fill in identity

- **Name** and **description**
- **Tags** (for search and filtering)
- **Model** (any model available in your LiteLLM config)
- **System prompt** (or use the AI Manifest Assistant to generate one)

#### Step 3 — Attach skills

Skills are pre-composed tool bundles with defined SOPs. Attach from the tenant catalog or system catalog. Each skill has a description, tool list, mutating flag, and approval policy.

#### Step 4 — Configure safety

- **Guardrails**: Select platform-provided content filters and compliance checks. All guardrails are individually toggleable; admin-managed ones are marked with a badge.
- **Hooks**: Attach pre/post-execution hooks (audit_log, cost_meter, hitl_intercept, rate_limit).

#### Step 5 — Review & create

Final summary shows tier badge, attached skills, guardrails, and execution limits. One click to create.

---

## 🧠 Knowledge Graph Workspace

The **Knowledge Graphs** section in Agent Studio lets domain architects design, visualize, and manage their tenant's knowledge graphs — the structural context that agents query during reasoning.

### KG Builder (AI-Assisted)

Describe your domain in plain English and the **KG-Architect system agent** builds the graph:

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

Real-time graph preview updates as each tool call executes.

### KG Visualizer

Interactive graph canvas with:
- Pan / zoom / node drag
- Node colors by entity type
- Edge labels for relationship types
- Click any node → inspect properties and connections
- "Traverse" button → expand N-hop subgraph
- Search entities by name, type, or property value
- Statistics panel: node counts, relationship distribution, densest nodes
- Export as JSON or PNG

### Agent-Callable KG Tools

Five system tools make KG data available to every agent:

| Tool | Description |
|------|-------------|
| `kg-create-graph` | Create a new domain knowledge graph |
| `kg-add-node` | Add typed entities with properties |
| `kg-add-edge` | Add typed relationships between entities |
| `kg-query` | Traverse graph with depth limits |
| `kg-search` | Semantic search via pgvector embeddings |

---

## 💡 Examples

### Example 1 — FAQ Bot (Lite tier)

A fast customer-facing assistant with no tool use.

```bash
# Create agent
curl -X POST http://localhost:8088/api/v1/agents \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme-corp" \
  -d '{
    "name": "FAQ Bot",
    "tier": "lite",
    "model": "gpt-4o-mini",
    "system_prompt": "You are a helpful customer support assistant for ACME Corp. Answer questions about our products concisely.",
    "skills": [],
    "execution_config": {
      "max_duration_seconds": 10,
      "max_tool_calls": 0,
      "max_tokens": 500,
      "max_cost_usd": 0.01
    }
  }'

# Chat with it via API Gateway
curl -X POST http://localhost:8080/api/v1/sessions \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: acme-corp" \
  -d '{
    "agent_id": "<agent-id>",
    "prompt": "What is your return policy?"
  }'
# Returns: {"workflow_id":"lite-wf-...", "status":"RUNNING"}
# Poll: GET /api/v1/sessions/{id}/poll
```

### Example 2 — Support Ticket Router (Workflow tier)

Routes tickets through a multi-step pipeline with an approval gate.

```json
{
  "name": "Support Router",
  "tier": "workflow",
  "model": "gpt-4o",
  "system_prompt": "You are a support ticket routing agent.",
  "skills": [
    {"name": "ticket-classifier", "version": "1.0"},
    {"name": "crm-updater", "version": "2.1"}
  ],
  "execution_config": {
    "max_duration_seconds": 300,
    "max_tool_calls": 20,
    "hitl_on_mutating": true,
    "steps": [
      {"id": "s1", "name": "Classify", "type": "skill", "skill_id": "ticket-classifier"},
      {"id": "s2", "name": "Approve Routing", "type": "approval",
       "approval_message": "Route this ticket to Tier 2?", "depends_on": ["s1"]},
      {"id": "s3", "name": "Update CRM", "type": "skill",
       "skill_id": "crm-updater", "depends_on": ["s2"]}
    ]
  }
}
```

### Example 3 — Incident Response Agent (Deep tier)

Autonomous SRE agent that queries KG topology and live MCP data.

```json
{
  "name": "SRE Incident Responder",
  "tier": "deep",
  "model": "gpt-4o",
  "system_prompt": "You are an autonomous SRE agent. When given an alert, use kg-query to understand service dependencies, then check MCP tools for live metrics. Synthesize root cause and recommend remediation.",
  "skills": [
    {"name": "incident-triage", "version": "1.0"},
    {"name": "k8s-remediation", "version": "1.2"}
  ],
  "execution_config": {
    "max_duration_seconds": 3600,
    "max_tool_calls": null,
    "planning_mode": "dynamic",
    "self_correction": true,
    "memory_cross_session": true,
    "hitl_on_mutating": true
  }
}
```

**Flow when triggered by a PagerDuty P1 alert:**
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

### Example 4 — Knowledge Graph Topology Query

Using the KG-Architect to build a fintech domain graph:

```
Architect: "We track portfolios. Each portfolio contains positions.
            Each position is in a security. Securities have a risk_score."

KG-Architect builds:
  • Entities: Portfolio, Position, Security
  • Relationships: contains (Portfolio→Position), held_in (Position→Security)
  • Properties: Security.risk_score, Portfolio.total_value

Agents can now call:
  kg-query(portfolio-id="P123", depth=3)
  → Returns full portfolio → position → security topology

  kg-search("high risk securities")
  → Vector search returns securities with risk_score > 8.0
```

### Example 5 — Multi-Agent Team

A team of specialized deep agents working in parallel:

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

## 🍳 Domain Cookbook System

Cookbooks are pre-built solution templates for vertical industries. Each cookbook contains:

```
infra/platform/cookbooks/<vertical>/
├── manifest.yaml              # Cookbook metadata and version
├── kg-schema.yaml             # Domain ontology (entity + relationship types)
├── agents/                    # Pre-built agent manifest templates
│   ├── manifest-sre-agent.yaml
│   └── manifest-oncall-agent.yaml
├── skills/                    # Domain-specific skill bundles
│   ├── incident-triage.yaml
│   └── k8s-remediation.yaml
├── mcp-recommendations.yaml   # Suggested external integrations
└── seed-kg.yaml               # Starter KG (common entities pre-populated)
```

**Import a cookbook (no-code):**
1. Agent Studio → Cookbooks
2. Select vertical (DevOps/SRE, Fintech, Healthcare)
3. One-click import → agent templates, skills, KG schema, seed KG created in your tenant
4. Customize system prompts and attach your MCP credentials
5. Deploy in < 2 hours

---

## 🔑 Key Features

### Durable Execution
All workflow and deep agent runs are backed by Temporal — resumable from last checkpoint after crashes, deployments, or network partitions. Lite agents trade durability for zero latency.

### Multi-Tenancy
- **PostgreSQL RLS**: Row-level security via `SET LOCAL app.tenant_id` — no cross-tenant data leakage
- **Redis Namespacing**: Per-tenant key prefixes for session and rate limit caches
- **Temporal Task Queues**: Per-tenant queues for isolation and independent scaling
- **Vector DB Partitioning**: Per-tenant pgvector embeddings

### Human-in-the-Loop (HITL)
Workflow and deep tier agents automatically pause execution on mutating tool calls and emit an `approval` event. Approved or rejected via:
- Agent Studio UI (real-time approval widget)
- Webhook integration (programmatic approval)
- Temporal signal (direct `approve_step` / `reject_step` signals)

### Guardrails & Hooks

**Guardrails** — Content and compliance filters configurable per agent:
- PII detection and redaction
- Harmful content filtering
- Prompt injection protection
- Custom regex/LLM-based checks

**Hooks** — Pre/post-execution middleware:
- `audit_log` — Immutable audit trail of every tool call and LLM invocation
- `cost_meter` — Per-agent, per-skill token and cost tracking
- `hitl_intercept` — Gate mutating operations behind human approval
- `rate_limit` — Per-tenant, per-agent request throttling

### AI-Assisted Agent Design (Manifest Assistant)

The **Manifest Assistant** is a platform system agent embedded in the Create Agent wizard. It:
1. Reads your tenant's live skill and tool catalog
2. Accepts a natural-language description of what your agent should do
3. Recommends a system prompt, relevant skills, and highlights capability gaps
4. Streams results via SSE; one-click applies to the form

### MCP Integration

Connect external data sources as Model Context Protocol (MCP) servers:
- Register per-tenant MCP endpoints (PagerDuty, GitHub, Jira, Datadog, Bloomberg)
- MCP Registry auto-discovers available tools from each server
- Agents call MCP tools exactly like platform tools — same Skill Dispatcher path
- Platform MCP Server (port 8091) exposes platform capabilities to external MCP clients

### Real-Time Streaming
- **Server-Sent Events**: `GET /api/v1/sessions/{id}/poll` streams thinking → tool_call → text → done events
- **WebSocket**: Full-duplex agent communication for interactive sessions
- Lite sessions and Temporal sessions share identical poll API — frontend unchanged

### Enterprise Security
- **HMAC Webhook Validation**: SHA-256 signed inbound events (disable with `WEBHOOK_HMAC_DISABLED=true` locally)
- **OIDC Token Issuance**: Industry-standard identity federation
- **JIT Credential Fetching**: Credentials retrieved at activity time, never stored at rest
- **Tenant Isolation**: Every resource scoped to a tenant; RLS enforced at database layer

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
│   ├── agent-workers/            # Temporal workers; PydanticAI ReAct loop
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

```bash
# Migrations run automatically on first docker compose up
# To apply a new migration manually:
psql -h localhost -p 5433 -U postgres -d agentplatform \
  -f infra/postgres/migrations/023_agent_tiers.sql

# Inspect with tenant context
psql -h localhost -p 5433 -U postgres -d agentplatform
SET LOCAL app.tenant_id = 'default-tenant';
SELECT id, name, tier, status FROM agents;
```

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

Open **http://localhost:8233** to:
- Browse workflow executions by status
- Inspect event histories step by step
- Check task queue depths
- Signal workflows (e.g., `approve_step`)

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

### LiteLLM Debug

```bash
# Check what models are configured
curl http://localhost:4000/v1/models \
  -H "Authorization: Bearer sk-litellm-dev"

# Test embedding
curl http://localhost:4000/v1/embeddings \
  -H "Authorization: Bearer sk-litellm-dev" \
  -H "Content-Type: application/json" \
  -d '{"model":"local-embedding","input":"knowledge graph search"}'
```

---

## 🏗️ Technology Stack

| Layer | Technology |
|-------|-----------|
| **Workflow orchestration** | Temporal (durable execution, HITL signals, task queues) |
| **LLM gateway** | LiteLLM (OpenAI-compatible; routes to any provider) |
| **Agent reasoning** | PydanticAI (deep/workflow tier ReAct loop) |
| **Backend services** | Go 1.22 (microservices, HTTP APIs) |
| **Agent workers** | Python 3.11 (Temporal SDK, PydanticAI, AsyncOpenAI) |
| **Frontend** | Next.js 14, React, Tailwind CSS, shadcn/ui |
| **Primary database** | PostgreSQL 15 + pgvector (state, KG, embeddings, RLS) |
| **Cache** | Redis 7 (session cache, rate limiting) |
| **Container runtime** | Docker Compose (local), Kubernetes/Helm (production) |
| **Observability** | Temporal UI, Streamlit dashboard, structured JSON logging |
| **Local models** | Ollama (llama3.1:8b, nomic-embed-text) |

---

## 🔒 Multi-Tenancy & Security

Every resource in A1 is **tenant-scoped** with multiple isolation layers:

1. **Database**: PostgreSQL RLS with `SET LOCAL app.tenant_id` — queries automatically filtered
2. **Cache**: Redis keys prefixed with `tenant:<id>:` — no cross-contamination
3. **Temporal**: Per-tenant task queues — one tenant's queue depth doesn't affect another
4. **Vectors**: pgvector rows include `tenant_id` column — semantic search never crosses tenants
5. **API**: All requests require `X-Tenant-ID` header — validated at API Gateway
6. **MCP Servers**: Per-tenant credentials for external integrations (PagerDuty, GitHub, etc.)

---

## 🎨 Design Decisions

### Three-Tier Agent Model
Not all agents need Temporal's overhead. Lite tier agents respond in < 2 s by running directly in-process. The same poll API is used for all tiers, so the frontend and api-gateway are unaware of the execution engine.

### Temporal as Primary Execution Engine
Workflow and deep tier agents use Temporal for crash recovery, HITL signaling, and operational visibility. The ~200 ms scheduling overhead is negligible against LLM call latency (typically 1–10 s).

### LiteLLM as Provider Gateway
All LLM traffic routes through LiteLLM, which provides a single OpenAI-compatible endpoint regardless of actual provider (Anthropic, OpenAI, Ollama, Azure). Provider switching requires only a config change.

### Skill Dispatcher as Tool Router
Direct tool execution is prohibited. All tool calls go through the Skill Dispatcher, which applies pre/post hooks (audit, cost, rate limit, HITL) consistently regardless of which agent or tier invoked the tool.

### pgvector for KG Semantic Search
Knowledge graph entity search uses pgvector embeddings stored in PostgreSQL alongside the graph tables. This avoids a separate vector database service while providing semantic search capabilities (e.g., "find services that depend on the cache layer").

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
