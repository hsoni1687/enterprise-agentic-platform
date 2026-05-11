package store

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInMemoryStore_CreateGraph(t *testing.T) {
	s := NewInMemoryStore()
	ctx := context.Background()

	g := &Graph{
		TenantID:    "tenant-1",
		Name:        "test-graph",
		Domain:      "devops",
		Description: "Test knowledge graph",
		Scope:       "private",
		Schema:      map[string]interface{}{"entities": []string{"Service", "Deployment"}},
	}

	result, err := s.CreateGraph(ctx, g)
	require.NoError(t, err)
	assert.NotEmpty(t, result.ID)
	assert.Equal(t, "tenant-1", result.TenantID)
	assert.Equal(t, "test-graph", result.Name)
}

func TestInMemoryStore_GetGraph(t *testing.T) {
	s := NewInMemoryStore()
	ctx := context.Background()

	g := &Graph{
		ID:       "graph-1",
		TenantID: "tenant-1",
		Name:     "test-graph",
		Scope:    "private",
	}
	s.graphs["graph-1"] = g

	result, err := s.GetGraph(ctx, "tenant-1", "graph-1")
	require.NoError(t, err)
	assert.Equal(t, "test-graph", result.Name)
}

func TestInMemoryStore_GetGraphNotFound(t *testing.T) {
	s := NewInMemoryStore()
	ctx := context.Background()

	_, err := s.GetGraph(ctx, "tenant-1", "nonexistent")
	assert.Error(t, err)
}

func TestInMemoryStore_CreateNode(t *testing.T) {
	s := NewInMemoryStore()
	ctx := context.Background()

	n := &Node{
		GraphID:    "graph-1",
		TenantID:   "tenant-1",
		NodeType:   "Service",
		Label:      "api-gateway",
		Properties: map[string]interface{}{"port": 8080},
	}

	result, err := s.CreateNode(ctx, n)
	require.NoError(t, err)
	assert.NotEmpty(t, result.ID)
	assert.Equal(t, "api-gateway", result.Label)
}

func TestInMemoryStore_CreateEdge(t *testing.T) {
	s := NewInMemoryStore()
	ctx := context.Background()

	e := &Edge{
		GraphID:          "graph-1",
		TenantID:         "tenant-1",
		FromNodeID:       "node-1",
		ToNodeID:         "node-2",
		RelationshipType: "depends_on",
		Weight:           1.0,
	}

	result, err := s.CreateEdge(ctx, e)
	require.NoError(t, err)
	assert.NotEmpty(t, result.ID)
	assert.Equal(t, "depends_on", result.RelationshipType)
}

func TestInMemoryStore_ListNodes(t *testing.T) {
	s := NewInMemoryStore()
	ctx := context.Background()

	n1 := &Node{ID: "node-1", GraphID: "graph-1", TenantID: "tenant-1", NodeType: "Service", Label: "svc1"}
	n2 := &Node{ID: "node-2", GraphID: "graph-1", TenantID: "tenant-1", NodeType: "Service", Label: "svc2"}
	s.nodes["node-1"] = n1
	s.nodes["node-2"] = n2
	s.nodeIDX["node-1"] = "graph-1"
	s.nodeIDX["node-2"] = "graph-1"

	result, err := s.ListNodes(ctx, "tenant-1", "graph-1")
	require.NoError(t, err)
	assert.Len(t, result, 2)
}

func TestInMemoryStore_DeleteGraph(t *testing.T) {
	s := NewInMemoryStore()
	ctx := context.Background()

	g := &Graph{ID: "graph-1", TenantID: "tenant-1", Name: "test"}
	s.graphs["graph-1"] = g

	err := s.DeleteGraph(ctx, "tenant-1", "graph-1")
	require.NoError(t, err)

	_, err = s.GetGraph(ctx, "tenant-1", "graph-1")
	assert.Error(t, err)
}

func TestInMemoryStore_QueryGraph_BFS(t *testing.T) {
	s := NewInMemoryStore()
	ctx := context.Background()

	// Create a simple graph: node1 -> node2 -> node3
	n1 := &Node{ID: "n1", GraphID: "g1", TenantID: "t1", NodeType: "Service", Label: "service1"}
	n2 := &Node{ID: "n2", GraphID: "g1", TenantID: "t1", NodeType: "Service", Label: "service2"}
	n3 := &Node{ID: "n3", GraphID: "g1", TenantID: "t1", NodeType: "Service", Label: "service3"}

	s.nodes["n1"] = n1
	s.nodes["n2"] = n2
	s.nodes["n3"] = n3
	s.nodeIDX["n1"] = "g1"
	s.nodeIDX["n2"] = "g1"
	s.nodeIDX["n3"] = "g1"

	e1 := &Edge{ID: "e1", GraphID: "g1", TenantID: "t1", FromNodeID: "n1", ToNodeID: "n2", RelationshipType: "depends"}
	e2 := &Edge{ID: "e2", GraphID: "g1", TenantID: "t1", FromNodeID: "n2", ToNodeID: "n3", RelationshipType: "depends"}

	s.edges["e1"] = e1
	s.edges["e2"] = e2

	nodes, edges, err := s.QueryGraph(ctx, "t1", "g1", "n1", 2)
	require.NoError(t, err)
	assert.Greater(t, len(nodes), 0)
	assert.Greater(t, len(edges), 0)
}
