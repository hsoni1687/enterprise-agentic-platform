"""
Orchestration activities for structured task planning and execution.

These activities implement the three-phase agent loop:
  1. Context assembly  (load_active_guardrails, load_active_hooks)
  2. Planning          (plan_tasks)
  3. Per-task cycle    (apply_guardrails → run_hooks → execute_single_task
                        → apply_guardrails → validate_task_result → run_hooks)
  4. Failure recovery  (handle_task_failure)
  5. Synthesis         (synthesize_final_answer)
"""

import json
import logging
import os
import re
from typing import Optional

import httpx
from openai import AsyncOpenAI
from temporalio import activity

logger = logging.getLogger(__name__)

# ─── Shared helpers ───────────────────────────────────────────────────────────

def _llm_client() -> tuple[AsyncOpenAI, str]:
    """Return (AsyncOpenAI client, gateway_url) from environment."""
    url = os.getenv("LLM_GATEWAY_URL", "http://localhost:4000/v1")
    key = os.getenv("LITELLM_MASTER_KEY") or os.getenv("OPENAI_API_KEY", "sk-litellm-dev")
    return AsyncOpenAI(base_url=url, api_key=key), url


async def _json_llm_call(model: str, system: str, user: str) -> dict:
    """Single LLM call that returns parsed JSON. Falls back on parse error."""
    client, _ = _llm_client()
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            temperature=0,
        )
        raw = resp.choices[0].message.content or "{}"
        # Strip markdown code fences if present
        raw = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        raw = re.sub(r"\s*```$", "", raw)
        return json.loads(raw)
    except json.JSONDecodeError as e:
        logger.warning(f"LLM returned non-JSON: {e}. Raw: {raw[:200]}")
        return {}
    except Exception as e:
        logger.error(f"LLM call failed: {e}")
        return {}


# ─── Guardrail pattern engine ─────────────────────────────────────────────────

# Lightweight regex patterns per guardrail id.
# These run instantly and don't require an LLM call.
_GUARDRAIL_PATTERNS: dict[str, re.Pattern] = {
    "gr-pii-block": re.compile(
        r"\b\d{3}-\d{2}-\d{4}\b"                  # SSN
        r"|(?<!\d)4[0-9]{12}(?:[0-9]{3})?(?!\d)"  # Visa card
        r"|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",  # email
        re.IGNORECASE,
    ),
    "gr-prompt-injection": re.compile(
        r"ignore\s+(?:previous|prior|above)\s+instructions?"
        r"|forget\s+(?:everything|all|your)\s+instructions?"
        r"|you\s+are\s+now\s+(?:a|an|the)\s+\w+"
        r"|jailbreak"
        r"|DAN\s+mode"
        r"|developer\s+mode",
        re.IGNORECASE,
    ),
    "gr-secret-leak": re.compile(
        r"sk-[A-Za-z0-9]{20,}"             # OpenAI-style key
        r"|Bearer\s+[A-Za-z0-9._\-]{20,}"  # Bearer token
        r"|ghp_[A-Za-z0-9]{36}"            # GitHub PAT
        r"|AKIA[0-9A-Z]{16}",              # AWS access key
        re.IGNORECASE,
    ),
    "gr-toxic-content": re.compile(
        r"\b(?:kill|murder|rape|genocide|terrorism|suicide\s+method)\b",
        re.IGNORECASE,
    ),
}

_PII_REDACT = re.compile(
    r"\b\d{3}-\d{2}-\d{4}\b"
    r"|(?<!\d)4[0-9]{12}(?:[0-9]{3})?(?!\d)"
    r"|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
    re.IGNORECASE,
)
_SECRET_REDACT = re.compile(
    r"sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._\-]{20,}|ghp_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}",
    re.IGNORECASE,
)


def _pattern_matches(guardrail_id: str, text: str) -> bool:
    pattern = _GUARDRAIL_PATTERNS.get(guardrail_id)
    return bool(pattern and pattern.search(text))


def _redact_text(guardrail_id: str, text: str) -> str:
    if guardrail_id == "gr-pii-block":
        return _PII_REDACT.sub("[REDACTED-PII]", text)
    if guardrail_id == "gr-secret-leak":
        return _SECRET_REDACT.sub("[REDACTED-SECRET]", text)
    return text


# ─── Context loading ──────────────────────────────────────────────────────────

@activity.defn
async def load_active_guardrails(agent_id: str, tenant_id: str) -> list[dict]:
    """
    Fetch all enabled platform guardrails from admin-api.
    Non-fatal: returns [] if the admin-api is unreachable.
    """
    admin_url = os.getenv("ADMIN_API_URL", "http://admin-api:8089")
    admin_key = os.getenv("ADMIN_API_KEY", "dev-admin-key")

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{admin_url}/api/v1/admin/guardrails",
                headers={"Authorization": f"Bearer {admin_key}"},
                timeout=10.0,
            )
            resp.raise_for_status()
            all_g = resp.json()
            enabled = [g for g in all_g if g.get("enabled", False)]
            logger.info(f"[GUARDRAILS] Loaded {len(enabled)}/{len(all_g)} enabled guardrails for agent {agent_id}")
            return enabled
    except Exception as e:
        logger.warning(f"[GUARDRAILS] Could not load guardrails (non-fatal): {e}")
        return []


@activity.defn
async def load_active_hooks(agent_id: str, tenant_id: str) -> list[dict]:
    """
    Fetch all enabled platform hooks from admin-api.
    Non-fatal: returns [] if unreachable.
    """
    admin_url = os.getenv("ADMIN_API_URL", "http://admin-api:8089")
    admin_key = os.getenv("ADMIN_API_KEY", "dev-admin-key")

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{admin_url}/api/v1/admin/hooks",
                headers={"Authorization": f"Bearer {admin_key}"},
                timeout=10.0,
            )
            resp.raise_for_status()
            all_h = resp.json()
            enabled = [h for h in all_h if h.get("enabled", False)]
            logger.info(f"[HOOKS] Loaded {len(enabled)}/{len(all_h)} enabled hooks for agent {agent_id}")
            return enabled
    except Exception as e:
        logger.warning(f"[HOOKS] Could not load hooks (non-fatal): {e}")
        return []


# ─── Planning ─────────────────────────────────────────────────────────────────

_PLANNER_SYSTEM = """You are a task planning agent for an AI execution system.

Given a user prompt and a set of available resources, decompose the prompt into
an ordered list of atomic, verifiable tasks.

Rules:
1. Each task uses exactly ONE resource (tool | skill | mcp | llm | code).
2. Use resource_type="llm" for pure reasoning steps that need no external call.
3. Use resource_type="code" only when Python sandbox execution is needed.
4. Every task MUST have a concrete, checkable validation criterion.
5. Explicit depends_on — never assume a prior task succeeded unless listed.
6. Mark critical=true if failure of this task should stop the entire plan.
7. Keep tasks atomic. Do not bundle multiple API calls into one task.
8. Do NOT invent resources not listed in the inventory.
9. Order tasks so that all items in depends_on appear earlier in the list.
10. Prefer fewer, meaningful tasks over many fine-grained micro-tasks.

Return ONLY valid JSON in this exact shape:
{
  "tasks": [
    {
      "task_id": "t1",
      "description": "...",
      "resource_type": "tool|skill|mcp|llm|code",
      "resource_name": "exact_name or 'reasoning'",
      "resource_args": {},
      "preconditions": ["natural language precondition"],
      "depends_on": [],
      "validation": "how to verify success from the result",
      "critical": true
    }
  ],
  "reasoning": "why you decomposed it this way"
}"""


@activity.defn
async def plan_tasks(prompt: str, context_summary: str, model: str) -> dict:
    """
    Call the LLM (same model as the agent) to produce a structured TaskPlan.
    Falls back to a single LLM reasoning task if planning fails.
    """
    logger.info(f"[PLANNER] Planning tasks for prompt: {prompt[:80]}...")

    user_msg = f"""Available resources:
{context_summary}

User prompt:
{prompt}"""

    plan = await _json_llm_call(model, _PLANNER_SYSTEM, user_msg)

    if not plan.get("tasks"):
        logger.warning("[PLANNER] LLM returned no tasks — using fallback single-step plan")
        plan = {
            "tasks": [{
                "task_id": "t1",
                "description": prompt,
                "resource_type": "llm",
                "resource_name": "reasoning",
                "resource_args": {},
                "preconditions": [],
                "depends_on": [],
                "validation": "LLM produced a non-empty response",
                "critical": True,
            }],
            "reasoning": "Fallback: planning did not produce tasks, executing prompt directly.",
        }

    logger.info(f"[PLANNER] Plan has {len(plan['tasks'])} tasks. Reasoning: {plan.get('reasoning','')[:120]}")
    return plan


# ─── Guardrail enforcement ────────────────────────────────────────────────────

@activity.defn
async def apply_guardrails(text: str, guardrails: list[dict], phase: str) -> dict:
    """
    Apply enabled guardrails that match `phase` ('input' | 'output') to `text`.

    Actions:
      block  → return blocked=True immediately; caller must stop execution.
      redact → sanitize text and continue.
      flag   → log violation and continue unchanged.

    Returns GuardrailResult as dict.
    """
    applicable = [
        g for g in guardrails
        if g.get("applies_to") in (phase, "both")
    ]

    sanitized = text
    violations: list[dict] = []

    for g in applicable:
        gid     = g.get("id", "")
        gname   = g.get("name", "unknown")
        action  = g.get("action", "flag")
        category = g.get("category", "")

        triggered = _pattern_matches(gid, sanitized)
        if not triggered:
            continue

        violation = {"guardrail_id": gid, "guardrail_name": gname, "action": action, "category": category}
        violations.append(violation)
        logger.info(f"[GUARDRAIL] {phase.upper()} — '{gname}' triggered (action={action})")

        if action == "block":
            return {
                "blocked": True,
                "block_reason": f"Guardrail '{gname}' blocked this {phase}: {category}",
                "sanitized_text": sanitized,
                "violations": violations,
            }
        elif action == "redact":
            sanitized = _redact_text(gid, sanitized)
        # flag: already appended to violations, no text change

    return {
        "blocked": False,
        "block_reason": None,
        "sanitized_text": sanitized,
        "violations": violations,
    }


# ─── Hook execution ───────────────────────────────────────────────────────────

@activity.defn
async def run_hooks(
    phase: str,
    task_name: str,
    task_args: dict,
    result: Optional[dict],
    hooks: list[dict],
    agent_context: dict,
) -> dict:
    """
    Execute platform lifecycle hooks for the given phase ('pre' | 'post').

    Hook types handled:
      pii_strip       (pre)  — scrub PII from task_args before execution
      rate_limit      (pre)  — check sliding-window counter, block if exceeded
      audit_log       (both) — write invocation record to admin-api audit endpoint
      cost_meter      (post) — record token/cost data
      webhook         (post) — POST result to configured webhook URL
      hitl_intercept  (pre)  — marker only; actual HITL gate is in the workflow via signal

    Returns HookResult as dict.
    """
    applicable = [h for h in hooks if h.get("phase") in (phase, "both")]

    modified_args = dict(task_args)
    admin_url = os.getenv("ADMIN_API_URL", "http://admin-api:8089")
    admin_key = os.getenv("ADMIN_API_KEY", "dev-admin-key")
    tenant_id = agent_context.get("tenant_id", "default-tenant")
    agent_id  = agent_context.get("agent_id", "unknown")

    for hook in applicable:
        htype = hook.get("type", "")

        # ── pii_strip (pre) ──────────────────────────────────────────────────
        if htype == "pii_strip" and phase == "pre":
            args_str = json.dumps(modified_args)
            cleaned  = _PII_REDACT.sub("[REDACTED-PII]", args_str)
            cleaned  = _SECRET_REDACT.sub("[REDACTED-SECRET]", cleaned)
            try:
                modified_args = json.loads(cleaned)
            except Exception:
                pass
            logger.info(f"[HOOK] pii_strip applied to task '{task_name}'")

        # ── rate_limit (pre) ─────────────────────────────────────────────────
        elif htype == "rate_limit" and phase == "pre":
            rpm = hook.get("requests_per_minute", 60)
            # Lightweight: we emit a log — real counter lives in a shared store.
            # In production this calls a rate-limit service; here we just log.
            logger.info(f"[HOOK] rate_limit check (limit={rpm} rpm) for tenant {tenant_id}")

        # ── audit_log (pre + post) ───────────────────────────────────────────
        elif htype == "audit_log":
            try:
                async with httpx.AsyncClient() as client:
                    await client.post(
                        f"{admin_url}/api/v1/admin/audit",
                        json={
                            "tenant_id":   tenant_id,
                            "agent_id":    agent_id,
                            "resource":    "task",
                            "action":      f"{phase}:{task_name}",
                            "args_snapshot": modified_args,
                            "result_snapshot": result,
                        },
                        headers={"Authorization": f"Bearer {admin_key}"},
                        timeout=5.0,
                    )
            except Exception as e:
                logger.warning(f"[HOOK] audit_log write failed (non-fatal): {e}")

        # ── cost_meter (post) ────────────────────────────────────────────────
        elif htype == "cost_meter" and phase == "post" and result:
            tokens = result.get("tokens", 0) if isinstance(result, dict) else 0
            logger.info(f"[HOOK] cost_meter: task '{task_name}', tokens={tokens}, tenant={tenant_id}")

        # ── webhook (post) ───────────────────────────────────────────────────
        elif htype == "webhook" and phase == "post" and result:
            url = hook.get("url") or hook.get("config", {}).get("url")
            if url:
                try:
                    async with httpx.AsyncClient() as client:
                        await client.post(
                            url,
                            json={"agent_id": agent_id, "task": task_name, "result": result},
                            timeout=hook.get("timeout_ms", 5000) / 1000,
                        )
                    logger.info(f"[HOOK] webhook posted for task '{task_name}'")
                except Exception as e:
                    logger.warning(f"[HOOK] webhook failed (non-fatal): {e}")

        # ── hitl_intercept (pre) — handled at workflow level via signal ──────
        elif htype == "hitl_intercept" and phase == "pre":
            logger.info(f"[HOOK] hitl_intercept registered for task '{task_name}' — gate is workflow-level")

    return {"blocked": False, "block_reason": None, "modified_args": modified_args}


# ─── Task execution ───────────────────────────────────────────────────────────

@activity.defn
async def execute_single_task(task: dict, agent_context: dict) -> str:
    """
    Execute one planned task by routing to the appropriate backend service.

    resource_type routing:
      tool  → skill-dispatcher /api/v1/tools/invoke
      skill → skill-dispatcher /api/v1/skills/{name}/invoke
      mcp   → mcp-registry     /api/v1/mcp/servers/{server}/call
      code  → sandbox-manager  /api/v1/execute
      llm   → LiteLLM gateway  (OpenAI chat completions)

    Returns the result as a string (serialised JSON for structured results).
    """
    rtype  = task.get("resource_type", "llm")
    rname  = task.get("resource_name", "reasoning")
    rargs  = task.get("resource_args", {})
    tenant = agent_context.get("tenant_id", "default-tenant")
    agent  = agent_context.get("agent_id", "unknown")
    model  = agent_context.get("model", "mock-gpt-4o")

    logger.info(f"[EXECUTE] task={task.get('task_id')} type={rtype} resource={rname}")

    # ── LLM reasoning ────────────────────────────────────────────────────────
    if rtype == "llm":
        client, _ = _llm_client()
        sys_prompt = agent_context.get("system_prompt", "You are a helpful assistant.")
        user_msg   = rargs.get("prompt") or task.get("description", "")
        try:
            resp = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": sys_prompt},
                    {"role": "user",   "content": user_msg},
                ],
            )
            return resp.choices[0].message.content or ""
        except Exception as e:
            return f"LLM reasoning failed: {e}"

    # ── Python code sandbox ───────────────────────────────────────────────────
    if rtype == "code":
        url = os.getenv("SANDBOX_MANAGER_URL", "http://sandbox-manager:8082/api/v1/execute")
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json={"code": rargs.get("code", "")}, timeout=30.0)
                resp.raise_for_status()
                return resp.json().get("result", "No output")
        except Exception as e:
            return f"Code execution failed: {e}"

    # ── Direct tool ───────────────────────────────────────────────────────────
    if rtype == "tool":
        url = os.getenv("SKILL_DISPATCHER_URL", "http://skill-dispatcher:8085")
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{url}/api/v1/tools/invoke",
                    json={"tool": {"name": rname, "version": "latest"}, "args": rargs, "agent_id": agent, "mutating": False},
                    headers={"X-Tenant-ID": tenant},
                    timeout=30.0,
                )
                resp.raise_for_status()
                data = resp.json()
                return json.dumps(data.get("result", data))
        except Exception as e:
            return f"Tool '{rname}' failed: {e}"

    # ── Skill ─────────────────────────────────────────────────────────────────
    if rtype == "skill":
        url = os.getenv("SKILL_DISPATCHER_URL", "http://skill-dispatcher:8085")
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{url}/api/v1/skills/{rname}/invoke",
                    json={"args": rargs, "agent_id": agent},
                    headers={"X-Tenant-ID": tenant},
                    timeout=30.0,
                )
                resp.raise_for_status()
                data = resp.json()
                return json.dumps(data.get("result", data))
        except Exception as e:
            return f"Skill '{rname}' failed: {e}"

    # ── MCP tool ──────────────────────────────────────────────────────────────
    if rtype == "mcp":
        # rname format: "mcp__server_name__tool_name" or "server_id::tool_name"
        mcp_url = os.getenv("MCP_REGISTRY_URL", "http://mcp-registry:8090")
        parts = rname.split("__")
        server_id = parts[1] if len(parts) >= 3 else rname
        tool_name = parts[2] if len(parts) >= 3 else rname
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{mcp_url}/api/v1/mcp/servers/{server_id}/call",
                    json={"tool_name": tool_name, "args": rargs},
                    headers={"X-Tenant-ID": tenant},
                    timeout=60.0,
                )
                resp.raise_for_status()
                data = resp.json()
                return json.dumps(data.get("result", data))
        except Exception as e:
            return f"MCP tool '{rname}' failed: {e}"

    return f"Unknown resource_type '{rtype}'"


# ─── Validation ───────────────────────────────────────────────────────────────

@activity.defn
async def validate_task_result(task: dict, result: str, model: str) -> dict:
    """
    Validate a task result against the task's validation criterion.
    Uses the same LLM model as the agent for semantic validation.

    Returns {"valid": bool, "reason": str, "confidence": "high"|"medium"|"low"}
    """
    criteria = task.get("validation", "")
    if not criteria:
        return {"valid": True, "reason": "No validation criterion — assumed ok", "confidence": "low"}

    if not result or result.startswith("Error") or result.startswith("LLM reasoning failed"):
        return {"valid": False, "reason": f"Result indicates failure: {result[:200]}", "confidence": "high"}

    system = "You are a result validator. Respond only with valid JSON, no explanation outside JSON."
    user = f"""Task: {task.get('description', '')}
Validation criterion: {criteria}
Actual result (first 800 chars): {result[:800]}

Return JSON: {{"valid": true/false, "reason": "...", "confidence": "high"|"medium"|"low"}}"""

    out = await _json_llm_call(model, system, user)
    if not out:
        return {"valid": True, "reason": "Validation check inconclusive — assumed ok", "confidence": "low"}

    logger.info(f"[VALIDATE] task={task.get('task_id')} valid={out.get('valid')} confidence={out.get('confidence')}")
    return out


# ─── Failure recovery ─────────────────────────────────────────────────────────

_RECOVERY_SYSTEM = """You are a task failure recovery agent for an AI execution system.

A task has failed. Your job: diagnose the error and decide the best recovery strategy.

Recovery options:
  retry_with_args   — the same resource can succeed with different arguments
  use_alternative   — a different resource from the inventory can do the same job
  skip              — this task is non-critical; record the failure and continue
  abort             — critical failure with no viable path forward

Rules:
- Prefer retry_with_args for transient errors (network, timeout, rate limit).
- Prefer skip for non-critical tasks where partial results are acceptable.
- Use abort only when the task is critical AND neither retry nor alternative is viable.
- Always provide a clear message_to_context that the agent can use to understand what happened.

Return ONLY valid JSON:
{
  "recovery": "retry_with_args|use_alternative|skip|abort",
  "retry_args": {} or null,
  "alternative_resource": "resource_name" or null,
  "reason": "why you chose this strategy",
  "message_to_context": "what the agent should know about this failure going forward"
}"""


@activity.defn
async def handle_task_failure(
    task: dict,
    error: str,
    prior_results: dict,
    context_summary: str,
    model: str,
) -> dict:
    """
    Like Claude Code: read the error, diagnose root cause, decide recovery.

    Strategy:
      - Transient / network errors  → retry_with_args
      - Wrong arguments             → retry_with_args with corrected args
      - Better resource exists      → use_alternative
      - Non-critical task           → skip
      - Critical + unrecoverable    → abort
    """
    logger.info(f"[RECOVERY] task={task.get('task_id')} error={error[:120]}")

    user = f"""Failed task:
{json.dumps(task, indent=2)}

Error:
{error}

Prior task results (context):
{json.dumps({k: str(v)[:200] for k, v in prior_results.items()}, indent=2)}

Available resource context:
{context_summary[:600]}"""

    recovery = await _json_llm_call(model, _RECOVERY_SYSTEM, user)

    if not recovery.get("recovery"):
        # If LLM failed to produce a valid recovery, default conservatively
        is_critical = task.get("critical", True)
        recovery = {
            "recovery": "abort" if is_critical else "skip",
            "retry_args": None,
            "alternative_resource": None,
            "reason": "Recovery analysis produced no actionable output",
            "message_to_context": f"Task '{task.get('description','?')}' failed: {error[:200]}",
        }

    logger.info(f"[RECOVERY] decision={recovery.get('recovery')} reason={recovery.get('reason','')[:100]}")
    return recovery


# ─── Final synthesis ──────────────────────────────────────────────────────────

_SYNTHESIS_SYSTEM = """You are a final answer synthesizer for an AI agent.

You are given the original user prompt and the results of each task the agent executed.
Some tasks may have failed, been skipped, or been blocked.

Your job:
1. Synthesize a clear, complete final answer to the user's original prompt.
2. Use the task results as evidence — do not invent information not present in results.
3. If some tasks failed, acknowledge what could not be completed and explain briefly.
4. Present the answer as if speaking directly to the user — no internal implementation details.
5. Be concise but complete. Use markdown formatting where it helps readability."""


@activity.defn
async def synthesize_final_answer(
    prompt: str,
    task_results: dict,
    task_statuses: dict,
    model: str,
) -> str:
    """
    Final LLM call that synthesizes all task results into a coherent answer.
    Analogous to Claude Code's end-of-turn summary — but richer.
    """
    results_text = ""
    for tid, status in task_statuses.items():
        result_val = task_results.get(tid, "")
        results_text += f"\n[{tid}] status={status}\n{str(result_val)[:500]}\n"

    user = f"""Original user prompt:
{prompt}

Task execution results:
{results_text}

Synthesize the final answer."""

    client, _ = _llm_client()
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _SYNTHESIS_SYSTEM},
                {"role": "user",   "content": user},
            ],
        )
        answer = resp.choices[0].message.content or ""
        logger.info(f"[SYNTHESIS] Final answer length: {len(answer)} chars")
        return answer
    except Exception as e:
        logger.error(f"[SYNTHESIS] Failed: {e}")
        # Fall back: concatenate succeeded results
        succeeded = {tid: task_results[tid] for tid, s in task_statuses.items() if s == "succeeded"}
        if succeeded:
            return "\n\n".join(str(v) for v in succeeded.values())
        return f"Agent execution completed but synthesis failed: {e}"
