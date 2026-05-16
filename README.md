# A1 Agent Engine

**Enterprise Agentic PaaS** — A production-grade platform for building, deploying, and orchestrating AI-driven agent workflows with durable execution, multi-tenancy, domain-oriented knowledge graphs, and comprehensive observability.

## 🎯 Platform Vision

A1 Agent Engine transforms how enterprises build and operate AI-driven automation. It provides a **full-stack agentic solution factory** for vertical domains—enabling organizations to deploy sophisticated multi-agent systems in hours rather than weeks.

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ LAYER 3: DOMAIN SOLUTIONS (Cookbooks)                              │
│                                                                     │
│  DevOps/SRE Cookbook    Fintech Cookbook     Healthcare Cookbook  │
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
│  • RLS multi-tenancy      • No-code interaction• Custom APIs      │
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
│  • Custom APIs           • Versioning        • Parallelization    │
│  → Governed composition without lock-in                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Capabilities

**Core Platform Features:**
- **Agent Workflows** — Define AI agents with reasoning loops, memory, and tool access
- **Team Orchestration** — Coordinate multi-agent teams with parallel execution and result synthesis
- **Durable Execution** — All workflows backed by Temporal for crash recovery and HITL integration
- **Multi-Tenancy** — Tenant isolation via PostgreSQL RLS, Redis namespacing, and per-tenant Temporal queues
- **Tool Ecosystem** — Build and compose tools, organize into skills, version-control everything
- **Enterprise Security** — HMAC webhook validation, OIDC token issuance, JIT credential fetching
- **Real-Time Observability** — Stream agent events as Server-Sent Events or WebSocket, monitor via Temporal UI
- **AI-Assisted Agent Design** — Embedded Manifest Assistant helps no-code users design agent manifests conversationally

**Knowledge Graph Layer (NEW):**
- **Structural Domain Context** — PostgreSQL + pgvector knowledge graphs store entity types, relationships, and ontologies per tenant
- **KG-Architect Agent** — Natural-language interface for building and refining domain knowledge graphs; no schema design needed
- **Agent-Callable KG Tools** — Five system tools enable agents to query domain topology without external API calls: `kg-query`, `kg-search`, `kg-add-node`, `kg-add-edge`, `kg-create-graph`
- **Semantic Search** — pgvector enables meaning-based entity discovery (e.g., "services with SLA < 99%")

**Vertical Domain Cookbooks (NEW):**
- **Pre-Built Templates** — Domain-specific agent templates, skill bundles, and KG schemas for DevOps/SRE, Fintech, Healthcare, etc.
- **Seed Knowledge** — Each cookbook includes starter KG data (common entities, relationships) for faster onboarding
- **MCP Recommendations** — Curated external data source integrations (PagerDuty, Jira, Bloomberg) per vertical
- **One-Click Import** — Admin Console wizard guides architects through cookbook selection, customization, and deployment

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Go 1.22+
- Python 3.9+ with venv
- Node.js 18+ with npm
- Ollama for local model serving

### Local Ollama Models

The local stack routes all model traffic through LiteLLM on `http://localhost:4000`. For host-served Ollama, keep Ollama running on the host and Docker services will reach it through `http://host.docker.internal:11434`.

```bash
# Terminal 1: start Ollama if it is not already running
ollama serve

# Terminal 2: pull the default local models used by infra/local/litellm.config.yaml
ollama pull llama3.1:8b
ollama pull nomic-embed-text

# Start LiteLLM and the platform services
cd infra/local
docker compose up -d
```

Verify chat completion through LiteLLM:

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-litellm-dev" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "local-chat",
    "messages": [{ "role": "user", "content": "Say hello from Ollama." }]
  }'
```

Verify embeddings through LiteLLM:

```bash
curl http://localhost:4000/v1/embeddings \
  -H "Authorization: Bearer sk-litellm-dev" \
  -H "Content-Type: application/json" \
  -d '{ "model": "local-embedding", "input": "knowledge graph search" }'
```

Local chat and embedding aliases are configured in `infra/local/litellm.config.yaml`. Override them from `infra/local/.env` with `OLLAMA_CHAT_MODEL`, `OLLAMA_EMBEDDING_MODEL`, and `OLLAMA_API_BASE`. The memory and KG services store `VECTOR(1536)` values; local embeddings are padded or truncated to that dimension before pgvector operations.

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

## 🏗️ Platform Architecture

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

### Domain-Oriented Solution Factory: Cookbook System

The **Cookbook System** enables rapid deployment of domain-specific agentic solutions. Each cookbook is a production-ready template for a vertical (DevOps/SRE, Fintech, Healthcare, etc.).

```
┌──────────────────────────────────────────────────────────────────┐
│ COOKBOOK BUNDLE (infra/platform/cookbooks/<vertical>/)           │
│                                                                  │
│ ├─ manifest.yaml              Chef's recipe: cookbook metadata  │
│ │  └─ name, version, description, setup artifacts             │
│ │                                                               │
│ ├─ kg-schema.yaml             Domain ontology definition        │
│ │  └─ Entity types (Service, Deployment, Environment)         │
│ │  └─ Relationship types (depends_on, deployed_in, etc.)      │
│ │  └─ Property suggestions per entity type                    │
│ │                                                               │
│ ├─ agents/                    Pre-built agent templates         │
│ │  ├─ manifest-sre-agent.yaml SRE specialist (draft template) │
│ │  ├─ manifest-oncall-agent.yaml On-call responder            │
│ │  └─ ...                                                       │
│ │                                                               │
│ ├─ skills/                    Domain-specific skill bundles    │
│ │  ├─ incident-triage-skill.yaml Multi-tool investigation    │
│ │  ├─ remediation-skill.yaml    Automated fixes              │
│ │  └─ ...                                                       │
│ │                                                               │
│ ├─ mcp-recommendations.yaml   External data sources           │
│ │  └─ PagerDuty (incident management)                         │
│ │  └─ Datadog (metrics & logs)                                │
│ │  └─ GitHub (code & deployment context)                      │
│ │                                                               │
│ └─ seed-kg.yaml               Starter knowledge graph          │
│    └─ Common entities: prod/staging/dev environments          │
│    └─ Shared infrastructure: databases, caches, load-balancers│
│    └─ Team structure & ownership mappings                      │
└──────────────────────────────────────────────────────────────────┘
```

**Cookbook Lifecycle: Two-Actor Model**

**Platform Administrator (Admin Console):**
1. **Publish Cookbook**: Upload DevOps/SRE, Fintech, Healthcare cookbook bundles
   - Platform team defines agent templates, skill bundles, KG schemas, MCP recommendations
   - Cookbooks versioned and marked "ready for use"
   - Stored in `infra/platform/cookbooks/<vertical>/`

2. **Manage Global Resources**: System agents, skills, tools, and MCP endpoints
   - Configure LLM providers, secrets, audit policies
   - Register recommended MCP servers (PagerDuty, Datadog, etc.)
   - Tenant management and quotas

---

**Domain Architect (Agent Studio - No-Code):**
All within their **tenant workspace**:

1. **Browse & Import Cookbook** (Agent Studio → Cookbooks)
   - Select published cookbook (e.g., "DevOps/SRE v1.2.0")
   - One-click import into their tenant
   - Platform creates: agent templates, skills, KG schema (tenant-isolated)

2. **Build Domain KG** (Agent Studio → Knowledge Graphs → KG Builder)
   - Natural language: "We have 12 microservices. api-gateway depends on user-service and product-service. They share a Postgres cluster."
   - KG-Architect system agent iteratively calls kg-* tools to build graph
   - Real-time graph preview on right panel shows structure as you describe
   - Iteration history shows each step taken
   - Architect reviews, refines with follow-ups, and approves
   - Result: Production-ready KG in their tenant

**2b. Visualize & Explore KG** (Agent Studio → Knowledge Graphs → KG Visualizer)
   - Interactive graph visualization showing nodes and edges
   - Search entities by type, properties, or relationships
   - Click nodes to inspect properties and connected relationships
   - Traverse relationships: "show all services that depend on this one"
   - View KG statistics (node counts, relationship types, densest nodes)
   - Export graph as JSON or PNG for documentation

3. **Configure Tenant MCPs** (Agent Studio → Settings → External Integrations)
   - Register PagerDuty, Datadog, GitHub instances for their infrastructure
   - Token-gated access scoped to their tenant
   - MCP tools auto-discovered and cached

4. **Create Agents from Templates** (Agent Studio → Create Agent → From Cookbook)
   - Select cookbook template (e.g., "SRE Incident Triager")
   - Pre-populated with:
     - System prompt (customizable)
     - Skills (from cookbook, can modify)
     - KG context (their tenant's graph)
     - MCP integrations (their tenant's connections)
   - Deploy to canary/production

5. **Operate & Monitor** (Agent Studio → Executions)
   - Agents query KG + MCP in real-time
   - Monitor execution traces, costs, performance
   - Iterate on system prompt and skill composition
   - Configure webhooks/schedules for automation

### End-to-End: Domain Architect Deploys a DevOps Agentic Solution

**Example Workflow (start to finish in 2 hours):** All within Agent Studio (Architect's Tenant Workspace)

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: Import DevOps/SRE Cookbook (5 min)                     │
├─────────────────────────────────────────────────────────────────┤
│ LOCATION: Agent Studio → Cookbooks                             │
│                                                                 │
│ Architect selects "DevOps/SRE v1.2.0" cookbook                │
│ One-click import → Platform creates in their tenant:           │
│  ✓ 3 agent templates (SRE Triager, On-Call Responder, etc.)   │
│  ✓ 5 skill bundles (Incident Triage, K8s Remediation, etc.)  │
│  ✓ KG schema (Service, Deployment, Environment entities)       │
│  ✓ Starter KG with dev/staging/prod environments              │
│                                                                 │
│ All resources tenant-isolated (RLS enforced in DB)             │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Build Domain KG via KG-Architect (30 min)              │
├─────────────────────────────────────────────────────────────────┤
│ LOCATION: Agent Studio → KG-Architect Chat                     │
│                                                                 │
│ Architect: "We have 3 services. api-gateway depends on both    │
│            user-service and product-service. They share        │
│            Postgres. Each has a runbook."                      │
│                                                                 │
│ KG-Architect system agent calls kg-* tools:                    │
│  • kg-create-graph (DevOps-TechCorp)                           │
│  • kg-add-node × 3 (services)                                  │
│  • kg-add-node × 1 (shared postgres)                           │
│  • kg-add-edge × 3 (depends_on, uses_database)                │
│  • kg-query (verify structure)                                 │
│                                                                 │
│ Result: Tenant's KG ready with 4 nodes, 3 edges              │
│ (Architect can refine iteratively in chat)                     │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Register Tenant MCP Integrations (10 min)              │
├─────────────────────────────────────────────────────────────────┤
│ LOCATION: Agent Studio → Settings → External Integrations      │
│                                                                 │
│ Architect configures MCP connections:                          │
│  • PagerDuty: prod-pagerduty.example.com (token)              │
│  • Datadog: metrics.datadoghq.com (API key)                   │
│  • GitHub: github.com (PAT)                                    │
│                                                                 │
│ All connections are tenant-scoped                              │
│ MCP Registry auto-discovers available tools                    │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Create SRE Agent from Template (10 min)                │
├─────────────────────────────────────────────────────────────────┤
│ LOCATION: Agent Studio → Create Agent → From Cookbook          │
│                                                                 │
│ Select template: "SRE Incident Triager"                        │
│ Pre-populated automatically:                                    │
│  • System prompt: "You are an autonomous SRE agent..."         │
│  • Skills: Incident Triage, K8s Remediation, Log Analysis      │
│  • Tools: kg-query, kg-search (their tenant's KG)             │
│  • MCPs: PagerDuty, Datadog, GitHub (their credentials)       │
│  • Memory: Redis session + pgvector (tenant-isolated)          │
│                                                                 │
│ Architect fine-tunes system prompt                             │
│ Deploys to canary (10%)                                        │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Test Agent in Simulator (20 min)                       │
├─────────────────────────────────────────────────────────────────┤
│ LOCATION: Agent Studio → Agent Simulator                       │
│                                                                 │
│ Test message: "api-gateway returning 5xx errors"               │
│                                                                 │
│ Agent flow:                                                     │
│  1. kg-query(api-gateway, depth=2)                             │
│     → Returns: [user-service, product-service, postgres]       │
│                                                                 │
│  2. MCP call: PagerDuty.get_active_alerts(services=[...])     │
│     → Returns: 2 P1 alerts on product-service                 │
│                                                                 │
│  3. MCP call: Datadog.query_metrics(services=[...])           │
│     → Returns: postgres conn pool at 99%                       │
│                                                                 │
│  4. LLM synthesis:                                              │
│     "api-gateway failure cascades to downstream. Root cause:   │
│      postgres connection pool saturation. Recommend scaling    │
│      postgres or investigating long-running queries."          │
│                                                                 │
│ Architect reviews trace, iterates on system prompt             │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ Step 6: Promote to Production (5 min)                          │
├─────────────────────────────────────────────────────────────────┤
│ LOCATION: Agent Studio → Agent Settings                        │
│                                                                 │
│ Architect configures:                                          │
│  • Webhook: PagerDuty P1 alerts → Trigger agent               │
│  • Rollout: Canary 10% → 25% → 100% (24 hours)               │
│  • Auto-rollback if success rate drops > 10%                  │
│  • Cost budget: $500/month for this agent                      │
│                                                                 │
│ ✅ LIVE: SRE Agent responding to real incidents               │
│ (No Admin Console access needed by architect)                 │
└─────────────────────────────────────────────────────────────────┘
```

**Time Investment: ~2 hours → Production SRE automation team deployed**

**All within Agent Studio (no Admin Console required)**

(Without platform: weeks of prompt engineering, tool integration, testing)

## 🧠 Knowledge Graph Workspace (Agent Studio)

### Overview

The **Knowledge Graphs** workspace in Agent Studio is where domain architects design and manage their tenant's knowledge graphs. It's a dedicated section similar to "Agents", "Skills", and "Tool Registry", providing a complete KG development experience with AI-assisted building, interactive visualization, and management tools.

### Workspace Structure

```
Agent Studio (port 3000)
┌─────────────────────────────────────────────────────────┐
│ ☰ Dashboard  |  Agents  |  Skills  |  ◆ Knowledge Graphs│
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│ Knowledge Graphs Workspace                              │
├─────────────────────────────────────────────────────────┤
│ [Tabs: KG List | KG Builder | KG Visualizer]           │
└─────────────────────────────────────────────────────────┘
```

### Tab 1: KG List (Browse & Manage)

```
┌──────────────────────────────────────────────────────────────┐
│ Knowledge Graphs                    [+ Create New KG]        │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│ DevOps-Infra (v1.2.0)                              [Edit]    │
│ └─ Last updated: 2 hours ago | 15 nodes, 23 edges          │
│    Description: 3-tier microservices with shared databases  │
│    Status: ✓ Active                                          │
│    [View] [Visualize] [Export] [Delete]                     │
│                                                               │
│ Fintech-Trading (v1.0.0)                           [Edit]    │
│ └─ Last updated: 1 day ago | 28 nodes, 54 edges            │
│    Description: Portfolio assets and risk exposure mapping  │
│    Status: ✓ Active                                          │
│    [View] [Visualize] [Export] [Delete]                     │
│                                                               │
│ Healthcare-Patients (v0.5.0)                       [Draft]   │
│ └─ Last updated: 3 days ago | 5 nodes, 2 edges             │
│    Description: Patient records and care pathways           │
│    Status: ⊘ Draft (incomplete)                             │
│    [Continue Building] [Visualize] [Delete]                 │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Tab 2: KG Builder (Design via KG-Architect)

```
┌──────────────────────────────────────────────────────────────┐
│ KG Builder: DevOps-Infra                    [Save] [Discard] │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│ ┌─────────────────────────────┐  ┌─────────────────────────┐ │
│ │  KG-Architect Chat          │  │  Graph Preview          │ │
│ │                             │  │  ┌─────────────────────┐│ │
│ │ You: "We have 3 services.   │  │  │     api-gateway    ││ │
│ │ api-gateway depends on both │  │  │         ╱╲         ││ │
│ │ user-service and            │  │  │        ╱  ╲        ││ │
│ │ product-service. They share │  │  │   user-s  product-s││ │
│ │ a Postgres cluster."        │  │  │       │    │        ││ │
│ │                             │  │  │       └────┘        ││ │
│ │ KG-Architect: "I'll create  │  │  │      postgres       ││ │
│ │ this graph. Starting...     │  │  │                     ││ │
│ │ • Creating graph: DevOps-   │  │  │  ✓ 3 nodes added   ││ │
│ │   Infra                     │  │  │  ✓ 2 edges added   ││ │
│ │ • Adding api-gateway node   │  │  │  ⧖ Updating...     ││ │
│ │ • Adding user-service node  │  │  └─────────────────────┘│ │
│ │ • Adding product-service    │  │                         │ │
│ │   node                      │  │                         │ │
│ │ • Adding shared postgres    │  │                         │ │
│ │   node                      │  │                         │ │
│ │ • Creating dependencies...  │  │  ┌─────────────────────┐│ │
│ │                             │  │  │ Iteration History   ││ │
│ │ Done! Graph has 4 nodes and │  │  │ ─────────────────  ││ │
│ │ 3 edges. Continue refining? │  │  │ 1. kg-create-graph ││ │
│ │                             │  │  │ 2. kg-add-node ×4  ││ │
│ │ [Thumbs up] [Continue Chat] │  │  │ 3. kg-add-edge ×3  ││ │
│ │ [Undo] [Save & Exit]        │  │  │ [Undo] [Redo]     ││ │
│ │                             │  │  └─────────────────────┘│ │
│ │ [Type refinement...]        │  │                         │ │
│ │                             │  │                         │ │
│ └─────────────────────────────┘  └─────────────────────────┘ │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

**KG Builder Features:**

- **Left Panel (Chat Interface)**:
  - Real-time conversation with KG-Architect system agent
  - Streaming responses via SSE
  - Architect describes domain; agent suggests KG structure
  - Follow-ups to refine relationships and properties
  - Confirmation prompts before operations

- **Right Panel (Graph Preview)**:
  - Real-time visualization as changes are made
  - Shows nodes and edges being added
  - Highlights new additions with animation
  - Mini-map for navigation in large graphs
  - Statistics: current node/edge count

- **Bottom Panel (Iteration History)**:
  - Ordered list of operations performed
  - Each step shows: tool called, parameters, result
  - Undo/Redo buttons
  - Export iteration log for documentation

- **Top Actions**:
  - Save (persists KG to tenant database)
  - Discard (abandon session, revert to last saved)
  - Settings (rename KG, change schema, version)

### Tab 3: KG Visualizer (Browse & Explore)

```
┌──────────────────────────────────────────────────────────────┐
│ KG Visualizer: DevOps-Infra            [Search] [Stats] [Exp]│
├──────────────────────────────────────────────────────────────┤
│                                                               │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ Search: [Enter entity name or property...] [Filter by]  │ │
│ │         [Service ▼] [depends_on ▼]                      │ │
│ │                                                          │ │
│ │                   Graph Canvas                          │ │
│ │                                                          │ │
│ │            ◯ api-gateway (Service)                      │ │
│ │                 ╱ depends_on ╲                          │ │
│ │                ╱               ╲                        │ │
│ │         ◯ user-svc        ◯ product-svc                │ │
│ │                 ╲                ╱                      │ │
│ │              uses_database      ╱                       │ │
│ │                   ╲            ╱                        │ │
│ │                    ◯ postgres                           │ │
│ │                                                          │ │
│ │ [Pan] [Zoom] [Reset View]                               │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                               │
│ ┌─────────────────────────────┐  ┌──────────────────────────┐│
│ │ Node Inspector              │  │ Statistics               ││
│ │ ─────────────────           │  │ ──────────               ││
│ │ Selected: api-gateway       │  │ Total Nodes: 4           ││
│ │ Type: Service               │  │ Total Edges: 3           ││
│ │ Properties:                 │  │ Entity Types:            ││
│ │  • port: 8080              │  │  - Service: 3            ││
│ │  • tier: frontend          │  │  - Database: 1           ││
│ │ Connected To:               │  │ Relationship Types:      ││
│ │  → user-service            │  │  - depends_on: 2         ││
│ │     (depends_on)            │  │  - uses_database: 1      ││
│ │  → product-service          │  │ Densest Node:            ││
│ │     (depends_on)            │  │  postgres (2 edges)      ││
│ │ [Traverse] [Show Subgraph]  │  │                          ││
│ └─────────────────────────────┘  └──────────────────────────┘│
│                                                               │
│ [Export as JSON] [Export as PNG] [Download Report]           │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

**KG Visualizer Features:**

- **Graph Canvas** (Interactive D3.js/Cytoscape):
  - Pan, zoom, drag nodes
  - Node colors by entity type
  - Edge labels showing relationship types
  - Animations when exploring

- **Search & Filter Panel**:
  - Search entities by name
  - Filter by entity type (Service, Database, etc.)
  - Filter by relationship type (depends_on, uses_database, etc.)
  - Highlight search results

- **Node Inspector** (Right panel):
  - Click node → show all properties
  - List connected nodes with edge types
  - "Traverse" button → expand connected subgraph
  - "Show Subgraph" → highlight N hops away

- **Statistics Panel** (Right panel):
  - Node and edge counts
  - Entity type distribution
  - Relationship type breakdown
  - Densest nodes (most connections)

- **Export Options**:
  - JSON (for backup, version control, sharing)
  - PNG (for documentation, Slack, presentations)
  - Full report (stats + metadata + timestamp)

### Multi-KG Management

Architects can manage multiple KGs for different domains:

```
KG List showing:
✓ DevOps-Infra (Active)      — 15 nodes, 23 edges
✓ Fintech-Trading (Active)   — 28 nodes, 54 edges
⊘ Healthcare-Patients (Draft) — 5 nodes, 2 edges
```

Each KG is independent:
- Separate nodes and edges
- Separate import source (which cookbook)
- Separate schema and properties
- Separate access control (tenant-isolated)

### Workflow: From KG Builder to Agent Creation

```
1. KG Builder Chat
   ↓ (Architect describes domain)
   KG-Architect creates graph
   ↓ (Architect refines)
   Graph finalized & saved
   ↓
2. KG Visualizer
   (Architect explores structure)
   ↓ (Verify correctness)
   Ready for agent use
   ↓
3. Agent Studio → Create Agent
   (Agent gets access to KG context)
   [Pre-populated with kg-query, kg-search tools]
   ↓
4. Deploy & Operate
   (Agents query KG during reasoning)
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
| LLM Gateway | 8083 | Go | Current custom LLM provider proxy |
| LiteLLM Proxy | 4000 | Python | Experimental provider proxy for future migration |
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

### Knowledge Graph + Cookbook: The Power Combination

The KG layer and Cookbook system work together to enable rapid domain solution deployment:

| Aspect | Knowledge Graph | Cookbook |
|--------|-----------------|----------|
| **What it stores** | Structural domain topology (static) | Solution templates + seed KG (reusable) |
| **Who builds it** | Domain Architect (via KG-Architect) | Platform team (per vertical) |
| **Who uses it** | Agents (via kg-query, kg-search tools) | Customers (import → customize → deploy) |
| **Query patterns** | "What depends on X?" "Which services use Postgres?" | "Deploy SRE solution for our infrastructure" |
| **Lifecycle** | Evolves with domain (new services, relationships) | Versioned; released quarterly per vertical |
| **Data partition** | Per-tenant (RLS enforced) | Per-vertical (DevOps, Fintech, Healthcare) |
| **Complements** | MCP servers (live operational data) | Agent templates (reasoning capability) |

**Example: Incident Response Workflow**
```
1. PagerDuty Alert (MCP server) → Agent receives: "api-gateway 5xx"
                    │
                    ▼
2. Agent calls kg-query(api-gateway, depth=2)
   KG returns: depends-on relationships
              → [user-service, product-service]
                    │
                    ▼
3. Agent calls Datadog MCP (live)
   Returns: active alerts on product-service
                    │
                    ▼
4. Agent synthesizes:
   KG (static topology) + MCP (live data) = Incident intelligence
   → Posts: "api-gateway failure cascades to downstream.
             Product-service has 2 active P1 alerts. Root cause likely in postgres."
```

**Why This Matters:**
- **Agents reason with full context**: KG provides "what is the structure" + MCP provides "what is happening now"
- **No external API calls for topology**: KG is in-database; agents get instant responses without rate limits
- **Domain-specific in minutes**: Cookbook templates eliminate setup friction; architects focus on customization, not configuration
- **Multi-tenant by design**: Every customer gets isolated KG; RLS ensures data never leaks between tenants
- **Semantic search**: pgvector enables meaning-based entity discovery ("services with < 99% SLA")

---

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

The platform includes a **Knowledge Graph (KG)** system for storing, querying, and visualizing structural domain context:

- **KG Service** (`services/kg-service`, port 8093): PostgreSQL-backed graph storage with semantic search via pgvector. Provides HTTP APIs for CRUD operations (graphs, nodes, edges) and traversal queries.

- **KG System Tools**: Five platform tools for agent-callable KG operations:
  - `kg-create-graph` — Create a new domain knowledge graph
  - `kg-add-node` — Add typed entities to graphs
  - `kg-add-edge` — Add relationships between entities
  - `kg-query` — Traverse graph relationships with depth limits
  - `kg-search` — Semantic search on node properties (pgvector)

- **KG-Architect System Agent**: Platform agent for natural-language knowledge graph construction. Architects describe domain structure conversationally; the agent builds the KG via tool invocations.

- **KG Visualization & Browse Interface** (Agent Studio): Interactive graph visualization allowing architects to:
  - See nodes and edges rendered as interactive diagrams
  - Search/filter entities by type, properties, or relationships
  - Inspect entity properties and relationships
  - Traverse the graph ("show all services depending on this one")
  - View statistics (entity counts, relationship types, graph density)
  - Export as JSON or PNG

- **Multi-Tenant Isolation**: Knowledge graphs are tenant-scoped via PostgreSQL RLS policies (`tenant_id` column). Agents can only access their tenant's KGs; visualization enforces tenant boundaries.

**Key Benefits:**
- Agents access domain topology without external API calls
- Architects visualize and understand domain structure before deploying agents
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
