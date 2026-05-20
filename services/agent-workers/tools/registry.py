"""
Tool registry — single source of truth for all built-in platform tools.

Usage:
    from tools.registry import ALL_TOOLS, get_tool

    tool = get_tool("bash")
    result = await tool.call(script="echo hello")

    # Sync database with tool catalog (idempotent, run on startup)
    await seed_to_registry()
"""
import logging
import os
from typing import Optional

import httpx

from tools.base import ToolDef
from tools.bash_tool import BashTool
from tools.web_fetch_tool import WebFetchTool
from tools.web_search_tool import WebSearchTool
from tools.file_read_tool import FileReadTool
from tools.file_write_tool import FileWriteTool
from tools.file_edit_tool import FileEditTool
from tools.glob_tool import GlobTool
from tools.grep_tool import GrepTool
from tools.todo_tool import TodoTool

logger = logging.getLogger(__name__)

# ── Singleton instances ────────────────────────────────────────────────────────

ALL_TOOLS: list[ToolDef] = [
    BashTool(),
    WebFetchTool(),
    WebSearchTool(),
    FileReadTool(),
    FileWriteTool(),
    FileEditTool(),
    GlobTool(),
    GrepTool(),
    TodoTool(),
]

_BY_NAME: dict[str, ToolDef] = {t.name: t for t in ALL_TOOLS}


def get_tool(name: str) -> Optional[ToolDef]:
    """Return a tool instance by name, or None if not found."""
    return _BY_NAME.get(name)


def list_tools() -> list[dict]:
    """Return serialized tool specs for all built-in tools."""
    return [t.to_tool_spec() for t in ALL_TOOLS]


# ── Registry sync ──────────────────────────────────────────────────────────────

_TOOL_REGISTRY_URL = os.getenv("TOOL_REGISTRY_URL", "http://tool-registry:8086")


async def seed_to_registry() -> None:
    """
    Upsert all built-in tools into the tool-registry service.
    Idempotent — safe to call on every worker startup.
    """
    async with httpx.AsyncClient(timeout=10) as client:
        for tool in ALL_TOOLS:
            spec = tool.to_tool_spec()
            try:
                # Try GET first — if it exists, skip (or update)
                resp = await client.get(
                    f"{_TOOL_REGISTRY_URL}/api/v1/tools/{spec['id']}",
                    headers={"X-Tenant-ID": "platform-system"},
                )
                if resp.status_code == 200:
                    # Tool already registered — update to keep description/schema fresh
                    await client.put(
                        f"{_TOOL_REGISTRY_URL}/api/v1/tools/{spec['id']}",
                        json=spec,
                        headers={"X-Tenant-ID": "platform-system"},
                    )
                    logger.debug(f"Updated tool: {spec['name']}")
                else:
                    # Not found — create it
                    create_resp = await client.post(
                        f"{_TOOL_REGISTRY_URL}/api/v1/tools",
                        json=spec,
                        headers={"X-Tenant-ID": "platform-system"},
                    )
                    if create_resp.status_code in (200, 201):
                        logger.info(f"Registered tool: {spec['name']}")
                    else:
                        logger.warning(
                            f"Failed to register tool {spec['name']}: "
                            f"{create_resp.status_code} {create_resp.text[:200]}"
                        )
            except Exception as e:
                # Registry might not be up yet — log and continue
                logger.warning(f"Could not sync tool '{spec['name']}' to registry: {e}")
