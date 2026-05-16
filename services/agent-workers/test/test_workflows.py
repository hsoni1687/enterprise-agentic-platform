import pytest
import respx
import httpx
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from workflows import AgentWorkflow
from activities_agent import (
    execute_code,
    reasoning_step,
    pydantic_ai_reasoning_step,
    discover_mcp_tools,
    invoke_mcp_tool,
    resolve_mcp_servers,
)
from activities_memory import recall_memories, store_memory


@pytest.mark.asyncio
async def test_agent_reasoning_loop():
    async with await WorkflowEnvironment.start_local() as env:
        with respx.mock:
            # Mock LLM Gateway: first call returns a tool call, second returns a final answer.
            respx.post("http://localhost:4000/v1/chat/completions").mock(
                side_effect=[
                    httpx.Response(200, json={
                        "id": "mock-1",
                        "object": "chat.completion",
                        "model": "mock-gpt-4o",
                        "created": 1234567890,
                        "choices": [{
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": None,
                                "tool_calls": [{
                                    "id": "c1",
                                    "type": "function",
                                    "function": {
                                        "name": "execute_code",
                                        "arguments": '{"code": "print(4)"}'
                                    }
                                }]
                            },
                            "finish_reason": "tool_calls"
                        }]
                    }),
                    httpx.Response(200, json={
                        "id": "mock-2",
                        "object": "chat.completion",
                        "model": "mock-gpt-4o",
                        "created": 1234567891,
                        "choices": [{
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": "The answer is 4.",
                                "tool_calls": None
                            },
                            "finish_reason": "stop"
                        }]
                    }),
                ]
            )

            # Mock embedding calls (recall_memories + store_memory both call this)
            respx.post("http://localhost:4000/v1/embeddings").mock(
                return_value=httpx.Response(200, json={
                    "object": "list",
                    "data": [{"object": "embedding", "index": 0, "embedding": [0.1] * 1536}],
                    "model": "mock-embedding-v1"
                })
            )

            # Mock Sandbox Manager
            respx.post("http://localhost:8082/api/v1/execute").mock(
                return_value=httpx.Response(200, json={"result": "4"})
            )

            async with Worker(
                env.client,
                task_queue="test-reasoning-queue",
                workflows=[AgentWorkflow],
                activities=[
                    execute_code,
                    reasoning_step,
                    pydantic_ai_reasoning_step,
                    discover_mcp_tools,
                    invoke_mcp_tool,
                    resolve_mcp_servers,
                    recall_memories,
                    store_memory,
                ],
            ):
                request = {
                    "agent_id": "math-agent",
                    "payload": {"prompt": "What is 2+2?"},
                    "model": "mock-gpt-4o"
                }

                result = await env.client.execute_workflow(
                    AgentWorkflow.run,
                    request,
                    id="reasoning-wf-test",
                    task_queue="test-reasoning-queue",
                )

                assert "The answer is 4" in result


@pytest.mark.asyncio
async def test_agent_no_tool_calls():
    """Workflow completes in one iteration when LLM returns a direct answer."""
    async with await WorkflowEnvironment.start_local() as env:
        with respx.mock:
            respx.post("http://localhost:4000/v1/chat/completions").mock(
                return_value=httpx.Response(200, json={
                    "id": "mock-direct",
                    "object": "chat.completion",
                    "model": "mock-gpt-4o",
                    "created": 1234567890,
                    "choices": [{
                        "index": 0,
                        "message": {"role": "assistant", "content": "Paris is the capital of France.", "tool_calls": None},
                        "finish_reason": "stop"
                    }]
                })
            )
            respx.post("http://localhost:4000/v1/embeddings").mock(
                return_value=httpx.Response(200, json={
                    "object": "list",
                    "data": [{"object": "embedding", "index": 0, "embedding": [0.0] * 1536}],
                    "model": "mock-embedding-v1"
                })
            )

            async with Worker(
                env.client,
                task_queue="test-direct-queue",
                workflows=[AgentWorkflow],
                activities=[
                    execute_code,
                    reasoning_step,
                    pydantic_ai_reasoning_step,
                    discover_mcp_tools,
                    invoke_mcp_tool,
                    resolve_mcp_servers,
                    recall_memories,
                    store_memory,
                ],
            ):
                request = {
                    "agent_id": "geo-agent",
                    "payload": {"prompt": "What is the capital of France?"},
                    "model": "mock-gpt-4o"
                }

                result = await env.client.execute_workflow(
                    AgentWorkflow.run,
                    request,
                    id="direct-answer-wf-test",
                    task_queue="test-direct-queue",
                )

                assert "Paris" in result


@pytest.mark.asyncio
async def test_agent_mcp_tool_call():
    """Workflow discovers and invokes MCP tools."""
    async with await WorkflowEnvironment.start_local() as env:
        with respx.mock:
            # Mock MCP Registry: list servers for tenant (returns one global MCP server)
            respx.get("http://localhost:8090/api/v1/mcp/servers").mock(
                return_value=httpx.Response(200, json={
                    "servers": [{
                        "id": "mcp-server-1",
                        "tenant_id": "platform-system",
                        "name": "github-mcp",
                        "url": "http://localhost:3001",
                        "enabled": True,
                        "scope": "global",
                        "created_at": "2026-05-03T00:00:00Z",
                        "updated_at": "2026-05-03T00:00:00Z"
                    }],
                    "count": 1
                })
            )

            # Mock MCP Server: discover tools
            respx.get("http://localhost:8090/api/v1/mcp/servers/mcp-server-1/tools").mock(
                return_value=httpx.Response(200, json={
                    "tools": [{
                        "name": "list_repos",
                        "description": "List repositories",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "owner": {"type": "string"}
                            },
                            "required": ["owner"]
                        },
                        "server_name": "github-mcp"
                    }],
                    "count": 1
                })
            )

            # Mock LLM Gateway: first call returns MCP tool call, second returns final answer
            respx.post("http://localhost:4000/v1/chat/completions").mock(
                side_effect=[
                    httpx.Response(200, json={
                        "id": "mock-mcp-1",
                        "object": "chat.completion",
                        "model": "mock-gpt-4o",
                        "created": 1234567890,
                        "choices": [{
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": None,
                                "tool_calls": [{
                                    "id": "c1",
                                    "type": "function",
                                    "function": {
                                        "name": "mcp__github-mcp__list_repos",
                                        "arguments": '{"owner": "anthropics"}'
                                    }
                                }]
                            },
                            "finish_reason": "tool_calls"
                        }]
                    }),
                    httpx.Response(200, json={
                        "id": "mock-mcp-2",
                        "object": "chat.completion",
                        "model": "mock-gpt-4o",
                        "created": 1234567891,
                        "choices": [{
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": "Found 5 repositories from anthropics.",
                                "tool_calls": None
                            },
                            "finish_reason": "stop"
                        }]
                    }),
                ]
            )

            # Mock MCP tool invocation
            respx.post("http://localhost:8090/api/v1/mcp/servers/mcp-server-1/call").mock(
                return_value=httpx.Response(200, json={
                    "result": '{"repos": ["claude", "anthropic-sdk", "vscode"]}'
                })
            )

            # Mock embeddings
            respx.post("http://localhost:4000/v1/embeddings").mock(
                return_value=httpx.Response(200, json={
                    "object": "list",
                    "data": [{"object": "embedding", "index": 0, "embedding": [0.1] * 1536}],
                    "model": "mock-embedding-v1"
                })
            )

            async with Worker(
                env.client,
                task_queue="test-mcp-queue",
                workflows=[AgentWorkflow],
                activities=[
                    execute_code,
                    reasoning_step,
                    pydantic_ai_reasoning_step,
                    discover_mcp_tools,
                    invoke_mcp_tool,
                    resolve_mcp_servers,
                    recall_memories,
                    store_memory,
                ],
            ):
                request = {
                    "agent_id": "github-agent",
                    "tenant_id": "default-tenant",
                    "payload": {"prompt": "List repos from anthropics"},
                    "model": "mock-gpt-4o",
                    "manifest": {
                        "system_prompt": "You are a helpful assistant.",
                        "mcp_servers": [],  # No explicit servers, but global ones should be discovered
                    }
                }

                result = await env.client.execute_workflow(
                    AgentWorkflow.run,
                    request,
                    id="mcp-wf-test",
                    task_queue="test-mcp-queue",
                )

                assert "Found 5 repositories" in result
