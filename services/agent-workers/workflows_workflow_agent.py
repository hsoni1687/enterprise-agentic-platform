"""
workflows_workflow_agent.py — Temporal workflow for Workflow-tier agents.

Design:
  • Executes a static step DAG defined in agent.execution_config.steps
  • Steps run in dependency order (topological sort)
  • Supported step types: llm, tool, skill, condition, approval, loop
  • HITL approval steps suspend the workflow and wait for a Temporal signal
  • Per-step retry config; fallback_step_id on failure
  • Full SSE event stream: step_start, step_complete, step_failed, approval, done
  • Guardrails applied: input PII/security check before each step, output redaction after
"""

import asyncio
import json
import logging
from datetime import timedelta
from typing import Optional

from temporalio import workflow
from temporalio.common import RetryPolicy


@workflow.defn
class WorkflowAgentRun:
    """Temporal workflow for Workflow-tier (multi-step static DAG) agents."""

    def __init__(self):
        self._events: list[dict] = []
        self._hitl_decision: Optional[str] = None

    @workflow.query
    def get_events(self) -> list[dict]:
        return self._events

    def _emit(self, event: dict) -> None:
        self._events.append(event)

    @workflow.signal(name="hitl_response")
    async def hitl_response(self, data: dict) -> None:
        self._hitl_decision = data.get("decision", "denied")

    @workflow.run
    async def run(self, request: dict) -> str:
        agent_id  = request.get("agent_id", "unknown")
        tenant_id = request.get("tenant_id", "default-tenant")
        prompt    = request.get("prompt") or request.get("payload", {}).get("prompt", "")
        manifest  = request.get("manifest") or {}

        system_prompt  = manifest.get("system_prompt") or "You are a helpful assistant."
        model          = manifest.get("model") or "gpt-4o-mini"
        exec_config    = manifest.get("execution_config") or {}
        steps_raw      = exec_config.get("steps") or []
        hitl_on_mutating = exec_config.get("hitl_on_mutating", True)
        max_duration   = exec_config.get("max_duration_seconds", 300)
        mcp_servers    = manifest.get("mcp_servers") or []

        workflow.logger.info(f"[WORKFLOW_AGENT] agent={agent_id} model={model} steps={len(steps_raw)}")

        # ── Load guardrails ──────────────────────────────────────────────────
        guardrails: list[dict] = await workflow.execute_activity(
            "load_active_guardrails",
            args=[agent_id, tenant_id],
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )

        # ── Guard the raw user prompt (input phase) ──────────────────────────
        if guardrails:
            guard_result = await workflow.execute_activity(
                "apply_guardrails",
                args=[prompt, guardrails, "input"],
                start_to_close_timeout=timedelta(seconds=10),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
            if guard_result.get("blocked"):
                reason = guard_result.get("block_reason", "Blocked by guardrail")
                self._emit({"type": "guardrail_block", "reason": reason})
                self._emit({"type": "text", "content": f"[Blocked] {reason}"})
                self._emit({"type": "done"})
                return f"[Blocked] {reason}"
            prompt = guard_result.get("sanitized_text", prompt)
            if guard_result.get("violations"):
                self._emit({"type": "guardrail_redact", "violations": guard_result["violations"]})

        if not steps_raw:
            # No steps defined — fall back to a single LLM call (with MCP tools if attached)
            thinking_msg = (
                f"No steps defined, running as single LLM call"
                + (f" with {len(mcp_servers)} MCP server(s)..." if mcp_servers else "...")
            )
            self._emit({"type": "thinking", "content": thinking_msg})
            result = await workflow.execute_activity(
                "run_single_llm_step",
                args=[prompt, system_prompt, model, agent_id, tenant_id, mcp_servers],
                start_to_close_timeout=timedelta(seconds=min(max_duration, 120)),
                retry_policy=RetryPolicy(maximum_attempts=2),
            )
            self._emit({"type": "text", "content": result})
            self._emit({"type": "done"})
            return result

        # ── Topological sort of steps ────────────────────────────────────────
        ordered_steps = _topo_sort(steps_raw)
        self._emit({
            "type": "plan",
            "content": f"Executing {len(ordered_steps)} steps",
            "steps": [{"id": s["id"], "name": s["name"], "type": s["type"]} for s in ordered_steps],
        })

        # ── Execute steps ────────────────────────────────────────────────────
        step_results: dict[str, str] = {"__prompt__": prompt}
        final_output = ""

        for step in ordered_steps:
            step_id   = step["id"]
            step_name = step.get("name", step_id)
            step_type = step.get("type", "llm")

            # Check dependencies are satisfied
            depends_on = step.get("depends_on") or []
            missing = [d for d in depends_on if d not in step_results]
            if missing:
                workflow.logger.warning(f"[WORKFLOW_AGENT] Skipping step {step_id}: unmet deps {missing}")
                continue

            self._emit({"type": "step_start", "step_id": step_id, "name": step_name, "step_type": step_type})

            try:
                # Apply input guardrails to step-specific input
                step_input_for_guard = _resolve_input(step, step_results)
                if guardrails and step_input_for_guard:
                    g_in = await workflow.execute_activity(
                        "apply_guardrails",
                        args=[step_input_for_guard, guardrails, "input"],
                        start_to_close_timeout=timedelta(seconds=10),
                        retry_policy=RetryPolicy(maximum_attempts=1),
                    )
                    if g_in.get("blocked"):
                        reason = g_in.get("block_reason", "Blocked by guardrail")
                        self._emit({"type": "guardrail_block", "step_id": step_id, "reason": reason})
                        step_results[step_id] = f"[Blocked] {reason}"
                        continue
                    if g_in.get("violations"):
                        self._emit({"type": "guardrail_redact", "step_id": step_id, "violations": g_in["violations"]})
                        # Inject sanitized version so _execute_step picks it up
                        step_results["__guardrail_sanitized__"] = g_in.get("sanitized_text", step_input_for_guard)

                result = await _execute_step(
                    self, step, step_results, system_prompt, model,
                    agent_id, tenant_id, hitl_on_mutating, max_duration, mcp_servers,
                )
                # Remove any temporary sanitized key
                step_results.pop("__guardrail_sanitized__", None)

                # Apply output guardrails to step result
                if guardrails and result:
                    g_out = await workflow.execute_activity(
                        "apply_guardrails",
                        args=[result, guardrails, "output"],
                        start_to_close_timeout=timedelta(seconds=10),
                        retry_policy=RetryPolicy(maximum_attempts=1),
                    )
                    if g_out.get("blocked"):
                        reason = g_out.get("block_reason", "Blocked by guardrail")
                        self._emit({"type": "guardrail_block", "step_id": step_id, "reason": reason})
                        result = f"[Output blocked by guardrail: {reason}]"
                    elif g_out.get("violations"):
                        self._emit({"type": "guardrail_redact", "step_id": step_id, "violations": g_out["violations"]})
                        result = g_out.get("sanitized_text", result)

                step_results[step_id] = result
                final_output = result  # last step output is the candidate final answer

                self._emit({"type": "step_complete", "step_id": step_id, "name": step_name, "result": result[:500] if result else ""})

            except Exception as exc:
                err_msg = str(exc)
                workflow.logger.error(f"[WORKFLOW_AGENT] step={step_id} failed: {err_msg}")
                self._emit({"type": "step_failed", "step_id": step_id, "name": step_name, "error": err_msg})

                # Try fallback step if defined
                fallback_id = step.get("fallback_step_id")
                if fallback_id:
                    step_results[step_id] = f"FAILED: {err_msg} (see fallback {fallback_id})"
                else:
                    step_results[step_id] = f"FAILED: {err_msg}"

        # ── Synthesize final answer ──────────────────────────────────────────
        if final_output:
            self._emit({"type": "text", "content": final_output})
        else:
            self._emit({"type": "text", "content": "Workflow completed but produced no output."})

        self._emit({"type": "done"})
        return final_output


# ─────────────────────────────────────────────────────────────────────────────
# Step execution dispatcher
# ─────────────────────────────────────────────────────────────────────────────

async def _execute_step(
    wf: "WorkflowAgentRun",
    step: dict,
    step_results: dict[str, str],
    system_prompt: str,
    model: str,
    agent_id: str,
    tenant_id: str,
    hitl_on_mutating: bool,
    max_duration: int,
    mcp_servers: list | None = None,
) -> str:
    step_type = step.get("type", "llm")
    timeout = timedelta(seconds=min(max_duration, 120))

    if step_type == "llm":
        # Build prompt from input_mapping or use previous step output
        step_input = _resolve_input(step, step_results)
        return await workflow.execute_activity(
            "run_single_llm_step",
            args=[step_input, system_prompt, model, agent_id, tenant_id, mcp_servers or []],
            start_to_close_timeout=timeout,
            retry_policy=RetryPolicy(maximum_attempts=2),
        )

    elif step_type in ("tool", "skill"):
        tool_id   = step.get("tool_id") or step.get("skill_id") or ""
        step_input = _resolve_input(step, step_results)

        # HITL check for mutating steps
        if hitl_on_mutating and _is_mutating_step(step):
            approved = await _request_hitl(wf, step, agent_id, tenant_id, step_input)
            if not approved:
                return f"Step '{step.get('name')}' skipped: not approved by human."

        return await workflow.execute_activity(
            "execute_workflow_step_tool",
            args=[tool_id, step_input, agent_id, tenant_id],
            start_to_close_timeout=timeout,
            retry_policy=RetryPolicy(
                maximum_attempts=step.get("max_retries", 1) + 1 if step.get("retry_on_failure") else 1,
            ),
        )

    elif step_type == "condition":
        condition = step.get("condition", "")
        step_input = _resolve_input(step, step_results)
        # Evaluate condition via activity (LLM-based or regex)
        result = await workflow.execute_activity(
            "evaluate_condition",
            args=[condition, step_input, step_results],
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
        return result  # "true" or "false" — routing handled by caller via next_step_id

    elif step_type == "approval":
        # Dedicated approval step — always requires human input
        approved = await _request_hitl(wf, step, agent_id, tenant_id, "Human approval required")
        if approved:
            return "Approved"
        timeout_action = step.get("on_timeout", "abort")
        if timeout_action == "abort":
            raise RuntimeError(f"Step '{step.get('name')}' rejected by human approver.")
        return "Skipped (not approved)"

    elif step_type == "loop":
        # Iterate over a JSON array from previous step
        step_input = _resolve_input(step, step_results)
        try:
            items = json.loads(step_input) if isinstance(step_input, str) else step_input
            if not isinstance(items, list):
                items = [items]
        except Exception:
            items = [step_input]

        outputs = []
        for item in items[:20]:  # cap at 20 to prevent runaway loops
            out = await workflow.execute_activity(
                "run_single_llm_step",
                args=[str(item), system_prompt, model, agent_id, tenant_id],
                start_to_close_timeout=timedelta(seconds=60),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
            outputs.append(out)
        return "\n".join(outputs)

    else:
        return f"Unknown step type: {step_type}"


async def _request_hitl(
    wf: "WorkflowAgentRun",
    step: dict,
    agent_id: str,
    tenant_id: str,
    context: str,
) -> bool:
    """Suspend workflow, emit approval event, wait for hitl_response signal."""
    step_name = step.get("name", step.get("id", "unknown"))
    approval_msg = step.get("approval_message") or f"Step '{step_name}' requires approval."
    timeout_sec = step.get("approval_timeout_seconds") or 300

    import uuid
    approval_id = str(uuid.uuid4())

    wf._emit({
        "type":        "approval",
        "approval_id": approval_id,
        "reason":      approval_msg,
        "tool_name":   step_name,
        "context":     context,
    })

    wf._hitl_decision = None

    try:
        await workflow.wait_condition(
            lambda: wf._hitl_decision is not None,
            timeout=timedelta(seconds=timeout_sec),
        )
    except asyncio.TimeoutError:
        on_timeout = step.get("on_timeout", "abort")
        if on_timeout == "proceed":
            return True
        return False

    return wf._hitl_decision == "approved"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _resolve_input(step: dict, step_results: dict[str, str]) -> str:
    """Build the step's input string from input_mapping or fall back to last result.

    If a guardrail-sanitized override was injected under '__guardrail_sanitized__',
    use it in place of the raw last result (for unmapped steps only).
    """
    mapping = step.get("input_mapping") or {}
    if not mapping:
        # Prefer sanitized override if guardrails already processed this input
        if "__guardrail_sanitized__" in step_results:
            return step_results["__guardrail_sanitized__"]
        # Default: use the most recent non-internal step result as input
        for key in reversed(list(step_results.keys())):
            if not key.startswith("__"):
                return step_results[key]
        return ""

    parts = []
    for key, source_step_id in mapping.items():
        value = step_results.get(source_step_id, "")
        parts.append(f"{key}: {value}")
    return "\n".join(parts)


def _is_mutating_step(step: dict) -> bool:
    """Heuristic: steps that call external tools or write data are considered mutating."""
    step_type = step.get("type", "llm")
    if step_type in ("tool", "skill"):
        name = (step.get("tool_id") or step.get("skill_id") or "").lower()
        mutating_keywords = ["write", "create", "update", "delete", "send", "post", "deploy", "execute"]
        return any(kw in name for kw in mutating_keywords)
    return False


def _topo_sort(steps: list[dict]) -> list[dict]:
    """Kahn's algorithm — returns steps in dependency order.
    Steps with no depends_on come first; cycles are broken by input order."""
    id_to_step = {s["id"]: s for s in steps}
    in_degree: dict[str, int] = {s["id"]: 0 for s in steps}
    adjacency: dict[str, list[str]] = {s["id"]: [] for s in steps}

    for step in steps:
        for dep in (step.get("depends_on") or []):
            if dep in id_to_step:
                adjacency[dep].append(step["id"])
                in_degree[step["id"]] += 1

    queue = [sid for sid, deg in in_degree.items() if deg == 0]
    ordered: list[dict] = []

    while queue:
        sid = queue.pop(0)
        ordered.append(id_to_step[sid])
        for neighbour in adjacency[sid]:
            in_degree[neighbour] -= 1
            if in_degree[neighbour] == 0:
                queue.append(neighbour)

    # Any remaining steps (cycle) — append in original order
    visited = {s["id"] for s in ordered}
    for step in steps:
        if step["id"] not in visited:
            ordered.append(step)

    return ordered
