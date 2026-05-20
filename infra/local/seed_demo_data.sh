#!/bin/bash
# =============================================================================
# Demo data seeder for default-tenant (idempotent)
#
# Seeds:
#   1. Three ready-to-chat demo agents under default-tenant
#   2. A "Platform Architecture" knowledge graph with services & relationships
#
# Designed to run on every `docker compose up` — safe to re-run.
# Uses python3 for clean JSON handling (same pattern as other seed scripts).
#
# Usage (host):
#   bash infra/local/seed_demo_data.sh
#
# Usage (inside seeder container):
#   sh /seed_demo_data.sh
# =============================================================================
set -e

AGENT_REGISTRY="${AGENT_REGISTRY_URL:-http://localhost:8088}"
KG_SERVICE="${KG_SERVICE_URL:-http://localhost:8093}"
TENANT="default-tenant"

echo "=========================================="
echo "Seeding Demo Data for default-tenant"
echo "Agent Registry: $AGENT_REGISTRY"
echo "KG Service    : $KG_SERVICE"
echo "Tenant        : $TENANT"
echo "=========================================="

# ---------------------------------------------------------------------------
# Wait for services to be ready
# ---------------------------------------------------------------------------
echo ""
echo "[1/3] Waiting for services..."
for i in $(seq 1 60); do
  if curl -sf "$AGENT_REGISTRY/health" >/dev/null 2>&1; then
    echo "✓ agent-registry ready"
    break
  fi
  printf "  agent-registry not ready yet (attempt %d/60)...\n" "$i"
  sleep 2
  if [ "$i" -eq 60 ]; then
    echo "✗ agent-registry never became ready"
    exit 1
  fi
done

for i in $(seq 1 60); do
  if curl -sf "$KG_SERVICE/health" >/dev/null 2>&1; then
    echo "✓ kg-service ready"
    break
  fi
  printf "  kg-service not ready yet (attempt %d/60)...\n" "$i"
  sleep 2
  if [ "$i" -eq 60 ]; then
    echo "✗ kg-service never became ready — skipping KG seeding"
    KG_SERVICE=""
    break
  fi
done

# ---------------------------------------------------------------------------
# 2. Demo Agents
# ---------------------------------------------------------------------------
echo ""
echo "[2/3] Seeding demo agents..."

python3 << SEED_AGENTS
import json
import subprocess
import sys
import os

AGENT_REGISTRY = os.environ.get("AGENT_REGISTRY_URL", "http://localhost:8088")
TENANT = "default-tenant"

AGENTS = [
    {
        "id": "demo-general-assistant",
        "name": "General Assistant",
        "version": "1.0.0",
        "model": "local-chat",
        "max_iterations": 15,
        "memory_budget_mb": 128,
        "system_prompt": (
            "You are a helpful, friendly, and knowledgeable general-purpose assistant. "
            "You can answer questions on a wide range of topics including science, history, "
            "technology, culture, and everyday tasks. "
            "Be concise but thorough. If you are unsure about something, say so clearly. "
            "When given a multi-step task, break it down and work through it step by step. "
            "Format your responses with markdown when it improves readability."
        ),
    },
    {
        "id": "demo-code-helper",
        "name": "Code Helper",
        "version": "1.0.0",
        "model": "local-chat",
        "max_iterations": 20,
        "memory_budget_mb": 256,
        "system_prompt": (
            "You are an expert software engineer and coding assistant. "
            "You can help with writing, debugging, reviewing, and explaining code in any language. "
            "When writing code, always follow best practices: "
            "  - Write clean, readable, well-commented code "
            "  - Handle edge cases and errors gracefully "
            "  - Prefer idiomatic patterns for the language "
            "  - Suggest tests when relevant "
            "When debugging, ask clarifying questions if needed and explain your reasoning. "
            "Always wrap code blocks in the appropriate markdown code fences."
        ),
    },
    {
        "id": "demo-data-analyst",
        "name": "Data Analyst",
        "version": "1.0.0",
        "model": "local-chat",
        "max_iterations": 20,
        "memory_budget_mb": 256,
        "system_prompt": (
            "You are a skilled data analyst and SQL expert. "
            "You help users understand their data, write SQL queries, interpret results, "
            "and generate actionable insights. "
            "Your capabilities include: "
            "  - Writing and optimizing SQL queries (PostgreSQL, MySQL, Snowflake) "
            "  - Explaining query results in plain language "
            "  - Suggesting data visualizations and charts "
            "  - Identifying trends, outliers, and patterns "
            "  - Designing data models and schemas "
            "Always validate your logic step by step and explain your assumptions. "
            "When given sample data, use it to give concrete, specific answers."
        ),
    },
]


def curl(method, url, headers=None, body=None):
    cmd = ["curl", "-s", "-X", method, url]
    for k, v in (headers or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    if body:
        cmd += ["-d", json.dumps(body)]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return result.stdout


def create_and_activate(agent):
    agent_id = agent["id"]
    agent_name = agent["name"]

    # Check if already exists
    existing = curl("GET", f"{AGENT_REGISTRY}/api/v1/agents/{agent_id}",
                    headers={"X-Tenant-ID": TENANT})
    if f'"id":"{agent_id}"' in existing:
        print(f"  ~ {agent_name} already exists — skipping")
        return True

    print(f"  + Creating {agent_name} ({agent_id})...")

    # Create
    resp = curl("POST", f"{AGENT_REGISTRY}/api/v1/agents",
                headers={"Content-Type": "application/json", "X-Tenant-ID": TENANT},
                body={**agent, "skills": []})

    if f'"id":"{agent_id}"' not in resp and "already exists" not in resp and "duplicate" not in resp.lower():
        print(f"    ✗ Create failed: {resp[:200]}")
        return False
    print(f"    ✓ Created")

    # Stage
    curl("POST", f"{AGENT_REGISTRY}/api/v1/agents/{agent_id}/transition",
         headers={"Content-Type": "application/json", "X-Tenant-ID": TENANT},
         body={"target_state": "staged", "actor": "demo-seed"})
    print(f"    ✓ Staged")

    # Activate
    curl("POST", f"{AGENT_REGISTRY}/api/v1/agents/{agent_id}/transition",
         headers={"Content-Type": "application/json", "X-Tenant-ID": TENANT},
         body={"target_state": "active", "actor": "demo-seed"})
    print(f"    ✓ Active")
    return True


seeded = 0
for ag in AGENTS:
    if create_and_activate(ag):
        seeded += 1

print(f"\n  ✓ {seeded}/{len(AGENTS)} demo agents ready")
SEED_AGENTS

# ---------------------------------------------------------------------------
# 3. Demo Knowledge Graph
# ---------------------------------------------------------------------------
echo ""
echo "[3/3] Seeding demo knowledge graph..."

if [ -z "$KG_SERVICE" ]; then
  echo "  ⚠ KG service unavailable — skipping knowledge graph seed"
  echo ""
  echo "=========================================="
  echo "✓ Demo data seeded (agents only — KG skipped)"
  echo "=========================================="
  exit 0
fi

python3 << SEED_KG
import json
import subprocess
import sys
import os

KG_SERVICE = os.environ.get("KG_SERVICE_URL", "http://localhost:8093")
TENANT = "default-tenant"
GRAPH_NAME = "Platform Architecture"

NODES = [
    {"label": "API Gateway",          "node_type": "Service",  "properties": {"port": "8080", "role": "entry-point", "lang": "Go",        "description": "Single entry point for all client requests, routes to Workflow Initiator"}},
    {"label": "Workflow Initiator",   "node_type": "Service",  "properties": {"port": "8081", "role": "dispatcher",  "lang": "Go",        "description": "Validates agent manifests and dispatches Temporal workflow executions"}},
    {"label": "Agent Registry",       "node_type": "Service",  "properties": {"port": "8088", "role": "registry",    "lang": "Go",        "description": "Stores agent manifests, versions, and lifecycle states"}},
    {"label": "Agent Workers",        "node_type": "Service",  "properties": {"role": "executor", "lang": "Python", "description": "Temporal workflow workers that execute agent steps using LLM + tools"}},
    {"label": "LiteLLM Proxy",        "node_type": "Service",  "properties": {"port": "4000", "role": "llm-gateway", "lang": "Python",    "description": "Unified LLM API gateway supporting Anthropic, OpenAI, and local Ollama models"}},
    {"label": "Temporal",             "node_type": "Service",  "properties": {"port": "7233", "role": "orchestrator","lang": "Go",        "description": "Durable workflow orchestration engine — guarantees exactly-once execution"}},
    {"label": "PostgreSQL",           "node_type": "Database", "properties": {"port": "5432", "role": "primary-db",  "engine": "pg16",    "description": "Primary relational store with pgvector extension for embeddings and RLS for multi-tenancy"}},
    {"label": "KG Service",           "node_type": "Service",  "properties": {"port": "8093", "role": "knowledge",   "lang": "Go",        "description": "Knowledge graph storage, semantic search, and graph-based context retrieval"}},
    {"label": "Skill Catalog",        "node_type": "Service",  "properties": {"port": "8087", "role": "catalog",     "lang": "Go",        "description": "Registry of skills (tool compositions) available to agents"}},
    {"label": "Skill Dispatcher",     "node_type": "Service",  "properties": {"port": "8085", "role": "dispatcher",  "lang": "Go",        "description": "Executes skill invocations and routes tool calls to appropriate backends"}},
    {"label": "Tool Registry",        "node_type": "Service",  "properties": {"port": "8086", "role": "registry",    "lang": "Go",        "description": "Central registry of all available tools (web-search, bash, http-request, etc.)"}},
    {"label": "MCP Registry",         "node_type": "Service",  "properties": {"port": "8090", "role": "mcp-hub",     "lang": "Go",        "description": "Model Context Protocol server hub — connects agents to external MCP servers"}},
    {"label": "Admin API",            "node_type": "Service",  "properties": {"port": "8089", "role": "admin",       "lang": "Go",        "description": "Administrative API for platform management, system tool/skill registration"}},
    {"label": "Agent Studio",         "node_type": "Frontend", "properties": {"port": "3000", "role": "ui",          "lang": "Next.js",   "description": "Main developer-facing UI for chatting with agents, managing models, and viewing KGs"}},
    {"label": "Admin Console",        "node_type": "Frontend", "properties": {"port": "3001", "role": "ui",          "lang": "Next.js",   "description": "Admin-facing UI for platform administration, tenant management, and monitoring"}},
]

EDGES = [
    # Request flow
    ("API Gateway",        "Workflow Initiator",  "routes_to",         {"description": "Forwards chat/run requests for agent execution"}),
    ("Workflow Initiator", "Temporal",            "dispatches_to",     {"description": "Starts durable Temporal workflows for agent runs"}),
    ("Workflow Initiator", "Agent Registry",      "fetches_manifest",  {"description": "Retrieves agent definition before dispatching"}),
    ("Agent Workers",      "Temporal",            "polls",             {"description": "Subscribes to Temporal task queues (one per tenant)"}),
    # Inference path
    ("Agent Workers",      "LiteLLM Proxy",       "calls_llm",         {"description": "All LLM calls route through LiteLLM for unified API + spend tracking"}),
    # Knowledge & skills
    ("Agent Workers",      "KG Service",          "queries_graph",     {"description": "Retrieves graph context to augment agent reasoning"}),
    ("Agent Workers",      "Skill Dispatcher",    "invokes_skill",     {"description": "Executes skills (tool compositions) during agent steps"}),
    ("Skill Dispatcher",   "Skill Catalog",       "resolves_skill",    {"description": "Looks up skill definition before execution"}),
    ("Skill Dispatcher",   "Tool Registry",       "fetches_tool",      {"description": "Retrieves tool schema for validation and execution routing"}),
    ("Skill Catalog",      "MCP Registry",        "delegates_mcp",     {"description": "Routes MCP-backed skills to the MCP Registry hub"}),
    # Persistence
    ("LiteLLM Proxy",      "PostgreSQL",          "persists_spend",    {"description": "Stores per-request spend data for cost tracking"}),
    ("Agent Registry",     "PostgreSQL",          "persists_data",     {"description": "Stores agent manifests, versions, and state transitions"}),
    ("Skill Catalog",      "PostgreSQL",          "persists_data",     {"description": "Stores skill definitions and tenant assignments"}),
    ("Tool Registry",      "PostgreSQL",          "persists_data",     {"description": "Stores tool schemas and metadata"}),
    ("KG Service",         "PostgreSQL",          "persists_data",     {"description": "Stores graph nodes, edges, and vector embeddings (pgvector)"}),
    ("MCP Registry",       "PostgreSQL",          "persists_data",     {"description": "Stores registered MCP server configs"}),
    # UI connections
    ("Agent Studio",       "API Gateway",         "api_calls",         {"description": "Chat and agent execution requests"}),
    ("Agent Studio",       "Agent Registry",      "api_calls",         {"description": "Lists and manages agent definitions"}),
    ("Agent Studio",       "KG Service",          "api_calls",         {"description": "Browses and searches knowledge graphs"}),
    ("Admin Console",      "Admin API",           "api_calls",         {"description": "Platform administration and management operations"}),
]


def curl(method, url, headers=None, body=None):
    cmd = ["curl", "-s", "-X", method, url]
    for k, v in (headers or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    if body is not None:
        cmd += ["-d", json.dumps(body)]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return result.stdout


def kg_headers():
    return {"Content-Type": "application/json", "X-Tenant-ID": TENANT}


# ── Check or create graph ──────────────────────────────────────────────────
print(f"  Checking for existing graph '{GRAPH_NAME}'...")
existing_resp = curl("GET", f"{KG_SERVICE}/graphs/list", headers={"X-Tenant-ID": TENANT})
try:
    existing = json.loads(existing_resp) if existing_resp.strip() else []
except Exception:
    existing = []

graph_id = None
for g in (existing or []):
    if g.get("name") == GRAPH_NAME:
        graph_id = g["id"]
        break

if graph_id:
    print(f"  ~ Graph already exists (id={graph_id}) — checking nodes...")
else:
    print(f"  + Creating graph '{GRAPH_NAME}'...")
    resp = curl("POST", f"{KG_SERVICE}/graphs/create",
                headers=kg_headers(),
                body={
                    "name": GRAPH_NAME,
                    "domain": "devops",
                    "description": "Architecture of the Enterprise Agentic Platform — shows all services and how they connect.",
                    "scope": "shared",
                })
    try:
        g = json.loads(resp)
        graph_id = g.get("id")
    except Exception:
        print(f"    ✗ Failed to parse graph response: {resp[:200]}")
        sys.exit(1)

    if not graph_id:
        print(f"    ✗ No graph ID in response: {resp[:200]}")
        sys.exit(1)
    print(f"    ✓ Graph created (id={graph_id})")


# ── Check existing nodes ───────────────────────────────────────────────────
nodes_resp = curl("GET", f"{KG_SERVICE}/nodes/list?graph_id={graph_id}",
                  headers={"X-Tenant-ID": TENANT})
try:
    existing_nodes = json.loads(nodes_resp) if nodes_resp.strip() else []
except Exception:
    existing_nodes = []

existing_labels = {n["label"]: n["id"] for n in (existing_nodes or [])}
label_to_id = dict(existing_labels)

nodes_created = 0
for node in NODES:
    if node["label"] in existing_labels:
        continue  # already seeded

    resp = curl("POST", f"{KG_SERVICE}/nodes/create",
                headers=kg_headers(),
                body={
                    "graph_id": graph_id,
                    "node_type": node["node_type"],
                    "label": node["label"],
                    "properties": node["properties"],
                })
    try:
        n = json.loads(resp)
        node_id = n.get("id")
    except Exception:
        print(f"    ✗ Failed to create node '{node['label']}': {resp[:100]}")
        continue

    if node_id:
        label_to_id[node["label"]] = node_id
        nodes_created += 1

if nodes_created:
    print(f"    ✓ Created {nodes_created} nodes")
else:
    print(f"    ~ All nodes already exist")


# ── Check existing edges ───────────────────────────────────────────────────
edges_resp = curl("GET", f"{KG_SERVICE}/edges/list?graph_id={graph_id}",
                  headers={"X-Tenant-ID": TENANT})
try:
    existing_edges = json.loads(edges_resp) if edges_resp.strip() else []
except Exception:
    existing_edges = []

# Build a set of (from_id, to_id, rel_type) for dedup
existing_edge_keys = {
    (e["from_node_id"], e["to_node_id"], e["relationship_type"])
    for e in (existing_edges or [])
}

edges_created = 0
for from_label, to_label, rel_type, props in EDGES:
    from_id = label_to_id.get(from_label)
    to_id = label_to_id.get(to_label)

    if not from_id or not to_id:
        print(f"    ⚠ Skipping edge {from_label} → {to_label}: node ID not found")
        continue

    if (from_id, to_id, rel_type) in existing_edge_keys:
        continue  # already exists

    resp = curl("POST", f"{KG_SERVICE}/edges/create",
                headers=kg_headers(),
                body={
                    "graph_id": graph_id,
                    "from_node_id": from_id,
                    "to_node_id": to_id,
                    "relationship_type": rel_type,
                    "properties": props,
                    "weight": 1.0,
                })
    try:
        e = json.loads(resp)
        if e.get("id"):
            edges_created += 1
    except Exception:
        print(f"    ✗ Failed to create edge {from_label} → {to_label}: {resp[:100]}")

if edges_created:
    print(f"    ✓ Created {edges_created} edges")
else:
    print(f"    ~ All edges already exist")

print(f"\n  ✓ Knowledge graph ready: '{GRAPH_NAME}' (id={graph_id})")
print(f"    Nodes: {len(label_to_id)}, Edges seen: {len(existing_edge_keys) + edges_created}")
SEED_KG

echo ""
echo "=========================================="
echo "✓ Demo data seeding complete"
echo ""
echo "  Agents (default-tenant):"
echo "    • General Assistant  (demo-general-assistant)"
echo "    • Code Helper        (demo-code-helper)"
echo "    • Data Analyst       (demo-data-analyst)"
echo ""
echo "  Knowledge Graph:"
echo "    • Platform Architecture"
echo "      15 nodes (services, databases, frontends)"
echo "      20 edges (request flow, persistence, UI)"
echo ""
echo "  Open http://localhost:3000 to start chatting."
echo "=========================================="
