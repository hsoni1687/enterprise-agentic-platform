"""
activities_workflow_agent.py — Temporal activities for Workflow-tier agents.

Activities can perform I/O; workflows cannot.
These back the WorkflowAgentRun Temporal workflow.
"""

import json
import os
import re
from typing import Any

import httpx
from temporalio import activity


def _litellm_url() -> str:
    return os.getenv("LITELLM_URL", "http://localhost:4000")


def _litellm_key() -> str:
    return os.getenv("LITELLM_MASTER_KEY", "sk-litellm-dev")


def _gateway_url() -> str:
    return os.getenv("API_GATEWAY_URL", "http://localhost:8080")


def _mcp_registry_url() -> str:
    return os.getenv("MCP_REGISTRY_URL", "http://mcp-registry:8090")


# ─────────────────────────────────────────────────────────────────────────────
# Text-mode tool call parser
# (for local models that don't emit tool_calls — they write JSON in content)
# ─────────────────────────────────────────────────────────────────────────────

def _extract_text_tool_calls(content: str, known_tools: list[str]) -> list[dict] | None:
    """Try to extract a tool call from markdown text produced by non-function-calling models.

    Detects patterns like:
      ```json { "tool_name": "...", "params": {...} } ```
      ```json { "name": "...", "arguments": {...} } ```
      or bare JSON objects containing tool_name/name + params/arguments/args
    Returns a list of synthetic tool_call dicts (same shape as OpenAI tool_calls),
    or None if no recognisable call is found.
    """
    # Pull all ```...``` or ``` ``` blocks and also bare {...} objects
    candidates: list[str] = re.findall(r"```(?:json)?\s*([\s\S]*?)```", content)
    # Also try the whole content as a bare JSON object
    bare = content.strip()
    if bare.startswith("{"):
        candidates.append(bare)

    for raw in candidates:
        raw = raw.strip()
        if not raw:
            continue
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            continue

        if not isinstance(obj, dict):
            continue

        # Extract tool name — try common key names
        name = (
            obj.get("tool_name")
            or obj.get("name")
            or obj.get("function")
            or obj.get("tool")
        )
        # Extract arguments — try common key names
        args = (
            obj.get("params")
            or obj.get("arguments")
            or obj.get("args")
            or obj.get("parameters")
            or obj.get("input")
            or {}
        )

        if not name or not isinstance(args, dict):
            continue

        # Match the name to a known tool.
        # Priority: 1) exact  2) substring  3) best word-overlap score
        matched = None
        if name in known_tools:
            matched = name
        else:
            name_words = set(re.split(r"[_\-\s]+", name.lower()))
            best_score, best_tool = 0, None
            for t in known_tools:
                # substring check (both directions)
                n_norm = name.lower().replace("_", "").replace("-", "")
                t_norm = t.lower().replace("_", "").replace("-", "")
                if n_norm in t_norm or t_norm in n_norm:
                    matched = t
                    break
                # word overlap score
                t_words = set(re.split(r"[_\-\s]+", t.lower()))
                score   = len(name_words & t_words)
                if score > best_score:
                    best_score, best_tool = score, t
            if not matched and best_score > 0:
                matched = best_tool

        if matched:
            return [{
                "id":       f"text-tc-{matched}",
                "type":     "function",
                "function": {
                    "name":      matched,
                    "arguments": json.dumps(args),
                },
            }]

    return None


# ─────────────────────────────────────────────────────────────────────────────
# MCP helpers
# ─────────────────────────────────────────────────────────────────────────────

async def _fetch_mcp_tools(
    mcp_servers: list[str],
    tenant_id: str,
) -> tuple[list[dict], dict[str, str]]:
    """Fetch OpenAI-compatible tool definitions from the MCP registry.

    mcp_servers is a list of server IDs or names (as stored on the agent manifest).
    Returns:
        tool_defs       — list of {"type":"function","function":{...}} dicts
        tool_server_map — maps tool_name → server_id for dispatch
    """
    if not mcp_servers:
        return [], {}

    url  = _mcp_registry_url()
    hdrs = {"Content-Type": "application/json"}
    if tenant_id:
        hdrs["X-Tenant-ID"] = tenant_id

    tool_defs: list[dict]    = []
    tool_server_map: dict[str, str] = {}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Resolve all registered servers for this tenant
            resp = await client.get(f"{url}/api/v1/mcp/servers", headers=hdrs)
            if resp.status_code != 200:
                activity.logger.warning(f"[MCP] list servers failed: {resp.status_code}")
                return [], {}

            all_servers = resp.json().get("servers", [])

            for srv in all_servers:
                srv_id   = srv.get("id", "")
                srv_name = srv.get("name", "")
                if not srv.get("enabled", True):
                    continue
                # Match by ID or name
                if srv_id not in mcp_servers and srv_name not in mcp_servers:
                    continue

                try:
                    t_resp = await client.get(
                        f"{url}/api/v1/mcp/servers/{srv_id}/tools",
                        headers=hdrs,
                    )
                    if t_resp.status_code != 200:
                        activity.logger.warning(f"[MCP] tools fetch failed for {srv_id}: {t_resp.status_code}")
                        continue

                    for tool in t_resp.json().get("tools", []):
                        name = tool.get("name", "")
                        if not name:
                            continue
                        schema = tool.get("inputSchema") or tool.get("input_schema") or {
                            "type": "object", "properties": {},
                        }
                        tool_defs.append({
                            "type": "function",
                            "function": {
                                "name":        name,
                                "description": tool.get("description", ""),
                                "parameters":  schema,
                            },
                        })
                        tool_server_map[name] = srv_id
                        activity.logger.info(f"[MCP] registered tool={name} server={srv_id}")
                except Exception as e:
                    activity.logger.warning(f"[MCP] error fetching tools from {srv_id}: {e}")
    except Exception as e:
        activity.logger.warning(f"[MCP] fetch_mcp_tools error: {e}")

    activity.logger.info(f"[MCP] total tools loaded: {len(tool_defs)}")
    return tool_defs, tool_server_map


async def _call_mcp_tool(
    server_id: str,
    tool_name: str,
    args: dict,
    tenant_id: str,
) -> str:
    """Dispatch a tool call to the MCP registry."""
    url  = _mcp_registry_url()
    hdrs = {"Content-Type": "application/json"}
    if tenant_id:
        hdrs["X-Tenant-ID"] = tenant_id

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{url}/api/v1/mcp/servers/{server_id}/call",
            json={"tool_name": tool_name, "args": args},
            headers=hdrs,
        )
        if resp.status_code >= 400:
            return f"Tool call failed ({resp.status_code}): {resp.text[:300]}"

        data = resp.json()
        result = data.get("result", "")
        activity.logger.info(f"[MCP] tool={tool_name} result_len={len(str(result))}")
        return str(result)


# ─────────────────────────────────────────────────────────────────────────────
# run_single_llm_step
# ─────────────────────────────────────────────────────────────────────────────

@activity.defn
async def run_single_llm_step(
    prompt: str,
    system_prompt: str,
    model: str,
    agent_id: str,
    tenant_id: str,
    mcp_servers: list | None = None,
) -> str:
    """Call LiteLLM with optional MCP tool use and return the final text response.

    If mcp_servers is supplied the activity:
      1. Fetches tool definitions from the MCP registry
      2. Passes them to the LLM
      3. Executes any tool calls and appends results to the conversation
      4. Loops until the LLM produces a text-only response (max 10 tool rounds)
    """
    activity.logger.info(
        f"[LLM_STEP] agent={agent_id} model={model} "
        f"prompt_len={len(prompt)} mcp_servers={mcp_servers}"
    )

    # ── Fetch MCP tools ───────────────────────────────────────────────────────
    tool_defs, tool_server_map = await _fetch_mcp_tools(mcp_servers or [], tenant_id)

    messages: list[dict] = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": prompt},
    ]

    max_tool_rounds = 10
    llm_url = _litellm_url()
    llm_key = _litellm_key()

    async with httpx.AsyncClient(timeout=60.0) as client:
        for round_idx in range(max_tool_rounds + 1):
            payload: dict[str, Any] = {
                "model":      model,
                "messages":   messages,
                "max_tokens": 4096,
            }
            if tool_defs and round_idx < max_tool_rounds:
                payload["tools"]       = tool_defs
                payload["tool_choice"] = "auto"

            resp = await client.post(
                f"{llm_url}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {llm_key}"},
            )
            resp.raise_for_status()
            data = resp.json()

            choices = data.get("choices", [])
            if not choices:
                raise RuntimeError("LLM returned empty choices")

            message    = choices[0].get("message", {})
            tool_calls = message.get("tool_calls") or []
            content    = message.get("content") or ""

            # ── No native tool_calls → check if model wrote one as text ───────
            if not tool_calls and tool_defs:
                text_calls = _extract_text_tool_calls(content, list(tool_server_map.keys()))
                if text_calls:
                    activity.logger.info(
                        f"[LLM_STEP] text-mode tool call detected: {text_calls[0]['function']['name']}"
                    )
                    tool_calls = text_calls

            # ── No tool calls → final answer ──────────────────────────────────
            if not tool_calls:
                activity.logger.info(f"[LLM_STEP] final response_len={len(content)}")
                return content.strip()

            # ── Execute tool calls ────────────────────────────────────────────
            # Append the assistant message (with tool_calls) to history
            messages.append({
                "role":       "assistant",
                "content":    content,
                "tool_calls": tool_calls,
            })

            for tc in tool_calls:
                tc_id   = tc.get("id", "")
                fn      = tc.get("function", {})
                name    = fn.get("name", "")
                try:
                    args = json.loads(fn.get("arguments", "{}"))
                except json.JSONDecodeError:
                    args = {}

                activity.logger.info(f"[LLM_STEP] tool_call name={name} args={args}")

                server_id = tool_server_map.get(name)
                if server_id:
                    result = await _call_mcp_tool(server_id, name, args, tenant_id)
                else:
                    result = f"Tool '{name}' is not available."

                activity.logger.info(f"[LLM_STEP] tool_result name={name} result={str(result)[:200]}")

                messages.append({
                    "role":         "tool",
                    "tool_call_id": tc_id,
                    "content":      str(result),
                })

    # Exceeded max tool rounds — return whatever the last message says
    last = messages[-1].get("content", "")
    return str(last).strip() if last else "Max tool rounds reached without a final response."


# ─────────────────────────────────────────────────────────────────────────────
# execute_workflow_step_tool
# ─────────────────────────────────────────────────────────────────────────────

@activity.defn
async def execute_workflow_step_tool(
    tool_id: str,
    step_input: str,
    agent_id: str,
    tenant_id: str,
) -> str:
    """Execute a tool or skill via the API gateway skill dispatcher."""
    activity.logger.info(f"[STEP_TOOL] agent={agent_id} tool={tool_id} input_len={len(step_input)}")

    # Parse step_input as JSON args if possible, else wrap as {"input": ...}
    try:
        args: dict[str, Any] = json.loads(step_input)
        if not isinstance(args, dict):
            args = {"input": step_input}
    except Exception:
        args = {"input": step_input}

    payload = {
        "skill_name": tool_id,
        "agent_id":   agent_id,
        "arguments":  args,
    }

    headers: dict[str, str] = {"Content-Type": "application/json"}
    if tenant_id:
        headers["X-Tenant-ID"] = tenant_id

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{_gateway_url()}/api/v1/skills/dispatch",
            json=payload,
            headers=headers,
        )

    if resp.status_code >= 400:
        raise RuntimeError(f"Skill dispatch failed ({resp.status_code}): {resp.text[:300]}")

    result = resp.json()
    output = result.get("output") or result.get("result") or json.dumps(result)
    activity.logger.info(f"[STEP_TOOL] tool={tool_id} output_len={len(str(output))}")
    return str(output)


# ─────────────────────────────────────────────────────────────────────────────
# evaluate_condition
# ─────────────────────────────────────────────────────────────────────────────

@activity.defn
async def evaluate_condition(
    condition: str,
    step_input: str,
    step_results: dict[str, str],
) -> str:
    """Evaluate a condition expression and return 'true' or 'false'.

    Supported condition formats:
      - contains:<text>        → true if step_input contains <text> (case-insensitive)
      - regex:<pattern>        → true if regex matches step_input
      - eq:<step_id>:<value>   → true if step_results[step_id] == value
      - llm:<natural language> → ask the LLM to evaluate (more expensive)
      - <anything else>        → passed to LLM for evaluation
    """
    activity.logger.info(f"[CONDITION] evaluating: {condition[:100]}")

    cond = condition.strip()

    # ── contains:<text> ──────────────────────────────────────────────────────
    if cond.startswith("contains:"):
        text = cond[len("contains:"):].strip()
        result = "true" if text.lower() in step_input.lower() else "false"
        activity.logger.info(f"[CONDITION] contains '{text}' → {result}")
        return result

    # ── regex:<pattern> ──────────────────────────────────────────────────────
    if cond.startswith("regex:"):
        pattern = cond[len("regex:"):].strip()
        try:
            result = "true" if re.search(pattern, step_input, re.IGNORECASE) else "false"
        except re.error as e:
            activity.logger.warning(f"[CONDITION] invalid regex: {e}")
            result = "false"
        activity.logger.info(f"[CONDITION] regex '{pattern}' → {result}")
        return result

    # ── eq:<step_id>:<value> ─────────────────────────────────────────────────
    if cond.startswith("eq:"):
        parts = cond[len("eq:"):].split(":", 1)
        if len(parts) == 2:
            step_id, expected = parts
            actual = step_results.get(step_id.strip(), "")
            result = "true" if actual.strip() == expected.strip() else "false"
            activity.logger.info(f"[CONDITION] eq step={step_id} expected='{expected}' actual='{actual}' → {result}")
            return result

    # ── LLM evaluation ───────────────────────────────────────────────────────
    if cond.startswith("llm:"):
        cond = cond[len("llm:"):].strip()

    eval_prompt = (
        f"Given the following input, evaluate whether this condition is true or false.\n"
        f"Condition: {cond}\n"
        f"Input: {step_input[:500]}\n\n"
        f"Respond with exactly one word: 'true' or 'false'."
    )

    payload = {
        "model": os.getenv("DEFAULT_MODEL", "gpt-4o-mini"),
        "messages": [
            {"role": "system", "content": "You are a condition evaluator. Respond only with 'true' or 'false'."},
            {"role": "user",   "content": eval_prompt},
        ],
        "max_tokens": 10,
        "temperature": 0,
    }

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{_litellm_url()}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {_litellm_key()}"},
        )
        resp.raise_for_status()
        data = resp.json()

    answer = data.get("choices", [{}])[0].get("message", {}).get("content", "false").strip().lower()
    result = "true" if "true" in answer else "false"
    activity.logger.info(f"[CONDITION] llm eval → {result}")
    return result
