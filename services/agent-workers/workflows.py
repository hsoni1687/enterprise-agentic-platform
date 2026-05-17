import asyncio
import json
import logging
from datetime import timedelta
from typing import Optional

from temporalio import workflow
from temporalio.common import RetryPolicy


@workflow.defn
class AgentWorkflow:
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
        prompt    = request.get("prompt") or request.get("payload", {}).get("prompt", "Hello")
        manifest  = request.get("manifest") or {}

        system_prompt  = manifest.get("system_prompt") or "You are a helpful assistant."
        model          = manifest.get("model") or request.get("model", "mock-gpt-4o")
        max_iterations = int(manifest.get("max_iterations") or 5)
        skills         = manifest.get("skills") or []
        direct_tools   = manifest.get("tools") or []
        explicit_mcp   = manifest.get("mcp_servers") or []

        workflow.logger.info(f"[WORKFLOW] agent={agent_id} model={model}")

        # ── manifest-assistant-system: legacy path, unchanged ─────────────────
        if agent_id == "manifest-assistant-system":
            return await self._manifest_assistant_run(
                agent_id, tenant_id, prompt, system_prompt, model,
                max_iterations, skills, direct_tools, explicit_mcp,
            )

        # ── All other agents: orchestrated task-plan execution ────────────────
        return await self._orchestrated_run(
            agent_id, tenant_id, prompt, system_prompt, model,
            max_iterations, skills, direct_tools, explicit_mcp,
        )

    # ─────────────────────────────────────────────────────────────────────────
    # Orchestrated execution (new path)
    # ─────────────────────────────────────────────────────────────────────────

    async def _orchestrated_run(
        self,
        agent_id: str,
        tenant_id: str,
        prompt: str,
        system_prompt: str,
        model: str,
        max_iterations: int,
        skills: list,
        direct_tools: list,
        explicit_mcp: list,
    ) -> str:

        # ── Phase 1: Parallel context assembly ────────────────────────────────
        self._emit({"type": "thinking", "content": "Assembling agent context..."})

        # max_attempts=1 → no Temporal retries for memory/context; failures are non-fatal
        recall_handle    = workflow.start_activity(
            "recall_memories",
            args=[prompt, agent_id],
            start_to_close_timeout=timedelta(seconds=8),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
        mcp_handle       = workflow.start_activity(
            "resolve_mcp_servers",
            args=[tenant_id, explicit_mcp],
            start_to_close_timeout=timedelta(seconds=15),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
        tools_handle     = workflow.start_activity(
            "fetch_system_tools",
            args=[tenant_id],
            start_to_close_timeout=timedelta(seconds=15),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
        guardrails_handle = workflow.start_activity(
            "load_active_guardrails",
            args=[agent_id, tenant_id],
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
        hooks_handle     = workflow.start_activity(
            "load_active_hooks",
            args=[agent_id, tenant_id],
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )

        # Await all parallel handles
        try:
            past_memories = await recall_handle
        except Exception as e:
            workflow.logger.warning(f"[WORKFLOW] Memory recall skipped: {e}")
            past_memories = []

        mcp_servers  = await mcp_handle
        system_tools = await tools_handle
        guardrails   = await guardrails_handle
        hooks        = await hooks_handle

        # ── Phase 1b: Dependent discoveries ───────────────────────────────────
        mcp_tool_defs = []
        if mcp_servers:
            try:
                mcp_tool_defs = await workflow.execute_activity(
                    "discover_mcp_tools",
                    args=[mcp_servers, tenant_id],
                    start_to_close_timeout=timedelta(seconds=30),
                    retry_policy=RetryPolicy(maximum_attempts=2),
                )
            except Exception as e:
                workflow.logger.warning(f"[WORKFLOW] MCP discovery failed: {e}")

        skill_context = await workflow.execute_activity(
            "resolve_skill_context",
            args=[tenant_id, skills],
            start_to_close_timeout=timedelta(seconds=20),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )
        resolved_skills  = skill_context.get("skills") or skills
        rendered_skills  = skill_context.get("markdown") or ""

        # Patch system prompt with memories + skills
        if past_memories:
            system_prompt += "\n\nPast findings:\n- " + "\n- ".join(past_memories)
        if rendered_skills:
            system_prompt += "\n\nAvailable skill instructions:\n\n" + rendered_skills

        # ── Build agent context ───────────────────────────────────────────────
        agent_context = {
            "agent_id":    agent_id,
            "tenant_id":   tenant_id,
            "prompt":      prompt,
            "model":       model,
            "max_iterations": max_iterations,
            "system_prompt":  system_prompt,
            "skills":         resolved_skills,
            "tools":          direct_tools,
            "system_tools":   system_tools,
            "mcp_servers":    explicit_mcp,
            "mcp_tool_defs":  mcp_tool_defs,
            "guardrails":     guardrails,
            "hooks":          hooks,
            "approved_hitl_tools": {},
        }

        # ── Build resource inventory summary for the planner ──────────────────
        tool_names  = [t.get("name", "") for t in direct_tools + system_tools if isinstance(t, dict)]
        skill_names = [s.get("name", "") for s in resolved_skills if isinstance(s, dict)]
        mcp_names   = [
            m.get("function", {}).get("name", "") for m in mcp_tool_defs if isinstance(m, dict)
        ]
        guardrail_names = [g.get("name", "") for g in guardrails if isinstance(g, dict)]

        context_summary = (
            f"Tools: {tool_names}\n"
            f"Skills: {skill_names}\n"
            f"MCP tools: {mcp_names}\n"
            f"Active guardrails: {guardrail_names}\n"
            f"Agent system prompt (excerpt): {system_prompt[:400]}"
        )

        # ── Phase 2: Planning ─────────────────────────────────────────────────
        self._emit({"type": "thinking", "content": "Planning execution tasks..."})

        plan = await workflow.execute_activity(
            "plan_tasks",
            args=[prompt, context_summary, model],
            start_to_close_timeout=timedelta(seconds=60),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )

        tasks = plan.get("tasks", [])
        workflow.logger.info(f"[WORKFLOW] Plan has {len(tasks)} tasks. Reasoning: {plan.get('reasoning','')[:120]}")
        self._emit({
            "type": "plan",
            "tasks": [{"id": t["task_id"], "description": t["description"]} for t in tasks],
            "reasoning": plan.get("reasoning", ""),
        })

        # ── Phase 3: Task execution loop ──────────────────────────────────────
        task_results: dict[str, str]  = {}
        task_statuses: dict[str, str] = {t["task_id"]: "pending" for t in tasks}
        final_answer: Optional[str]   = None
        abort_plan = False

        for task in tasks:
            if abort_plan:
                break

            tid         = task["task_id"]
            description = task["description"]
            is_critical = task.get("critical", True)

            # ── Dependency check ──────────────────────────────────────────────
            deps           = task.get("depends_on", [])
            failed_deps    = [d for d in deps if task_statuses.get(d) in ("failed", "blocked", "aborted")]
            incomplete_deps = [d for d in deps if task_statuses.get(d) not in ("succeeded", "skipped")]

            if failed_deps:
                task_statuses[tid] = "blocked"
                self._emit({"type": "task_blocked", "task_id": tid, "reason": f"dependency failed: {failed_deps}"})
                workflow.logger.warning(f"[WORKFLOW] task={tid} BLOCKED — dependency failed: {failed_deps}")
                continue

            if incomplete_deps:
                # Plan was not topologically sorted — treat as blocked
                task_statuses[tid] = "blocked"
                self._emit({"type": "task_blocked", "task_id": tid, "reason": f"dependency not complete: {incomplete_deps}"})
                continue

            task_statuses[tid] = "running"
            self._emit({"type": "task_start", "task_id": tid, "description": description})
            workflow.logger.info(f"[WORKFLOW] task={tid} STARTING — {description}")

            # ── Input guardrails ──────────────────────────────────────────────
            args_text    = json.dumps(task.get("resource_args", {}))
            guard_input  = await workflow.execute_activity(
                "apply_guardrails",
                args=[args_text, guardrails, "input"],
                start_to_close_timeout=timedelta(seconds=10),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
            if guard_input.get("blocked"):
                reason = guard_input.get("block_reason", "input guardrail")
                task_statuses[tid] = "blocked"
                self._emit({"type": "task_blocked", "task_id": tid, "reason": reason})
                workflow.logger.warning(f"[WORKFLOW] task={tid} blocked by input guardrail: {reason}")
                if is_critical:
                    abort_plan = True
                    final_answer = f"Execution blocked by safety guardrail: {reason}"
                continue
            # Use sanitized args going forward
            if guard_input.get("violations"):
                task["resource_args"] = json.loads(guard_input.get("sanitized_text", args_text))

            # ── Pre-execution hooks ───────────────────────────────────────────
            hook_pre = await workflow.execute_activity(
                "run_hooks",
                args=["pre", task.get("resource_name", ""), task.get("resource_args", {}), None, hooks, agent_context],
                start_to_close_timeout=timedelta(seconds=15),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
            if hook_pre.get("blocked"):
                reason = hook_pre.get("block_reason", "pre-hook")
                task_statuses[tid] = "blocked"
                self._emit({"type": "task_blocked", "task_id": tid, "reason": reason})
                if is_critical:
                    abort_plan = True
                    final_answer = f"Execution blocked by hook: {reason}"
                continue
            # Use args modified by hooks (e.g. pii_strip)
            if hook_pre.get("modified_args"):
                task["resource_args"] = hook_pre["modified_args"]

            # ── HITL gate for mutating tasks ──────────────────────────────────
            is_mutating = any(
                h.get("type") == "hitl_intercept"
                for h in hooks
                if h.get("phase") in ("pre", "both")
            )
            if is_mutating and task.get("resource_type") in ("tool", "skill"):
                import uuid as _uuid
                approval_id = str(_uuid.uuid4())
                self._emit({
                    "type": "approval",
                    "approval_id": approval_id,
                    "tool_name": task.get("resource_name"),
                    "tool_args": task.get("resource_args", {}),
                    "reason": f"Task '{description}' requires human approval before execution.",
                })
                self._hitl_decision = None
                try:
                    await workflow.wait_condition(
                        lambda: self._hitl_decision is not None,
                        timeout=timedelta(minutes=5),
                    )
                except asyncio.TimeoutError:
                    task_statuses[tid] = "blocked"
                    self._emit({"type": "task_blocked", "task_id": tid, "reason": "HITL approval timed out"})
                    if is_critical:
                        abort_plan = True
                        final_answer = f"Task '{description}' timed out awaiting human approval."
                    continue

                if self._hitl_decision != "approved":
                    task_statuses[tid] = "blocked"
                    self._emit({"type": "task_blocked", "task_id": tid, "reason": "HITL denied"})
                    if is_critical:
                        abort_plan = True
                        final_answer = f"Task '{description}' was denied by operator."
                    continue

            # ── Execute the task ──────────────────────────────────────────────
            raw_result: Optional[str] = None
            execution_error: Optional[str] = None
            retry_count = 0
            max_retries = 1  # one recovery attempt

            while retry_count <= max_retries:
                try:
                    raw_result = await workflow.execute_activity(
                        "execute_single_task",
                        args=[task, agent_context],
                        start_to_close_timeout=timedelta(seconds=60),
                        retry_policy=RetryPolicy(
                            maximum_attempts=3,
                            non_retryable_error_types=["BadRequestError"],
                        ),
                    )
                    execution_error = None
                    break
                except Exception as e:
                    execution_error = str(e)
                    workflow.logger.error(f"[WORKFLOW] task={tid} execution error (attempt {retry_count+1}): {execution_error[:200]}")

                    if retry_count >= max_retries:
                        break

                    # ── Recovery: diagnose and decide ─────────────────────────
                    self._emit({"type": "thinking", "content": f"Task '{description}' failed — diagnosing recovery..."})
                    recovery = await workflow.execute_activity(
                        "handle_task_failure",
                        args=[task, execution_error, task_results, context_summary, model],
                        start_to_close_timeout=timedelta(seconds=30),
                        retry_policy=RetryPolicy(maximum_attempts=1),
                    )

                    decision = recovery.get("recovery", "abort")
                    self._emit({
                        "type": "recovery",
                        "task_id": tid,
                        "decision": decision,
                        "reason": recovery.get("reason", ""),
                    })
                    workflow.logger.info(f"[WORKFLOW] task={tid} recovery={decision}")

                    if decision == "retry_with_args" and recovery.get("retry_args"):
                        task["resource_args"] = recovery["retry_args"]
                        retry_count += 1
                        continue

                    elif decision == "skip":
                        task_statuses[tid] = "skipped"
                        task_results[tid]  = recovery.get("message_to_context", "skipped")
                        self._emit({"type": "task_skipped", "task_id": tid})
                        raw_result = None
                        execution_error = None
                        break

                    else:  # abort or use_alternative (alternative not yet implemented)
                        task_statuses[tid] = "failed"
                        task_results[tid]  = f"ERROR: {execution_error}"
                        self._emit({"type": "task_failed", "task_id": tid, "error": execution_error})
                        if is_critical:
                            abort_plan = True
                            final_answer = (
                                f"Critical task '{description}' could not be completed: {execution_error}"
                            )
                        raw_result = None
                        execution_error = None
                        break

            # Skip to next task if recovery resolved it
            if task_statuses.get(tid) in ("skipped", "failed"):
                continue
            if abort_plan:
                break

            # ── Handle unrecovered execution error ────────────────────────────
            if execution_error:
                task_statuses[tid] = "failed"
                task_results[tid]  = f"ERROR: {execution_error}"
                self._emit({"type": "task_failed", "task_id": tid, "error": execution_error})
                if is_critical:
                    abort_plan = True
                    final_answer = f"Critical task '{description}' failed: {execution_error}"
                continue

            result_str = raw_result or ""

            # ── Output guardrails ─────────────────────────────────────────────
            guard_output = await workflow.execute_activity(
                "apply_guardrails",
                args=[result_str, guardrails, "output"],
                start_to_close_timeout=timedelta(seconds=10),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
            if guard_output.get("blocked"):
                result_str = f"[Output blocked by guardrail: {guard_output.get('block_reason')}]"
                self._emit({"type": "guardrail_block", "task_id": tid, "phase": "output"})
            elif guard_output.get("violations"):
                result_str = guard_output.get("sanitized_text", result_str)
                self._emit({"type": "guardrail_redact", "task_id": tid, "count": len(guard_output["violations"])})

            # ── Validate result ───────────────────────────────────────────────
            validation = await workflow.execute_activity(
                "validate_task_result",
                args=[task, result_str, model],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
            self._emit({
                "type": "task_validated",
                "task_id": tid,
                "valid": validation.get("valid", True),
                "confidence": validation.get("confidence", "low"),
            })

            if not validation.get("valid", True) and validation.get("confidence") == "high":
                # High-confidence validation failure — treat like an execution error
                workflow.logger.warning(f"[WORKFLOW] task={tid} validation FAILED (high confidence): {validation.get('reason')}")
                task_statuses[tid] = "failed"
                task_results[tid]  = f"VALIDATION_FAILED: {validation.get('reason')}"
                self._emit({"type": "task_failed", "task_id": tid, "error": validation.get("reason")})
                if is_critical:
                    abort_plan = True
                    final_answer = f"Task '{description}' result did not meet validation: {validation.get('reason')}"
                continue

            # ── Post-execution hooks ──────────────────────────────────────────
            await workflow.execute_activity(
                "run_hooks",
                args=["post", task.get("resource_name", ""), task.get("resource_args", {}),
                      {"result": result_str}, hooks, agent_context],
                start_to_close_timeout=timedelta(seconds=15),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )

            # ── Task succeeded ────────────────────────────────────────────────
            task_statuses[tid] = "succeeded"
            task_results[tid]  = result_str
            self._emit({"type": "task_complete", "task_id": tid, "result_preview": result_str[:200]})
            workflow.logger.info(f"[WORKFLOW] task={tid} SUCCEEDED")

        # ── Phase 4: Synthesize final answer ──────────────────────────────────
        if not final_answer:
            self._emit({"type": "thinking", "content": "Synthesizing final answer..."})
            final_answer = await workflow.execute_activity(
                "synthesize_final_answer",
                args=[prompt, task_results, task_statuses, model],
                start_to_close_timeout=timedelta(seconds=60),
                retry_policy=RetryPolicy(maximum_attempts=2),
            )

        # ── Phase 5: Store memory (fire-and-forget) ───────────────────────────
        try:
            workflow.start_activity(
                "store_memory",
                args=[f"Observation for '{prompt}': {final_answer}", agent_id],
                start_to_close_timeout=timedelta(seconds=10),
            )
        except Exception as e:
            workflow.logger.warning(f"[WORKFLOW] store_memory skipped: {e}")

        self._emit({"type": "text", "content": final_answer})
        self._emit({"type": "done"})
        return f"Agent {agent_id} completed: {final_answer}"

    # ─────────────────────────────────────────────────────────────────────────
    # Legacy manifest-assistant path — unchanged
    # ─────────────────────────────────────────────────────────────────────────

    async def _manifest_assistant_run(
        self,
        agent_id: str,
        tenant_id: str,
        prompt: str,
        system_prompt: str,
        model: str,
        max_iterations: int,
        skills: list,
        direct_tools: list,
        explicit_mcp: list,
    ) -> str:
        recall_handle = workflow.start_activity(
            "recall_memories",
            args=[prompt, agent_id],
            start_to_close_timeout=timedelta(seconds=8),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )

        explicit_mcp_servers = explicit_mcp
        all_mcp_servers = await workflow.execute_activity(
            "resolve_mcp_servers",
            args=[tenant_id, explicit_mcp_servers],
            start_to_close_timeout=timedelta(seconds=15),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )

        mcp_tool_defs = []
        if all_mcp_servers:
            try:
                discovered = await workflow.execute_activity(
                    "discover_mcp_tools",
                    args=[all_mcp_servers, tenant_id],
                    start_to_close_timeout=timedelta(seconds=30),
                    retry_policy=RetryPolicy(maximum_attempts=2),
                )
                mcp_tool_defs = discovered
            except Exception as e:
                workflow.logger.warning(f"MCP tool discovery failed: {e}")

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": prompt},
        ]

        try:
            past_memories = await recall_handle
        except Exception as mem_err:
            workflow.logger.warning(f"[WORKFLOW] Memory recall skipped (non-fatal): {mem_err}")
            past_memories = []
        if past_memories:
            system_prompt += "\n\nPast findings/memories:\n- " + "\n- ".join(past_memories)
            messages[0] = {"role": "system", "content": system_prompt}

        self._emit({"type": "thinking", "content": f"Starting reasoning for: {prompt[:80]}"})

        system_tools = await workflow.execute_activity(
            "fetch_system_tools",
            args=[tenant_id],
            start_to_close_timeout=timedelta(seconds=15),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )
        skill_context = await workflow.execute_activity(
            "resolve_skill_context",
            args=[tenant_id, skills],
            start_to_close_timeout=timedelta(seconds=20),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )
        rendered_skills = skill_context.get("markdown") or ""
        if rendered_skills:
            system_prompt += "\n\nAvailable skill instructions:\n\n" + rendered_skills
            messages[0] = {"role": "system", "content": system_prompt}

        final_answer = None
        for i in range(max_iterations):
            workflow.logger.info(f"[MANIFEST-ASSISTANT] Iteration {i+1}/{max_iterations}")
            decision = await workflow.execute_activity(
                "reasoning_step",
                args=[messages, model, []],
                start_to_close_timeout=timedelta(seconds=60),
                retry_policy=RetryPolicy(maximum_attempts=3),
            )

            final_answer = decision.get("content")
            tool_calls   = decision.get("tool_calls")
            continue_loop = bool(tool_calls)

            if final_answer or tool_calls:
                assistant_msg: dict = {"role": "assistant"}
                if final_answer:
                    assistant_msg["content"] = final_answer
                else:
                    assistant_msg["content"] = None
                if tool_calls:
                    assistant_msg["tool_calls"] = [
                        {"id": tc["id"], "function": {"name": tc["function"]["name"], "arguments": tc["function"]["arguments"]}}
                        for tc in tool_calls
                    ]
                messages.append(assistant_msg)

            if tool_calls:
                for tc in tool_calls:
                    tool_id   = tc.get("id", "")
                    tool_name = tc.get("function", {}).get("name", "unknown")
                    tool_args = tc.get("function", {}).get("arguments", "{}")
                    if isinstance(tool_args, str):
                        tool_args = json.loads(tool_args)
                    self._emit({"type": "tool_call", "tool_name": tool_name, "tool_args": tool_args})

                    if tool_name == "execute_code":
                        try:
                            tool_result_content = await workflow.execute_activity(
                                "execute_code",
                                args=[tool_args.get("code", "")],
                                start_to_close_timeout=timedelta(seconds=30),
                                retry_policy=RetryPolicy(maximum_attempts=2),
                            )
                        except Exception as e:
                            tool_result_content = f"Tool error: {e}"
                        messages.append({"role": "tool", "tool_call_id": tool_id, "content": str(tool_result_content)})

            if final_answer or not continue_loop:
                break

        if not final_answer:
            final_answer = "Exceeded max reasoning iterations without a conclusion."

        self._emit({"type": "text", "content": final_answer})
        self._emit({"type": "done"})

        try:
            workflow.start_activity(
                "store_memory",
                args=[f"Observation for '{prompt}': {final_answer}", agent_id],
                start_to_close_timeout=timedelta(seconds=10),
            )
        except Exception as store_err:
            workflow.logger.warning(f"[WORKFLOW] store_memory skipped: {store_err}")

        return f"Agent {agent_id} completed: {final_answer}"
