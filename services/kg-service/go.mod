module github.com/agent-platform/kg-service

go 1.23

require (
	github.com/lib/pq v1.10.9
	github.com/pgvector/pgvector-go v0.1.1
)

require github.com/stretchr/testify v1.11.1 // indirect

replace github.com/agent-platform/go-shared => ../../packages/go-shared
