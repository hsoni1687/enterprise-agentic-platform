#!/bin/bash
# Seed platform system agents (idempotent)
# These are real agents that help with platform operations
# Usage: bash infra/local/seed_system_agents.sh

set -e

AGENT_REGISTRY="${AGENT_REGISTRY_URL:-http://localhost:8088}"
TENANT="platform-system"
AGENTS_YAML="${1:-infra/platform/system-agents.yaml}"

echo "=========================================="
echo "Seeding System Agents for A1 Platform"
echo "Registry: $AGENT_REGISTRY"
echo "YAML File: $AGENTS_YAML"
echo "Tenant: $TENANT"
echo "=========================================="

# Check if YAML file exists
if [ ! -f "$AGENTS_YAML" ]; then
  echo "⚠ YAML file not found: $AGENTS_YAML, using hardcoded manifest-assistant"
  AGENTS_YAML=""
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

# Parse YAML and seed agents if available
if [ -n "$AGENTS_YAML" ] && command -v python3 &> /dev/null; then
  echo ""
  echo "[2/3] Seeding system agents from YAML..."

  AGENT_COUNT=$(python3 -c "
import yaml
with open('$AGENTS_YAML', 'r') as f:
    data = yaml.safe_load(f)
    print(len(data.get('agents', [])))
" 2>/dev/null || echo 0)

  if [ "$AGENT_COUNT" -gt 0 ]; then
    # Extract and seed each agent from YAML
    python3 << PYTHON_EOF
import yaml
import subprocess
import json

with open('$AGENTS_YAML', 'r') as f:
    data = yaml.safe_load(f)

for i, agent in enumerate(data.get('agents', [])):
    agent_id = agent.get('id')
    agent_name = agent.get('name')
    agent_version = agent.get('version')
    system_prompt = agent.get('system_prompt', '')
    model = agent.get('model', 'claude-sonnet-4-6')
    max_iterations = agent.get('max_iterations', 10)
    memory_budget_mb = agent.get('memory_budget_mb', 128)

    print(f"\n[{i+1}/{len(data.get('agents', []))}] Seeding {agent_name}...")

    # Call bash function via curl (inline agent creation)
    # This is simplified; in production, call create_and_activate_agent
    print(f"✓ Would seed {agent_name}@{agent_version}")

PYTHON_EOF
    # Simplified: fall through to hardcoded agents below
  fi
fi

echo ""
echo "[2/3] Seeding system agents..."

# Manifest Assistant Agent (core platform agent)
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

create_and_activate_agent "manifest-assistant" "Manifest Assistant" "1.0.0" "$MANIFEST_SYSTEM_PROMPT"

# Documentation Generator Agent
DOC_SYSTEM_PROMPT='You are the Documentation Generator. Your role is to produce clear, comprehensive documentation from code, APIs, and requirements.

Your responsibilities:
1. Parse technical specifications and code structures
2. Generate well-formatted markdown/RST documentation
3. Create consistent API references with examples
4. Produce user guides and getting-started tutorials
5. Ensure documentation is accessible to both technical and non-technical audiences

Guidelines:
- Always include code examples where appropriate
- Use clear headings and logical structure
- Include tables of contents for longer documents
- Provide quick-start sections before detailed references
- Include troubleshooting and FAQ sections'

create_and_activate_agent "documentation-generator" "Documentation Generator" "1.0.0" "$DOC_SYSTEM_PROMPT"

# Code Reviewer Agent
CODE_REVIEW_PROMPT='You are an expert Code Reviewer. Your role is to analyze code submissions and provide constructive feedback.

Review dimensions:
1. **Correctness**: Does the code work as intended? Are there logical errors?
2. **Security**: Are there security vulnerabilities? Injection attacks? Exposed secrets?
3. **Performance**: Could this be optimized? Are there n+1 queries? Memory leaks?
4. **Maintainability**: Is the code readable? Are naming conventions followed? Is it DRY?
5. **Testing**: Is the code testable? Are edge cases handled? Is test coverage adequate?

Provide feedback in this format:
- **Critical Issues**: Security, correctness problems (must fix)
- **Important Issues**: Performance, maintainability problems (should fix)
- **Suggestions**: Improvements and best practices (nice to have)
- **Approved**: If no critical/important issues found

Be constructive and explain the reasoning behind each comment.'

create_and_activate_agent "code-reviewer" "Code Reviewer" "1.0.0" "$CODE_REVIEW_PROMPT" "claude-sonnet-4-6" "12" "512"

# Test Generator Agent
TEST_PROMPT='You are the Test Generator. Your role is to create comprehensive, high-quality test suites.

Test strategy:
1. **Unit Tests**: Test individual functions and classes in isolation
2. **Integration Tests**: Test interactions between components
3. **E2E Tests**: Test complete workflows and user scenarios
4. **Edge Cases**: Test boundary conditions and error scenarios
5. **Performance Tests**: Test performance under load (where applicable)

For each test, include:
- Clear test names describing what is being tested
- Setup/teardown code where needed
- Assertions that verify both positive and negative cases
- Comments explaining non-obvious test logic

Testing best practices:
- Follow AAA pattern (Arrange, Act, Assert)
- Keep tests focused and independent
- Use mocking/stubbing appropriately
- Aim for >80% code coverage'

create_and_activate_agent "test-generator" "Test Generator" "1.0.0" "$TEST_PROMPT" "claude-sonnet-4-6" "10" "384"

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
echo ""
echo "To verify:"
echo "  curl -H 'X-Tenant-ID: platform-system' $AGENT_REGISTRY/api/v1/agents"
echo ""
