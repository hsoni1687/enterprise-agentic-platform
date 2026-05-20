"""
FastAPI HTTP server exposing built-in tool catalog and playground invocation.

Runs on port 8094 alongside the Temporal worker (asyncio.gather in main.py).

Endpoints:
  GET  /api/v1/tools                    — list all built-in tools
  GET  /api/v1/tools/{name}             — get single tool spec
  POST /api/v1/tools/{name}/invoke      — invoke a tool (playground / agent use)
  GET  /health                          — liveness probe
"""
import logging
import os
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from tools.registry import list_tools, get_tool
from tool_executor import execute_tool, ToolNotFoundError

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Agent Workers — Tool API",
    version="1.0.0",
    description="Built-in platform tool catalog and playground invocation endpoint",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Models ─────────────────────────────────────────────────────────────────────

class InvokeRequest(BaseModel):
    inputs: dict[str, Any] = {}
    agent_id: str = ""


class InvokeResponse(BaseModel):
    tool: str
    result: Any = None
    error: str | None = None
    duration_ms: int = 0


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "tools": len(list_tools())}


@app.get("/api/v1/tools")
async def list_all_tools():
    """Return all built-in tool specs."""
    return {"tools": list_tools(), "count": len(list_tools())}


@app.get("/api/v1/tools/{name}")
async def get_tool_spec(name: str):
    """Return spec for a single built-in tool."""
    tool = get_tool(name)
    if tool is None:
        raise HTTPException(status_code=404, detail=f"Tool '{name}' not found")
    return tool.to_tool_spec()


@app.post("/api/v1/tools/{name}/invoke", response_model=InvokeResponse)
async def invoke_tool(
    name: str,
    body: InvokeRequest,
    x_tenant_id: str = Header(default="default-tenant"),
):
    """
    Invoke a built-in tool with the given inputs.

    Used by:
    - Tool playground in agent-studio (direct HTTP to port 8094)
    - Agent activities that need to call tools directly (bypassing skill-dispatcher)
    """
    try:
        outcome = await execute_tool(
            name=name,
            inputs=body.inputs,
            agent_id=body.agent_id,
            tenant_id=x_tenant_id,
        )
    except ToolNotFoundError:
        raise HTTPException(status_code=404, detail=f"Tool '{name}' not found")
    except Exception as e:
        logger.exception("Unexpected error invoking tool '%s'", name)
        raise HTTPException(status_code=500, detail=str(e))

    return InvokeResponse(
        tool=name,
        result=outcome.get("result"),
        error=outcome.get("error"),
        duration_ms=outcome.get("duration_ms", 0),
    )


# ── Runner ─────────────────────────────────────────────────────────────────────

async def run_tool_api():
    """Run the FastAPI server. Called from main.py via asyncio.gather."""
    port = int(os.getenv("TOOL_API_PORT", "8094"))
    config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=port,
        log_level="info",
        access_log=True,
    )
    server = uvicorn.Server(config)
    logger.info(f"Starting Tool API on port {port}")
    await server.serve()
