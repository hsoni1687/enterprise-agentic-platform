module github.com/agent-platform/skill-dispatcher

go 1.23

require (
	github.com/agent-platform/go-shared v0.0.0-00010101000000-000000000000
	github.com/agent-platform/hook-engine v0.0.0-00010101000000-000000000000
	github.com/stretchr/testify v1.11.1
)

require (
	github.com/davecgh/go-spew v1.1.2-0.20180830191138-d8f796af33cc // indirect
	github.com/kr/text v0.2.0 // indirect
	github.com/pmezard/go-difflib v1.0.1-0.20181226105442-5d4384ee4fb2 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

replace github.com/agent-platform/go-shared => ../../packages/go-shared

replace github.com/agent-platform/hook-engine => ../../packages/hook-engine
