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

import asyncio
import collections
import json
import logging
import os
import re
import time
from typing import Optional

import httpx
from openai import AsyncOpenAI
from temporalio import activity

import observability as obs

logger = logging.getLogger(__name__)

# ─── In-process sliding-window rate limiter ───────────────────────────────────
# Keyed by "tenant_id:agent_id:hook_id" → deque of monotonic timestamps.
# This is per-worker-process. For multi-worker deployments, replace with a
# shared Redis INCR + EXPIRE pattern (REDIS_URL env var) for cross-process accuracy.
_rate_limit_windows: dict[str, collections.deque] = {}
_rate_limit_lock = asyncio.Lock()


async def _check_rate_limit(key: str, rpm: int) -> bool:
    """Sliding-window rate limit check (60-second window). Returns True if allowed."""
    async with _rate_limit_lock:
        now = time.monotonic()
        window = _rate_limit_windows.setdefault(key, collections.deque())
        # Evict timestamps older than the 60-second window
        while window and now - window[0] > 60.0:
            window.popleft()
        if len(window) >= rpm:
            return False
        window.append(now)
        return True

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
        r"\b\d{3}-\d{2}-\d{4}\b"                                          # SSN
        r"|(?<!\d)\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}(?!\d)"      # Any 16-digit card (Visa/MC/Discover/etc.)
        r"|(?<!\d)3[47]\d{2}[\s\-]?\d{6}[\s\-]?\d{5}(?!\d)"             # Amex (15-digit, 4-6-5 groups)
        r"|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",        # email
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
    r"\b\d{3}-\d{2}-\d{4}\b"                                          # SSN
    r"|(?<!\d)\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}(?!\d)"      # Any 16-digit card
    r"|(?<!\d)3[47]\d{2}[\s\-]?\d{6}[\s\-]?\d{5}(?!\d)"             # Amex (15-digit)
    r"|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",        # email
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
async def load_active_guardrails(
    agent_id: str,
    tenant_id: str,
    guardrail_ids: Optional[list] = None,
) -> list[dict]:
    """
    Fetch guardrails from admin-api filtered to the agent's configured set.

    - If guardrail_ids is a list (even empty), ONLY those guardrails are returned —
      this is the per-agent opt-in model used by all agents created through the wizard.
    - If guardrail_ids is None (legacy / manifest field absent), ALL platform-enabled
      guardrails are returned for backward compatibility with pre-existing agents.

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

            if guardrail_ids is not None:
                # Per-agent selection: respect exactly what the user configured
                id_set = set(guardrail_ids)
                selected = [g for g in all_g if g.get("id") in id_set]
                logger.info(
                    f"[GUARDRAILS] Agent '{agent_id}' opted into {len(id_set)} guardrail(s); "
                    f"matched {len(selected)} from catalog of {len(all_g)}"
                )
                return selected
            else:
                # Legacy fallback: return all platform-enabled guardrails
                enabled = [g for g in all_g if g.get("enabled", False)]
                logger.info(
                    f"[GUARDRAILS] No per-agent config for '{agent_id}' — "
                    f"falling back to {len(enabled)}/{len(all_g)} platform-enabled guardrails"
                )
                return enabled
    except Exception as e:
        logger.warning(f"[GUARDRAILS] Could not load guardrails (non-fatal): {e}")
        return []


@activity.defn
async def load_active_hooks(
    agent_id: str,
    tenant_id: str,
    hook_ids: Optional[list] = None,
) -> list[dict]:
    """
    Fetch hooks from admin-api filtered to the agent's configured set.

    - If hook_ids is a list (even empty), ONLY those hooks are returned —
      this is the per-agent opt-in model used by all agents created through the wizard.
    - If hook_ids is None (legacy / manifest field absent), ALL platform-enabled
      hooks are returned for backward compatibility with pre-existing agents.

    Non-fatal: returns [] if the admin-api is unreachable.
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

            if hook_ids is not None:
                # Per-agent selection: respect exactly what the user configured
                id_set = set(hook_ids)
                selected = [h for h in all_h if h.get("id") in id_set]
                logger.info(
                    f"[HOOKS] Agent '{agent_id}' opted into {len(id_set)} hook(s); "
                    f"matched {len(selected)} from catalog of {len(all_h)}"
                )
                return selected
            else:
                # Legacy fallback: return all platform-enabled hooks
                enabled = [h for h in all_h if h.get("enabled", False)]
                logger.info(
                    f"[HOOKS] No per-agent config for '{agent_id}' — "
                    f"falling back to {len(enabled)}/{len(all_h)} platform-enabled hooks"
                )
                return enabled
    except Exception as e:
        logger.warning(f"[HOOKS] Could not load hooks (non-fatal): {e}")
        return []


# ─── Planning ─────────────────────────────────────────────────────────────────

_PLANNER_SYSTEM = """You are a task planning agent for an AI execution system.

Given a user prompt and a set of available resources, decompose the prompt into
an ordered list of atomic, verifiable tasks.

Rules:
1. Each task uses exactly ONE resource (tool | skill | mcp | llm | code | kg).
2. Use resource_type="llm" for pure reasoning steps that need no external call.
3. Use resource_type="code" only when Python sandbox execution is needed.
4. Use resource_type="kg" with resource_name="kg_search" when the prompt requires
   retrieving domain knowledge or context from the agent's attached knowledge graphs.
   Pass {"query": "<natural language search query>"} in resource_args.
   Only use "kg" if knowledge graph IDs are listed in the inventory — do NOT invent them.
5. Every task MUST have a concrete, checkable validation criterion.
6. Explicit depends_on — never assume a prior task succeeded unless listed.
7. Mark critical=true if failure of this task should stop the entire plan.
8. Keep tasks atomic. Do not bundle multiple API calls into one task.
9. Do NOT invent resources not listed in the inventory.
10. Order tasks so that all items in depends_on appear earlier in the list.
11. Prefer fewer, meaningful tasks over many fine-grained micro-tasks.

Return ONLY valid JSON in this exact shape:
{
  "tasks": [
    {
      "task_id": "t1",
      "description": "...",
      "resource_type": "tool|skill|mcp|llm|code|kg",
      "resource_name": "exact_name or 'reasoning' or 'kg_search'",
      "resource_args": {},
      "preconditions": ["natural language precondition"],
      "depends_on": [],
      "validation": "how to verify success from the result",
      "critical": true
    }
  ],
  "reasoning": "why you decomposed it this way"
}"""




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

        # Emit guardrail event immediately on trigger
        wf_id, run_id = obs.workflow_ctx()
        emit_level = "error" if action == "block" else "warn"
        import asyncio as _asyncio
        _asyncio.ensure_future(obs.emit(
            event_type="guardrail_triggered", level=emit_level, source="guardrail",
            source_id=gname, message=f"Guardrail '{gname}' triggered ({phase}) — action: {action}",
            workflow_id=wf_id, run_id=run_id,
            details={"phase": phase, "action": action, "category": category, "guardrail_id": gid},
        ))

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
            hook_id = hook.get("id", "default-rate-limit")
            # Key is per-tenant + per-agent + per-hook so each hook has its own window.
            # NOTE: This is in-process (per-worker). For multi-worker deployments,
            # replace with a shared Redis INCR+EXPIRE pattern (REDIS_URL env var).
            rl_key = f"{tenant_id}:{agent_id}:{hook_id}"
            allowed = await _check_rate_limit(rl_key, rpm)
            if not allowed:
                logger.warning(
                    f"[HOOK] rate_limit EXCEEDED (limit={rpm} rpm) for tenant={tenant_id} agent={agent_id}"
                )
                return {
                    "blocked": True,
                    "block_reason": f"Rate limit exceeded: {rpm} requests/minute for agent '{agent_id}'",
                    "modified_args": modified_args,
                }
            logger.info(f"[HOOK] rate_limit allowed (limit={rpm} rpm) for tenant={tenant_id} agent={agent_id}")

        # ── audit_log (pre + post) ───────────────────────────────────────────
        elif htype == "audit_log":
            try:
                _wf_id, _run_id = obs.workflow_ctx()
                async with httpx.AsyncClient() as client:
                    await client.post(
                        f"{admin_url}/api/v1/admin/audit",
                        json={
                            "tenant_id":       tenant_id,
                            "agent_id":        agent_id,
                            "workflow_id":     _wf_id,
                            "run_id":          _run_id,
                            "resource":        "task",
                            "action":          f"{phase}:{task_name}",
                            "args_snapshot":   modified_args,
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



# ─── Validation ───────────────────────────────────────────────────────────────



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




# ─── Dynamic replanning ───────────────────────────────────────────────────────

_REPLAN_SYSTEM = """You are a dynamic task replanning agent for an AI execution system.

A task in the current plan has failed or produced an invalid result.
Your job: revise the remaining plan so the overall goal can still be achieved.

You will be given:
  - The original user goal
  - Tasks that already succeeded (do NOT redo these)
  - The task that failed, the exact error/validation reason, and what it produced
  - The remaining tasks that were going to run next (now cancelled)
  - Available resources (tools, skills, MCP, llm, code)

Rules:
1. Produce ONLY the tasks still needed to reach the original goal.
2. Do NOT repeat tasks that already succeeded.
3. Every new task must address the failure — either work around it, use a different
   resource, simplify the approach, or fix the inputs.
4. Use resource_type="llm" for pure reasoning with no external calls.
5. Keep tasks atomic — one resource per task.
6. Every task MUST have a concrete validation criterion.
7. Number new task IDs starting from where the failure occurred, prefixed with "r{replan_n}_"
   e.g. "r1_t1", "r1_t2". This makes it clear which replan generated them.
8. If there is NO viable path to the goal given the failure, return an empty tasks list
   and set "give_up": true with a clear explanation in "reasoning".
9. Do NOT invent resources that are not in the available inventory.

Return ONLY valid JSON:
{
  "tasks": [
    {
      "task_id": "r{n}_t1",
      "description": "...",
      "resource_type": "tool|skill|mcp|llm|code",
      "resource_name": "exact name or 'reasoning'",
      "resource_args": {},
      "preconditions": [],
      "depends_on": [],
      "validation": "how to verify this task succeeded",
      "critical": true
    }
  ],
  "give_up": false,
  "reasoning": "why this revised plan will succeed where the original failed"
}"""




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


