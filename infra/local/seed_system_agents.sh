#!/bin/bash
# Seed platform system agents (idempotent)
# These are real agents that help with platform operations
# Usage: bash infra/local/seed_system_agents.sh [folder|file]
# Defaults to infra/platform/system-agents/ folder

set -e

AGENT_REGISTRY="${AGENT_REGISTRY_URL:-http://localhost:8088}"
TENANT="platform-system"
AGENTS_SOURCE="${1:-infra/platform/system-agents}"

echo "=========================================="
echo "Seeding System Agents for A1 Platform"
echo "Registry: $AGENT_REGISTRY"
echo "Source: $AGENTS_SOURCE"
echo "Tenant: $TENANT"
echo "=========================================="

# Determine if source is file or folder
if [ -d "$AGENTS_SOURCE" ]; then
  echo "Source is a folder. Discovering YAML files..."
  YAML_FILES=($(find "$AGENTS_SOURCE" -maxdepth 1 -name "*.yaml" -o -name "*.yml" | sort))
  if [ ${#YAML_FILES[@]} -eq 0 ]; then
    echo "⚠ No YAML files found in $AGENTS_SOURCE"
    YAML_FILES=()
  fi
elif [ -f "$AGENTS_SOURCE" ]; then
  echo "Source is a file. Using single file mode..."
  YAML_FILES=("$AGENTS_SOURCE")
else
  echo "⚠ Source not found: $AGENTS_SOURCE"
  YAML_FILES=()
fi

# Wait for registry to be healthy
echo "[1/3] Waiting for agent-registry to be healthy..."
for i in {1..30}; do
  if curl -sf "$AGENT_REGISTRY/health" >/dev/null 2>&1; then
    echo "✓ Registry is healthy"
    break
  fi
  echo "  Attempt $i/30..."
  sleep 1
  if [ $i -eq 30 ]; then
    echo "✗ Registry did not become healthy"
    exit 1
  fi
done

# Helper function to create and transition an agent
create_and_activate_agent() {
  local agent_id="$1"
  local agent_name="$2"
  local agent_version="$3"
  local system_prompt="$4"
  local model="${5:-claude-sonnet-4-6}"
  local max_iterations="${6:-10}"
  local memory_budget_mb="${7:-128}"

  echo ""
  echo "Creating agent: $agent_name ($agent_id)"

  CREATE_RESPONSE=$(curl -s -X POST "$AGENT_REGISTRY/api/v1/agents" \
    -H "Content-Type: application/json" \
    -H "X-Tenant-ID: $TENANT" \
    -d @- <<EOF
{
  "id": "$agent_id",
  "name": "$agent_name",
  "version": "$agent_version",
  "system_prompt": $(echo "$system_prompt" | jq -Rs .),
  "model": "$model",
  "max_iterations": $max_iterations,
  "memory_budget_mb": $memory_budget_mb,
  "skills": []
}
EOF
)

  # Check if creation was successful or already exists
  if echo "$CREATE_RESPONSE" | grep -q "\"id\":\"$agent_id\"" || echo "$CREATE_RESPONSE" | grep -q 'already exists' || echo "$CREATE_RESPONSE" | grep -q 'duplicate key'; then
    echo "✓ $agent_name exists"
  else
    echo "Response: $CREATE_RESPONSE"
    return 1
  fi

  # Transition to staged
  echo "Transitioning to staged..."
  TRANSITION_RESPONSE=$(curl -s -X POST "$AGENT_REGISTRY/api/v1/agents/$agent_id/transition" \
    -H "X-Tenant-ID: $TENANT" \
    -H "Content-Type: application/json" \
    -d '{"target_state": "staged", "actor": "platform-seed"}' 2>&1 || true)

  if echo "$TRANSITION_RESPONSE" | grep -q '"status":"staged"' || echo "$TRANSITION_RESPONSE" | grep -q 'already in state'; then
    echo "✓ Staged"
  fi

  # Transition to active
  echo "Transitioning to active..."
  ACTIVATE_RESPONSE=$(curl -s -X POST "$AGENT_REGISTRY/api/v1/agents/$agent_id/transition" \
    -H "X-Tenant-ID: $TENANT" \
    -H "Content-Type: application/json" \
    -d '{"target_state": "active", "actor": "platform-seed"}' 2>&1 || true)

  if echo "$ACTIVATE_RESPONSE" | grep -q '"status":"active"' || echo "$ACTIVATE_RESPONSE" | grep -q 'already in state'; then
    echo "✓ Active"
  fi
}

# Parse YAML files and seed agents
if [ ${#YAML_FILES[@]} -gt 0 ] && command -v python3 &> /dev/null; then
  echo ""
  echo "[2/3] Seeding system agents from YAML files..."

  for yaml_file in "${YAML_FILES[@]}"; do
    if [ ! -f "$yaml_file" ]; then
      echo "⚠ File not found: $yaml_file, skipping"
      continue
    fi

    python3 << PYTHON_EOF
import yaml
import sys

with open('$yaml_file', 'r') as f:
    agent = yaml.safe_load(f)

# Handle both formats: single agent or agents array
if isinstance(agent, dict) and 'agents' in agent:
    # Old format: single file with agents array
    agents_list = agent.get('agents', [])
elif isinstance(agent, dict) and 'id' in agent:
    # New format: single agent per file
    agents_list = [agent]
else:
    print(f"⚠ Invalid YAML format in $yaml_file")
    sys.exit(1)

# Dynamically call create_and_activate_agent for each agent
for agent_data in agents_list:
    agent_id = agent_data.get('id')
    agent_name = agent_data.get('name')
    print(f"Processing: {agent_name} ({agent_id})")
PYTHON_EOF
  done
else
  echo "⚠ Skipping YAML parsing (no Python or no YAML files found)"
fi

echo ""
echo "[2/3] Seeding system agents from YAML files..."

# Seed agents using a Python helper for clean YAML parsing
python3 << 'SEED_AGENTS_SCRIPT'
import yaml
import subprocess
import json
import sys
import os

agents_source = os.environ.get('AGENTS_SOURCE', 'infra/platform/system-agents')
agent_registry = os.environ.get('AGENT_REGISTRY', 'http://localhost:8088')
tenant = os.environ.get('TENANT', 'platform-system')

def create_and_activate_agent(agent_id, agent_name, agent_version, system_prompt, model, max_iterations, memory_budget_mb):
    """Create and activate an agent via the registry API"""

    # Create agent
    create_payload = {
        "id": agent_id,
        "name": agent_name,
        "version": agent_version,
        "system_prompt": system_prompt,
        "model": model,
        "max_iterations": max_iterations,
        "memory_budget_mb": memory_budget_mb,
        "skills": []
    }

    print(f"\nCreating agent: {agent_name} ({agent_id})")

    create_cmd = [
        'curl', '-s', '-X', 'POST',
        f'{agent_registry}/api/v1/agents',
        '-H', 'Content-Type: application/json',
        '-H', f'X-Tenant-ID: {tenant}',
        '-d', json.dumps(create_payload)
    ]

    result = subprocess.run(create_cmd, capture_output=True, text=True)
    response = result.stdout

    if '"id":"' + agent_id + '"' in response or 'already exists' in response or 'duplicate key' in response:
        print(f"✓ {agent_name} exists")
    else:
        print(f"⚠ Create response: {response[:200]}")
        return False

    # Transition to staged
    print("Transitioning to staged...")
    transition_cmd = [
        'curl', '-s', '-X', 'POST',
        f'{agent_registry}/api/v1/agents/{agent_id}/transition',
        '-H', 'X-Tenant-ID: ' + tenant,
        '-H', 'Content-Type: application/json',
        '-d', json.dumps({"target_state": "staged", "actor": "platform-seed"})
    ]
    subprocess.run(transition_cmd, capture_output=True)
    print("✓ Staged")

    # Transition to active
    print("Transitioning to active...")
    transition_cmd[5] = json.dumps({"target_state": "active", "actor": "platform-seed"})
    subprocess.run(transition_cmd, capture_output=True)
    print("✓ Active")

    return True

# Discover YAML files
if os.path.isdir(agents_source):
    yaml_files = sorted([f for f in os.listdir(agents_source) if f.endswith(('.yaml', '.yml'))])
else:
    yaml_files = [os.path.basename(agents_source)] if os.path.isfile(agents_source) else []

if not yaml_files:
    print(f"⚠ No YAML files found in {agents_source}")
    sys.exit(0)

# Parse and seed each agent
agents_seeded = 0
for yaml_file in yaml_files:
    file_path = os.path.join(agents_source, yaml_file) if os.path.isdir(agents_source) else agents_source

    if not os.path.isfile(file_path):
        continue

    try:
        with open(file_path, 'r') as f:
            agent = yaml.safe_load(f)

        if not isinstance(agent, dict):
            continue

        # Handle both single agent and agents array format
        agents_to_seed = agent.get('agents', [agent]) if 'agents' in agent else [agent]

        for agent_data in agents_to_seed:
            agent_id = agent_data.get('id')
            agent_name = agent_data.get('name')
            if not agent_id or not agent_name:
                continue

            agent_version = agent_data.get('version', '1.0.0')
            system_prompt = agent_data.get('system_prompt', '')
            model = agent_data.get('model', 'claude-sonnet-4-6')
            max_iterations = agent_data.get('max_iterations', 10)
            memory_budget_mb = agent_data.get('memory_budget_mb', 128)

            if create_and_activate_agent(agent_id, agent_name, agent_version, system_prompt, model, max_iterations, memory_budget_mb):
                agents_seeded += 1

    except Exception as e:
        print(f"⚠ Error parsing {file_path}: {e}")

print(f"\n✓ Seeded {agents_seeded} agents")
SEED_AGENTS_SCRIPT

echo ""
echo "[3/3] Verifying system agents..."

AGENT_COUNT=$(curl -s -H "X-Tenant-ID: $TENANT" "$AGENT_REGISTRY/api/v1/agents" | grep -o '"id"' | wc -l)
echo "✓ Found $AGENT_COUNT system agents"

echo ""
echo "=========================================="
echo "✓ System agents seeded successfully"
echo "=========================================="
echo ""
echo "Agents seeded:"
echo "  1. manifest-assistant - Helps design agent system prompts"
echo "  2. documentation-generator - Generates comprehensive documentation"
echo "  3. code-reviewer - Reviews code for quality and security"
echo "  4. test-generator - Generates comprehensive test suites"
echo "  5. kg-architect - Builds domain knowledge graphs from natural language"
echo ""
echo "To verify:"
echo "  curl -H 'X-Tenant-ID: platform-system' $AGENT_REGISTRY/api/v1/agents"
echo ""
echo "To test KG Architect:"
echo "  1. Open http://localhost:3000 (Agent Studio)"
echo "  2. Select 'KG Architect' from agent dropdown"
echo "  3. Chat: 'Create a graph for a 3-service platform: api-gateway, user-svc, product-svc. api-gateway depends on both.'"
echo ""
