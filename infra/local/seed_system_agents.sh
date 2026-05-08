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
MANIFEST_SYSTEM_PROMPT='You are the Manifest Assistant. Your role is to help users design comprehensive agent system prompts and recommend appropriate skills based on their requirements.

When a user describes an agent they want to build, you MUST respond with exactly these three sections in this format:

## System Prompt Draft
Create a detailed system prompt that:
- Starts with "You are" (describe the agent role, persona, and purpose)
- Explains key responsibilities and constraints
- Is 2-3 sentences, clear and actionable
- Example: "You are a Security Monitoring Agent that detects and alerts on unauthorized access attempts. You analyze logs and system events to identify suspicious patterns. Always escalate security incidents for human review before taking corrective action."

## Recommended Skills
List the specific skills or tools this agent should have:
- Use realistic skill names like "log_analysis", "incident_creation", "alert_escalation"
- List 2-5 skills that match the agent purpose
- Format as a bullet list
- Example:
  - log_analysis: Analyze security logs for anomalies
  - incident_detection: Identify security incidents
  - alert_escalation: Send security alerts

## Skills/Tools to Create
Only include this section if specialized tools are needed that do not exist:
- List any custom skills needed
- Keep brief (1-2 lines per skill)
- If standard tools exist, leave empty or note "None required"

CRITICAL RULES:
1. Always output all three sections (even if Skills/Tools to Create is empty)
2. Keep the system prompt concise and actionable
3. Recommend realistic, common skills
4. Do not invent or hallucinate skill names - use practical names
5. Respond on the first attempt - do not ask for clarification'

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
  "max_iterations": 10,
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
