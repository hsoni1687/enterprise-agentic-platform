#!/bin/bash
# Seed platform system skills (idempotent)
# These are pre-built skills available to all tenants
# Usage: bash infra/local/seed_system_skills.sh

set -e

ADMIN_API="${ADMIN_API_URL:-http://localhost:8089}"
ADMIN_KEY="${ADMIN_API_KEY:-dev-admin-key}"
SKILLS_YAML="${1:-infra/platform/system-skills.yaml}"

echo "=========================================="
echo "Seeding System Skills for A1 Platform"
echo "Admin API: $ADMIN_API"
echo "YAML File: $SKILLS_YAML"
echo "=========================================="

# Check if YAML file exists
if [ ! -f "$SKILLS_YAML" ]; then
  echo "✗ YAML file not found: $SKILLS_YAML"
  exit 1
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

echo ""
echo "[2/2] Seeding system skills from YAML..."

# Check if Python and yaml module available
if ! command -v python3 &> /dev/null || ! python3 -c "import yaml" 2>/dev/null; then
  echo "⚠ Python 3 and pyyaml required for YAML parsing"
  exit 1
fi

SEEDED=0
SKIPPED=0
FAILED=0

# Use Python for full YAML parsing with metadata extraction
python3 << PYEOF
import yaml
import json
import subprocess
import sys

with open("$SKILLS_YAML", 'r') as f:
    data = yaml.safe_load(f)

for skill in data.get('skills', []):
    skill_name = skill.get('name')
    skill_version = skill.get('version')

    if not skill_name:
        continue

    print(f"\nCreating system skill: {skill_name}@{skill_version}")

    # Extract metadata and flatten into request
    metadata = skill.get('_metadata', {})
    tools = skill.get('tools', [])

    request_body = {
        'name': skill.get('name'),
        'version': skill.get('version'),
        'description': skill.get('description'),
        'tools': tools,
        'mutating': skill.get('mutating', False),
        'approval_required': skill.get('approval_required', False),
        'sop': skill.get('sop', ''),
        'registered_by': metadata.get('registered_by', 'platform-seed')
    }

    cmd = [
        'curl', '-s', '-X', 'POST',
        '$ADMIN_API/api/v1/admin/system-skills',
        '-H', 'Authorization: Bearer $ADMIN_KEY',
        '-H', 'Content-Type: application/json',
        '-d', json.dumps(request_body)
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    response = result.stdout

    if '"id"' in response or '"status"' in response:
        print(f"✓ {skill_name}@{skill_version} created")
    elif 'already exists' in response or 'duplicate key' in response:
        print(f"~ {skill_name}@{skill_version} already exists")
    else:
        print(f"✗ Failed to create {skill_name}@{skill_version}")
        print(f"  Response: {response}")

PYEOF

echo ""
echo "=========================================="
echo "✓ System skills seeded successfully"
echo "=========================================="
echo ""
echo "To verify:"
echo "  curl -H 'Authorization: Bearer $ADMIN_KEY' $ADMIN_API/api/v1/admin/system-skills"
echo ""
