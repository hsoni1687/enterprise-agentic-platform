"""
PydanticAI Agent builder for A1 Agent Engine.

This module:
1. Registers tools from manifests, skills, and MCP servers
2. Creates PydanticAI Agent with typed tool decorators
3. Routes tool invocations to appropriate services (Sandbox, Skill Dispatcher, MCP Registry)
4. Maintains backward compatibility with existing Temporal activities

The agent runs within a Temporal activity, preserving durability and fault tolerance.
"""

import json
import logging
import os
from typing import Any, Callable, Optional
from functools import wraps

import httpx
from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import ModelMessage

from models import AgentContext, ToolCall, MCPToolDefinition

logger = logging.getLogger(__name__)


class AgentToolRegistry:
    """Registry and builder for agent tools."""

    def __init__(self, context: AgentContext, workflow_ref: Any, mcp_tools: list[MCPToolDefinition]):
        """
        Initialize tool registry.

        Args:
            context: Agent context (tenant_id, agent_id, etc.)
            workflow_ref: Reference to Temporal workflow (for activity execution)
            mcp_tools: Discovered MCP tools
        """
        self.context = context
        self.workflow = workflow_ref
        self.mcp_tools = mcp_tools
        self.tools: dict[str, Callable] = {}

    async def execute_code(self, code: str) -> str:
        """Execute Python code in sandbox via HTTP."""
        logger.info(f"Executing code for agent {self.context.agent_id}")
        url = os.getenv("SANDBOX_MANAGER_URL", "http://localhost:8082/api/v1/execute")
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json={"code": code}, timeout=30.0)
                resp.raise_for_status()
                return resp.json().get("result", "No output")
        except Exception as e:
            logger.error(f"Code execution failed: {e}")
            return f"Error executing code: {e}"

    async def invoke_skill(self, skill_name: str, args: dict) -> str:
        """Invoke a skill via Skill Dispatcher HTTP."""
        logger.info(f"Invoking skill '{skill_name}' for agent {self.context.agent_id}")
        url = os.getenv("SKILL_DISPATCHER_URL", "http://localhost:8085")
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{url}/api/v1/skills/{skill_name}/invoke",
                    json={"args": args, "agent_id": self.context.agent_id},
                    headers={"X-Tenant-ID": self.context.tenant_id},
                    timeout=30.0,
                )
                resp.raise_for_status()
                data = resp.json()
                return json.dumps(data.get("result", data))
        except Exception as e:
            logger.error(f"Skill invocation failed: {e}")
            return f"Error invoking skill '{skill_name}': {e}"

    async def invoke_mcp_tool(self, server_id: str, tool_name: str, args: dict) -> str:
        """Invoke a tool on an MCP server via HTTP."""
        logger.info(f"Invoking MCP tool '{tool_name}' on server {server_id}")
        url = os.getenv("MCP_REGISTRY_URL", "http://localhost:8090")
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{url}/api/v1/mcp/servers/{server_id}/call",
                    json={"tool_name": tool_name, "args": args},
                    headers={"X-Tenant-ID": self.context.tenant_id},
                    timeout=60.0,
                )
                resp.raise_for_status()
                data = resp.json()
                return json.dumps(data.get("result", data))
        except Exception as e:
            logger.error(f"MCP tool invocation failed: {e}")
            return f"Error invoking MCP tool '{tool_name}': {e}"

    def register_tools(self, agent: Agent) -> Agent:
        """
        Register all available tools with the agent using decorators.

        Registers:
        1. execute_code - Sandbox code execution
        2. Skills from manifest
        3. MCP tools from discovery

        Note: Tools make direct HTTP calls since they run within a Temporal activity
        and cannot invoke other activities.
        """

        # Skip tool registration for manifest-assistant-system (text-only generation)
        if self.context.agent_id == "manifest-assistant-system":
            logger.info("Skipping tool registration for manifest-assistant-system agent")
            return agent

        # Capture registry reference for closures
        registry = self

        # 1. Built-in execute_code tool - use decorator with RunContext
        @agent.tool
        async def execute_code(ctx: RunContext[Any], code: str) -> str:
            """Execute Python code in a secure sandbox.

            Args:
                code: The Python code to execute

            Returns:
                Output from the code execution
            """
            return await registry.execute_code(code)

        # 2. Skills from manifest
        for skill_def in self.context.skills:
            skill_name = skill_def.get("name", "").replace(" ", "-").replace("_", "-").lower()
            skill_description = skill_def.get("description", f"Execute {skill_name} skill")

            # Create inline tool function for this skill
            @agent.tool
            async def _skill_tool(
                ctx: RunContext[Any],
                args: dict = None,
                _skill_name: str = skill_name,
                _skill_desc: str = skill_description
            ) -> str:
                f"""{_skill_desc}

                Args:
                    args: Skill arguments as dict

                Returns:
                    Skill execution result
                """
                tool_args = args or {}
                return await registry.invoke_skill(_skill_name, tool_args)

            # Set the function name for display
            _skill_tool.__name__ = skill_name

        # 3. MCP tools from discovery
        for mcp_tool in self.mcp_tools:
            server_id = mcp_tool.server_id
            tool_name = mcp_tool.tool_name
            qualified_name = mcp_tool.qualified_name
            description = mcp_tool.description

            # Create inline tool function for this MCP tool
            @agent.tool
            async def _mcp_tool_func(
                ctx: RunContext[Any],
                args: dict = None,
                _server_id: str = server_id,
                _tool_name: str = tool_name,
                _qualified_name: str = qualified_name,
                _desc: str = description
            ) -> str:
                f"""{_desc}

                Args:
                    args: Tool arguments as dict

                Returns:
                    Tool execution result
                """
                tool_args = args or {}
                return await registry.invoke_mcp_tool(_server_id, _tool_name, tool_args)

            # Set the function name for display
            _mcp_tool_func.__name__ = qualified_name

        logger.info(
            f"Registered {1 + len(self.context.skills) + len(self.mcp_tools)} tools for agent"
        )
        return agent


async def build_agent_with_tools(
    context: AgentContext,
    workflow_ref: Any,
    mcp_tools: list[MCPToolDefinition],
) -> Agent:
    """
    Build a PydanticAI Agent with all available tools registered.

    This is the main entry point for creating an agent with:
    - Type-safe context
    - Registered tools (execute_code, skills, MCP tools)
    - Temporal activity integration

    Args:
        context: Agent execution context (prompt, model, etc.)
        workflow_ref: Reference to Temporal workflow (for activity invocation)
        mcp_tools: List of discovered MCP tool definitions

    Returns:
        Configured PydanticAI Agent ready for reasoning
    """
    import os
    from pydantic_ai.models import infer_model

    # Set environment variables for LLM Gateway configuration
    # PydanticAI uses OPENAI_BASE_URL and OPENAI_API_KEY automatically
    os.environ.setdefault("OPENAI_BASE_URL", os.getenv("LLM_GATEWAY_URL", "http://localhost:8083/v1"))
    os.environ.setdefault("OPENAI_API_KEY", os.getenv("OPENAI_API_KEY", "sk-mock-key"))

    # Let PydanticAI infer and configure the model from environment
    logger.info(f"[build_agent] Inferring model: openai:{context.model}")
    try:
        model = infer_model(f"openai:{context.model}")
        logger.info(f"[build_agent] Model inferred successfully")
    except Exception as e:
        logger.error(f"[build_agent] Failed to infer model: {e}", exc_info=True)
        raise

    # Initialize agent with configured model
    logger.info(f"[build_agent] Creating Agent with system_prompt length={len(context.system_prompt)}")
    try:
        agent = Agent(
            model=model,
            system_prompt=context.system_prompt,
        )
        logger.info(f"[build_agent] Agent created successfully")
    except Exception as e:
        logger.error(f"[build_agent] Failed to create Agent: {e}", exc_info=True)
        raise

    # Build and register all tools
    logger.info(f"[build_agent] Registering tools")
    try:
        registry = AgentToolRegistry(context, workflow_ref, mcp_tools)
        agent = registry.register_tools(agent)
        logger.info(f"[build_agent] Tools registered successfully")
    except Exception as e:
        logger.error(f"[build_agent] Failed to register tools: {e}", exc_info=True)
        raise

    return agent


def _convert_openai_tool_to_mcp_definition(openai_tool_dict: dict) -> MCPToolDefinition:
    """
    Convert OpenAI-format tool definition to MCPToolDefinition.

    OpenAI format has:
    {
        "type": "function",
        "function": {"name": "mcp__server__tool", ...},
        "__mcp_meta": {"server_id": "...", "tool_name": "..."}
    }

    MCPToolDefinition expects:
    {
        "server_id": "...",
        "server_name": "...",
        "tool_name": "...",
        "description": "...",
        "input_schema": {...}
    }
    """
    meta = openai_tool_dict.get("__mcp_meta", {})
    func = openai_tool_dict.get("function", {})

    # Extract server_name from qualified tool name: mcp__server_name__tool_name
    qualified_name = func.get("name", "")
    parts = qualified_name.split("__")
    server_name = parts[1] if len(parts) >= 2 else "unknown"

    return MCPToolDefinition(
        server_id=meta.get("server_id", ""),
        server_name=server_name,
        tool_name=meta.get("tool_name", ""),
        description=func.get("description", ""),
        input_schema=func.get("parameters", {}),
    )


async def extract_tool_calls_from_response(response: Any) -> list[ToolCall]:
    """
    Extract tool calls from PydanticAI response (AgentRunResult).

    PydanticAI tool calls are in response.all_messages() as ModelResponse.parts
    with part_kind='tool-call'. Tool execution happens internally in agent.run(),
    so this typically returns empty list for text-only responses.

    Args:
        response: PydanticAI AgentRunResult

    Returns:
        List of ToolCall objects
    """
    tool_calls = []
    try:
        from pydantic_ai.messages import ModelResponse

        # Use .all_messages() method to get message history
        for msg in response.all_messages():
            if isinstance(msg, ModelResponse):
                for part in msg.parts:
                    if getattr(part, "part_kind", None) == "tool-call":
                        tool_calls.append(
                            ToolCall(
                                id=getattr(part, "tool_call_id", ""),
                                name=getattr(part, "tool_name", ""),
                                arguments=part.args_as_dict() if hasattr(part, "args_as_dict") else {},
                            )
                        )
    except Exception as e:
        logger.warning(f"Tool call extraction failed: {e}")

    return tool_calls


async def convert_response_to_decision(response: Any, mcp_tools: list[MCPToolDefinition]):
    """
    Convert PydanticAI response to AgentDecision.

    Handles:
    - Extracting final answer (if LLM stopped)
    - Parsing tool calls (if LLM wants to execute tools)
    - Building updated message history

    Args:
        response: PydanticAI agent response
        mcp_tools: MCP tool definitions (for tool_call routing)

    Returns:
        AgentDecision object ready for workflow processing
    """
    from models import AgentDecision

    final_answer = None
    tool_calls = []
    messages_delta = []

    # Extract text content (final answer)
    # PydanticAI returns the result in response.output (AgentRunResult field)
    if hasattr(response, "output"):
        if isinstance(response.output, str):
            final_answer = response.output
        elif response.output is not None:
            final_answer = str(response.output)
    elif isinstance(response, str):
        final_answer = response
    elif response:
        # Last resort: just convert to string
        final_answer = str(response)

    logger.info(f"Extracted final_answer: {repr(final_answer)}")

    # Extract tool calls
    tool_calls = await extract_tool_calls_from_response(response)
    logger.info(f"Extracted tool_calls: {len(tool_calls)} calls")

    # Build message delta for state persistence
    try:
        for msg in response.all_messages():
            messages_delta.append(_message_to_dict(msg))
    except Exception as e:
        logger.warning(f"Failed to build message delta: {e}")

    continue_loop = bool(tool_calls) and not final_answer
    logger.info(f"Decision: final_answer={bool(final_answer)}, tool_calls={len(tool_calls)}, continue_loop={continue_loop}")

    return AgentDecision(
        final_answer=final_answer,
        tool_calls=tool_calls,
        messages_delta=messages_delta,
        continue_loop=continue_loop,
    )


def _message_to_dict(message: Any) -> dict:
    """Convert PydanticAI ModelRequest/ModelResponse to dict for storage in Temporal."""
    kind = getattr(message, "kind", None)
    if kind in ("request", "response"):
        parts = getattr(message, "parts", [])
        content_parts = []
        for part in parts:
            if getattr(part, "part_kind", None) == "text":
                content_parts.append(getattr(part, "content", ""))
        return {
            "role": kind,
            "content": " ".join(content_parts),
        }
    return message.__dict__ if hasattr(message, "__dict__") else {}
