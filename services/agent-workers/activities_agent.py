import json
import logging
import os
import re
import time
from typing import Optional
from temporalio import activity
from openai import AsyncOpenAI
import httpx

import observability as obs


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
async def invoke_skill(skill_name: str, args: dict, tenant_id: str, agent_id: str, skill_id: str = "") -> str:
    """Invokes a named skill via the skill-dispatcher (runs pre/post hooks)."""
    url = os.getenv("SKILL_DISPATCHER_URL", "http://localhost:8085")
    logging.info(f"Invoking skill '{skill_name}' for agent {agent_id}")
    wf_id, run_id = obs.workflow_ctx()
    obs.lf_trace(wf_id, agent_id, tenant_id)
    span  = obs.lf_span(wf_id, f"skill:{skill_name}", input_data=args)
    t0 = time.monotonic()
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{url}/api/v1/skills/{skill_name}/invoke",
                json={"args": args, "agent_id": agent_id, "skill_id": skill_id},
                headers={"X-Tenant-ID": tenant_id},
                timeout=30.0,
            )
            resp.raise_for_status()
            data = resp.json()
            result = json.dumps(data.get("result", data))
        duration_ms = int((time.monotonic() - t0) * 1000)
        obs.lf_end_span(span, output={"result_len": len(result)})
        await obs.emit(
            event_type="skill_invoked", level="success", source="skill",
            source_id=skill_name, message=f"Skill '{skill_name}' completed",
            workflow_id=wf_id, run_id=run_id, tenant_id=tenant_id, agent_id=agent_id,
            duration_ms=duration_ms, details={"skill_id": skill_id},
        )
        obs.lf_flush()
        return result
    except Exception as e:
        duration_ms = int((time.monotonic() - t0) * 1000)
        obs.lf_end_span(span, output={"error": str(e)}, level="ERROR")
        await obs.emit(
            event_type="skill_invoked", level="error", source="skill",
            source_id=skill_name, message=f"Skill '{skill_name}' failed: {e}",
            workflow_id=wf_id, run_id=run_id, tenant_id=tenant_id, agent_id=agent_id,
            duration_ms=duration_ms,
        )
        obs.lf_flush()
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
                        # Sanitise server_name: Anthropic tool names must match
                        # ^[a-zA-Z0-9_-]{1,128}$ — replace spaces/dots with underscores.
                        raw_server = tool.get('server_name', 'unknown')
                        safe_server = re.sub(r'[^a-zA-Z0-9_-]', '_', raw_server)
                        safe_tool   = re.sub(r'[^a-zA-Z0-9_-]', '_', tool['name'])
                        tool_name   = f"mcp__{safe_server}__{safe_tool}"[:128]

                        # Ensure inputSchema is never None (crashes LiteLLM)
                        schema = tool.get("inputSchema") or {"type": "object", "properties": {}}

                        tool_def = {
                            "type": "function",
                            "function": {
                                "name":        tool_name,
                                "description": tool.get("description", ""),
                                "parameters":  schema,
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
    wf_id, run_id = obs.workflow_ctx()
    obs.lf_trace(wf_id, tenant_id=tenant_id)
    span  = obs.lf_span(wf_id, f"mcp:{server_id}/{tool_name}", input_data=args)
    t0 = time.monotonic()
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
            result = json.dumps(data.get("result", data))
        duration_ms = int((time.monotonic() - t0) * 1000)
        obs.lf_end_span(span, output={"result_len": len(result)})
        await obs.emit(
            event_type="tool_invoked", level="success", source="tool",
            source_id=f"mcp:{tool_name}", message=f"MCP tool '{tool_name}' on '{server_id}' completed",
            workflow_id=wf_id, run_id=run_id, tenant_id=tenant_id,
            duration_ms=duration_ms, details={"server_id": server_id, "tool_name": tool_name},
        )
        obs.lf_flush()
        return result
    except Exception as e:
        duration_ms = int((time.monotonic() - t0) * 1000)
        obs.lf_end_span(span, output={"error": str(e)}, level="ERROR")
        await obs.emit(
            event_type="tool_invoked", level="error", source="tool",
            source_id=f"mcp:{tool_name}", message=f"MCP tool '{tool_name}' failed: {e}",
            workflow_id=wf_id, run_id=run_id, tenant_id=tenant_id, duration_ms=duration_ms,
        )
        obs.lf_flush()
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
async def resolve_skill_context(tenant_id: str, skill_refs: list[dict]) -> dict:
    """Fetches selected skills and renders DB-backed skill instructions."""
    skill_catalog_url = os.getenv("SKILL_CATALOG_URL", "http://skill-catalog:8087")
    resolved: list[dict] = []
    markdown_blocks: list[str] = []
    logging.info(f"Resolving {len(skill_refs or [])} skills for tenant {tenant_id}")

    try:
        async with httpx.AsyncClient() as client:
            available_resp = await client.get(
                f"{skill_catalog_url}/api/v1/skills?available=true&include_system=true&include_public=true&status=active",
                headers={"X-Tenant-ID": tenant_id},
                timeout=15.0,
            )
            available_resp.raise_for_status()
            available = available_resp.json()
            skills = available if isinstance(available, list) else available.get("skills", [])

            for ref in skill_refs or []:
                skill = None
                ref_id = ref.get("id")
                if ref_id:
                    skill = next((s for s in skills if s.get("id") == ref_id), None)
                if skill is None:
                    skill = next(
                        (
                            s for s in skills
                            if s.get("name") == ref.get("name")
                            and (not ref.get("version") or s.get("version") == ref.get("version"))
                        ),
                        None,
                    )
                if skill is None:
                    logging.warning(f"Skill ref could not be resolved: {ref}")
                    continue

                render_resp = await client.get(
                    f"{skill_catalog_url}/api/v1/skills/{skill['id']}/render",
                    headers={"X-Tenant-ID": tenant_id},
                    timeout=15.0,
                )
                render_resp.raise_for_status()
                rendered = render_resp.json().get("markdown", "")

                skill["rendered_markdown"] = rendered
                skill["description"] = rendered or skill.get("description", "")
                resolved.append(skill)
                if rendered:
                    markdown_blocks.append(rendered)
    except Exception as e:
        logging.error(f"Failed to resolve skill context: {e}")
        return {"skills": skill_refs or [], "markdown": ""}

    return {"skills": resolved, "markdown": "\n\n---\n\n".join(markdown_blocks)}


@activity.defn
async def invoke_direct_tool(tool_name: str, tool_version: str, args: dict, tenant_id: str, agent_id: str, mutating: bool) -> str:
    """Invokes a direct tool via the skill-dispatcher."""
    skill_dispatcher_url = os.getenv("SKILL_DISPATCHER_URL", "http://localhost:8085")
    logging.info(f"Invoking direct tool '{tool_name}' for agent {agent_id}")
    wf_id, run_id = obs.workflow_ctx()
    obs.lf_trace(wf_id, agent_id, tenant_id)
    span  = obs.lf_span(wf_id, f"tool:{tool_name}", input_data={"args": args, "mutating": mutating})
    t0 = time.monotonic()
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
            result = json.dumps(data.get("result", data))
        duration_ms = int((time.monotonic() - t0) * 1000)
        obs.lf_end_span(span, output={"result_len": len(result)})
        await obs.emit(
            event_type="tool_invoked", level="success", source="tool",
            source_id=tool_name, message=f"Tool '{tool_name}' completed",
            workflow_id=wf_id, run_id=run_id, tenant_id=tenant_id, agent_id=agent_id,
            duration_ms=duration_ms, details={"version": tool_version, "mutating": mutating},
        )
        obs.lf_flush()
        return result
    except Exception as e:
        duration_ms = int((time.monotonic() - t0) * 1000)
        obs.lf_end_span(span, output={"error": str(e)}, level="ERROR")
        await obs.emit(
            event_type="tool_invoked", level="error", source="tool",
            source_id=tool_name, message=f"Tool '{tool_name}' failed: {e}",
            workflow_id=wf_id, run_id=run_id, tenant_id=tenant_id, agent_id=agent_id,
            duration_ms=duration_ms,
        )
        obs.lf_flush()
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
    """Executes a single LLM reasoning step via the LLM Gateway.

    For Ollama models, calls the native Ollama API with think=True so the
    model's internal reasoning is captured and returned as 'thinking_content'.
    All other models go through LiteLLM as before.
    """
    logging.info(f"[REASONING_STEP] Called with model={model}")

    raw_tools = tool_defs if tool_defs is not None else [_default_execute_code_tool()]
    # Sanitise tool definitions: LiteLLM crashes with AttributeError if inputSchema/parameters
    # is None. Ensure every tool has at least an empty object schema.
    tools = []
    for t in raw_tools:
        fn = t.get("function", {})
        if fn.get("parameters") is None:
            fn = dict(fn, parameters={"type": "object", "properties": {}})
            t = dict(t, function=fn)
        tools.append(t)
    logging.info(f"Calling LLM (model={model}, tools={[t['function']['name'] for t in tools]})")
    logging.info(f"[DEBUG] Messages structure: {json.dumps(messages, indent=2, default=str)}")

    # ── Ollama native path — captures thinking field ──────────────────────────
    if model.startswith("ollama/"):
        ollama_model = model[len("ollama/"):]
        ollama_base  = os.getenv("OLLAMA_API_BASE", "http://host.docker.internal:11434")

        # Convert OpenAI-format messages → Ollama native format.
        # Key differences:
        #   - tool_calls[].function.arguments: OpenAI = JSON string, Ollama = dict
        #   - tool_calls[].id / .type: not needed by Ollama
        #   - tool result messages: Ollama doesn't use tool_call_id
        #   - content: null not accepted by Ollama, use ""
        def _to_ollama_messages(msgs: list[dict]) -> list[dict]:
            out = []
            for m in msgs:
                role = m.get("role", "user")
                if role == "assistant":
                    tcs = m.get("tool_calls") or []
                    ollama_msg: dict = {"role": "assistant", "content": m.get("content") or ""}
                    if tcs:
                        ollama_tcs = []
                        for tc in tcs:
                            fn = tc.get("function", {})
                            args = fn.get("arguments", "{}")
                            if isinstance(args, str):
                                try:
                                    args = json.loads(args)
                                except Exception:
                                    args = {}
                            ollama_tcs.append({
                                "function": {"name": fn.get("name", ""), "arguments": args}
                            })
                        ollama_msg["tool_calls"] = ollama_tcs
                    out.append(ollama_msg)
                elif role == "tool":
                    # Ollama tool result — drop tool_call_id
                    out.append({"role": "tool", "content": m.get("content") or ""})
                else:
                    out.append({"role": role, "content": m.get("content") or ""})
            return out

        # Convert OpenAI tool_defs format → Ollama tools format
        ollama_tools = [
            {
                "type": "function",
                "function": {
                    "name":        t["function"]["name"],
                    "description": t["function"].get("description", ""),
                    "parameters":  t["function"].get("parameters", {}),
                },
            }
            for t in tools
        ] if tools else []

        payload: dict = {
            "model":    ollama_model,
            "messages": _to_ollama_messages(messages),
            "stream":   False,
            "think":    True,
        }
        if ollama_tools:
            payload["tools"] = ollama_tools

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(f"{ollama_base}/api/chat", json=payload)
            resp.raise_for_status()
            data = resp.json()

        msg_data       = data.get("message", {})
        content        = msg_data.get("content") or ""
        thinking       = msg_data.get("thinking") or ""
        raw_tool_calls = msg_data.get("tool_calls") or []

        # Ollama returns token counts at the top level of the response
        tokens_in_ollama  = data.get("prompt_eval_count", 0) or 0
        tokens_out_ollama = data.get("eval_count", 0) or 0

        logging.info(f"[OLLAMA] thinking_len={len(thinking)} content_len={len(content)} tool_calls={len(raw_tool_calls)} tokens={tokens_in_ollama}→{tokens_out_ollama}")

        # ── Emit observability (Langfuse + DB) for Ollama LLM call ──────────
        wf_id_ollama, run_id_ollama = obs.workflow_ctx()

        # Build concise input/output summaries for logging
        last_user_msg = next(
            (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), ""
        )
        llm_input_summary  = last_user_msg[:500] if last_user_msg else f"{len(messages)} messages"
        llm_output_summary = content[:500] if content else (thinking[:300] if thinking else "")

        obs.lf_generation(
            wf_id_ollama, f"ollama:{ollama_model}",
            model=ollama_model,
            input_data={"messages": messages[-4:] if len(messages) > 4 else messages},  # last 4 messages
            output_data={"content": content, "thinking": thinking[:200] if thinking else ""},
            tokens_in=tokens_in_ollama,
            tokens_out=tokens_out_ollama,
            metadata={"tool_calls": len(raw_tool_calls)},
        )
        await obs.emit(
            event_type="llm_call", level="info", source="llm",
            source_id=model, message=f"Ollama reasoning step ({tokens_in_ollama}→{tokens_out_ollama} tokens, {len(raw_tool_calls)} tool calls)",
            workflow_id=wf_id_ollama, run_id=run_id_ollama,
            details={
                "model":       ollama_model,
                "tokens_in":   tokens_in_ollama,
                "tokens_out":  tokens_out_ollama,
                "tool_calls":  len(raw_tool_calls),
                "input":       llm_input_summary,
                "output":      llm_output_summary,
            },
        )
        obs.lf_flush()

        result: dict = {
            "content": content,
            "thinking_content": thinking,
            "tool_calls": None,
            "tokens_in": tokens_in_ollama,
            "tokens_out": tokens_out_ollama,
        }
        if raw_tool_calls:
            result["tool_calls"] = [
                {
                    "id": f"call_{i}",
                    "function": {
                        "name":      tc.get("function", {}).get("name", ""),
                        "arguments": json.dumps(tc.get("function", {}).get("arguments", {})),
                    },
                }
                for i, tc in enumerate(raw_tool_calls)
            ]
        return result

    # ── LiteLLM path (non-Ollama models) ─────────────────────────────────────
    gateway_url = os.getenv("LLM_GATEWAY_URL", "http://localhost:4000/v1")
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("LITELLM_MASTER_KEY", "sk-litellm-dev")
    openai_client = AsyncOpenAI(base_url=gateway_url, api_key=api_key)

    wf_id, run_id = obs.workflow_ctx()
    t0 = time.monotonic()
    response = await openai_client.chat.completions.create(
        model=model,
        messages=messages,
        tools=tools,
        extra_body=obs.lf_metadata(wf_id, step_name="reasoning_step"),
    )
    duration_ms = int((time.monotonic() - t0) * 1000)
    usage = getattr(response, "usage", None)
    tokens_in  = getattr(usage, "prompt_tokens", 0) if usage else 0
    tokens_out = getattr(usage, "completion_tokens", 0) if usage else 0

    msg = response.choices[0].message

    # Build concise input/output summaries for logging
    last_user_msg = next(
        (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), ""
    )
    llm_input_summary  = last_user_msg[:500] if last_user_msg else f"{len(messages)} messages"
    llm_output_summary = (msg.content or "")[:500]

    # Log to Langfuse as a proper generation (shows in token/cost tracking)
    obs.lf_generation(
        wf_id, "reasoning_step",
        model=model,
        input_data={"messages": messages[-4:] if len(messages) > 4 else messages},
        output_data={"content": msg.content, "tool_calls": len(msg.tool_calls or [])},
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        metadata={"duration_ms": duration_ms},
    )
    await obs.emit(
        event_type="llm_call", level="info", source="llm",
        source_id=model, message=f"LLM reasoning step ({tokens_in}→{tokens_out} tokens, {duration_ms}ms)",
        workflow_id=wf_id, run_id=run_id, duration_ms=duration_ms,
        details={
            "model":      model,
            "tokens_in":  tokens_in,
            "tokens_out": tokens_out,
            "input":      llm_input_summary,
            "output":     llm_output_summary,
        },
    )
    obs.lf_flush()
    result = {
        "content": msg.content,
        "thinking_content": "",
        "tool_calls": None,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }
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
            "hitl_pending": decision.hitl_pending,
            "hitl_approval_id": decision.hitl_approval_id,
            "hitl_tool_name": decision.hitl_tool_name,
            "hitl_tool_args": decision.hitl_tool_args,
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


# ─── ReAct tool executor ──────────────────────────────────────────────────────

@activity.defn
async def execute_react_tool(
    tool_name: str,
    tool_args: dict,
    agent_id: str,
    tenant_id: str,
    tool_router: dict,
) -> str:
    """
    Route and execute a tool call from the ReAct loop.

    tool_router maps each tool name exposed to the LLM → routing metadata:
      {"type": "mcp",   "server_id": "...", "tool_name": "actual_name"}
      {"type": "skill", "name": "skill_name"}
      {"type": "tool",  "name": "tool_name"}
      {"type": "kg",    "graph_ids": ["..."]}

    Returns the result as a plain string so the LLM can read it.
    """
    logging.info(f"[REACT_TOOL] tool={tool_name} agent={agent_id}")
    wf_id, run_id = obs.workflow_ctx()
    t0_react = time.monotonic()

    route = tool_router.get(tool_name)
    if not route:
        return f"Tool '{tool_name}' is not available. Choose from: {list(tool_router.keys())}"

    rtype = route.get("type", "")

    # ── MCP tool ──────────────────────────────────────────────────────────────
    if rtype == "mcp":
        server_id       = route["server_id"]
        actual_tool     = route["tool_name"]
        mcp_url         = os.getenv("MCP_REGISTRY_URL", "http://mcp-registry:8090")
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{mcp_url}/api/v1/mcp/servers/{server_id}/call",
                    json={"tool_name": actual_tool, "args": tool_args},
                    headers={"X-Tenant-ID": tenant_id},
                    timeout=60.0,
                )
                resp.raise_for_status()
                data = resp.json()
                result = data.get("result", data)
                result_str = json.dumps(result) if not isinstance(result, str) else result
            duration_ms = int((time.monotonic() - t0_react) * 1000)
            await obs.emit(
                event_type="tool_invoked", level="success", source="tool",
                source_id=f"mcp:{actual_tool}", message=f"ReAct MCP '{actual_tool}' completed",
                workflow_id=wf_id, run_id=run_id, tenant_id=tenant_id, agent_id=agent_id,
                duration_ms=duration_ms, details={"server_id": server_id},
            )
            return result_str
        except Exception as e:
            logging.error(f"[REACT_TOOL] MCP call failed: {e}")
            await obs.emit(
                event_type="tool_invoked", level="error", source="tool",
                source_id=f"mcp:{actual_tool}", message=f"ReAct MCP '{actual_tool}' failed: {e}",
                workflow_id=wf_id, run_id=run_id, tenant_id=tenant_id, agent_id=agent_id,
            )
            return f"MCP tool '{actual_tool}' failed: {e}"

    # ── Skill ─────────────────────────────────────────────────────────────────
    if rtype == "skill":
        skill_name      = route["name"]
        dispatcher_url  = os.getenv("SKILL_DISPATCHER_URL", "http://skill-dispatcher:8085")
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{dispatcher_url}/api/v1/skills/{skill_name}/invoke",
                    json={"args": tool_args, "agent_id": agent_id},
                    headers={"X-Tenant-ID": tenant_id},
                    timeout=30.0,
                )
                resp.raise_for_status()
                data = resp.json()
                result = data.get("result", data)
                result_str = json.dumps(result) if not isinstance(result, str) else result
            duration_ms = int((time.monotonic() - t0_react) * 1000)
            await obs.emit(
                event_type="skill_invoked", level="success", source="skill",
                source_id=skill_name, message=f"ReAct skill '{skill_name}' completed",
                workflow_id=wf_id, run_id=run_id, tenant_id=tenant_id, agent_id=agent_id,
                duration_ms=duration_ms,
            )
            return result_str
        except Exception as e:
            logging.error(f"[REACT_TOOL] Skill call failed: {e}")
            await obs.emit(
                event_type="skill_invoked", level="error", source="skill",
                source_id=skill_name, message=f"ReAct skill '{skill_name}' failed: {e}",
                workflow_id=wf_id, run_id=run_id, tenant_id=tenant_id, agent_id=agent_id,
            )
            return f"Skill '{skill_name}' failed: {e}"

    # ── Direct platform tool ──────────────────────────────────────────────────
    if rtype == "tool":
        tool_n          = route["name"]
        dispatcher_url  = os.getenv("SKILL_DISPATCHER_URL", "http://skill-dispatcher:8085")
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{dispatcher_url}/api/v1/tools/invoke",
                    json={"tool": {"name": tool_n, "version": "latest"},
                          "args": tool_args, "agent_id": agent_id, "mutating": False},
                    headers={"X-Tenant-ID": tenant_id},
                    timeout=30.0,
                )
                resp.raise_for_status()
                data = resp.json()
                result = data.get("result", data)
                result_str = json.dumps(result) if not isinstance(result, str) else result
            duration_ms = int((time.monotonic() - t0_react) * 1000)
            await obs.emit(
                event_type="tool_invoked", level="success", source="tool",
                source_id=tool_n, message=f"ReAct tool '{tool_n}' completed",
                workflow_id=wf_id, run_id=run_id, tenant_id=tenant_id, agent_id=agent_id,
                duration_ms=duration_ms,
            )
            return result_str
        except Exception as e:
            logging.error(f"[REACT_TOOL] Tool call failed: {e}")
            await obs.emit(
                event_type="tool_invoked", level="error", source="tool",
                source_id=tool_n, message=f"ReAct tool '{tool_n}' failed: {e}",
                workflow_id=wf_id, run_id=run_id, tenant_id=tenant_id, agent_id=agent_id,
            )
            return f"Tool '{tool_n}' failed: {e}"

    # ── Knowledge-graph search ────────────────────────────────────────────────
    if rtype == "kg":
        graph_ids   = route.get("graph_ids", [])
        kg_url      = os.getenv("KG_SERVICE_URL", "http://kg-service:8093")
        query       = tool_args.get("query", tool_args.get("question", ""))
        top_k       = int(tool_args.get("top_k", 5))
        parts: list[str] = []
        async with httpx.AsyncClient() as client:
            for gid in graph_ids:
                try:
                    resp = await client.post(
                        f"{kg_url}/graph/context",
                        json={"graph_id": gid, "question": query, "top_k": top_k},
                        headers={"X-Tenant-ID": tenant_id},
                        timeout=30.0,
                    )
                    if resp.status_code == 200:
                        ctx = resp.json().get("context", "")
                        if ctx and ctx != "(No relevant entities found)":
                            parts.append(ctx[:1500])
                except Exception as e:
                    parts.append(f"KG search failed for graph {gid}: {e}")
        kg_result = "\n\n".join(parts) if parts else "No relevant knowledge graph results found."
        duration_ms = int((time.monotonic() - t0_react) * 1000)
        await obs.emit(
            event_type="tool_invoked", level="success", source="tool",
            source_id="knowledge_graph", message=f"KG search completed ({len(graph_ids)} graphs)",
            workflow_id=wf_id, run_id=run_id, tenant_id=tenant_id, agent_id=agent_id,
            duration_ms=duration_ms, details={"graph_ids": graph_ids, "query": query[:120]},
        )
        return kg_result

    # emit a fallback event for unknown route type
    await obs.emit(
        event_type="tool_invoked", level="warn", source="tool",
        source_id=tool_name, message=f"Unknown route type '{rtype}' for tool '{tool_name}'",
        workflow_id=wf_id, run_id=run_id, tenant_id=tenant_id, agent_id=agent_id,
    )
    return f"Unknown route type '{rtype}' for tool '{tool_name}'"


# ── Workflow-level event emitter ───────────────────────────────────────────────

@activity.defn
async def register_hitl_approval(
    approval_id: str,
    workflow_id: str,
    agent_id: str,
    tenant_id: str,
    tool_name: str,
    tool_args: dict,
    reason: str,
) -> bool:
    """
    Register a pending HITL approval in the workflow-initiator's durable store,
    using the workflow-supplied approval_id so the id emitted over SSE is the
    same id an operator approves/denies. Without this, the orchestrated path's
    approvals are invisible to GET /api/v1/approvals/pending and the approve
    endpoint cannot map the id back to a workflow to signal.

    Best-effort: a failure here must not crash the run. The workflow still waits
    on its Temporal signal; the operator can also approve via the live event
    stream. Returns True on successful registration.
    """
    initiator_url = os.getenv("WORKFLOW_INITIATOR_URL", "http://workflow-initiator:8081")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{initiator_url}/api/v1/approvals",
                json={
                    "approval_id": approval_id,
                    "workflow_id": workflow_id,
                    "agent_id": agent_id,
                    "tool_name": tool_name,
                    "tool_args": tool_args,
                    "reason": reason,
                },
                headers={"X-Tenant-ID": tenant_id},
                timeout=10.0,
            )
            resp.raise_for_status()
            return True
    except Exception as e:
        activity.logger.warning(f"[HITL] register_hitl_approval failed for {approval_id}: {e}")
        return False


@activity.defn
async def emit_run_event(
    event_type: str,
    level: str,
    source: str,
    source_id: str,
    message: str,
    workflow_id: str = "",
    run_id: str = "",
    tenant_id: str = "default-tenant",
    agent_id: str = "",
    duration_ms: int = 0,
    details: Optional[dict] = None,
) -> None:
    """
    Thin Temporal activity wrapper around obs.emit() so that workflows can
    write structured events to agent_run_events without doing I/O directly.

    Also initialises the Langfuse trace root so every event is linked to the
    correct trace in Langfuse.
    """
    obs.lf_trace(workflow_id, agent_id)
    await obs.emit(
        event_type=event_type,
        level=level,
        source=source,
        source_id=source_id,
        message=message,
        workflow_id=workflow_id,
        run_id=run_id,
        tenant_id=tenant_id,
        agent_id=agent_id,
        duration_ms=duration_ms if duration_ms else None,
        details=details,
    )
    obs.lf_flush()
