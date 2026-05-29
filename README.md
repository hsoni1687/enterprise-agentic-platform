<div align="center">

# 🤖 Enterprise Agentic Platform

### Build production AI agents in seconds — by composition, not code.

A multi-tenant, self-hostable **Agent PaaS**: assemble agents from reusable primitives
(tools · skills · guardrails · hooks · knowledge graphs · MCP servers) in a no-code builder,
and run them on a **durable, governed execution engine** with human-in-the-loop, row-level
tenant isolation, and end-to-end observability built in.

`Go` · `Python` · `Temporal` · `PostgreSQL + pgvector` · `Next.js` · `LiteLLM` · `Langfuse`

[Quick Start](#-quick-start-5-minutes) ·
[How It Works](#-how-it-works) ·
[Architecture](#-architecture) ·
[Primitives](#-the-building-blocks-primitives) ·
[Security](#-enterprise-security)

</div>

---

## ✨ Why this platform

Most teams rebuild the same agent plumbing over and over: an execution loop, tool routing,
retries, approvals, secrets, tenant isolation, tracing. **This platform makes that the substrate,
so the only thing you build is the agent — by clicking primitives together.**

> **The product is composition.** New behaviour is a new *parameter on a primitive* or a *new
> primitive*, never a fork in the engine. Anything that varies between two agents is
> **configuration**, not a code change.

| Without a platform | With this platform |
|---|---|
| Hand-roll an agent loop per project | One **governed** loop, shared by every agent |
| Copy-paste auth / rate-limit / PII checks into each tool | Attach **guardrails & hooks** declaratively |
| Bolt on approvals later | **Human-in-the-loop** is a first-class gate |
| Hope a forgotten `WHERE` doesn't leak tenants | **Postgres RLS** enforces isolation in the database |
| "Why did the agent do that?" | Every step is a **structured event + trace** |

---

## 🚀 Create an agent in seconds

In **Agent Studio** (the no-code builder), an agent is just a manifest you assemble with clicks:

```yaml
name: incident-responder
system_prompt: "You triage production incidents and propose fixes."
model: claude-sonnet            # any model, via LiteLLM
skills:        [search-runbook, query-metrics]   # reusable tool bundles
tools:         [bash, web-search]                 # governed primitives
knowledge_graph_ids: [sre-ontology]               # domain context (pgvector)
mcp_servers:   [pagerduty, github]                # external integrations
guardrails:    [block-secrets, pii-redact]        # cross-cutting safety
hooks:         [hitl-on-mutating, audit-log]      # approval + audit
```

Click **Create** → the agent is live behind a stable API and a streaming chat UI.
No redeploy, no code. The same manifest is portable across tenants.

---

## 🧠 How It Works

The platform runs **one execution strategy for every agent: a governed ReAct loop** — the model reasons,
calls a tool, observes the result, and repeats until it answers. This is the Claude-Code-style
design: *the model orchestrates; the platform governs.*

```
         ┌──────────────── Context assembly (parallel) ────────────────┐
 run ───▶│  memory · skills · system tools · MCP tools · KG · guardrails · hooks │
         └───────────────────────────────┬─────────────────────────────┘
                                          ▼
                          ┌───────────────────────────────┐
                          │   ReAct loop (model-driven)     │  reason → act → observe → repeat
                          │   the LLM decides each step      │
                          └───────────────┬─────────────────┘
                                          │ EVERY tool call passes through
        ┌──────────────────────────────────▼──────────────────────────────────┐
        │  Governed tool chokepoint (applied uniformly, once):                  │
        │  input guardrail → pre-hook → HITL gate → EXECUTE → output guardrail → │
        │  post-hook → telemetry / cost → event emit                            │
        └────────────────────────────────────────────────────────────────────────┘
```

Why this matters:

- **Safety is a property of the chokepoint, not the agent.** Guardrails, hooks, and approvals
  wrap *every* tool call — an agent structurally *cannot* bypass them.
- **Durable by default.** The loop runs as a [Temporal](https://temporal.io) workflow: it
  survives worker restarts, retries transient failures, and resumes exactly where it left off —
  including pausing for hours on a human approval.
- **Streamed & observable.** Each step emits a structured event (`thinking`, `tool_call`,
  `approval`, `text`, `done`) over SSE to the UI, and a full trace to Langfuse.

---

## 🧩 The Building Blocks (Primitives)

Everything an agent is made of is a registered, reusable, versioned primitive. Build once,
compose into any agent, in any tenant.

| Primitive | What it is | Example |
|---|---|---|
| 🔧 **Tool** | A single capability with a JSON-schema contract, auth level, sandbox policy | `bash`, `web-search`, `kg-search`, your custom API |
| 📦 **Skill** | A bundle of tools + an SOP (standard procedure) + pre/post hooks | `search-runbook`, `triage-ticket` |
| 🛡️ **Guardrail** | A cross-cutting input/output policy, attached declaratively | `block-secrets`, `pii-redact` |
| 🪝 **Hook** | Middleware around tool execution: audit, rate-limit, **HITL approval** | `hitl-on-mutating`, `audit-log` |
| 🕸️ **Knowledge Graph** | Tenant-scoped entities/relationships with pgvector semantic search | `sre-ontology`, `product-catalog` |
| 🔌 **MCP Server** | A [Model Context Protocol](https://modelcontextprotocol.io) integration | PagerDuty, GitHub, Jira |
| 🤝 **Sub-Agent** | A reusable agent contract that other agents can delegate to | `code-reviewer`, `researcher` |

> Need new behaviour? Add a parameter to a primitive or register a new one — the builder picks
> it up automatically. The engine never changes.

---

## 🏗️ Architecture

A loosely-coupled service fleet. Services talk over explicit HTTP contracts and **never reach
into each other's databases** — multi-tenancy is enforced at the data layer.

```
 User / Webhook
      │  (HMAC-verified, idempotent)
      ▼
┌─────────────┐     ┌────────────────────┐     ┌──────────────────────────┐
│ API Gateway │────▶│ Workflow Initiator │────▶│  Agent Workers (Temporal) │
│   (SSE)     │     │  (Temporal client) │     │   the governed ReAct loop │
└─────────────┘     └────────────────────┘     └────────────┬──────────────┘
                                                             │ tool calls
                              ┌──────────────────────────────┼───────────────────────┐
                              ▼                ▼              ▼            ▼            ▼
                        Skill Dispatcher  Tool Registry  KG Service  MCP Registry  Guardrail/Hook
                                                                                     engine
   Backing services:  PostgreSQL (pgvector, RLS) · Redis · Temporal · LiteLLM · Langfuse
```

### Service topology

| Service | Port | Lang | Role |
|---|---|---|---|
| **API Gateway** | 8080 | Go | Entry point · HMAC verify · idempotency · SSE stream |
| **Workflow Initiator** | 8081 | Go | Dispatches the agent workflow on Temporal · HITL approvals |
| **Agent Workers** | — | Python | Temporal workers running the governed ReAct loop |
| **Agent Registry** | 8088 | Go | Agent manifest storage & versioning |
| **Tool Registry** | 8086 | Go | Tool registration, versioning, security review |
| **Skill Catalog** | 8087 | Go | Skill composition & lifecycle |
| **Skill Dispatcher** | 8085 | Go | Governed tool routing & execution |
| **Sub-Agent Registry** | 8084 | Go | Reusable sub-agent contracts |
| **KG Service** | 8093 | Go | Knowledge-graph CRUD, traversal, semantic search |
| **MCP Registry / Server** | 8090 / 8091 | Go | External MCP hub (client) · platform MCP endpoint |
| **Sandbox Manager** | 8082 | Go | Ephemeral container lifecycle for code/bash tools |
| **Admin API** | 8089 | Go | Platform governance & tenant management |
| **Agent Studio** | 3000 | Next.js | No-code builder · agent simulator · ops views |
| **Admin Console** | 3001 | Next.js | Platform administration |
| **LiteLLM** | 4000 | — | Unified, OpenAI-compatible model gateway (cloud + local) |
| **Langfuse** | 3002 | — | LLM tracing & observability |
| **Temporal** | 7233/8233 | — | Durable workflow engine |
| **PostgreSQL** | 5433 | — | `agentplatform` (pgvector + RLS) · `litellm` |
| **Redis** | 6379 | — | Cache · rate limiting |

### Event stream (SSE)

Every run emits a structured stream consumed by the chat UI and persisted for the Logs view:

```
thinking   → the model's live reasoning
tool_call  → { tool_name, tool_args, tool_result }
approval   → { approval_id, reason }   ← HITL gate: the durable workflow pauses here
text       → final answer
done       → terminal event  (always emitted — success, failure, or crash)
```

---

## ⚡ Quick Start (5 minutes)

### Prerequisites
- Docker + Docker Compose
- Node.js 18+ (for the two frontends, which run on the host for hot-reload)
- An LLM key (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) **or** [Ollama](https://ollama.com) for fully local models

### 1 · Configure
```bash
cd infra/local
cp .env.example .env
# Edit .env — add an LLM API key, or point at a local Ollama model
```

### 2 · Start the backend (everything in Docker)
```bash
docker compose up -d           # Temporal, Postgres, Redis, LiteLLM, Langfuse + all services
# Migrations run automatically; the seeder loads demo agents, skills, and tools.
```

### 3 · Start the frontends (on host)
```bash
# Terminal A
cd apps/agent-studio && npm install && npm run dev     # → http://localhost:3000

# Terminal B
cd apps/admin-console && npm install && npm run dev    # → http://localhost:3001
```

### 4 · Build & run your first agent (no code)
1. Open **Agent Studio** → **New Agent**.
2. Pick a model, write a system prompt, and click to attach skills / tools / guardrails / a knowledge graph.
3. Hit **Create**, then **Chat** — watch the reasoning, tool calls, and any approval gates stream live.

Or drive it via the API:

```bash
curl -X POST http://localhost:8080/api/v1/agents/incident-responder/trigger \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: default-tenant" \
  -d '{"prompt": "Investigate the latency spike on checkout-svc", "idempotency_key": "run-001"}'
# → { "workflow_id": "...", "run_id": "...", "status": "RUNNING" }
```

---

## 🔐 Enterprise Security

- **Tenant isolation enforced in the database.** Tenant-scoped tables use PostgreSQL
  **Row-Level Security**: services connect as a non-superuser role and set the tenant per
  transaction, so a forgotten `WHERE` clause **cannot** leak another tenant's data — isolation
  is structural, not a convention.
- **Human-in-the-loop.** Mutating tool calls can require approval; the durable workflow pauses
  (for up to hours) until an operator approves or denies, scoped to their tenant.
- **Idempotent ingress.** Webhook/API triggers are deduplicated with an atomic
  reserve-then-complete key, shared across replicas.
- **Signed webhooks** (HMAC) and **sandboxed** code/bash execution.
- **Secrets** via environment/secret-manager — never in the repo.

---

## 🛠️ Development

```bash
# Backing services in Docker, individual Go services with hot-reload (air):
cd infra/local && docker compose up -d postgres redis temporal litellm
cd services/api-gateway       && air      # :8080
cd services/workflow-initiator && air     # :8081
cd services/agent-workers     && python -m main   # Temporal worker

# Tests
go test ./...           # per Go module (or with the workspace)
```

**Database migrations** apply automatically on startup. To add one, drop a new
`infra/postgres/migrations/NNN_name.sql` file — the runner applies only new files and refuses to
re-run modified ones (fix forward, never edit an applied migration).

```
services/    # Go + Python microservices (the fleet)
apps/        # Next.js frontends (agent-studio, admin-console)
packages/    # Shared libraries (go-shared, hook-engine, webhook-security, py-agent-core)
infra/       # docker-compose, Postgres migrations, k8s/Helm, platform seeds
```

---

## 🗺️ Roadmap

- [ ] Stream run events to a durable log + cursor reads (keep workflow history lean)
- [ ] Per-agent execution policy (retry/iteration budgets) as first-class config
- [ ] Cost metering & per-tenant budgets enforced as a hook
- [ ] Platform-vs-tenant role split for cross-tenant admin/MCP services

---

## 🤝 Contributing

Issues and PRs welcome. The one rule that keeps the platform a platform:

> **Customisation as config is a feature; customisation as code is debt.**
> If a change can't be reused by the next tenant, it probably belongs in a primitive's
> configuration — not in the engine.

<div align="center">
<sub>Built as a study in doing agentic infrastructure <i>right</i>: composable primitives,
one governed execution loop, tenant safety by construction.</sub>
</div>
