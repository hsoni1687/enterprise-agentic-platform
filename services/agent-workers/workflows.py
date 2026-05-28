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

        system_prompt        = manifest.get("system_prompt") or "You are a helpful assistant."
        model                = manifest.get("model") or request.get("model", "mock-gpt-4o")
        max_iterations       = int(manifest.get("max_iterations") or 5)
        skills               = manifest.get("skills") or []
        direct_tools         = manifest.get("tools") or []
        explicit_mcp         = manifest.get("mcp_servers") or []
        autonomy_level       = manifest.get("autonomy_level", "none")
        knowledge_graph_ids  = manifest.get("knowledge_graph_ids") or []

        workflow.logger.info(f"[WORKFLOW] agent={agent_id} model={model} autonomy={autonomy_level}")

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
            autonomy_level, knowledge_graph_ids,
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
        autonomy_level: str = "none",
        knowledge_graph_ids: list = None,
    ) -> str:
        if knowledge_graph_ids is None:
            knowledge_graph_ids = []

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

        try:
            mcp_servers = await mcp_handle
        except Exception as e:
            workflow.logger.warning(f"[WORKFLOW] MCP server resolution skipped: {e}")
            mcp_servers = []

        try:
            system_tools = await tools_handle
        except Exception as e:
            workflow.logger.warning(f"[WORKFLOW] System tools fetch skipped: {e}")
            system_tools = []

        try:
            guardrails = await guardrails_handle
        except Exception as e:
            workflow.logger.warning(f"[WORKFLOW] Guardrails load skipped: {e}")
            guardrails = []

        try:
            hooks = await hooks_handle
        except Exception as e:
            workflow.logger.warning(f"[WORKFLOW] Hooks load skipped: {e}")
            hooks = []

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

        # ── ReAct gate: autonomous agents bypass plan-execute, use dynamic loop ─
        if autonomy_level == "autonomous":
            workflow.logger.info(f"[WORKFLOW] autonomy=autonomous → entering ReAct loop")
            tool_defs, tool_router = self._build_react_tools(
                direct_tools, system_tools, resolved_skills, mcp_tool_defs, knowledge_graph_ids
            )
            return await self._react_loop(
                agent_id=agent_id,
                tenant_id=tenant_id,
                prompt=prompt,
                system_prompt=system_prompt,
                model=model,
                max_iterations=max_iterations,
                tool_defs=tool_defs,
                tool_router=tool_router,
                guardrails=guardrails,
                hooks=hooks,
                agent_context={
                    "agent_id": agent_id, "tenant_id": tenant_id,
                    "model": model, "system_prompt": system_prompt,
                },
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

        # ── Phase 3: Task execution loop (Claude-Code-style: execute → verify → replan) ──
        #
        # Key design: pending_tasks is a mutable queue, not a fixed list.
        # When a task fails validation or execution, replan_remaining_tasks() rewrites
        # the queue with a revised plan that addresses the specific failure.
        # This continues up to MAX_REPLANS times before giving up.
        #
        task_results:    dict[str, str] = {}
        task_statuses:   dict[str, str] = {t["task_id"]: "pending" for t in tasks}
        succeeded_tasks: list[dict]     = []   # ordered list of tasks that succeeded
        final_answer:    Optional[str]  = None
        abort_plan  = False
        replan_count = 0
        MAX_REPLANS  = 3   # max times we'll rewrite the plan before giving up

        pending_tasks: list[dict] = list(tasks)   # mutable — replanning replaces this

        while pending_tasks and not abort_plan:
            task = pending_tasks.pop(0)

            tid         = task["task_id"]
            description = task["description"]
            is_critical = task.get("critical", True)

            task_statuses.setdefault(tid, "pending")

            # ── Dependency check ──────────────────────────────────────────────
            deps            = task.get("depends_on", [])
            failed_deps     = [d for d in deps if task_statuses.get(d) in ("failed", "blocked", "aborted")]
            incomplete_deps = [d for d in deps if task_statuses.get(d) not in ("succeeded", "skipped")]

            if failed_deps:
                task_statuses[tid] = "blocked"
                self._emit({"type": "task_blocked", "task_id": tid, "reason": f"dependency failed: {failed_deps}"})
                workflow.logger.warning(f"[WORKFLOW] task={tid} BLOCKED — dependency failed: {failed_deps}")
                continue

            if incomplete_deps:
                task_statuses[tid] = "blocked"
                self._emit({"type": "task_blocked", "task_id": tid, "reason": f"dependency not complete: {incomplete_deps}"})
                continue

            task_statuses[tid] = "running"
            self._emit({"type": "task_start", "task_id": tid, "description": description})
            workflow.logger.info(f"[WORKFLOW] task={tid} STARTING — {description}")

            # ── Input guardrails ──────────────────────────────────────────────
            args_text   = json.dumps(task.get("resource_args", {}))
            guard_input = await workflow.execute_activity(
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

            # ── Execute — with one immediate retry on transient errors ─────────
            raw_result:      Optional[str] = None
            execution_error: Optional[str] = None

            for attempt in range(2):   # attempt 0 = first try, attempt 1 = one retry
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
                    workflow.logger.error(
                        f"[WORKFLOW] task={tid} attempt={attempt+1} error: {execution_error[:200]}")

                    if attempt == 0:
                        # First failure: ask recovery agent if we should retry immediately
                        # with different args (transient / wrong-args) before replanning
                        self._emit({"type": "thinking",
                                    "content": f"Task '{description}' failed — checking quick recovery..."})
                        recovery = await workflow.execute_activity(
                            "handle_task_failure",
                            args=[task, execution_error, task_results, context_summary, model],
                            start_to_close_timeout=timedelta(seconds=30),
                            retry_policy=RetryPolicy(maximum_attempts=1),
                        )
                        decision = recovery.get("recovery", "abort")
                        workflow.logger.info(f"[WORKFLOW] task={tid} quick-recovery={decision}")

                        if decision == "retry_with_args" and recovery.get("retry_args"):
                            # Patch args and retry immediately (attempt 1)
                            task["resource_args"] = recovery["retry_args"]
                            self._emit({"type": "thinking",
                                        "content": f"Retrying '{description}' with adjusted arguments..."})
                            continue   # → attempt 1

                        elif decision == "skip":
                            task_statuses[tid] = "skipped"
                            task_results[tid]  = recovery.get("message_to_context", "skipped")
                            self._emit({"type": "task_skipped", "task_id": tid})
                            execution_error = None
                            raw_result      = None
                            break

                        # For abort/use_alternative: fall through to replanning below
                        break

            # ── Task failed after execution attempts → replan ─────────────────
            if execution_error and task_statuses.get(tid) not in ("skipped",):
                task_statuses[tid] = "failed"
                task_results[tid]  = f"ERROR: {execution_error}"
                self._emit({"type": "task_failed", "task_id": tid, "error": execution_error})

                if replan_count < MAX_REPLANS:
                    replan_count += 1
                    self._emit({"type": "thinking",
                                "content": f"Task '{description}' failed — replanning (attempt {replan_count}/{MAX_REPLANS})..."})
                    workflow.logger.info(f"[WORKFLOW] REPLANNING #{replan_count} — task={tid} error={execution_error[:100]}")

                    new_plan = await workflow.execute_activity(
                        "replan_remaining_tasks",
                        args=[prompt, succeeded_tasks, task,
                              f"Execution error: {execution_error}",
                              "",   # no output to show — task never produced one
                              list(pending_tasks),  # tasks that were still queued
                              context_summary, replan_count, model],
                        start_to_close_timeout=timedelta(seconds=60),
                        retry_policy=RetryPolicy(maximum_attempts=1),
                    )

                    if new_plan.get("give_up") or not new_plan.get("tasks"):
                        abort_plan  = True
                        final_answer = (
                            f"Could not complete the task after {replan_count} replan(s). "
                            f"Reason: {new_plan.get('reasoning', execution_error)}"
                        )
                        self._emit({"type": "thinking",
                                    "content": f"No viable path forward — stopping. {new_plan.get('reasoning', '')}"})
                    else:
                        # Register new task IDs in statuses, splice into pending queue
                        for nt in new_plan["tasks"]:
                            task_statuses[nt["task_id"]] = "pending"
                        pending_tasks = new_plan["tasks"]
                        self._emit({
                            "type": "plan",
                            "tasks": [{"id": t["task_id"], "description": t["description"]}
                                      for t in new_plan["tasks"]],
                            "reasoning": new_plan.get("reasoning", ""),
                            "replan_n":  replan_count,
                        })
                        workflow.logger.info(
                            f"[WORKFLOW] Replan #{replan_count} produced {len(new_plan['tasks'])} tasks")
                else:
                    # Exhausted replan budget
                    if is_critical:
                        abort_plan   = True
                        final_answer = f"Critical task '{description}' could not be completed after {MAX_REPLANS} replan attempts."

                continue

            # Skip to next if task was skipped by quick-recovery
            if task_statuses.get(tid) == "skipped":
                continue
            if abort_plan:
                break

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
                self._emit({"type": "guardrail_redact", "task_id": tid,
                             "count": len(guard_output["violations"])})

            # ── Verify result (the "check" in Claude-Code loop) ───────────────
            validation = await workflow.execute_activity(
                "validate_task_result",
                args=[task, result_str, model],
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
            self._emit({
                "type":       "task_validated",
                "task_id":    tid,
                "valid":      validation.get("valid", True),
                "confidence": validation.get("confidence", "low"),
            })

            # ── Validation failed → replan remaining tasks ────────────────────
            if not validation.get("valid", True) and validation.get("confidence") == "high":
                failure_reason = validation.get("reason", "validation failed")
                workflow.logger.warning(
                    f"[WORKFLOW] task={tid} validation FAILED: {failure_reason}")
                task_statuses[tid] = "failed"
                task_results[tid]  = f"VALIDATION_FAILED: {failure_reason}"
                self._emit({"type": "task_failed", "task_id": tid, "error": failure_reason})

                if replan_count < MAX_REPLANS:
                    replan_count += 1
                    self._emit({"type": "thinking",
                                "content": f"Result for '{description}' didn't pass check — replanning (attempt {replan_count}/{MAX_REPLANS})..."})
                    workflow.logger.info(
                        f"[WORKFLOW] REPLANNING #{replan_count} after validation failure: {failure_reason[:80]}")

                    new_plan = await workflow.execute_activity(
                        "replan_remaining_tasks",
                        args=[prompt, succeeded_tasks, task,
                              f"Validation failed: {failure_reason}",
                              result_str,               # pass the bad output as evidence
                              list(pending_tasks),
                              context_summary, replan_count, model],
                        start_to_close_timeout=timedelta(seconds=60),
                        retry_policy=RetryPolicy(maximum_attempts=1),
                    )

                    if new_plan.get("give_up") or not new_plan.get("tasks"):
                        abort_plan   = True
                        final_answer = (
                            f"Could not produce a valid result after {replan_count} replan(s). "
                            f"Reason: {new_plan.get('reasoning', failure_reason)}"
                        )
                        self._emit({"type": "thinking",
                                    "content": f"No viable path — stopping. {new_plan.get('reasoning', '')}"})
                    else:
                        for nt in new_plan["tasks"]:
                            task_statuses[nt["task_id"]] = "pending"
                        pending_tasks = new_plan["tasks"]
                        self._emit({
                            "type":      "plan",
                            "tasks":     [{"id": t["task_id"], "description": t["description"]}
                                          for t in new_plan["tasks"]],
                            "reasoning": new_plan.get("reasoning", ""),
                            "replan_n":  replan_count,
                        })
                        workflow.logger.info(
                            f"[WORKFLOW] Replan #{replan_count} produced {len(new_plan['tasks'])} tasks")
                else:
                    if is_critical:
                        abort_plan   = True
                        final_answer = (
                            f"Task '{description}' never produced a valid result after "
                            f"{MAX_REPLANS} replan attempts."
                        )
                continue

            if abort_plan:
                break

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
            succeeded_tasks.append(task)   # track for replanning context
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

        # ── Phase 5: Reflect on run + store memory (fire-and-forget) ────────────
        try:
            # reflect_on_run extracts typed learnings (strategies, failures, tool prefs)
            # and returns True if it also recommends a manifest update proposal
            should_propose = await workflow.execute_activity(
                "reflect_on_run",
                args=[agent_id, tenant_id, prompt, plan, task_results, task_statuses,
                      final_answer, model],
                start_to_close_timeout=timedelta(seconds=45),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
            if should_propose:
                workflow.start_activity(
                    "propose_manifest_update",
                    args=[agent_id, tenant_id, model],
                    start_to_close_timeout=timedelta(seconds=30),
                )
        except Exception as e:
            workflow.logger.warning(f"[WORKFLOW] reflect_on_run skipped: {e}")

        self._emit({"type": "text", "content": final_answer})
        self._emit({"type": "done"})
        return f"Agent {agent_id} completed: {final_answer}"

    # ─────────────────────────────────────────────────────────────────────────
    # ReAct loop — true agentic execution (autonomy_level = "full")
    # ─────────────────────────────────────────────────────────────────────────

    def _build_react_tools(
        self,
        direct_tools: list,
        system_tools: list,
        resolved_skills: list,
        mcp_tool_defs: list,
        knowledge_graph_ids: list,
    ) -> tuple[list, dict]:
        """
        Convert all available resources into two structures:
          tool_defs  — OpenAI-format list passed to the LLM so it knows what it can call
          tool_router — serialisable dict mapping every tool_name → routing metadata
                        consumed by the execute_react_tool activity
        """
        tool_defs: list  = []
        tool_router: dict = {}

        # ── MCP tools (already in OpenAI format from discover_mcp_tools) ─────
        for td in mcp_tool_defs:
            fn   = td.get("function", {})
            name = fn.get("name", "")
            meta = td.get("__mcp_meta", {})
            if not name:
                continue
            tool_defs.append({"type": "function", "function": fn})
            tool_router[name] = {
                "type":      "mcp",
                "server_id": meta.get("server_id", ""),
                "tool_name": meta.get("tool_name", name.split("__")[-1]),
            }

        # ── Skills ────────────────────────────────────────────────────────────
        for skill in resolved_skills:
            if not isinstance(skill, dict):
                continue
            name = skill.get("name", "")
            if not name:
                continue
            exposed_name = f"skill__{name}"
            tool_defs.append({
                "type": "function",
                "function": {
                    "name":        exposed_name,
                    "description": skill.get("description", f"Skill: {name}"),
                    "parameters":  skill.get("parameters") or {"type": "object", "properties": {}},
                },
            })
            tool_router[exposed_name] = {"type": "skill", "name": name}

        # ── Direct / system tools ─────────────────────────────────────────────
        for tool in (direct_tools or []) + (system_tools or []):
            if not isinstance(tool, dict):
                continue
            name = tool.get("name", "")
            if not name:
                continue
            exposed_name = f"tool__{name}"
            tool_defs.append({
                "type": "function",
                "function": {
                    "name":        exposed_name,
                    "description": tool.get("description", f"Tool: {name}"),
                    "parameters":  tool.get("parameters") or {"type": "object", "properties": {}},
                },
            })
            tool_router[exposed_name] = {"type": "tool", "name": name}

        # ── Knowledge-graph search (added automatically if KGs are attached) ──
        if knowledge_graph_ids:
            tool_defs.append({
                "type": "function",
                "function": {
                    "name":        "kg_search",
                    "description": (
                        "Search the agent's attached knowledge graphs for entities, "
                        "facts, or relationships relevant to a query."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type":        "string",
                                "description": "Natural-language search query",
                            },
                            "top_k": {
                                "type":        "integer",
                                "description": "Max number of results (default 5)",
                            },
                        },
                        "required": ["query"],
                    },
                },
            })
            tool_router["kg_search"] = {"type": "kg", "graph_ids": knowledge_graph_ids}

        return tool_defs, tool_router

    async def _react_loop(
        self,
        agent_id: str,
        tenant_id: str,
        prompt: str,
        system_prompt: str,
        model: str,
        max_iterations: int,
        tool_defs: list,
        tool_router: dict,
        guardrails: list,
        hooks: list,
        agent_context: dict,
    ) -> str:
        """
        True ReAct (Reason → Act → Observe) loop.

        The LLM is told WHAT to achieve (the user prompt + system prompt).
        It decides HOW — which tools to call, in what order, and when to stop.
        Every tool result is fed back into the conversation before the next
        reasoning step, so the agent can change course based on observations.

        Loop terminates when:
          • The LLM responds without a tool call (it has a final answer), OR
          • max_iterations is reached (safety ceiling), OR
          • A critical guardrail blocks execution.
        """
        # Augment system prompt with ReAct behavioural instructions
        react_system = system_prompt + """

You are an autonomous agent with access to tools. Use them when you need real data.

Your job:
1. If the user asks for live data (account info, balances, transactions, customer records) — use the relevant tool. Do NOT make up or refuse this data.
2. Call ONE tool at a time. After each result, decide if you have enough to answer.
3. Stop calling tools as soon as you have enough information.
4. Provide a clear, helpful final answer in plain language addressed directly to the user.

Rules:
- If a tool exists that can answer the question, USE IT. Never say you cannot access data when a tool can fetch it.
- Call each tool at most ONCE. Do not repeat the same call.
- If a tool returns an error, report what you found and acknowledge the limitation.
- Your final answer must be in plain language, never raw JSON.
"""

        messages = [
            {"role": "system", "content": react_system},
            {"role": "user",   "content": prompt},
        ]

        final_answer: Optional[str] = None
        tools_arg = tool_defs if tool_defs else None   # None → LLM has no tools

        # Token counters — accumulated across all reasoning steps in this loop
        total_tokens_in  = 0
        total_tokens_out = 0

        # Deduplication: cache tool results so repeated identical calls reuse the result
        # and the LLM is nudged to stop looping and synthesise.
        tool_result_cache: dict[str, str] = {}
        consecutive_repeats = 0
        # Force synthesis threshold: after this many steps, remove tools so the LLM must answer.
        # Use half of max_iterations so we get at least half the steps as pure reasoning time,
        # rather than waiting until the last 2 steps.
        force_synthesis_after = max(2, max_iterations // 2)

        self._emit({"type": "thinking", "content": f"Starting ReAct loop (max {max_iterations} steps)..."})

        # ── Emit agent_started event ──────────────────────────────────────────
        wf_info = workflow.info()
        try:
            await workflow.execute_activity(
                "emit_run_event",
                args=[
                    "agent_started", "info", "agent", agent_id,
                    f"Agent '{agent_id}' started ReAct loop",
                    wf_info.workflow_id, wf_info.run_id,
                    tenant_id, agent_id, 0,
                    {"model": model, "max_iterations": max_iterations, "tools": len(tool_defs)},
                ],
                start_to_close_timeout=timedelta(seconds=10),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
        except Exception as _e:
            workflow.logger.warning(f"[REACT] emit agent_started skipped: {_e}")

        for step in range(max_iterations):
            workflow.logger.info(f"[REACT] step={step + 1}/{max_iterations} agent={agent_id}")
            self._emit({"type": "thinking", "content": f"Reasoning step {step + 1}..."})

            # ── Forced synthesis: past threshold, remove tools so LLM must answer ──
            if step >= force_synthesis_after and tools_arg is not None:
                tools_arg = None   # no more tools → LLM is forced to synthesise
                workflow.logger.info(
                    f"[REACT] agent={agent_id} forced-synthesis at step {step + 1} "
                    f"(threshold={force_synthesis_after})"
                )
                messages.append({
                    "role":    "user",
                    "content": (
                        "You have gathered sufficient information from your tool calls. "
                        "Now synthesise everything you have learned and provide a clear, "
                        "complete final answer to the original question. "
                        "Do NOT call any more tools."
                    ),
                })

            # ── REASON: ask LLM what to do next ──────────────────────────────
            decision = await workflow.execute_activity(
                "reasoning_step",
                args=[messages, model, tools_arg],
                start_to_close_timeout=timedelta(seconds=90),
                retry_policy=RetryPolicy(maximum_attempts=2),
            )

            content          = decision.get("content") or ""
            thinking_content = decision.get("thinking_content") or ""
            tool_calls       = decision.get("tool_calls") or []

            # Accumulate token usage from this reasoning step
            total_tokens_in  += decision.get("tokens_in", 0) or 0
            total_tokens_out += decision.get("tokens_out", 0) or 0

            # No tool calls → LLM has its final answer
            if not tool_calls:
                final_answer = content
                workflow.logger.info(f"[REACT] agent={agent_id} reached final answer at step {step + 1}")
                # Still emit the thinking block for the final answer step if present
                if thinking_content:
                    self._emit({"type": "thinking", "content": thinking_content})
                break

            # Emit thinking: prefer the model's own reasoning (thinking_content from Ollama),
            # fall back to its content text, and last resort synthesise from tool names.
            if thinking_content:
                self._emit({"type": "thinking", "content": thinking_content})
            elif content:
                self._emit({"type": "thinking", "content": content})
            else:
                tool_names = [tc.get("function", {}).get("name", "") for tc in tool_calls]
                tool_args_list = []
                for tc in tool_calls:
                    try:
                        args = json.loads(tc.get("function", {}).get("arguments", "{}"))
                        if args:
                            args_str = ", ".join(f"{k}={v}" for k, v in list(args.items())[:2])
                            tool_args_list.append(args_str)
                    except Exception:
                        pass
                desc = f"Calling **{', '.join(tool_names)}**"
                if tool_args_list:
                    desc += f" with {' | '.join(tool_args_list)}"
                self._emit({"type": "thinking", "content": desc})

            # Append assistant message with tool calls to history
            messages.append({
                "role":       "assistant",
                "content":    content or None,
                "tool_calls": [
                    {
                        "id":   tc.get("id", f"call_{step}_{i}"),
                        "type": "function",
                        "function": {
                            "name":      tc.get("function", {}).get("name", ""),
                            "arguments": tc.get("function", {}).get("arguments", "{}"),
                        },
                    }
                    for i, tc in enumerate(tool_calls)
                ],
            })

            # ── ACT + OBSERVE: execute each tool, append result ───────────────
            for tc in tool_calls:
                tool_id   = tc.get("id", f"call_{step}")
                fn        = tc.get("function", {})
                tool_name = fn.get("name", "")
                try:
                    tool_args = json.loads(fn.get("arguments", "{}"))
                except Exception:
                    tool_args = {}

                # Dedup key: tool + args fingerprint
                cache_key = f"{tool_name}::{json.dumps(tool_args, sort_keys=True)}"
                cached = tool_result_cache.get(cache_key)

                # Guardrail check on tool inputs
                tool_result = None
                if cached is not None:
                    # Repeated identical call — serve from cache silently (no UI event emitted).
                    # The user already saw this call; showing it again would be noisy.
                    tool_result = cached
                    consecutive_repeats += 1
                    workflow.logger.info(
                        f"[REACT] cache hit for {tool_name} (repeat #{consecutive_repeats})"
                    )
                    if consecutive_repeats >= 3:
                        # Model is stuck in a hard loop and ignoring nudges — force exit now.
                        # Synthesise from whatever we have in the conversation history.
                        workflow.logger.info(
                            f"[REACT] agent={agent_id} hard-break: model ignored nudge "
                            f"{consecutive_repeats} times, forcing final answer"
                        )
                        # Collect all tool results observed so far as context
                        tool_observations = [
                            m["content"] for m in messages
                            if m.get("role") == "tool" and m.get("content")
                        ]
                        summary = "\n".join(tool_observations[-3:]) if tool_observations else "No data retrieved."
                        final_answer = (
                            f"Based on the information retrieved:\n\n{summary}\n\n"
                            "I was unable to find a more specific answer with the available tools."
                        )
                        break
                    # After 1 repeat inject a nudge
                    if consecutive_repeats >= 1:
                        messages.append({
                            "role":    "user",
                            "content": (
                                "You have already retrieved this information. "
                                "You now have everything you need. "
                                "Please provide your final answer to the user directly, "
                                "without calling any more tools."
                            ),
                        })
                elif guardrails:
                    guard = await workflow.execute_activity(
                        "apply_guardrails",
                        args=[json.dumps(tool_args), guardrails, "input"],
                        start_to_close_timeout=timedelta(seconds=10),
                        retry_policy=RetryPolicy(maximum_attempts=1),
                    )
                    if guard.get("blocked"):
                        tool_result = f"[Blocked by guardrail: {guard.get('block_reason')}]"

                # Execute tool (skip if already resolved via cache/guardrail)
                if tool_result is None:
                    # Emit "before" event only for fresh (non-cached) tool calls
                    self._emit({"type": "tool_call", "tool_name": tool_name, "tool_args": tool_args})
                    try:
                        tool_result = await workflow.execute_activity(
                            "execute_react_tool",
                            args=[tool_name, tool_args, agent_id, tenant_id, tool_router],
                            start_to_close_timeout=timedelta(seconds=60),
                            retry_policy=RetryPolicy(maximum_attempts=2),
                        )
                        consecutive_repeats = 0
                        tool_result_cache[cache_key] = str(tool_result)
                    except Exception as e:
                        tool_result = f"Tool '{tool_name}' failed: {e}"
                        workflow.logger.error(f"[REACT] tool={tool_name} error={e}")

                    # Emit "after" event with result — only for fresh calls
                    self._emit({
                        "type":        "tool_call",
                        "tool_name":   tool_name,
                        "tool_args":   tool_args,
                        "tool_result": str(tool_result)[:500],
                    })

                # OBSERVE: give the result back to the LLM
                messages.append({
                    "role":         "tool",
                    "tool_call_id": tool_id,
                    "content":      str(tool_result),
                })

                workflow.logger.info(
                    f"[REACT] step={step + 1} tool={tool_name} "
                    f"result_len={len(str(tool_result))}"
                )

            # If hard-break was triggered inside the inner loop, exit the outer loop too
            if final_answer is not None:
                break

        # Safety fallback if we exhausted max_iterations
        if final_answer is None:
            final_answer = (
                "I reached my maximum reasoning steps without completing the task. "
                "Here is what I found so far:\n\n" + (content or "No conclusion reached.")
            )

        # ── Reflect on run + store typed memories (fire-and-forget) ─────────────
        try:
            # Build minimal plan/results summary for the ReAct path (no formal plan object)
            react_plan = {"tasks": [{"task_id": f"step_{i}", "description": f"ReAct step {i}",
                                      "resource_name": "llm", "resource_type": "llm"}
                                     for i in range(step + 1)]}
            react_statuses = {f"step_{i}": "succeeded" for i in range(step + 1)}
            react_results  = {f"step_{i}": "" for i in range(step + 1)}

            should_propose = await workflow.execute_activity(
                "reflect_on_run",
                args=[agent_id, tenant_id, prompt, react_plan, react_results,
                      react_statuses, final_answer, model],
                start_to_close_timeout=timedelta(seconds=45),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
            if should_propose:
                workflow.start_activity(
                    "propose_manifest_update",
                    args=[agent_id, tenant_id, model],
                    start_to_close_timeout=timedelta(seconds=30),
                )
        except Exception as e:
            workflow.logger.warning(f"[REACT] reflect_on_run skipped: {e}")

        # ── Emit agent_completed event ────────────────────────────────────────
        try:
            await workflow.execute_activity(
                "emit_run_event",
                args=[
                    "agent_completed", "success", "agent", agent_id,
                    f"Agent '{agent_id}' completed ReAct loop ({step + 1} steps)",
                    wf_info.workflow_id, wf_info.run_id,
                    tenant_id, agent_id, 0,
                    {"steps": step + 1, "answer_len": len(final_answer), "model": model},
                ],
                start_to_close_timeout=timedelta(seconds=10),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
        except Exception as _e:
            workflow.logger.warning(f"[REACT] emit agent_completed skipped: {_e}")

        self._emit({"type": "text", "content": final_answer})
        self._emit({
            "type":       "done",
            "tokens_in":  total_tokens_in,
            "tokens_out": total_tokens_out,
            "steps":      step + 1,
            "model":      model,
        })
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

        # ── Reflect on run (PydanticAI path) ──────────────────────────────────
        try:
            pai_plan = {"tasks": [{"task_id": "t1", "description": prompt[:120],
                                    "resource_name": "pydantic_ai", "resource_type": "llm"}]}
            pai_statuses = {"t1": "succeeded"}
            pai_results  = {"t1": final_answer[:300]}

            should_propose = await workflow.execute_activity(
                "reflect_on_run",
                args=[agent_id, tenant_id, prompt, pai_plan, pai_results,
                      pai_statuses, final_answer, model],
                start_to_close_timeout=timedelta(seconds=45),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
            if should_propose:
                workflow.start_activity(
                    "propose_manifest_update",
                    args=[agent_id, tenant_id, model],
                    start_to_close_timeout=timedelta(seconds=30),
                )
        except Exception as store_err:
            workflow.logger.warning(f"[WORKFLOW] reflect_on_run skipped: {store_err}")

        return f"Agent {agent_id} completed: {final_answer}"
