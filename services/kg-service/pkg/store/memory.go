package store

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"sync"

	"github.com/pgvector/pgvector-go"
)

type InMemoryStore struct {
	mu      sync.RWMutex
	graphs  map[string]*Graph
	nodes   map[string]*Node
	edges   map[string]*Edge
	nodeIDX map[string]string // nodeID -> graphID for easy lookup
}

func NewInMemoryStore() *InMemoryStore {
	return &InMemoryStore{
		graphs:  make(map[string]*Graph),
		nodes:   make(map[string]*Node),
		edges:   make(map[string]*Edge),
		nodeIDX: make(map[string]string),
	}
}

func (ms *InMemoryStore) CreateGraph(ctx context.Context, g *Graph) (*Graph, error) {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	if g.ID == "" {
		// Generate UUID-like ID for in-memory store
		g.ID = randID()
	}
	ms.graphs[g.ID] = g
	return g, nil
}

func (ms *InMemoryStore) GetGraph(ctx context.Context, tenantID, graphID string) (*Graph, error) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	g, ok := ms.graphs[graphID]
	if !ok || g.TenantID != tenantID {
		return nil, errors.New("graph not found")
	}
	return g, nil
}

func (ms *InMemoryStore) ListGraphs(ctx context.Context, tenantID string) ([]*Graph, error) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	var result []*Graph
	for _, g := range ms.graphs {
		if g.TenantID == tenantID {
			result = append(result, g)
		}
	}
	return result, nil
}

func (ms *InMemoryStore) UpdateGraph(ctx context.Context, g *Graph) (*Graph, error) {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	existing, ok := ms.graphs[g.ID]
	if !ok || existing.TenantID != g.TenantID {
		return nil, errors.New("graph not found")
	}
	ms.graphs[g.ID] = g
	return g, nil
}

func (ms *InMemoryStore) UpdateGraphScope(ctx context.Context, tenantID, graphID string, scope string, sharedWith []string) error {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	g, ok := ms.graphs[graphID]
	if !ok || g.TenantID != tenantID {
		return errors.New("graph not found")
	}
	g.Scope = scope
	g.SharedWith = sharedWith
	return nil
}

func (ms *InMemoryStore) DeleteGraph(ctx context.Context, tenantID, graphID string) error {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	g, ok := ms.graphs[graphID]
	if !ok || g.TenantID != tenantID {
		return errors.New("graph not found")
	}
	delete(ms.graphs, graphID)

	// Clean up nodes/edges for this graph
	for nID, n := range ms.nodes {
		if n.GraphID == graphID {
			delete(ms.nodes, nID)
			delete(ms.nodeIDX, nID)
		}
	}
	for eID, e := range ms.edges {
		if e.GraphID == graphID {
			delete(ms.edges, eID)
		}
	}
	return nil
}

func (ms *InMemoryStore) CreateNode(ctx context.Context, n *Node) (*Node, error) {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	if n.ID == "" {
		n.ID = randID()
	}
	ms.nodes[n.ID] = n
	ms.nodeIDX[n.ID] = n.GraphID
	return n, nil
}

func (ms *InMemoryStore) GetNode(ctx context.Context, tenantID, nodeID string) (*Node, error) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	n, ok := ms.nodes[nodeID]
	if !ok || n.TenantID != tenantID {
		return nil, errors.New("node not found")
	}
	return n, nil
}

func (ms *InMemoryStore) ListNodes(ctx context.Context, tenantID, graphID string) ([]*Node, error) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	var result []*Node
	for _, n := range ms.nodes {
		if n.GraphID == graphID && n.TenantID == tenantID {
			result = append(result, n)
		}
	}
	return result, nil
}

func (ms *InMemoryStore) DeleteNode(ctx context.Context, tenantID, nodeID string) error {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	n, ok := ms.nodes[nodeID]
	if !ok || n.TenantID != tenantID {
		return errors.New("node not found")
	}
	delete(ms.nodes, nodeID)
	delete(ms.nodeIDX, nodeID)

	// Clean up edges referencing this node
	for eID, e := range ms.edges {
		if e.FromNodeID == nodeID || e.ToNodeID == nodeID {
			delete(ms.edges, eID)
		}
	}
	return nil
}

func (ms *InMemoryStore) CreateEdge(ctx context.Context, e *Edge) (*Edge, error) {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	if e.ID == "" {
		e.ID = randID()
	}
	ms.edges[e.ID] = e
	return e, nil
}

func (ms *InMemoryStore) GetEdge(ctx context.Context, tenantID, edgeID string) (*Edge, error) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	e, ok := ms.edges[edgeID]
	if !ok || e.TenantID != tenantID {
		return nil, errors.New("edge not found")
	}
	return e, nil
}

func (ms *InMemoryStore) ListEdges(ctx context.Context, tenantID, graphID string) ([]*Edge, error) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	var result []*Edge
	for _, e := range ms.edges {
		if e.GraphID == graphID && e.TenantID == tenantID {
			result = append(result, e)
		}
	}
	return result, nil
}

func (ms *InMemoryStore) ListEdgesFrom(ctx context.Context, tenantID, fromNodeID string) ([]*Edge, error) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	var result []*Edge
	for _, e := range ms.edges {
		if e.FromNodeID == fromNodeID && e.TenantID == tenantID {
			result = append(result, e)
		}
	}
	return result, nil
}

func (ms *InMemoryStore) ListEdgesTo(ctx context.Context, tenantID, toNodeID string) ([]*Edge, error) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	var result []*Edge
	for _, e := range ms.edges {
		if e.ToNodeID == toNodeID && e.TenantID == tenantID {
			result = append(result, e)
		}
	}
	return result, nil
}

func (ms *InMemoryStore) DeleteEdge(ctx context.Context, tenantID, edgeID string) error {
	ms.mu.Lock()
	defer ms.mu.Unlock()

	e, ok := ms.edges[edgeID]
	if !ok || e.TenantID != tenantID {
		return errors.New("edge not found")
	}
	delete(ms.edges, edgeID)
	return nil
}

func (ms *InMemoryStore) QueryGraph(ctx context.Context, tenantID, graphID, startNodeID string, maxDepth int) ([]*Node, []*Edge, error) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	visited := make(map[string]bool)
	var resultNodes []*Node
	var resultEdges []*Edge

	// BFS from startNodeID
	queue := []string{startNodeID}
	depth := 0

	for len(queue) > 0 && depth < maxDepth {
		var nextQueue []string
		for _, nID := range queue {
			if visited[nID] {
				continue
			}
			visited[nID] = true

			if n, ok := ms.nodes[nID]; ok && n.GraphID == graphID && n.TenantID == tenantID {
				resultNodes = append(resultNodes, n)

				// Find connected edges
				for _, e := range ms.edges {
					if e.GraphID == graphID && e.TenantID == tenantID {
						if e.FromNodeID == nID {
							resultEdges = append(resultEdges, e)
							if !visited[e.ToNodeID] {
								nextQueue = append(nextQueue, e.ToNodeID)
							}
						} else if e.ToNodeID == nID {
							resultEdges = append(resultEdges, e)
							if !visited[e.FromNodeID] {
								nextQueue = append(nextQueue, e.FromNodeID)
							}
						}
					}
				}
			}
		}
		queue = nextQueue
		depth++
	}

	return resultNodes, resultEdges, nil
}

func (ms *InMemoryStore) SearchNodes(ctx context.Context, tenantID, graphID, nodeType string, limit int) ([]*Node, error) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	var result []*Node
	for _, n := range ms.nodes {
		if n.GraphID == graphID && n.TenantID == tenantID && n.NodeType == nodeType {
			result = append(result, n)
			if len(result) >= limit {
				break
			}
		}
	}
	return result, nil
}

func (ms *InMemoryStore) SearchNodesByEmbedding(ctx context.Context, tenantID, graphID string, embedding *pgvector.Vector, limit int) ([]*Node, error) {
	ms.mu.RLock()
	defer ms.mu.RUnlock()

	// In-memory store doesn't support vector search, return empty
	return []*Node{}, nil
}

func (ms *InMemoryStore) Health(ctx context.Context) error {
	return nil
}

func randID() string {
	// Simple random ID for in-memory use
	return fmt.Sprintf("%x", rand.Int63())
}
