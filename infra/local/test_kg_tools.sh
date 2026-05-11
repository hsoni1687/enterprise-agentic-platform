#!/bin/bash
# Test Knowledge Graph system tools integration
# Verifies: kg tools registered, skill-dispatcher routing, kg-service API

set -e

DISPATCHER_URL="${DISPATCHER_URL:-http://localhost:8085}"
TOOL_REGISTRY="${TOOL_REGISTRY:-http://localhost:8086}"
KG_SERVICE="${KG_SERVICE:-http://localhost:8093}"
TENANT_ID="test-tenant"

echo "=============================================="
echo "Testing KG System Tools Integration"
echo "=============================================="
echo "Dispatcher: $DISPATCHER_URL"
echo "Tool Registry: $TOOL_REGISTRY"
echo "KG Service: $KG_SERVICE"
echo "Tenant: $TENANT_ID"
echo ""

# Helper function for HTTP requests
make_request() {
  local method=$1
  local url=$2
  local data=$3
  local tenant=${4:-$TENANT_ID}

  if [ -z "$data" ]; then
    curl -s -X "$method" "$url" \
      -H "X-Tenant-ID: $tenant" \
      -H "Content-Type: application/json"
  else
    curl -s -X "$method" "$url" \
      -H "X-Tenant-ID: $tenant" \
      -H "Content-Type: application/json" \
      -d "$data"
  fi
}

# Test 1: Verify KG tools are registered
echo "[1/6] Verifying KG tools registered in tool registry..."
RESPONSE=$(make_request GET "$TOOL_REGISTRY/api/v1/tools?include_system=true" "" "default-tenant")
KG_TOOL_COUNT=$(echo "$RESPONSE" | grep -o '"name":"kg-[^"]*"' | wc -l)

if [ "$KG_TOOL_COUNT" -eq 5 ]; then
  echo "✓ All 5 KG tools registered"
else
  echo "✗ Expected 5 KG tools, found $KG_TOOL_COUNT"
  echo "Tools: $RESPONSE" | head -100
  exit 1
fi

# Test 2: Test kg-create-graph through dispatcher
echo ""
echo "[2/6] Testing kg-create-graph tool..."
GRAPH_RESPONSE=$(make_request POST "$DISPATCHER_URL/api/v1/tools/invoke" '{
  "tool": {"name": "kg-create-graph", "version": "1.0.0"},
  "args": {
    "name": "Test DevOps Graph",
    "domain": "devops",
    "description": "A test knowledge graph",
    "schema": {"entities": ["Service", "Deployment"], "relationships": ["depends_on"]}
  },
  "agent_id": "test-agent",
  "mutating": true,
  "hitl_approval_id": "test-bypass"
}')

GRAPH_ID=$(echo "$GRAPH_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$GRAPH_ID" ]; then
  echo "✓ kg-create-graph succeeded (graph_id: ${GRAPH_ID:0:8}...)"
else
  echo "✗ kg-create-graph failed"
  echo "Response: $GRAPH_RESPONSE" | head -100
  exit 1
fi

# Test 3: Test kg-add-node through dispatcher
echo ""
echo "[3/6] Testing kg-add-node tool..."
NODE1_RESPONSE=$(make_request POST "$DISPATCHER_URL/api/v1/tools/invoke" "{
  \"tool\": {\"name\": \"kg-add-node\", \"version\": \"1.0.0\"},
  \"args\": {
    \"graph_id\": \"$GRAPH_ID\",
    \"node_type\": \"Service\",
    \"label\": \"api-gateway\",
    \"properties\": {\"port\": 8080}
  },
  \"agent_id\": \"test-agent\",
  \"mutating\": true,
  \"hitl_approval_id\": \"test-bypass\"
}")

NODE1_ID=$(echo "$NODE1_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$NODE1_ID" ]; then
  echo "✓ kg-add-node (api-gateway) succeeded (node_id: ${NODE1_ID:0:8}...)"
else
  echo "✗ kg-add-node failed"
  echo "Response: $NODE1_RESPONSE" | head -100
  exit 1
fi

# Test 4: Add another node for edge testing
echo ""
echo "[4/6] Testing kg-add-node (second node)..."
NODE2_RESPONSE=$(make_request POST "$DISPATCHER_URL/api/v1/tools/invoke" "{
  \"tool\": {\"name\": \"kg-add-node\", \"version\": \"1.0.0\"},
  \"args\": {
    \"graph_id\": \"$GRAPH_ID\",
    \"node_type\": \"Service\",
    \"label\": \"user-service\",
    \"properties\": {\"port\": 8081}
  },
  \"agent_id\": \"test-agent\",
  \"mutating\": true,
  \"hitl_approval_id\": \"test-bypass\"
}")

NODE2_ID=$(echo "$NODE2_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$NODE2_ID" ]; then
  echo "✓ kg-add-node (user-service) succeeded (node_id: ${NODE2_ID:0:8}...)"
else
  echo "✗ kg-add-node (2nd) failed"
  exit 1
fi

# Test 5: Test kg-add-edge through dispatcher
echo ""
echo "[5/6] Testing kg-add-edge tool..."
EDGE_RESPONSE=$(make_request POST "$DISPATCHER_URL/api/v1/tools/invoke" "{
  \"tool\": {\"name\": \"kg-add-edge\", \"version\": \"1.0.0\"},
  \"args\": {
    \"graph_id\": \"$GRAPH_ID\",
    \"from_node_id\": \"$NODE1_ID\",
    \"to_node_id\": \"$NODE2_ID\",
    \"relationship_type\": \"depends_on\",
    \"weight\": 1.0
  },
  \"agent_id\": \"test-agent\",
  \"mutating\": true,
  \"hitl_approval_id\": \"test-bypass\"
}")

EDGE_ID=$(echo "$EDGE_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$EDGE_ID" ]; then
  echo "✓ kg-add-edge succeeded (edge_id: ${EDGE_ID:0:8}...)"
else
  echo "✗ kg-add-edge failed"
  echo "Response: $EDGE_RESPONSE" | head -100
  exit 1
fi

# Test 6: Test kg-query through dispatcher
echo ""
echo "[6/6] Testing kg-query tool..."
QUERY_RESPONSE=$(make_request POST "$DISPATCHER_URL/api/v1/tools/invoke" "{
  \"tool\": {\"name\": \"kg-query\", \"version\": \"1.0.0\"},
  \"args\": {
    \"graph_id\": \"$GRAPH_ID\",
    \"start_node_id\": \"$NODE1_ID\",
    \"max_depth\": 2
  },
  \"agent_id\": \"test-agent\",
  \"mutating\": false
}")

# Check if response contains nodes array
if echo "$QUERY_RESPONSE" | grep -q '"nodes"'; then
  echo "✓ kg-query succeeded"
  echo "  Response contains query results"
else
  echo "✗ kg-query failed"
  echo "Response: $QUERY_RESPONSE" | head -100
  exit 1
fi

echo ""
echo "=============================================="
echo "✓ All KG tools integration tests passed!"
echo "=============================================="
echo ""
echo "Summary:"
echo "  Graph ID: $GRAPH_ID"
echo "  Node 1: $NODE1_ID (api-gateway)"
echo "  Node 2: $NODE2_ID (user-service)"
echo "  Edge: $EDGE_ID (depends_on)"
echo ""
echo "To verify in KG service directly:"
echo "  curl -H 'X-Tenant-ID: $TENANT_ID' $KG_SERVICE/graphs/get?id=$GRAPH_ID"
echo ""
