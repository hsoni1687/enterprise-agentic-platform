module github.com/a1-agent-engine/mcp-server

go 1.23

require (
	github.com/lib/pq v1.10.9
)

require github.com/a1-agent-engine/go-shared v0.0.0

replace github.com/a1-agent-engine/go-shared => ../../packages/go-shared
