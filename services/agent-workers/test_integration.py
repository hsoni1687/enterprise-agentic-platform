#!/usr/bin/env python3
"""
Quick integration test to verify all components work together.
This doesn't require Temporal or external services.
"""

import sys
import asyncio
from models import AgentContext, ToolCall, ToolResult, AgentDecision, MCPToolDefinition
from pydantic_ai_agent import build_agent_with_tools, AgentToolRegistry


def test_models():
    """Test Pydantic models."""
    print("Testing Pydantic models...")

    # Test AgentContext
    context = AgentContext(
        agent_id="test-agent",
        tenant_id="test-tenant",
        prompt="What is 2+2?",
        model="gpt-4o",
        system_prompt="You are a math tutor",
        skills=[{"name": "calculator", "description": "Basic math"}],
    )
    assert context.agent_id == "test-agent"
    assert context.tenant_id == "test-tenant"
    print("  ✓ AgentContext")

    # Test ToolCall
    tool_call = ToolCall(id="1", name="execute_code", arguments={"code": "print(2+2)"})
    assert tool_call.name == "execute_code"
    print("  ✓ ToolCall")

    # Test ToolResult
    result = ToolResult(tool_call_id="1", success=True, content="4")
    assert result.success
    print("  ✓ ToolResult")

    # Test AgentDecision
    decision = AgentDecision(
        final_answer="The answer is 4",
        tool_calls=[tool_call],
        continue_loop=False,
    )
    assert decision.final_answer == "The answer is 4"
    print("  ✓ AgentDecision")

    # Test MCPToolDefinition
    mcp_tool = MCPToolDefinition(
        server_id="github-mcp",
        server_name="github",
        tool_name="list_repos",
        description="List repositories",
    )
    assert mcp_tool.qualified_name == "mcp__github__list_repos"
    print("  ✓ MCPToolDefinition")

    print("✓ All Pydantic models work correctly\n")


def test_tool_registry():
    """Test AgentToolRegistry initialization."""
    print("Testing AgentToolRegistry...")

    context = AgentContext(
        agent_id="test-agent",
        tenant_id="test-tenant",
        prompt="Test",
        skills=[],
    )

    registry = AgentToolRegistry(context, workflow_ref=None, mcp_tools=[])
    assert registry.context == context
    assert registry.mcp_tools == []
    print("  ✓ AgentToolRegistry initialization")

    print("✓ AgentToolRegistry works correctly\n")


async def test_imports():
    """Test all imports work."""
    print("Testing imports...")

    try:
        from models import (
            AgentContext,
            ToolCall,
            ToolResult,
            AgentDecision,
            SkillDefinition,
            MCPToolDefinition,
        )
        print("  ✓ models module")
    except Exception as e:
        print(f"  ✗ models module: {e}")
        return False

    try:
        from pydantic_ai_agent import (
            AgentToolRegistry,
            build_agent_with_tools,
            extract_tool_calls_from_response,
            convert_response_to_decision,
        )
        print("  ✓ pydantic_ai_agent module")
    except Exception as e:
        print(f"  ✗ pydantic_ai_agent module: {e}")
        return False

    try:
        from activities_agent import (
            execute_code,
            reasoning_step,
            pydantic_ai_reasoning_step,
            discover_mcp_tools,
            invoke_mcp_tool,
            invoke_skill,
            resolve_mcp_servers,
        )
        print("  ✓ activities_agent module")
    except Exception as e:
        print(f"  ✗ activities_agent module: {e}")
        return False

    try:
        from workflows import AgentWorkflow
        print("  ✓ workflows module")
    except Exception as e:
        print(f"  ✗ workflows module: {e}")
        return False

    print("✓ All imports successful\n")
    return True


async def test_type_validation():
    """Test Pydantic validation."""
    print("Testing Pydantic validation...")

    # Valid context
    try:
        context = AgentContext(
            agent_id="test",
            tenant_id="test",
            prompt="test",
        )
        print("  ✓ Valid AgentContext")
    except Exception as e:
        print(f"  ✗ Valid AgentContext: {e}")
        return False

    # Invalid context (missing required field)
    try:
        context = AgentContext(tenant_id="test")  # missing agent_id
        print("  ✗ Should have rejected AgentContext without agent_id")
        return False
    except Exception:
        print("  ✓ Rejects AgentContext without agent_id")

    print("✓ Pydantic validation works\n")
    return True


async def test_manifest_compatibility():
    """Test compatibility with existing agent manifests."""
    print("Testing manifest compatibility...")

    from pydantic_ai_agent import _convert_openai_tool_to_mcp_definition

    # Simulate existing manifest format
    existing_manifest = {
        "system_prompt": "You are a helpful assistant.",
        "model": "gpt-4o",
        "max_iterations": 5,
        "skills": [
            {"name": "analyze_logs", "description": "Analyze log files"},
            {"name": "query_db"},  # description is optional
        ],
        "mcp_servers": ["github-mcp", "slack-mcp"],
    }

    # Extract fields (as workflows.py does)
    system_prompt = existing_manifest.get("system_prompt") or "default"
    model = existing_manifest.get("model", "gpt-4o")
    max_iterations = int(existing_manifest.get("max_iterations", 5))
    skills = existing_manifest.get("skills", [])
    mcp_servers = existing_manifest.get("mcp_servers", [])

    # Create AgentContext (as workflows.py does)
    try:
        context = AgentContext(
            agent_id="existing-agent",
            tenant_id="existing-tenant",
            prompt="Test prompt",
            system_prompt=system_prompt,
            model=model,
            max_iterations=max_iterations,
            skills=skills,
            mcp_servers=mcp_servers,
        )
        assert context.system_prompt == "You are a helpful assistant."
        assert context.model == "gpt-4o"
        assert len(context.skills) == 2
        assert context.skills[0]["name"] == "analyze_logs"
        print("  ✓ AgentContext created from existing manifest format")
    except Exception as e:
        print(f"  ✗ Failed to create AgentContext from manifest: {e}")
        return False

    # Test MCP tool conversion (OpenAI format → MCPToolDefinition)
    try:
        openai_tool_format = {
            "type": "function",
            "function": {
                "name": "mcp__github__list_repos",
                "description": "List repositories",
                "parameters": {"type": "object"},
            },
            "__mcp_meta": {
                "server_id": "mcp-server-1",
                "tool_name": "list_repos",
            },
        }

        mcp_def = _convert_openai_tool_to_mcp_definition(openai_tool_format)
        assert mcp_def.server_id == "mcp-server-1"
        assert mcp_def.server_name == "github"
        assert mcp_def.tool_name == "list_repos"
        assert mcp_def.qualified_name == "mcp__github__list_repos"
        print("  ✓ MCP tool conversion from OpenAI format works")
    except Exception as e:
        print(f"  ✗ MCP tool conversion failed: {e}")
        return False

    print("✓ Manifest compatibility verified\n")
    return True


async def main():
    """Run all tests."""
    print("=" * 60)
    print("PydanticAI + Temporal Integration Test Suite")
    print("=" * 60 + "\n")

    test_models()
    test_tool_registry()

    if not await test_imports():
        sys.exit(1)

    if not await test_type_validation():
        sys.exit(1)

    if not await test_manifest_compatibility():
        sys.exit(1)

    print("=" * 60)
    print("✓ All integration tests passed!")
    print("=" * 60)
    print("\nSummary:")
    print("  - Pydantic models work correctly")
    print("  - Tool registry initializes properly")
    print("  - All modules import successfully")
    print("  - Type validation works as expected")
    print("  - Existing manifests are compatible")
    print("  - MCP tool conversion from OpenAI format works")
    print("\nManifest Compatibility:")
    print("  ✓ Existing system_prompt field supported")
    print("  ✓ Existing model field supported")
    print("  ✓ Existing max_iterations field supported")
    print("  ✓ Existing skills format compatible")
    print("  ✓ Existing mcp_servers format compatible")
    print("  ✓ OpenAI tool format converts to internal format")
    print("\nThe implementation is ready for:")
    print("  1. Full pytest suite with mocked services")
    print("  2. Local Docker services integration")
    print("  3. Production deployment with existing manifests")


if __name__ == "__main__":
    asyncio.run(main())
