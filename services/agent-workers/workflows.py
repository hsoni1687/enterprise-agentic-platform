import json
import logging
from datetime import timedelta
from temporalio import workflow
from temporalio.common import RetryPolicy


@workflow.defn
class AgentWorkflow:
    def __init__(self):
        self._events: list[dict] = []

    @workflow.query
    def get_events(self) -> list[dict]:
        return self._events

    def _emit(self, event: dict) -> None:
        self._events.append(event)

    @workflow.run
    async def run(self, request: dict) -> str:
        agent_id = request.get("agent_id", "unknown")
        tenant_id = request.get("tenant_id", "default-tenant")
        prompt = request.get("prompt") or request.get("payload", {}).get("prompt", "Hello")

        manifest = request.get("manifest") or {}
        system_prompt = manifest.get("system_prompt") or "You are a helpful assistant with code execution capabilities."
        model = manifest.get("model") or request.get("model", "mock-gpt-4o")
        max_iterations = int(manifest.get("max_iterations") or 5)
        skills = manifest.get("skills") or []

        # 1. Start recall_memories as non-blocking handle
        recall_handle = workflow.start_activity(
            "recall_memories",
            args=[prompt, agent_id],
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )

        # Build LLM tool definitions concurrently while recall is in flight
        tool_defs = [_execute_code_tool_def()]
        for skill_ref in skills:
            tool_defs.append(_skill_tool_def(skill_ref["name"]))

        # Discover MCP tools: merge global + tenant + explicit servers
        mcp_meta_map = {}
        explicit_mcp_servers = manifest.get("mcp_servers") or []

        # Resolve all applicable MCP servers (global + tenant + explicit)
        all_mcp_servers = await workflow.execute_activity(
            "resolve_mcp_servers",
            args=[tenant_id, explicit_mcp_servers],
            start_to_close_timeout=timedelta(seconds=15),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )

        if all_mcp_servers:
            try:
                mcp_tool_defs = await workflow.execute_activity(
                    "discover_mcp_tools",
                    args=[all_mcp_servers, tenant_id],
                    start_to_close_timeout=timedelta(seconds=30),
                    retry_policy=RetryPolicy(maximum_attempts=2),
                )
                # Strip __mcp_meta before passing to LLM, store in lookup map
                for t in mcp_tool_defs:
                    meta = t.pop("__mcp_meta", None)
                    if meta:
                        mcp_meta_map[t["function"]["name"]] = meta
                tool_defs.extend(mcp_tool_defs)
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

        # 2. ReAct reasoning loop
        final_answer = None
        for i in range(max_iterations):
            workflow.logger.info(f"Iteration {i + 1}/{max_iterations}")

            step_result = await workflow.execute_activity(
                "reasoning_step",
                args=[messages, model, tool_defs],
                start_to_close_timeout=timedelta(seconds=60),
                retry_policy=RetryPolicy(
                    maximum_attempts=3,
                    non_retryable_error_types=["BadRequestError"],
                ),
            )

            content = step_result.get("content")
            tool_calls = step_result.get("tool_calls")

            if tool_calls:
                if content:
                    self._emit({"type": "thinking", "content": content})

                assistant_msg = {
                    "role": "assistant",
                    "content": content,
                    "tool_calls": [
                        {
                            "id": tc["id"],
                            "type": "function",
                            "function": {
                                "name": tc["function"]["name"],
                                "arguments": tc["function"]["arguments"],
                            },
                        }
                        for tc in tool_calls
                    ],
                }
                messages.append(assistant_msg)

                for tc in tool_calls:
                    tool_name = tc["function"]["name"]
                    raw_args = tc["function"]["arguments"]
                    args_dict = json.loads(raw_args) if isinstance(raw_args, str) else raw_args

                    self._emit({"type": "tool_call", "name": tool_name, "args": json.dumps(args_dict)})

                    if tool_name == "execute_code":
                        result = await workflow.execute_activity(
                            "execute_code",
                            args_dict.get("code", ""),
                            start_to_close_timeout=timedelta(seconds=60),
                            retry_policy=RetryPolicy(maximum_attempts=3),
                        )
                    elif tool_name.startswith("mcp__"):
                        # Route MCP tool calls through the MCP registry
                        meta = mcp_meta_map.get(tool_name, {})
                        result = await workflow.execute_activity(
                            "invoke_mcp_tool",
                            args=[meta.get("server_id"), meta.get("tool_name"), args_dict, tenant_id],
                            start_to_close_timeout=timedelta(seconds=60),
                            retry_policy=RetryPolicy(maximum_attempts=2),
                        )
                    else:
                        # Dispatch as a skill via skill-dispatcher
                        result = await workflow.execute_activity(
                            "invoke_skill",
                            args=[tool_name, args_dict, tenant_id, agent_id],
                            start_to_close_timeout=timedelta(seconds=60),
                            retry_policy=RetryPolicy(maximum_attempts=2),
                        )

                    # Patch result into the already-emitted tool_call event
                    self._events[-1]["result"] = str(result)

                    # Add tool result as a user message (Anthropic format requires tool_result in user message)
                    messages.append({
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": tc["id"],
                                "content": str(result),
                            }
                        ],
                    })
                continue

            # No tool calls — LLM produced final answer
            final_answer = content
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
