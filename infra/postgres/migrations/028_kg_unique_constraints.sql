-- Migration 028: Unique constraints on kg_nodes and kg_edges
-- Enables idempotent seed data via ON CONFLICT DO NOTHING.
--
-- kg_nodes:  (graph_id, label) must be unique within a graph
-- kg_edges:  (graph_id, from_node_id, to_node_id, relationship_type) must be unique
--
-- Safe for existing data: only fails if there are genuine duplicates.
-- On a fresh clone there are none. On a running instance the HTTP seeder
-- (seed_demo_data.sh) may have created duplicates — dedup first.

-- Deduplicate kg_nodes before adding constraint (keep oldest row per label)
DELETE FROM kg_nodes a
USING kg_nodes b
WHERE a.graph_id = b.graph_id
  AND a.label    = b.label
  AND a.created_at > b.created_at;

-- Deduplicate kg_edges before adding constraint (keep oldest row)
DELETE FROM kg_edges a
USING kg_edges b
WHERE a.graph_id          = b.graph_id
  AND a.from_node_id      = b.from_node_id
  AND a.to_node_id        = b.to_node_id
  AND a.relationship_type = b.relationship_type
  AND a.created_at        > b.created_at;

-- Add unique constraints
ALTER TABLE kg_nodes
  ADD CONSTRAINT kg_nodes_graph_label_unique
  UNIQUE (graph_id, label);

ALTER TABLE kg_edges
  ADD CONSTRAINT kg_edges_graph_from_to_rel_unique
  UNIQUE (graph_id, from_node_id, to_node_id, relationship_type);

INSERT INTO schema_migrations (version) VALUES ('028')
  ON CONFLICT (version) DO NOTHING;
