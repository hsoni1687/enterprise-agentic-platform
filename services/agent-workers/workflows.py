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
        agent_id = request.get("agent_id", "unknown")
        tenant_id = request.get("tenant_id", "default-tenant")
        prompt = request.get("prompt") or request.get("payload", {}).get("prompt", "Hello")

        # Log for debugging
        workflow.logger.info(f"[WORKFLOW] agent_id={agent_id}, checking if manifest-assistant-system: {agent_id == 'manifest-assistant-system'}")

        manifest = request.get("manifest") or {}
        workflow.logger.info(f"[WORKFLOW] manifest keys: {list(manifest.keys())}, has_model={('model' in manifest)}, model_value={manifest.get('model', 'NOT PROVIDED')}")
        system_prompt = manifest.get("system_prompt") or "You are a helpful assistant with code execution capabilities."
        model = manifest.get("model") or request.get("model", "mock-gpt-4o")
        workflow.logger.info(f"[WORKFLOW] resolved model={model}, system_prompt_len={len(system_prompt)}")
        max_iterations = int(manifest.get("max_iterations") or 5)
        skills = manifest.get("skills") or []

        # 1. Start recall_memories as non-blocking handle
        recall_handle = workflow.start_activity(
            "recall_memories",
            args=[prompt, agent_id],
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )

        # Discover MCP tools: merge global + tenant + explicit servers
        explicit_mcp_servers = manifest.get("mcp_servers") or []

        # Resolve all applicable MCP servers (global + tenant + explicit)
        all_mcp_servers = await workflow.execute_activity(
            "resolve_mcp_servers",
            args=[tenant_id, explicit_mcp_servers],
            start_to_close_timeout=timedelta(seconds=15),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )

        # Discover MCP tool definitions
        mcp_tool_defs = []
        if all_mcp_servers:
            try:
                discovered = await workflow.execute_activity(
                    "discover_mcp_tools",
                    args=[all_mcp_servers, tenant_id],
                    start_to_close_timeout=timedelta(seconds=30),
                    retry_policy=RetryPolicy(maximum_attempts=2),
                )
                # Convert to MCPToolDefinition dicts (with metadata preserved)
                for tool in discovered:
                    mcp_tool_defs.append(tool)
            except Exception as e:
                workflow.logger.warning(f"MCP tool discovery failed: {e}")

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]

        # Await recall result and patch system prompt if memories found
        past_memories = await recall_handle
        if past_memories:
            system_prompt += "\n\nPast findings/memories:\n- " + "\n- ".join(past_memories)
            messages[0] = {"role": "system", "content": system_prompt}

        self._emit({"type": "thinking", "content": f"Starting reasoning for: {prompt[:80]}"})

        # Extract direct tools from manifest
        direct_tools = manifest.get("tools") or []

        # Fetch system tools (auto-injected for all agents)
        system_tools = await workflow.execute_activity(
            "fetch_system_tools",
            args=[tenant_id],
            start_to_close_timeout=timedelta(seconds=15),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )

        # Build agent context
        agent_context = {
            "agent_id": agent_id,
            "tenant_id": tenant_id,
            "prompt": prompt,
            "model": model,
            "max_iterations": max_iterations,
            "system_prompt": system_prompt,
            "skills": skills,
            "tools": direct_tools,
            "system_tools": system_tools,
            "mcp_servers": explicit_mcp_servers,
        }

        # 2. ReAct reasoning loop
        final_answer = None

        for i in range(max_iterations):
            workflow.logger.info(f"Iteration {i + 1}/{max_iterations}")

            # Use old reasoning_step for manifest-assistant-system (avoids PydanticAI extended thinking)
            # Use new pydantic_ai_reasoning_step for other agents
            if agent_id == "manifest-assistant-system":
                # Old AsyncOpenAI approach - no extended thinking
                # Manifest assistant should generate responses through reasoning only, no tool calls
                openai_tools = []

                workflow.logger.info(f"[MANIFEST-ASSISTANT] Messages before reasoning_step: {json.dumps(messages, default=str)}")
                decision = await workflow.execute_activity(
                    "reasoning_step",
                    args=[messages, model, openai_tools],
                    start_to_close_timeout=timedelta(seconds=60),
                    retry_policy=RetryPolicy(maximum_attempts=3),
                )

                # Debug: Log full decision dict
                workflow.logger.info(f"[MANIFEST-ASSISTANT] Decision dict keys: {list(decision.keys())}")
                workflow.logger.info(f"[MANIFEST-ASSISTANT] Decision content type: {type(decision.get('content'))}, length: {len(str(decision.get('content'))) if decision.get('content') else 0}")
                workflow.logger.info(f"[MANIFEST-ASSISTANT] Tool calls: {decision.get('tool_calls')}")

                final_answer = decision.get("content")
                tool_calls = decision.get("tool_calls")
                continue_loop = bool(tool_calls)

                workflow.logger.info(f"[MANIFEST-ASSISTANT] Iteration {i+1}: final_answer={bool(final_answer)} (len={len(final_answer) if final_answer else 0}), tool_calls={bool(tool_calls)}, continue_loop={continue_loop}")
                workflow.logger.info(f"[MANIFEST-ASSISTANT] Break condition: final_answer={bool(final_answer)} or not continue_loop={not continue_loop} = {bool(final_answer) or not continue_loop}")

                # Add assistant message with content and tool calls (OpenAI format)
                if final_answer or tool_calls:
                    assistant_msg = {"role": "assistant"}
                    # Set content to the answer, or None if no text
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

                # If there are tool calls, execute them and add results
                if tool_calls:
                    for tc in tool_calls:
                        tool_id = tc.get("id", "")
                        tool_name = tc.get("function", {}).get("name", "unknown")
                        tool_args = tc.get("function", {}).get("arguments", "{}")
                        if isinstance(tool_args, str):
                            tool_args = json.loads(tool_args)

                        self._emit({
                            "type": "tool_call",
                            "tool_name": tool_name,
                            "tool_args": tool_args
                        })

                        # Execute execute_code tool
                        if tool_name == "execute_code":
                            tool_result_content = ""
                            try:
                                code = tool_args.get("code", "")
                                tool_result = await workflow.execute_activity(
                                    "execute_code",
                                    args=[code],
                                    start_to_close_timeout=timedelta(seconds=30),
                                    retry_policy=RetryPolicy(maximum_attempts=2),
                                )
                                tool_result_content = str(tool_result)
                            except Exception as e:
                                workflow.logger.error(f"[MANIFEST-ASSISTANT] Tool execution failed: {e}")
                                tool_result_content = f"Tool error: {str(e)}"

                            # Add tool result in OpenAI format
                            # OpenAI format uses role="tool" and tool_call_id
                            messages.append({
                                "role": "tool",
                                "tool_call_id": tool_id,
                                "content": tool_result_content
                            })

                # Check if we should stop
                if final_answer or not continue_loop:
                    workflow.logger.info(f"[MANIFEST-ASSISTANT] Breaking loop")
                    break
            else:
                # PydanticAI approach for other agents
                try:
                    with open("/tmp/workflow_debug.log", "a") as f:
                        f.write(f"[WORKFLOW] Entering PydanticAI branch, iteration {i+1}\n")
                        f.flush()
                except:
                    pass

                decision = await workflow.execute_activity(
                    "pydantic_ai_reasoning_step",
                    args=[agent_context, messages, mcp_tool_defs],
                    start_to_close_timeout=timedelta(seconds=60),
                    retry_policy=RetryPolicy(
                        maximum_attempts=3,
                        non_retryable_error_types=["BadRequestError"],
                    ),
                )

                final_answer = decision.get("final_answer")
                tool_calls = decision.get("tool_calls")
                continue_loop = decision.get("continue_loop", False)

                # DEBUG: Log the full decision
                workflow.logger.info(f"[WORKFLOW] Decision from activity: keys={list(decision.keys())}, hitl_pending={decision.get('hitl_pending')}")

                # Emit decision state
                if decision.get("reasoning"):
                    self._emit({"type": "thinking", "content": decision["reasoning"]})

                # Process tool calls (routing is now handled by PydanticAI internally)
                if tool_calls:
                    for tc in tool_calls:
                        tool_name = tc.get("name", "unknown")
                        tool_args = tc.get("arguments", {})
                        self._emit({
                            "type": "tool_call",
                            "tool_name": tool_name,
                            "tool_args": tool_args
                        })

                    # Note: Tool invocations and result collection happen inside
                    # pydantic_ai_reasoning_step. The messages here are pre-updated.
                    if decision.get("messages_delta"):
                        messages.extend(decision["messages_delta"])

                # Check for HITL approval pending
                if decision.get("hitl_pending"):
                    approval_id = decision.get("hitl_approval_id", "")
                    h_tool_name = decision.get("hitl_tool_name", "")
                    h_tool_args = decision.get("hitl_tool_args", {})

                    workflow.logger.info(f"[HITL WORKFLOW] approval_id='{approval_id}', tool_name='{h_tool_name}', has_args={bool(h_tool_args)}")

                    # Log to file for debugging
                    try:
                        with open("/tmp/hitl_debug.log", "a") as f:
                            f.write(f"[HITL] Emitting approval event: approval_id={approval_id}, tool={h_tool_name}\n")
                            f.flush()
                    except:
                        pass

                    approval_event = {
                        "type": "approval",
                        "approval_id": approval_id,
                        "tool_name": h_tool_name,
                        "tool_args": h_tool_args,
                        "reason": f"Tool '{h_tool_name}' requires human approval before execution",
                    }

                    workflow.logger.info(f"[HITL] Event dict before emit: {list(approval_event.keys())}, has approval_id key: {'approval_id' in approval_event}, approval_id value: {approval_event.get('approval_id')}")

                    self._emit(approval_event)

                    workflow.logger.info(f"[HITL] Events list after emit: {len(self._events)} events, last event keys: {list(self._events[-1].keys()) if self._events else 'N/A'}")

                    # Log after emit
                    try:
                        with open("/tmp/hitl_debug.log", "a") as f:
                            f.write(f"[HITL] Events list now has {len(self._events)} events\n")
                            f.write(f"[HITL] Last event: {json.dumps(self._events[-1]) if self._events else 'N/A'}\n")
                            f.flush()
                    except:
                        pass

                    self._hitl_decision = None
                    try:
                        await workflow.wait_condition(
                            lambda: self._hitl_decision is not None,
                            timeout=timedelta(minutes=5)
                        )
                    except asyncio.TimeoutError:
                        final_answer = f"Approval timeout: '{h_tool_name}' was not reviewed within 5 minutes."
                        break

                    if self._hitl_decision == "approved":
                        agent_context["approved_hitl_tools"] = {h_tool_name: approval_id}
                        messages.append({
                            "role": "user",
                            "content": f"Tool '{h_tool_name}' has been approved. Please proceed with executing it.",
                        })
                        continue_loop = True
                        final_answer = None
                    else:
                        final_answer = f"Execution of '{h_tool_name}' was denied by the operator."
                        break

                # Check if we should stop
                if final_answer or not continue_loop:
                    break

        if not final_answer:
            final_answer = "Exceeded max reasoning iterations without a conclusion."

        self._emit({"type": "text", "content": final_answer})
        self._emit({"type": "done"})

        # 3. Fire-and-forget store_memory (start without awaiting)
        workflow.start_activity(
            "store_memory",
            args=[f"Observation for '{prompt}': {final_answer}", agent_id],
            start_to_close_timeout=timedelta(seconds=10),
        )

        return f"Agent {agent_id} completed: {final_answer}"


def _execute_code_tool_def() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "execute_code",
            "description": "Run Python code in a secure sandbox and return stdout.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "Python code to execute."}
                },
                "required": ["code"],
            },
        },
    }


def _skill_tool_def(skill_name: str) -> dict:
    # Sanitize tool name: replace spaces and special chars with underscores
    sanitized_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in skill_name)
    return {
        "type": "function",
        "function": {
            "name": sanitized_name,
            "description": f"Invoke the '{skill_name}' skill.",
            "parameters": {
                "type": "object",
                "properties": {
                    "args": {"type": "object", "description": "Arguments to pass to the skill."}
                },
                "required": [],
            },
        },
    }
