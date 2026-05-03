# A1 Agent Engine: Project-Specific Guidelines

## Quick Setup

```bash
# Terminal 1: Docker backing services
cd infra/local && docker-compose up -d

# Terminal 2-6: Run services locally with hot-reload
cd apps/agent-studio && npm run dev              # Frontend on :3000
cd apps/admin-console && npm run dev             # Frontend on :3001
cd services/mcp-registry && air                  # MCP Registry on :8090
cd services/api-gateway && air                   # API Gateway on :8080
cd services/workflow-initiator && air            # Workflow Initiator on :8081
cd services/agent-workers && python -m temporal.worker  # Temporal workers
```

## Service Port Convention

- **8080**: API Gateway (entry point)
- **8081**: Workflow Initiator (Temporal dispatcher)
- **8082–8088**: Platform services (registries, dispatchers)
- **8089**: Admin API
- **8090**: MCP Registry (MCP server hub)
- **3000**: Agent Studio frontend
- **3001**: Admin Console frontend

## Key Patterns

### Frontend on Host Only
Agent Studio and Admin Console run on host (`npm run dev`), NOT in Docker. Backends are in Docker.
This enables rapid iteration with HMR and debugger attachment.

### All Execution via Temporal
All agent workflows go through Temporal (`workflow-initiator` → `agent-workers`).
No direct async goroutines or background job queues.

### Secrets & Config
- `.env` in `infra/local/` — Docker build-time config
- `WEBHOOK_HMAC_DISABLED=true` for local dev only (never in prod)
- Database: `SET LOCAL app.tenant_id = 'default-tenant'` for RLS

### Multi-tenancy via PostgreSQL RLS
Every resource (agent, skill, tool) belongs to a tenant.
RLS enforced at DB layer; never bypass with raw SQL.

### Tool Invocation
All tool calls route through Skill Dispatcher.
Direct tool execution is prohibited.

## Enforcement Rules (Non-Negotiable)

1. **TDD Mandatory** — Write tests before code; verify integration before merge
2. **Temporal Durable** — All agent execution via Temporal workflows only
3. **RLS Always** — Never bypass PostgreSQL RLS policies
4. **No Direct Tool Calls** — Route all tools through Skill Dispatcher
5. **No Secrets in Git** — Use AWS Secrets Manager in prod
6. **HMAC Validation** — Enabled except locally with explicit env var
7. **Surgical Precision** — Only modify code strictly related to the task; no drive-by refactoring

## Project Structure

```
services/          # Go/Python microservices
apps/              # Next.js frontends (agent-studio, admin-console)
packages/          # Shared code (go-shared, shared-protos, webhook-security, team-sdk)
infra/
├── local/         # docker-compose for local dev
├── postgres/      # Migrations and schema
├── k8s/           # Kubernetes: Helm charts (per-service) + env overrides (staging/prod)
└── terraform/     # AWS infrastructure (EKS, RDS, etc.)
```

## Documentation

- **[README.md](../../README.md)** — Project overview, setup, quick start
- **[architecture.md](../../architecture.md)** — System design, data flow, decisions
- **[requirements.md](../../requirements.md)** — Feature spec, SLOs, admin requirements
- **[Temporal Docs](https://docs.temporal.io)** — Workflow patterns, SDKs
