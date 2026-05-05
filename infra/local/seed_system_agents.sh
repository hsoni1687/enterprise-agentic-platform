#!/bin/bash
# Seed platform system agents (idempotent)
# These are real agents that help with platform operations

set -e

REGISTRY="${AGENT_REGISTRY_URL:-http://localhost:8088}"
TENANT="platform-system"

echo "=========================================="
echo "Seeding System Agents for A1 Platform"
echo "Registry: $REGISTRY"
echo "Tenant: $TENANT"
echo "=========================================="

# Wait for registry to be healthy
echo "[1/4] Waiting for agent-registry to be healthy..."
for i in {1..30}; do
  if curl -sf "$REGISTRY/health" >/dev/null 2>&1; then
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

# Create manifest-assistant agent
echo ""
echo "[2/4] Creating manifest-assistant agent..."
MANIFEST_SYSTEM_PROMPT='You are the Manifest Assistant. Help design agent system prompts and select skills.

Parse the <catalog> block. Reference only skills/tools listed there by exact name and version.

Output format:
## System Prompt Draft
[Clear, concise agent persona and responsibilities]

## Recommended Skills
[List skills from catalog that match the use case]

## Skills/Tools to Create
[Only if needed - brief descriptions]

Rules:
- Use only catalog skills - never invent names
- System prompt: start with "You are", describe role and constraints
- Keep responses concise'

CREATE_RESPONSE=$(curl -s -X POST "$REGISTRY/api/v1/agents" \
  -H "Content-Type: application/json" \
  -H "X-Tenant-ID: $TENANT" \
  -d @- <<EOF
{
  "id": "manifest-assistant",
  "name": "Manifest Assistant",
  "version": "1.0.0",
  "system_prompt": $(echo "$MANIFEST_SYSTEM_PROMPT" | jq -Rs .),
  "model": "claude-sonnet-4-6",
  "max_iterations": 3,
  "memory_budget_mb": 128,
  "skills": []
}
EOF
)

# Check if creation was successful or already exists
if echo "$CREATE_RESPONSE" | grep -q '"id":"manifest-assistant"' || echo "$CREATE_RESPONSE" | grep -q 'already exists'; then
  echo "✓ manifest-assistant agent exists"
else
  echo "Response: $CREATE_RESPONSE"
fi

# Transition to staged
echo ""
echo "[3/4] Transitioning manifest-assistant to staged..."
TRANSITION_RESPONSE=$(curl -s -X POST "$REGISTRY/api/v1/agents/manifest-assistant/transition" \
  -H "X-Tenant-ID: $TENANT" \
  -H "Content-Type: application/json" \
  -d '{"target_state": "staged", "actor": "platform-seed"}' 2>&1 || true)

# Check response (ignore errors if already staged/active)
if echo "$TRANSITION_RESPONSE" | grep -q '"status":"staged"' || echo "$TRANSITION_RESPONSE" | grep -q 'already in state'; then
  echo "✓ manifest-assistant transitioned to staged"
else
  echo "  Transition response: $TRANSITION_RESPONSE"
fi

# Transition to active
echo ""
echo "[4/4] Transitioning manifest-assistant to active..."
ACTIVATE_RESPONSE=$(curl -s -X POST "$REGISTRY/api/v1/agents/manifest-assistant/transition" \
  -H "X-Tenant-ID: $TENANT" \
  -H "Content-Type: application/json" \
  -d '{"target_state": "active", "actor": "platform-seed"}' 2>&1 || true)

# Check response
if echo "$ACTIVATE_RESPONSE" | grep -q '"status":"active"' || echo "$ACTIVATE_RESPONSE" | grep -q 'already in state'; then
  echo "✓ manifest-assistant is now active"
else
  echo "  Activate response: $ACTIVATE_RESPONSE"
fi

echo ""
echo "=========================================="
echo "✓ System agents seeded successfully"
echo "=========================================="
echo ""
echo "To verify:"
echo "  curl -H 'X-Tenant-ID: platform-system' $REGISTRY/api/v1/agents"
