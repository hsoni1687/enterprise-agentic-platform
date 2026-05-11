# KG Service

Knowledge Graph microservice for the A1 Agent Platform. Provides CRUD API for knowledge graphs, nodes, and edges with semantic search support via pgvector.

## Quick Start

### Local Development

```bash
cd services/kg-service
go mod download
go run main.go
# Runs on http://localhost:8093
```

### Testing

```bash
go test ./pkg/store -v
```

### Docker Build

```bash
docker build -f services/kg-service/Dockerfile -t kg-service:latest .
docker run -e DATABASE_URL="postgresql://user:pass@localhost:5432/kg" -p 8093:8093 kg-service:latest
```

## Endpoints

### Graphs

- `POST /graphs/create` - Create a new knowledge graph
- `GET /graphs/get?id=<graph_id>` - Get graph details
- `GET /graphs/list` - List all graphs for tenant
- `PUT /graphs/update` - Update graph metadata
- `PATCH /graphs/scope?id=<graph_id>` - Update graph scope (private/shared/global)
- `DELETE /graphs/delete?id=<graph_id>` - Delete graph

### Nodes

- `POST /nodes/create` - Create a node in graph
- `GET /nodes/get?id=<node_id>` - Get node details
- `GET /nodes/list?graph_id=<graph_id>` - List nodes in graph
- `DELETE /nodes/delete?id=<node_id>` - Delete node

### Edges

- `POST /edges/create` - Create edge between nodes
- `GET /edges/list?graph_id=<graph_id>` - List edges in graph
- `DELETE /edges/delete?id=<edge_id>` - Delete edge

### Query

- `GET /query?graph_id=<id>&start_node_id=<id>&max_depth=3` - BFS traversal from node
- `GET /search/nodes?graph_id=<id>&node_type=<type>&limit=100` - Search nodes by type

### Health

- `GET /health` - Health check

## Request Headers

All endpoints require:

```
X-Tenant-ID: <tenant-id>
```

## Data Models

### Graph

```json
{
  "id": "uuid",
  "tenant_id": "uuid",
  "name": "string",
  "domain": "string",
  "description": "string",
  "scope": "private|shared|global",
  "shared_with": ["tenant-id-1", "tenant-id-2"],
  "schema": { "entities": [], "relationships": [] },
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### Node

```json
{
  "id": "uuid",
  "graph_id": "uuid",
  "tenant_id": "uuid",
  "node_type": "string",
  "label": "string",
  "properties": { "custom": "data" },
  "embedding": [0.1, 0.2, ...],
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### Edge

```json
{
  "id": "uuid",
  "graph_id": "uuid",
  "tenant_id": "uuid",
  "from_node_id": "uuid",
  "to_node_id": "uuid",
  "relationship_type": "string",
  "properties": { "custom": "data" },
  "weight": 1.0,
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

## Architecture

- **Store Interface**: Abstraction for PostgreSQL and in-memory implementations
- **PostgreSQL**: Production store with RLS enforcement, pgvector for semantic search
- **In-Memory**: Development/testing store (no persistence)
- **HTTP Handler**: RESTful API with tenant isolation via X-Tenant-ID header

## Environment Variables

- `DATABASE_URL`: PostgreSQL connection string (optional, defaults to in-memory store)

## Database Schema

See [migration 018](../../infra/postgres/migrations/018_knowledge_graph.sql) for full schema including:

- `kg_graphs` - Graph instances with scope and sharing
- `kg_nodes` - Entities with optional embeddings
- `kg_edges` - Relationships with weights
- Row-Level Security policies for tenant isolation
