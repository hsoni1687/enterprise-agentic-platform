package store

import (
	"context"

	"github.com/pgvector/pgvector-go"
)

// Graph represents a knowledge graph
type Graph struct {
	ID          string    `json:"id"`
	TenantID    string    `json:"tenant_id"`
	Name        string    `json:"name"`
	Domain      string    `json:"domain,omitempty"`
	Description string    `json:"description,omitempty"`
	Scope       string    `json:"scope"` // private, shared, global
	SharedWith  []string  `json:"shared_with,omitempty"`
	Schema      map[string]interface{} `json:"schema,omitempty"`
	CreatedAt   string    `json:"created_at"`
	UpdatedAt   string    `json:"updated_at"`
}

// Node represents an entity in a knowledge graph
type Node struct {
	ID         string                 `json:"id"`
	GraphID    string                 `json:"graph_id"`
	TenantID   string                 `json:"tenant_id"`
	NodeType   string                 `json:"node_type"`
	Label      string                 `json:"label"`
	Properties map[string]interface{} `json:"properties,omitempty"`
	Embedding  *pgvector.Vector       `json:"embedding,omitempty"`
	CreatedAt  string                 `json:"created_at"`
	UpdatedAt  string                 `json:"updated_at"`
}

// Edge represents a relationship between nodes
type Edge struct {
	ID               string                 `json:"id"`
	GraphID          string                 `json:"graph_id"`
	TenantID         string                 `json:"tenant_id"`
	FromNodeID       string                 `json:"from_node_id"`
	ToNodeID         string                 `json:"to_node_id"`
	RelationshipType string                 `json:"relationship_type"`
	Properties       map[string]interface{} `json:"properties,omitempty"`
	Weight           float64                `json:"weight,omitempty"`
	CreatedAt        string                 `json:"created_at"`
	UpdatedAt        string                 `json:"updated_at"`
}

// Store defines the interface for KG data persistence
type Store interface {
	// Graphs
	CreateGraph(ctx context.Context, graph *Graph) (*Graph, error)
	GetGraph(ctx context.Context, tenantID, graphID string) (*Graph, error)
	ListGraphs(ctx context.Context, tenantID string) ([]*Graph, error)
	UpdateGraph(ctx context.Context, graph *Graph) (*Graph, error)
	UpdateGraphScope(ctx context.Context, tenantID, graphID string, scope string, sharedWith []string) error
	DeleteGraph(ctx context.Context, tenantID, graphID string) error

	// Nodes
	CreateNode(ctx context.Context, node *Node) (*Node, error)
	GetNode(ctx context.Context, tenantID, nodeID string) (*Node, error)
	ListNodes(ctx context.Context, tenantID, graphID string) ([]*Node, error)
	DeleteNode(ctx context.Context, tenantID, nodeID string) error

	// Edges
	CreateEdge(ctx context.Context, edge *Edge) (*Edge, error)
	GetEdge(ctx context.Context, tenantID, edgeID string) (*Edge, error)
	ListEdges(ctx context.Context, tenantID, graphID string) ([]*Edge, error)
	ListEdgesFrom(ctx context.Context, tenantID, fromNodeID string) ([]*Edge, error)
	ListEdgesTo(ctx context.Context, tenantID, toNodeID string) ([]*Edge, error)
	DeleteEdge(ctx context.Context, tenantID, edgeID string) error

	// Query
	QueryGraph(ctx context.Context, tenantID, graphID, startNodeID string, maxDepth int) ([]*Node, []*Edge, error)
	SearchNodes(ctx context.Context, tenantID, graphID, nodeType string, limit int) ([]*Node, error)
	SearchNodesByEmbedding(ctx context.Context, tenantID, graphID string, embedding *pgvector.Vector, limit int) ([]*Node, error)

	// Health
	Health(ctx context.Context) error
}
