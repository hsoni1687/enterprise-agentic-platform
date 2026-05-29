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
        self._clarification_response: Optional[str] = None

    @workflow.query
    def get_events(self) -> list[dict]:
        return self._events

    def _emit(self, event: dict) -> None:
        self._events.append(event)

    @workflow.signal(name="hitl_response")
    async def hitl_response(self, data: dict) -> None:
        self._hitl_decision = data.get("decision", "denied")

    @workflow.signal(name="clarification_response")
    async def clarification_response(self, data: dict) -> None:
        """Receives the user's free-text answer to an ask_human clarification request."""
        self._clarification_response = data.get("answer", "")

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
        # None means key was absent (legacy agent) → activity falls back to all-enabled.
        # A list (even []) means the wizard explicitly configured per-agent guardrails/hooks.
        guardrail_ids = manifest.get("guardrail_ids")   # Optional[list]
        hook_ids      = manifest.get("hook_ids")         # Optional[list]

        workflow.logger.info(f"[WORKFLOW] agent={agent_id} model={model} autonomy={autonomy_level}")

        # The ReAct loop emits its own terminal agent_run_events row (agent_completed)
        # on normal completion. This wrapper is the safety net for the remaining
        # case: an unhandled exception, which would otherwise leave the run with no
        # terminal event and stuck showing "running" in the Logs view.
        try:
            return await self._run_agent(
                agent_id, tenant_id, prompt, system_prompt, model,
                max_iterations, skills, direct_tools, explicit_mcp,
                knowledge_graph_ids, guardrail_ids, hook_ids,
            )
        except Exception as e:
            await self._emit_terminal_failure(agent_id, tenant_id, f"Agent run failed: {e}")
            raise

    async def _emit_terminal_failure(self, agent_id: str, tenant_id: str, message: str) -> None:
        """Best-effort agent_failed run event so the Logs view never shows a run
        stuck on 'running' after a crash. Never raises."""
        try:
            wf_info = workflow.info()
            await workflow.execute_activity(
                "emit_run_event",
                args=[
                    "agent_failed", "error", "agent", agent_id, message,
                    wf_info.workflow_id, wf_info.run_id,
                    tenant_id, agent_id, 0, {"crashed": True},
                ],
                start_to_close_timeout=timedelta(seconds=10),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
        except Exception as _e:
            workflow.logger.warning(f"[WORKFLOW] emit terminal agent_failed skipped: {_e}")

    # ─────────────────────────────────────────────────────────────────────────
    # Single agent execution flow: context assembly → governed ReAct loop
    # ─────────────────────────────────────────────────────────────────────────

    async def _run_agent(
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
        knowledge_graph_ids: list = None,
        guardrail_ids: Optional[list] = None,
        hook_ids: Optional[list] = None,
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
            args=[agent_id, tenant_id, guardrail_ids],   # pass per-agent IDs (None = legacy fallback)
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )
        hooks_handle     = workflow.start_activity(
            "load_active_hooks",
            args=[agent_id, tenant_id, hook_ids],         # pass per-agent IDs (None = legacy fallback)
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
            "knowledge_graph_ids": knowledge_graph_ids,
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
            f"Knowledge graphs (use resource_type='kg', resource_name='kg_search'): {knowledge_graph_ids}\n"
            f"Agent system prompt (excerpt): {system_prompt[:400]}"
        )

        # ── Single governed execution flow: the dynamic ReAct loop ─────────────
        # Every agent runs here. The former plan-execute ("orchestrated") branch and
        # the autonomy_level fork were removed: all agents are autonomous deep agents,
        # so that branch was unreachable, and its safety stack (guardrails/hooks/HITL)
        # now lives in the ReAct loop's governed tool chokepoint.
        workflow.logger.info("[WORKFLOW] entering governed ReAct loop")
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
                "agent_id":            agent_id,
                "tenant_id":           tenant_id,
                "model":               model,
                "system_prompt":       system_prompt,
                "knowledge_graph_ids": knowledge_graph_ids,
            },
        )

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

        # ── ask_human: platform clarification HITL (always available) ─────────
        # The workflow handles this tool natively — it never reaches execute_react_tool.
        tool_defs.append({
            "type": "function",
            "function": {
                "name": "ask_human",
                "description": (
                    "Pause execution and ask the user ONE clarifying question. "
                    "Use ONLY when the request is genuinely too ambiguous to proceed. "
                    "Provide 3-5 short answer options when there are clear discrete choices "
                    "(e.g. angle, audience, tone). The user can click an option or type a custom answer."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "question": {
                            "type": "string",
                            "description": "The single most important clarifying question to ask.",
                        },
                        "options": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": (
                                "Optional: 3-5 short answer options the user can click. "
                                "Include when there are clear discrete choices. "
                                "Each option should be concise (2-6 words)."
                            ),
                        },
                    },
                    "required": ["question"],
                },
            },
        })
        tool_router["ask_human"] = {"type": "hitl_clarification"}

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
        # Augment system prompt with ReAct behavioural instructions.
        # The augmentation is conditional:
        #   • When the agent has tools  → add tool-calling discipline rules.
        #   • When the agent has NO tools → add a minimal completion directive that
        #     reinforces the agent's own system prompt without overriding it.
        #     This is critical for purpose-specific agents (e.g. LinkedIn post writer,
        #     code reviewer) that must act on the user's message, not ask clarifying
        #     questions about what to do.
        # Detect whether external tools exist beyond the platform's built-in ask_human.
        # ask_human is always injected by _build_react_tools; it is NOT an external tool.
        external_tools = [
            t for t in tool_defs
            if t.get("function", {}).get("name") != "ask_human"
        ]

        if external_tools:
            # Agent has real external tools (MCP, skills, KG, etc.)
            react_augmentation = """

You have access to tools. Use them when you need real data.

Rules:
1. Call ONE tool at a time. After each result, decide if you have enough to answer.
2. If a tool exists that can answer the question, USE IT. Never refuse when a tool can fetch the data.
3. Call each tool at most ONCE. Do not repeat the same call.
4. Stop calling tools as soon as you have enough information.
5. If a tool returns an error, report what you found and acknowledge the limitation.
6. Provide a clear, helpful final answer in plain language addressed directly to the user.
7. Your final answer must be in plain language, never raw JSON.
8. CRITICAL — If you need clarification from the user before you can proceed, you MUST call the ask_human tool. NEVER write clarifying questions as plain text — they will be ignored. Use the tool so the user can answer."""
        else:
            # Agent has NO external tools — only ask_human is available.
            # Purpose-specific agents (LinkedIn writer, code reviewer, etc.) fall here.
            react_augmentation = """

Complete the user's request directly and immediately, following your system instructions above.
You have ONE special tool: ask_human.

CRITICAL RULES:
- If the request gives you enough to work with (a topic, keyword, or short phrase), produce your output DIRECTLY. Do not ask questions — just do the work.
- If the request is genuinely too vague to produce any meaningful output (e.g. a single ambiguous word where you cannot make a reasonable interpretation), call ask_human with ONE concise, specific question. Do NOT list multiple questions — pick the single most important one.
- NEVER write clarifying questions as plain text in your response. If you must ask, use the ask_human tool so the user can respond. Questions written as text cannot be answered."""

        react_system = system_prompt + react_augmentation

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
            # Never strip ask_human-only configs — the LLM needs it available throughout
            # so it can still pause for clarification after gathering context.
            if step >= force_synthesis_after and tools_arg is not None and external_tools:
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
                if tool_name == "ask_human":
                    # ── Platform clarification HITL ───────────────────────────
                    # Pause the ReAct loop, surface the question to the user via
                    # SSE, and wait for their answer via a Temporal signal.
                    question = tool_args.get("question", "Could you clarify your request?")
                    options  = tool_args.get("options") or []
                    wf_info  = workflow.info()
                    self._emit({
                        "type":        "clarification_request",
                        "question":    question,
                        "options":     options,
                        "workflow_id": wf_info.workflow_id,
                    })
                    self._clarification_response = None
                    try:
                        await workflow.wait_condition(
                            lambda: self._clarification_response is not None,
                            timeout=timedelta(minutes=10),
                        )
                        tool_result = self._clarification_response or "No response provided."
                    except asyncio.TimeoutError:
                        tool_result = (
                            "The user did not respond in time. "
                            "Please proceed with your best judgment based on the original request."
                        )
                    self._clarification_response = None
                    # Cache so the model doesn't loop and re-ask the same question
                    tool_result_cache[cache_key] = str(tool_result)
                    self._emit({
                        "type":    "thinking",
                        "content": f"User answered: {str(tool_result)[:200]}",
                    })
                elif cached is not None:
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

                # ── Governed execution: every tool call passes through the same
                #    pre-hook → HITL → execute → output-guardrail → post-hook
                #    chokepoint, so autonomous agents get the SAME safety controls
                #    the plan-execute path used to apply. Skipped only when the call
                #    was already resolved above (cache / input guardrail block).
                if tool_result is None:
                    route = tool_router.get(tool_name, {})
                    rtype = route.get("type", "")

                    # ── Pre-execution hooks ───────────────────────────────────
                    if hooks:
                        hook_pre = await workflow.execute_activity(
                            "run_hooks",
                            args=["pre", tool_name, tool_args, None, hooks, agent_context],
                            start_to_close_timeout=timedelta(seconds=15),
                            retry_policy=RetryPolicy(maximum_attempts=1),
                        )
                        if hook_pre.get("blocked"):
                            tool_result = f"[Blocked by hook: {hook_pre.get('block_reason', 'pre-hook')}]"
                        elif hook_pre.get("modified_args"):
                            tool_args = hook_pre["modified_args"]

                    # ── HITL gate for mutating tools (tool/skill/mcp, not reads) ─
                    hitl_required = (
                        tool_result is None
                        and rtype in ("tool", "skill", "mcp")
                        and any(
                            h.get("type") == "hitl_intercept"
                            for h in hooks if h.get("phase") in ("pre", "both")
                        )
                    )
                    if hitl_required:
                        approval_id = str(workflow.uuid4())
                        approval_reason = f"Tool '{tool_name}' requires human approval before execution."
                        wf_info = workflow.info()
                        # Register in the durable store under THIS id so the operator's
                        # approve/deny maps back to this workflow to signal it.
                        await workflow.execute_activity(
                            "register_hitl_approval",
                            args=[approval_id, wf_info.workflow_id, agent_id, tenant_id,
                                  tool_name, tool_args, approval_reason],
                            start_to_close_timeout=timedelta(seconds=10),
                            retry_policy=RetryPolicy(maximum_attempts=2),
                        )
                        self._emit({
                            "type": "approval", "approval_id": approval_id,
                            "tool_name": tool_name, "tool_args": tool_args,
                            "reason": approval_reason,
                        })
                        self._hitl_decision = None
                        try:
                            await workflow.wait_condition(
                                lambda: self._hitl_decision is not None,
                                timeout=timedelta(minutes=5),
                            )
                        except asyncio.TimeoutError:
                            tool_result = f"[Tool '{tool_name}' not executed: human approval timed out]"
                        if tool_result is None and self._hitl_decision != "approved":
                            tool_result = f"[Tool '{tool_name}' denied by human operator]"

                    # ── Execute (only if not blocked/denied above) ────────────
                    if tool_result is None:
                        self._emit({"type": "tool_call", "tool_name": tool_name, "tool_args": tool_args})
                        try:
                            tool_result = await workflow.execute_activity(
                                "execute_react_tool",
                                args=[tool_name, tool_args, agent_id, tenant_id, tool_router],
                                start_to_close_timeout=timedelta(seconds=60),
                                retry_policy=RetryPolicy(maximum_attempts=2),
                            )
                            consecutive_repeats = 0
                        except Exception as e:
                            tool_result = f"Tool '{tool_name}' failed: {e}"
                            workflow.logger.error(f"[REACT] tool={tool_name} error={e}")

                        # ── Output guardrails ─────────────────────────────────
                        if guardrails:
                            guard_out = await workflow.execute_activity(
                                "apply_guardrails",
                                args=[str(tool_result), guardrails, "output"],
                                start_to_close_timeout=timedelta(seconds=10),
                                retry_policy=RetryPolicy(maximum_attempts=1),
                            )
                            if guard_out.get("blocked"):
                                tool_result = f"[Output blocked by guardrail: {guard_out.get('block_reason')}]"
                                self._emit({"type": "guardrail_block", "tool_name": tool_name, "phase": "output"})
                            elif guard_out.get("violations"):
                                tool_result = guard_out.get("sanitized_text", str(tool_result))
                                self._emit({"type": "guardrail_redact", "tool_name": tool_name,
                                            "count": len(guard_out["violations"])})

                        # ── Post-execution hooks ──────────────────────────────
                        if hooks:
                            await workflow.execute_activity(
                                "run_hooks",
                                args=["post", tool_name, tool_args, {"result": str(tool_result)}, hooks, agent_context],
                                start_to_close_timeout=timedelta(seconds=15),
                                retry_policy=RetryPolicy(maximum_attempts=1),
                            )

                        tool_result_cache[cache_key] = str(tool_result)

                    # Emit "after" event with the (possibly blocked/redacted) result
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

