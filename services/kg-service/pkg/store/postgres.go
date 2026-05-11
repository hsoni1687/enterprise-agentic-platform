package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/lib/pq"
	"github.com/pgvector/pgvector-go"
)

type PostgresStore struct {
	db *sql.DB
}

func NewPostgresStore(db *sql.DB) (*PostgresStore, error) {
	if err := db.PingContext(context.Background()); err != nil {
		return nil, fmt.Errorf("database connection failed: %w", err)
	}
	return &PostgresStore{db: db}, nil
}

// ============== Graphs ==============

func (ps *PostgresStore) CreateGraph(ctx context.Context, g *Graph) (*Graph, error) {
	tenantID := ctx.Value("tenant_id")
	if tenantID == nil {
		return nil, errors.New("tenant_id not in context")
	}

	schemaJSON, _ := json.Marshal(g.Schema)
	sharedWithArray := pq.Array(g.SharedWith)

	var schemaBytes []byte
	err := ps.db.QueryRowContext(ctx,
		`INSERT INTO kg_graphs (tenant_id, name, domain, description, scope, shared_with, schema)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, tenant_id, name, domain, description, scope, shared_with, schema, created_at, updated_at`,
		tenantID, g.Name, g.Domain, g.Description, g.Scope, sharedWithArray, string(schemaJSON),
	).Scan(&g.ID, &g.TenantID, &g.Name, &g.Domain, &g.Description, &g.Scope, pq.Array(&g.SharedWith), &schemaBytes, &g.CreatedAt, &g.UpdatedAt)

	if err != nil {
		if err.Error() == "pq: duplicate key value violates unique constraint \"kg_graphs_tenant_id_name_key\"" {
			return nil, fmt.Errorf("graph with name %q already exists in this tenant", g.Name)
		}
		return nil, err
	}
	json.Unmarshal(schemaBytes, &g.Schema)
	return g, nil
}

func (ps *PostgresStore) GetGraph(ctx context.Context, tenantID, graphID string) (*Graph, error) {
	g := &Graph{}
	var schemaBytes []byte
	err := ps.db.QueryRowContext(ctx,
		`SELECT id, tenant_id, name, domain, description, scope, shared_with, schema, created_at, updated_at
		FROM kg_graphs WHERE id = $1 AND tenant_id = $2`,
		graphID, tenantID,
	).Scan(&g.ID, &g.TenantID, &g.Name, &g.Domain, &g.Description, &g.Scope, pq.Array(&g.SharedWith), &schemaBytes, &g.CreatedAt, &g.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, errors.New("graph not found")
	}
	if err != nil {
		return nil, err
	}

	json.Unmarshal(schemaBytes, &g.Schema)
	return g, nil
}

func (ps *PostgresStore) ListGraphs(ctx context.Context, tenantID string) ([]*Graph, error) {
	rows, err := ps.db.QueryContext(ctx,
		`SELECT id, tenant_id, name, domain, description, scope, shared_with, schema, created_at, updated_at
		FROM kg_graphs WHERE tenant_id = $1 ORDER BY created_at DESC`,
		tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var graphs []*Graph
	for rows.Next() {
		g := &Graph{}
		var schemaBytes []byte
		if err := rows.Scan(&g.ID, &g.TenantID, &g.Name, &g.Domain, &g.Description, &g.Scope, pq.Array(&g.SharedWith), &schemaBytes, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return nil, err
		}
		json.Unmarshal(schemaBytes, &g.Schema)
		graphs = append(graphs, g)
	}
	return graphs, rows.Err()
}

func (ps *PostgresStore) UpdateGraph(ctx context.Context, g *Graph) (*Graph, error) {
	schemaJSON, _ := json.Marshal(g.Schema)

	err := ps.db.QueryRowContext(ctx,
		`UPDATE kg_graphs SET name = $1, domain = $2, description = $3, schema = $4, updated_at = now()
		WHERE id = $5 AND tenant_id = $6
		RETURNING id, tenant_id, name, domain, description, scope, shared_with, schema, created_at, updated_at`,
		g.Name, g.Domain, g.Description, string(schemaJSON), g.ID, g.TenantID,
	).Scan(&g.ID, &g.TenantID, &g.Name, &g.Domain, &g.Description, &g.Scope, pq.Array(&g.SharedWith), &g.Schema, &g.CreatedAt, &g.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, errors.New("graph not found")
	}
	return g, err
}

func (ps *PostgresStore) UpdateGraphScope(ctx context.Context, tenantID, graphID string, scope string, sharedWith []string) error {
	sharedWithArray := pq.Array(sharedWith)
	_, err := ps.db.ExecContext(ctx,
		`UPDATE kg_graphs SET scope = $1, shared_with = $2, updated_at = now()
		WHERE id = $3 AND tenant_id = $4`,
		scope, sharedWithArray, graphID, tenantID,
	)
	return err
}

func (ps *PostgresStore) DeleteGraph(ctx context.Context, tenantID, graphID string) error {
	_, err := ps.db.ExecContext(ctx,
		`DELETE FROM kg_graphs WHERE id = $1 AND tenant_id = $2`,
		graphID, tenantID,
	)
	return err
}

// ============== Nodes ==============

func (ps *PostgresStore) CreateNode(ctx context.Context, n *Node) (*Node, error) {
	propsJSON, _ := json.Marshal(n.Properties)

	var embeddingSQL interface{} = nil
	if n.Embedding != nil {
		embeddingSQL = n.Embedding
	}

	err := ps.db.QueryRowContext(ctx,
		`INSERT INTO kg_nodes (graph_id, tenant_id, node_type, label, properties, embedding)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, graph_id, tenant_id, node_type, label, properties, embedding, created_at, updated_at`,
		n.GraphID, n.TenantID, n.NodeType, n.Label, string(propsJSON), embeddingSQL,
	).Scan(&n.ID, &n.GraphID, &n.TenantID, &n.NodeType, &n.Label, &n.Properties, &n.Embedding, &n.CreatedAt, &n.UpdatedAt)

	if err != nil {
		return nil, err
	}
	return n, nil
}

func (ps *PostgresStore) GetNode(ctx context.Context, tenantID, nodeID string) (*Node, error) {
	n := &Node{}
	err := ps.db.QueryRowContext(ctx,
		`SELECT id, graph_id, tenant_id, node_type, label, properties, embedding, created_at, updated_at
		FROM kg_nodes WHERE id = $1 AND tenant_id = $2`,
		nodeID, tenantID,
	).Scan(&n.ID, &n.GraphID, &n.TenantID, &n.NodeType, &n.Label, &n.Properties, &n.Embedding, &n.CreatedAt, &n.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, errors.New("node not found")
	}
	return n, err
}

func (ps *PostgresStore) ListNodes(ctx context.Context, tenantID, graphID string) ([]*Node, error) {
	rows, err := ps.db.QueryContext(ctx,
		`SELECT id, graph_id, tenant_id, node_type, label, properties, embedding, created_at, updated_at
		FROM kg_nodes WHERE graph_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`,
		graphID, tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var nodes []*Node
	for rows.Next() {
		n := &Node{}
		if err := rows.Scan(&n.ID, &n.GraphID, &n.TenantID, &n.NodeType, &n.Label, &n.Properties, &n.Embedding, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		nodes = append(nodes, n)
	}
	return nodes, rows.Err()
}

func (ps *PostgresStore) DeleteNode(ctx context.Context, tenantID, nodeID string) error {
	_, err := ps.db.ExecContext(ctx,
		`DELETE FROM kg_nodes WHERE id = $1 AND tenant_id = $2`,
		nodeID, tenantID,
	)
	return err
}

// ============== Edges ==============

func (ps *PostgresStore) CreateEdge(ctx context.Context, e *Edge) (*Edge, error) {
	propsJSON, _ := json.Marshal(e.Properties)

	err := ps.db.QueryRowContext(ctx,
		`INSERT INTO kg_edges (graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties, weight)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties, weight, created_at, updated_at`,
		e.GraphID, e.TenantID, e.FromNodeID, e.ToNodeID, e.RelationshipType, string(propsJSON), e.Weight,
	).Scan(&e.ID, &e.GraphID, &e.TenantID, &e.FromNodeID, &e.ToNodeID, &e.RelationshipType, &e.Properties, &e.Weight, &e.CreatedAt, &e.UpdatedAt)

	return e, err
}

func (ps *PostgresStore) GetEdge(ctx context.Context, tenantID, edgeID string) (*Edge, error) {
	e := &Edge{}
	err := ps.db.QueryRowContext(ctx,
		`SELECT id, graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties, weight, created_at, updated_at
		FROM kg_edges WHERE id = $1 AND tenant_id = $2`,
		edgeID, tenantID,
	).Scan(&e.ID, &e.GraphID, &e.TenantID, &e.FromNodeID, &e.ToNodeID, &e.RelationshipType, &e.Properties, &e.Weight, &e.CreatedAt, &e.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, errors.New("edge not found")
	}
	return e, err
}

func (ps *PostgresStore) ListEdges(ctx context.Context, tenantID, graphID string) ([]*Edge, error) {
	rows, err := ps.db.QueryContext(ctx,
		`SELECT id, graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties, weight, created_at, updated_at
		FROM kg_edges WHERE graph_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`,
		graphID, tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var edges []*Edge
	for rows.Next() {
		e := &Edge{}
		if err := rows.Scan(&e.ID, &e.GraphID, &e.TenantID, &e.FromNodeID, &e.ToNodeID, &e.RelationshipType, &e.Properties, &e.Weight, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, err
		}
		edges = append(edges, e)
	}
	return edges, rows.Err()
}

func (ps *PostgresStore) ListEdgesFrom(ctx context.Context, tenantID, fromNodeID string) ([]*Edge, error) {
	rows, err := ps.db.QueryContext(ctx,
		`SELECT id, graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties, weight, created_at, updated_at
		FROM kg_edges WHERE from_node_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`,
		fromNodeID, tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var edges []*Edge
	for rows.Next() {
		e := &Edge{}
		if err := rows.Scan(&e.ID, &e.GraphID, &e.TenantID, &e.FromNodeID, &e.ToNodeID, &e.RelationshipType, &e.Properties, &e.Weight, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, err
		}
		edges = append(edges, e)
	}
	return edges, rows.Err()
}

func (ps *PostgresStore) ListEdgesTo(ctx context.Context, tenantID, toNodeID string) ([]*Edge, error) {
	rows, err := ps.db.QueryContext(ctx,
		`SELECT id, graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties, weight, created_at, updated_at
		FROM kg_edges WHERE to_node_id = $1 AND tenant_id = $2 ORDER BY created_at DESC`,
		toNodeID, tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var edges []*Edge
	for rows.Next() {
		e := &Edge{}
		if err := rows.Scan(&e.ID, &e.GraphID, &e.TenantID, &e.FromNodeID, &e.ToNodeID, &e.RelationshipType, &e.Properties, &e.Weight, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, err
		}
		edges = append(edges, e)
	}
	return edges, rows.Err()
}

func (ps *PostgresStore) DeleteEdge(ctx context.Context, tenantID, edgeID string) error {
	_, err := ps.db.ExecContext(ctx,
		`DELETE FROM kg_edges WHERE id = $1 AND tenant_id = $2`,
		edgeID, tenantID,
	)
	return err
}

// ============== Query ==============

func (ps *PostgresStore) QueryGraph(ctx context.Context, tenantID, graphID, startNodeID string, maxDepth int) ([]*Node, []*Edge, error) {
	// BFS traversal from startNodeID up to maxDepth
	// Returns all reachable nodes and edges
	var nodes []*Node
	var edges []*Edge

	query := `
	WITH RECURSIVE traversal AS (
		SELECT id, graph_id, tenant_id, node_type, label, properties, embedding, created_at, updated_at, 0 as depth
		FROM kg_nodes
		WHERE id = $1 AND graph_id = $2 AND tenant_id = $3

		UNION ALL

		SELECT n.id, n.graph_id, n.tenant_id, n.node_type, n.label, n.properties, n.embedding, n.created_at, n.updated_at, t.depth + 1
		FROM kg_nodes n
		JOIN kg_edges e ON (n.id = e.from_node_id OR n.id = e.to_node_id)
		JOIN traversal t ON (e.from_node_id = t.id OR e.to_node_id = t.id)
		WHERE e.graph_id = $2 AND e.tenant_id = $3 AND t.depth < $4
	)
	SELECT DISTINCT id, graph_id, tenant_id, node_type, label, properties, embedding, created_at, updated_at
	FROM traversal
	`

	rows, err := ps.db.QueryContext(ctx, query, startNodeID, graphID, tenantID, maxDepth)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	nodeIDs := make(map[string]bool)
	for rows.Next() {
		n := &Node{}
		if err := rows.Scan(&n.ID, &n.GraphID, &n.TenantID, &n.NodeType, &n.Label, &n.Properties, &n.Embedding, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, nil, err
		}
		nodes = append(nodes, n)
		nodeIDs[n.ID] = true
	}

	// Get all edges between traversed nodes
	edgeRows, err := ps.db.QueryContext(ctx,
		`SELECT id, graph_id, tenant_id, from_node_id, to_node_id, relationship_type, properties, weight, created_at, updated_at
		FROM kg_edges
		WHERE graph_id = $1 AND tenant_id = $2`,
		graphID, tenantID,
	)
	if err != nil {
		return nil, nil, err
	}
	defer edgeRows.Close()

	for edgeRows.Next() {
		e := &Edge{}
		if err := edgeRows.Scan(&e.ID, &e.GraphID, &e.TenantID, &e.FromNodeID, &e.ToNodeID, &e.RelationshipType, &e.Properties, &e.Weight, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, nil, err
		}
		if nodeIDs[e.FromNodeID] && nodeIDs[e.ToNodeID] {
			edges = append(edges, e)
		}
	}

	return nodes, edges, edgeRows.Err()
}

func (ps *PostgresStore) SearchNodes(ctx context.Context, tenantID, graphID, nodeType string, limit int) ([]*Node, error) {
	rows, err := ps.db.QueryContext(ctx,
		`SELECT id, graph_id, tenant_id, node_type, label, properties, embedding, created_at, updated_at
		FROM kg_nodes
		WHERE graph_id = $1 AND tenant_id = $2 AND node_type = $3
		ORDER BY created_at DESC
		LIMIT $4`,
		graphID, tenantID, nodeType, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var nodes []*Node
	for rows.Next() {
		n := &Node{}
		if err := rows.Scan(&n.ID, &n.GraphID, &n.TenantID, &n.NodeType, &n.Label, &n.Properties, &n.Embedding, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		nodes = append(nodes, n)
	}
	return nodes, rows.Err()
}

func (ps *PostgresStore) SearchNodesByEmbedding(ctx context.Context, tenantID, graphID string, embedding *pgvector.Vector, limit int) ([]*Node, error) {
	rows, err := ps.db.QueryContext(ctx,
		`SELECT id, graph_id, tenant_id, node_type, label, properties, embedding, created_at, updated_at
		FROM kg_nodes
		WHERE graph_id = $1 AND tenant_id = $2 AND embedding IS NOT NULL
		ORDER BY embedding <-> $3
		LIMIT $4`,
		graphID, tenantID, embedding, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var nodes []*Node
	for rows.Next() {
		n := &Node{}
		if err := rows.Scan(&n.ID, &n.GraphID, &n.TenantID, &n.NodeType, &n.Label, &n.Properties, &n.Embedding, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		nodes = append(nodes, n)
	}
	return nodes, rows.Err()
}

func (ps *PostgresStore) Health(ctx context.Context) error {
	return ps.db.PingContext(ctx)
}
