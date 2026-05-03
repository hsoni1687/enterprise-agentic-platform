module github.com/a1-agent-engine/mcp-registry

go 1.23

require (
	github.com/google/uuid v1.5.0
	github.com/lib/pq v1.10.9
	github.com/a1-agent-engine/go-shared v0.0.0
)

replace github.com/a1-agent-engine/go-shared => ../../packages/go-shared
