#!/bin/bash
# Seed platform system tools (idempotent)
# These are pre-built tools available to all tenants
# Usage: bash infra/local/seed_system_tools.sh

set -e

ADMIN_API="${ADMIN_API_URL:-http://localhost:8089}"
ADMIN_KEY="${ADMIN_API_KEY:-dev-admin-key}"
TOOLS_YAML="${TOOLS_YAML:-${1:-infra/platform/system-tools.yaml}}"

echo "=========================================="
echo "Seeding System Tools for A1 Platform"
echo "Admin API: $ADMIN_API"
echo "YAML File: $TOOLS_YAML"
echo "=========================================="

# Check if YAML file exists (optional, fall back to hardcoded tools)
if [ ! -f "$TOOLS_YAML" ]; then
  echo "⚠ YAML file not found: $TOOLS_YAML, using fallback tools list"
fi

# Wait for admin API to be healthy
echo "[1/2] Waiting for admin API to be healthy..."
for i in {1..30}; do
  if curl -sf "$ADMIN_API/health" >/dev/null 2>&1; then
    echo "✓ Admin API is healthy"
    break
  fi
  echo "  Attempt $i/30..."
  sleep 1
  if [ $i -eq 30 ]; then
    echo "✗ Admin API did not become healthy"
    exit 1
  fi
done

# Parse YAML and seed each tool
echo ""
echo "[2/2] Seeding system tools from YAML..."

# Use a simple YAML parser to extract tools
# This uses yq if available, falls back to manual parsing
if command -v yq &> /dev/null; then
  TOOL_COUNT=$(yq eval '.tools | length' "$TOOLS_YAML")
else
  # Fallback: count "- id:" lines
  TOOL_COUNT=$(grep -c "^  - id:" "$TOOLS_YAML" || echo 0)
fi

SEEDED=0
SKIPPED=0
FAILED=0

# Extract tool data and seed each one
extract_tool_from_yaml() {
  local yaml_file="$1"
  local tool_index="$2"

  # Simple extraction for tool data
  # In production, use proper YAML parsing
  python3 << PYTHON_EOF
import yaml
import json
import sys

with open("$yaml_file", 'r') as f:
    data = yaml.safe_load(f)

if data and 'tools' in data and len(data['tools']) > $tool_index:
    tool = data['tools'][$tool_index]
    print(json.dumps(tool))
else:
    sys.exit(1)
PYTHON_EOF
}

# Check if Python and yaml module available
if ! command -v python3 &> /dev/null || ! python3 -c "import yaml" 2>/dev/null; then
  echo "⚠ Python 3 and pyyaml required for advanced YAML parsing"
  echo "  Installing fallback: manual tool creation"

  # Fallback: manually create the standard tools via curl
  TOOLS="web-search:1.0.0:Search the web for information and retrieve results:read:false
web-fetch:1.0.0:Fetch a web page and return a summarized extract with source citation:read:false
code-executor:1.0.0:Execute code snippets in a sandboxed environment:mutating:true
http-request:1.0.0:Make HTTP requests to external APIs:mutating:false
text-processing:1.0.0:Advanced text processing operations:read:false
data-validation:1.0.0:Validate data against schemas:read:false
bash:1.0.0:Execute bash commands with streaming output and signal handling:mutating:true"

  echo "$TOOLS" | while IFS= read -r TOOL_DEF; do
    [ -z "$TOOL_DEF" ] && continue

    NAME=$(echo "$TOOL_DEF" | cut -d: -f1)
    VERSION=$(echo "$TOOL_DEF" | cut -d: -f2)
    DESCRIPTION=$(echo "$TOOL_DEF" | cut -d: -f3)
    AUTH_LEVEL=$(echo "$TOOL_DEF" | cut -d: -f4)
    SANDBOX=$(echo "$TOOL_DEF" | cut -d: -f5)

    echo ""
    echo "Creating system tool: $NAME@$VERSION"

    RESPONSE=$(curl -s -X POST "$ADMIN_API/api/v1/admin/system-tools" \
      -H "Authorization: Bearer $ADMIN_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"name\":\"$NAME\",\"version\":\"$VERSION\",\"description\":\"$DESCRIPTION\",\"auth_level\":\"$AUTH_LEVEL\",\"sandbox_required\":$SANDBOX,\"registered_by\":\"platform-seed\"}")

    if echo "$RESPONSE" | grep -q '"status"' || echo "$RESPONSE" | grep -q '"id"'; then
      echo "✓ $NAME@$VERSION created"
      SEEDED=$((SEEDED + 1))
    else
      echo "✗ Failed to create $NAME@$VERSION"
      echo "  Response: $RESPONSE"
      FAILED=$((FAILED + 1))
    fi
  done
else
  # Use Python for full YAML parsing with metadata extraction
  python3 << PYEOF
import yaml
import json
import subprocess

with open("$TOOLS_YAML", 'r') as f:
    data = yaml.safe_load(f)

for tool in data.get('tools', []):
    tool_name = tool.get('name')
    tool_version = tool.get('version')

    if not tool_name:
        continue

    print(f"\nCreating system tool: {tool_name}@{tool_version}")

    # Extract metadata and flatten into request
    metadata = tool.get('_metadata', {})
    request_body = {
        'name': tool.get('name'),
        'version': tool.get('version'),
        'description': tool.get('description'),
        'input_schema': tool.get('input_schema'),
        'auth_level': metadata.get('auth_level', 'read'),
        'sandbox_required': metadata.get('sandbox_required', False),
        'registered_by': metadata.get('registered_by', 'platform-seed')
    }

    cmd = [
        'curl', '-s', '-X', 'POST',
        '$ADMIN_API/api/v1/admin/system-tools',
        '-H', 'Authorization: Bearer $ADMIN_KEY',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps(request_body)
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    response = result.stdout

    if '"id"' in response or '"status"' in response:
        print(f"✓ {tool_name}@{tool_version} created")
    elif 'already exists' in response or 'duplicate key' in response:
        print(f"~ {tool_name}@{tool_version} already exists")
    else:
        print(f"✗ Failed to create {tool_name}@{tool_version}")
        print(f"  Response: {response}")

PYEOF
fi

echo ""
echo "=========================================="
echo "System Tools Seeding Summary"
echo "  Seeded:  $SEEDED"
echo "  Skipped: $SKIPPED"
echo "  Failed:  $FAILED"
echo "=========================================="

if [ $FAILED -gt 0 ]; then
  exit 1
fi

echo ""
echo "✓ System tools seeded successfully"
echo ""
echo "To verify:"
echo "  curl -H 'Authorization: Bearer $ADMIN_KEY' $ADMIN_API/api/v1/admin/system-tools"
echo ""
