#!/bin/bash
# =============================================================================
# Safe LiteLLM restart — reloads .env without touching any other container.
#
# Usage:  bash infra/local/restart-litellm.sh
#
# What it does:
#   1. Recreates ONLY the litellm container (--no-deps keeps postgres safe)
#   2. Loads the current infra/local/.env (cd ensures Docker Compose finds it)
#   3. Verifies the API key is loaded
#   4. Runs a quick smoke-test against the configured model
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env explicitly so its values override any empty shell exports.
# (Shell env vars normally beat .env — sourcing reverses that.)
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

echo "==> Recreating litellm (--no-deps: postgres/redis/other services untouched)..."
docker compose up -d --force-recreate --no-deps litellm

echo "==> Waiting for litellm to be healthy..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:4000/health/liveliness \
       -H "Authorization: Bearer ${LITELLM_MASTER_KEY:-sk-litellm-dev}" >/dev/null 2>&1; then
    echo "    ✓ LiteLLM is up"
    break
  fi
  printf "    attempt %d/30...\r" "$i"
  sleep 2
  [ "$i" -eq 30 ] && echo "    ✗ LiteLLM did not come up" && exit 1
done

echo "==> Verifying env vars loaded..."
docker exec litellm python3 -c "
import os
key = os.environ.get('ANTHROPIC_API_KEY','')
base = os.environ.get('ANTHROPIC_BASE_URL','(direct api.anthropic.com)')
if key:
    print(f'    ✓ ANTHROPIC_API_KEY loaded ({key[:8]}...)')
else:
    print('    ✗ ANTHROPIC_API_KEY is EMPTY — check infra/local/.env')
    exit(1)
print(f'    ✓ ANTHROPIC_BASE_URL = {base}')
"

echo "==> Smoke-test: calling claude-sonnet-4-5..."
RESPONSE=$(curl -sf http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer ${LITELLM_MASTER_KEY:-sk-litellm-dev}" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-5","messages":[{"role":"user","content":"Reply with just OK"}],"max_tokens":5}' 2>&1)

if echo "$RESPONSE" | grep -q '"content"'; then
  echo "    ✓ LLM responded — Anthropic is reachable"
else
  echo "    ✗ LLM call failed:"
  echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
  exit 1
fi

echo ""
echo "✓ LiteLLM restarted successfully. Ready to chat."
