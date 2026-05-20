import os
from pathlib import Path
from tools.base import ToolDef

_WORKSPACE = os.getenv("AGENT_WORKSPACE", "/tmp/agent-workspace")
_MAX_BYTES = 200_000  # 200 KB safety cap


def _resolve(path: str) -> Path:
    """Resolve path inside workspace, rejecting traversal attempts."""
    workspace = Path(_WORKSPACE).resolve()
    target = (workspace / path).resolve()
    if not str(target).startswith(str(workspace)):
        raise PermissionError(f"Path '{path}' escapes workspace")
    return target


class FileReadTool(ToolDef):
    name = "file-read"
    description = (
        "Read the contents of a file in the agent workspace. "
        "Returns the file content as a string."
    )
    auth_level = "read"

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path to file within agent workspace",
                },
                "offset": {
                    "type": "integer",
                    "default": 0,
                    "description": "Line number to start reading from (0-indexed)",
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of lines to read",
                },
            },
            "required": ["path"],
        }

    async def call(self, path: str, offset: int = 0, limit: int = None) -> dict:
        target = _resolve(path)

        if not target.exists():
            return {"error": f"File not found: {path}", "path": path}
        if not target.is_file():
            return {"error": f"Not a file: {path}", "path": path}

        raw = target.read_bytes()[:_MAX_BYTES]
        text = raw.decode("utf-8", errors="replace")
        lines = text.splitlines(keepends=True)

        total_lines = len(lines)
        start = offset
        end = total_lines if limit is None else min(start + limit, total_lines)
        selected = lines[start:end]

        return {
            "path": path,
            "content": "".join(selected),
            "total_lines": total_lines,
            "lines_returned": len(selected),
            "offset": start,
        }
