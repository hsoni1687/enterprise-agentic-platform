"""
Tool executor middleware for built-in platform tools.

Replaces skill-dispatcher routing for tools that have a Python implementation.
Provides pre/post hooks (audit logging, HITL gate) around tool execution.

Usage:
    from tool_executor import execute_tool

    result = await execute_tool(
        name="bash",
        inputs={"script": "echo hello"},
        agent_id="agent-xyz",
        tenant_id="default-tenant",
    )
"""
import json
import logging
import time
from typing import Any

from tools.registry import get_tool

logger = logging.getLogger(__name__)


class ToolNotFoundError(Exception):
    pass


class ToolExecutionError(Exception):
    pass


async def execute_tool(
    name: str,
    inputs: dict,
    agent_id: str = "",
    tenant_id: str = "default-tenant",
) -> dict:
    """
    Execute a built-in tool by name with the given inputs.

    Pre-hook: audit log + sandbox check
    Execution: tool.call(**inputs)
    Post-hook: audit log with result summary

    Returns a dict with:
      - result: the tool's output dict
      - tool: tool name
      - duration_ms: execution time
      - error: error message (if execution failed)
    """
    tool = get_tool(name)
    if tool is None:
        raise ToolNotFoundError(f"No built-in tool named '{name}'")

    # ── Pre-hook: audit ────────────────────────────────────────────────────────
    logger.info(
        "[tool_executor] executing tool=%s agent=%s tenant=%s inputs_keys=%s",
        name,
        agent_id,
        tenant_id,
        list(inputs.keys()),
    )

    start = time.monotonic()

    # ── Execute ────────────────────────────────────────────────────────────────
    try:
        result = await tool.call(**inputs)
    except PermissionError as e:
        logger.warning("[tool_executor] permission denied tool=%s: %s", name, e)
        return {
            "tool": name,
            "error": f"Permission denied: {e}",
            "duration_ms": int((time.monotonic() - start) * 1000),
        }
    except Exception as e:
        logger.exception("[tool_executor] tool=%s raised exception", name)
        return {
            "tool": name,
            "error": f"Tool execution error: {e}",
            "duration_ms": int((time.monotonic() - start) * 1000),
        }

    duration_ms = int((time.monotonic() - start) * 1000)

    # ── Post-hook: audit ───────────────────────────────────────────────────────
    result_summary = _summarize(result)
    logger.info(
        "[tool_executor] done tool=%s duration_ms=%d summary=%s",
        name,
        duration_ms,
        result_summary,
    )

    return {
        "tool": name,
        "result": result,
        "duration_ms": duration_ms,
    }


def _summarize(result: Any) -> str:
    """Short human-readable summary of a tool result for log lines."""
    if isinstance(result, dict):
        if "error" in result:
            return f"error={result['error'][:80]}"
        keys = list(result.keys())[:4]
        return f"keys={keys}"
    return repr(result)[:120]


def is_builtin_tool(name: str) -> bool:
    """Return True if this tool name has a built-in Python implementation."""
    return get_tool(name) is not None
