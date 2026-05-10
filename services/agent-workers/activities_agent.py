import json
import logging
import os
from typing import Optional
from temporalio import activity
from openai import AsyncOpenAI
import httpx


@activity.defn
async def execute_code(code: str) -> str:
    """Executes Python code in the sandbox manager."""
    logging.info(f"Executing code in sandbox: {code[:50]}...")
    url = os.getenv("SANDBOX_MANAGER_URL", "http://localhost:8082/api/v1/execute")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json={"code": code}, timeout=30.0)
            resp.raise_for_status()
            return resp.json().get("result", "No output")
    except Exception as e:
        logging.error(f"Sandbox execution failed: {e}")
        return f"Error executing code: {e}"


@activity.defn
async def invoke_skill(skill_name: str, args: dict, tenant_id: str, agent_id: str) -> str:
    """Invokes a named skill via the skill-dispatcher (runs pre/post hooks)."""
    url = os.getenv("SKILL_DISPATCHER_URL", "http://localhost:8085")
    logging.info(f"Invoking skill '{skill_name}' for agent {agent_id}")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{url}/api/v1/skills/{skill_name}/invoke",
                json={"args": args, "agent_id": agent_id},
                headers={"X-Tenant-ID": tenant_id},
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()
            return json.dumps(data.get("result", data))
    except Exception as e:
        logging.error(f"Skill invocation failed: {e}")
        return f"Error invoking skill '{skill_name}': {e}"


@activity.defn
async def discover_mcp_tools(server_ids: list[str], tenant_id: str) -> list[dict]:
    """Discovers tools from external MCP servers and returns OpenAI-compatible tool definitions."""
    mcp_registry_url = os.getenv("MCP_REGISTRY_URL", "http://localhost:8090")
    tools = []

    try:
        async with httpx.AsyncClient() as client:
            for server_id in server_ids:
                try:
                    resp = await client.get(
                        f"{mcp_registry_url}/api/v1/mcp/servers/{server_id}/tools",
                        headers={"X-Tenant-ID": tenant_id},
                        timeout=30.0,
                    )
                    resp.raise_for_status()
                    data = resp.json()

                    for tool in data.get("tools", []):
                        tool_def = {
                            "type": "function",
                            "function": {
                                "name": f"mcp__{tool.get('server_name', 'unknown')}__{tool['name']}",
                                "description": tool.get("description", ""),
                                "parameters": tool.get("inputSchema", {}),
                            },
                            "__mcp_meta": {
                                "server_id": server_id,
                                "tool_name": tool["name"],
                            },
                        }
                        tools.append(tool_def)
                except Exception as e:
                    logging.error(f"Failed to discover tools from MCP server {server_id}: {e}")
                    continue
    except Exception as e:
        logging.error(f"MCP tool discovery failed: {e}")

    return tools


@activity.defn
async def invoke_mcp_tool(server_id: str, tool_name: str, args: dict, tenant_id: str) -> str:
    """Invokes a tool on an external MCP server."""
    mcp_registry_url = os.getenv("MCP_REGISTRY_URL", "http://localhost:8090")
    logging.info(f"Invoking MCP tool '{tool_name}' on server {server_id}")

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{mcp_registry_url}/api/v1/mcp/servers/{server_id}/call",
                json={"tool_name": tool_name, "args": args},
                headers={"X-Tenant-ID": tenant_id},
                timeout=60.0,
            )
            resp.raise_for_status()
            data = resp.json()
            return json.dumps(data.get("result", data))
    except Exception as e:
        logging.error(f"MCP tool invocation failed: {e}")
        return f"Error invoking MCP tool '{tool_name}': {e}"


@activity.defn
async def fetch_system_tools(tenant_id: str) -> list[dict]:
    """Fetches platform system tools and returns them as tool definitions."""
    tool_registry_url = os.getenv("TOOL_REGISTRY_URL", "http://localhost:8086")
    logging.info(f"Fetching system tools for tenant {tenant_id}")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{tool_registry_url}/api/v1/tools?include_system=true&status=approved",
                headers={"X-Tenant-ID": tenant_id},
                timeout=15.0,
            )
            resp.raise_for_status()
            data = resp.json()
            # API returns list directly, not dict with "tools" key
            tools = data if isinstance(data, list) else data.get("tools", [])
            # Filter to only system tools
            system_tools = [t for t in tools if t.get("scope") == "system"]
            logging.info(f"Found {len(system_tools)} system tools")
            return system_tools
    except Exception as e:
        logging.error(f"Failed to fetch system tools: {e}")
        return []


@activity.defn
async def invoke_direct_tool(tool_name: str, tool_version: str, args: dict, tenant_id: str, agent_id: str, mutating: bool) -> str:
    """Invokes a direct tool via the skill-dispatcher."""
    skill_dispatcher_url = os.getenv("SKILL_DISPATCHER_URL", "http://localhost:8085")
    logging.info(f"Invoking direct tool '{tool_name}' for agent {agent_id}")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{skill_dispatcher_url}/api/v1/tools/invoke",
                json={"tool": {"name": tool_name, "version": tool_version}, "args": args, "agent_id": agent_id, "mutating": mutating},
                headers={"X-Tenant-ID": tenant_id},
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()
            return json.dumps(data.get("result", data))
    except Exception as e:
        logging.error(f"Direct tool invocation failed: {e}")
        return f"Error invoking tool '{tool_name}': {e}"


@activity.defn
async def resolve_mcp_servers(tenant_id: str, explicit_server_ids: list[str]) -> list[str]:
    """Returns merged list of global + tenant MCP server IDs."""
    mcp_registry_url = os.getenv("MCP_REGISTRY_URL", "http://localhost:8090")
    logging.info(f"Resolving MCP servers for tenant {tenant_id} with explicit IDs: {explicit_server_ids}")

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{mcp_registry_url}/api/v1/mcp/servers",
                headers={"X-Tenant-ID": tenant_id},
                timeout=10.0,
            )
            resp.raise_for_status()
            servers = resp.json().get("servers") or []
            registry_ids = [s["id"] for s in servers]
            logging.info(f"Found {len(registry_ids)} servers in registry (includes global + tenant)")

        # Union: registry (global+tenant) + any explicit manifest server_ids
        all_ids = list({*registry_ids, *explicit_server_ids})
        logging.info(f"Total MCP servers resolved: {len(all_ids)}")
        return all_ids
    except Exception as e:
        logging.error(f"Failed to resolve MCP servers: {e}")
        return explicit_server_ids or []


@activity.defn
async def reasoning_step(messages: list[dict], model: str, tool_defs: Optional[list[dict]] = None) -> dict:
    """Executes a single LLM reasoning step via the LLM Gateway."""
    logging.info(f"[REASONING_STEP] Called with model={model}")
    logging.info(f"[REASONING_STEP] LLM_GATEWAY_URL={os.getenv('LLM_GATEWAY_URL')}")

    gateway_url = os.getenv("LLM_GATEWAY_URL", "http://localhost:8083/v1")
    client = AsyncOpenAI(base_url=gateway_url, api_key="sk-mock-key")

    tools = tool_defs if tool_defs is not None else [_default_execute_code_tool()]

    logging.info(f"Calling LLM (model={model}, tools={[t['function']['name'] for t in tools]})")
    logging.info(f"[DEBUG] Messages structure: {json.dumps(messages, indent=2, default=str)}")
    response = await client.chat.completions.create(
        model=model,
        messages=messages,
        tools=tools,
    )

    msg = response.choices[0].message
    result = {"content": msg.content, "tool_calls": None}
    if msg.tool_calls:
        result["tool_calls"] = [
            {
                "id": tc.id,
                "function": {
                    "name": tc.function.name,
                    "arguments": tc.function.arguments,
                },
            }
            for tc in msg.tool_calls
        ]
    return result


def _default_execute_code_tool() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "execute_code",
            "description": "Run Python code in a secure sandbox.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "The Python code to run."}
                },
                "required": ["code"],
            },
        },
    }


@activity.defn
async def pydantic_ai_reasoning_step(
    context_dict: dict,
    messages: list[dict],
    mcp_tools_list: list[dict],
) -> dict:
    """
    Executes a single LLM reasoning step using PydanticAI.

    This is the new implementation that uses PydanticAI's agent framework
    for cleaner tool registration, type-safe tool calls, and simplified
    message management. It replaces the manual tool dispatch logic in
    workflows.py.

    Args:
        context_dict: Agent context as dict (agent_id, tenant_id, prompt, model, etc.)
        messages: Current message history
        mcp_tools_list: Discovered MCP tools as dicts

    Returns:
        Dict with keys:
        - final_answer: str or None (if LLM decided to stop)
        - tool_calls: list[dict] or None (if LLM wants to invoke tools)
        - messages_delta: list[dict] (updated message history)
        - continue_loop: bool (whether to continue reasoning)
    """
    from models import AgentContext, MCPToolDefinition
    from pydantic_ai_agent import build_agent_with_tools, convert_response_to_decision

    import sys
    agent_id = context_dict.get('agent_id')
    logging.info(f"PydanticAI reasoning step for agent {agent_id}")

    try:
        # Validate context using Pydantic model
        logging.info(f"[STEP 1] Creating AgentContext from dict: {list(context_dict.keys())}")
        context = AgentContext(**context_dict)
        logging.info(f"[STEP 2] Reasoning: model={context.model}, iterations={context.max_iterations}")

        # Convert MCP tools from OpenAI format to MCPToolDefinition
        from pydantic_ai_agent import _convert_openai_tool_to_mcp_definition
        from pydantic_ai.models import ModelSettings

        logging.info(f"[STEP 3] Converting {len(mcp_tools_list)} MCP tools")
        mcp_tools = []
        for tool_dict in mcp_tools_list:
            try:
                mcp_def = _convert_openai_tool_to_mcp_definition(tool_dict)
                mcp_tools.append(mcp_def)
            except Exception as e:
                logging.warning(f"Failed to convert MCP tool: {e}")
                continue

        # Build agent with all registered tools
        # Note: workflow_ref is None here; tool invocations will use workflow.execute_activity
        logging.info(f"[STEP 4] Building agent with model={context.model}, {len(mcp_tools)} tools")
        logging.info(f"[STEP 4] LLM_GATEWAY_URL={os.getenv('LLM_GATEWAY_URL')}")
        agent = await build_agent_with_tools(context, workflow_ref=None, mcp_tools=mcp_tools)
        logging.info(f"[STEP 5] Agent built successfully")

        # Run agent for single reasoning step
        # Note: We only pass user_prompt and system_prompt, not message history,
        # because PydanticAI manages message history internally
        logging.info(f"[STEP 6] Calling PydanticAI agent with {len(mcp_tools)} MCP tools and max_tokens=20000")
        logging.info(f"[STEP 6] Model: {context.model}, Prompt length: {len(context.prompt)}, System prompt length: {len(context.system_prompt)}")
        response = await agent.run(
            user_prompt=context.prompt,
            model_settings=ModelSettings(max_tokens=20000, budget_tokens=0),
        )
        logging.info(f"[STEP 7] Response received: type={type(response)}")

        # Log raw response size before processing - write directly to file
        try:
            with open("/tmp/response-debug.txt", "w") as f:
                f.write(f"Response type: {type(response)}\n")
                if hasattr(response, 'output'):
                    raw_data = str(response.output) if response.output else ""
                    f.write(f"Raw response.output length: {len(raw_data)} characters\n")
                    f.write(f"First 300 chars:\n{raw_data[:300]}\n")
                    f.write(f"Last 300 chars:\n{raw_data[-300:]}\n")
                f.flush()
        except Exception as e:
            pass

        # Debug: log response structure
        logging.info(f"PydanticAI response type: {type(response)}")
        logging.info(f"PydanticAI response attrs: {dir(response)}")
        if hasattr(response, "output"):
            output_str = str(response.output) if response.output else "None"
            logging.info(f"PydanticAI response.output length: {len(output_str)}, first 200 chars: {output_str[:200]}")
        try:
            messages = response.all_messages()
            logging.info(f"PydanticAI response.all_messages() count: {len(messages)}")
        except Exception as e:
            logging.info(f"Could not get messages: {e}")

        # Convert PydanticAI response to our AgentDecision model
        decision = await convert_response_to_decision(response, mcp_tools)

        result = {
            "final_answer": decision.final_answer,
            "tool_calls": [tc.model_dump() for tc in decision.tool_calls],
            "messages_delta": decision.messages_delta,
            "continue_loop": decision.continue_loop,
        }

        # Log what we're actually returning
        if decision.final_answer:
            answer_len = len(decision.final_answer)
            logging.info(f"Final answer length: {answer_len} chars")
            logging.info(f"Final answer STARTS with: {decision.final_answer[:300]}")
            logging.info(f"Final answer ends with: ...{decision.final_answer[-100:]}")

            # Check for required sections
            has_prompt = "## System Prompt Draft" in decision.final_answer
            has_skills = "## Recommended Skills" in decision.final_answer
            logging.info(f"Sections: system_prompt={has_prompt}, recommended_skills={has_skills}")

            # Write directly to debug file
            with open("/tmp/activity-debug.log", "a") as f:
                f.write(f"[FINAL] Length: {answer_len}, system_prompt={has_prompt}, recommended_skills={has_skills}\n")
                f.write(f"[START_TEXT] {decision.final_answer[:200]}\n")
                f.write(f"[END_TEXT] {decision.final_answer[-200:]}\n")
                if not has_skills:
                    f.write(f"[ERROR] MISSING Recommended Skills section!\n")
                f.flush()

        logging.info(f"Returning decision with {len(result)} fields")
        return result

    except Exception as e:
        logging.error(f"PydanticAI reasoning step failed: {e}", exc_info=True)
        logging.error(f"Exception type: {type(e)}", exc_info=False)
        return {
            "final_answer": None,
            "tool_calls": [],
            "messages_delta": [],
            "continue_loop": False,
            "error": str(e),
        }
