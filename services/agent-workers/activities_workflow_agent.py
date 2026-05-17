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
) -> str:
    """Call LiteLLM with a single prompt and return the text response."""
    activity.logger.info(f"[LLM_STEP] agent={agent_id} model={model} prompt_len={len(prompt)}")

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": prompt},
        ],
        "max_tokens": 4096,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{_litellm_url()}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {_litellm_key()}"},
        )
        resp.raise_for_status()
        data = resp.json()

    choices = data.get("choices", [])
    if not choices:
        raise RuntimeError("LLM returned empty choices")

    content = choices[0].get("message", {}).get("content", "")
    activity.logger.info(f"[LLM_STEP] response_len={len(content)}")
    return content.strip()


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
    # Strip llm: prefix if present
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
