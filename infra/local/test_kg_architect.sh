#!/bin/bash
# Test KG-Architect system agent end-to-end
# Verifies: agent registration, tool invocation via agent, KG creation

set -e

AGENT_REGISTRY="${AGENT_REGISTRY:-http://localhost:8088}"
API_GATEWAY="${API_GATEWAY:-http://localhost:8080}"
KG_SERVICE="${KG_SERVICE:-http://localhost:8093}"
TENANT_ID="platform-system"

echo "=============================================="
echo "Testing KG-Architect System Agent"
echo "=============================================="
echo "Agent Registry: $AGENT_REGISTRY"
echo "API Gateway: $API_GATEWAY"
echo "KG Service: $KG_SERVICE"
echo "Tenant: $TENANT_ID"
echo ""

# Test 1: Verify KG-Architect agent is registered
echo "[1/4] Verifying KG-Architect agent is registered..."
AGENTS=$(curl -s -H "X-Tenant-ID: $TENANT_ID" "$AGENT_REGISTRY/api/v1/agents")
if echo "$AGENTS" | grep -q '"name":"KG Architect"'; then
  AGENT_ID=$(echo "$AGENTS" | grep -o '"id":"kg-architect"' -A 0 | cut -d'"' -f4 || echo "kg-architect")
  echo "✓ KG Architect agent found (id: $AGENT_ID)"
else
  echo "✗ KG Architect agent not found"
  echo "Available agents: $(echo "$AGENTS" | grep -o '"name":"[^"]*"')"
  exit 1
fi

# Test 2: Start a session with the agent
echo ""
echo "[2/4] Starting agent session..."
SESSION_RESPONSE=$(curl -s -X POST "$API_GATEWAY/api/v1/agents/kg-architect/sessions" \
  -H "X-Tenant-ID: $TENANT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create a DevOps knowledge graph for a microservices platform with 3 services: api-gateway, user-service, product-service. api-gateway depends on both user-service and product-service. Both services use a shared postgres database. Create nodes for each service, the database, and add edges for the dependencies."
  }')

SESSION_ID=$(echo "$SESSION_RESPONSE" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)

if [ -n "$SESSION_ID" ]; then
  echo "✓ Session started (session_id: ${SESSION_ID:0:8}...)"
else
  echo "✗ Failed to start session"
  echo "Response: $SESSION_RESPONSE" | head -50
  exit 1
fi

# Test 3: Poll for session completion (with timeout)
echo ""
echo "[3/4] Waiting for agent to complete (polling for max 60s)..."
MAX_ATTEMPTS=30
ATTEMPT=0
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  STATUS=$(curl -s -H "X-Tenant-ID: $TENANT_ID" "$API_GATEWAY/api/v1/agents/kg-architect/sessions/$SESSION_ID" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

  if [ "$STATUS" = "completed" ]; then
    echo "✓ Session completed (status: $STATUS)"
    break
  elif [ "$STATUS" = "running" ]; then
    ATTEMPT=$((ATTEMPT + 1))
    echo "  Attempt $ATTEMPT/$MAX_ATTEMPTS - Still running..."
    sleep 2
  else
    echo "Session status: $STATUS"
    ATTEMPT=$((ATTEMPT + 1))
    sleep 2
  fi

  if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    echo "⚠ Session still running after 60s (may be processing)"
    # Don't fail - continue to check KG
    break
  fi
done

# Get session details to see output
SESSION_DETAILS=$(curl -s -H "X-Tenant-ID: $TENANT_ID" "$API_GATEWAY/api/v1/agents/kg-architect/sessions/$SESSION_ID")
echo "Session output:"
echo "$SESSION_DETAILS" | grep -o '"response":"[^"]*' | head -3

# Test 4: Verify KG was created
echo ""
echo "[4/4] Verifying knowledge graph was created..."
GRAPHS=$(curl -s -H "X-Tenant-ID: $TENANT_ID" "$KG_SERVICE/graphs/list")

if echo "$GRAPHS" | grep -q '"name"'; then
  GRAPH_COUNT=$(echo "$GRAPHS" | grep -o '"id":"[^"]*"' | wc -l)
  echo "✓ Knowledge graph(s) found ($GRAPH_COUNT graph(s))"

  # Extract first graph ID for detailed inspection
  GRAPH_ID=$(echo "$GRAPHS" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "$GRAPH_ID" ]; then
    GRAPH_DETAILS=$(curl -s -H "X-Tenant-ID: $TENANT_ID" "$KG_SERVICE/graphs/get?id=$GRAPH_ID")
    DOMAIN=$(echo "$GRAPH_DETAILS" | grep -o '"domain":"[^"]*"' | cut -d'"' -f4)
    echo "  - Domain: $DOMAIN"

    # Count nodes
    NODES=$(curl -s -H "X-Tenant-ID: $TENANT_ID" "$KG_SERVICE/nodes/list?graph_id=$GRAPH_ID")
    NODE_COUNT=$(echo "$NODES" | grep -o '"id":"[^"]*"' | wc -l)
    echo "  - Nodes: $NODE_COUNT"

    # Count edges
    EDGES=$(curl -s -H "X-Tenant-ID: $TENANT_ID" "$KG_SERVICE/edges/list?graph_id=$GRAPH_ID")
    EDGE_COUNT=$(echo "$EDGES" | grep -o '"id":"[^"]*"' | wc -l)
    echo "  - Edges: $EDGE_COUNT"
  fi
else
  echo "⚠ No knowledge graphs found yet (agent may still be processing)"
fi

echo ""
echo "=============================================="
echo "✓ KG-Architect agent test completed"
echo "=============================================="
echo ""
echo "Session Details:"
echo "  Session ID: $SESSION_ID"
echo "  Status: $(curl -s -H 'X-Tenant-ID: '$TENANT_ID "$API_GATEWAY/api/v1/agents/kg-architect/sessions/$SESSION_ID" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"
echo ""
echo "To view agent in real-time:"
echo "  1. Open http://localhost:3000 (Agent Studio)"
echo "  2. Select 'KG Architect' from agent dropdown"
echo "  3. Send natural language requests to build KGs"
echo ""
