import os
import uuid
import httpx
from tools.base import ToolDef


class BashTool(ToolDef):
    name = "bash"
    description = (
        "Execute bash scripts in a sandboxed environment with resource limits. "
        "Supports environment variables, working directory, and configurable timeouts. "
        "stdout/stderr captured and returned."
    )
    auth_level = "mutating"
    sandbox_required = True

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "script": {
                    "type": "string",
                    "description": "Bash script to execute (set -e -o pipefail enforced)",
                },
                "timeout_seconds": {
                    "type": "integer",
                    "default": 300,
                    "minimum": 1,
                    "maximum": 3600,
                    "description": "Execution timeout in seconds",
                },
                "environment": {
                    "type": "object",
                    "description": "Extra environment variables (name → value)",
                    "additionalProperties": {"type": "string"},
                },
                "working_dir": {
                    "type": "string",
                    "description": "Working directory inside the sandbox (default /tmp)",
                },
            },
            "required": ["script"],
        }

    async def call(
        self,
        script: str,
        timeout_seconds: int = 300,
        environment: dict = None,
        working_dir: str = None,
    ) -> dict:
        url = os.getenv("BASH_EXECUTOR_URL", "http://bash-executor:8092") + "/api/v1/execute"
        payload = {
            "script": script,
            "timeout_seconds": min(timeout_seconds, 3600),
            "environment": environment or {},
            "execution_id": str(uuid.uuid4()),
        }
        if working_dir:
            payload["working_dir"] = working_dir

        async with httpx.AsyncClient(timeout=timeout_seconds + 15) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()

        return {
            "stdout": data.get("stdout", ""),
            "stderr": data.get("stderr", ""),
            "exit_code": data.get("exit_code", 0),
            "status": data.get("status", "completed"),
            "duration_ms": data.get("duration_ms", 0),
        }
