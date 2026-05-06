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

        # Log for debugging
        workflow.logger.info(f"[WORKFLOW] agent_id={agent_id}, checking if manifest-assistant: {agent_id == 'manifest-assistant'}")

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

        # Build agent context
        agent_context = {
            "agent_id": agent_id,
            "tenant_id": tenant_id,
            "prompt": prompt,
            "model": model,
            "max_iterations": max_iterations,
            "system_prompt": system_prompt,
            "skills": skills,
            "mcp_servers": explicit_mcp_servers,
        }

        # 2. ReAct reasoning loop
        final_answer = None

        for i in range(max_iterations):
            workflow.logger.info(f"Iteration {i + 1}/{max_iterations}")

            # Use old reasoning_step for manifest-assistant (avoids PydanticAI extended thinking)
            # Use new pydantic_ai_reasoning_step for other agents
            if agent_id == "manifest-assistant":
                # Old AsyncOpenAI approach - no extended thinking
                # Convert MCP tool defs to OpenAI tool format
                openai_tools = []
                for tool in mcp_tool_defs:
                    openai_tools.append({
                        "type": "function",
                        "function": {
                            "name": tool.get("name", tool.get("qualified_name", "unknown")),
                            "description": tool.get("description", ""),
                            "parameters": tool.get("parameters", tool.get("inputSchema", {})),
                        }
                    })

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

                # Check if we should stop
                if final_answer or not continue_loop:
                    workflow.logger.info(f"[MANIFEST-ASSISTANT] Breaking loop")
                    break
            else:
                # PydanticAI approach for other agents
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
                            "name": tool_name,
                            "args": json.dumps(tool_args)
                        })

                    # Note: Tool invocations and result collection happen inside
                    # pydantic_ai_reasoning_step. The messages here are pre-updated.
                    if decision.get("messages_delta"):
                        messages.extend(decision["messages_delta"])

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
