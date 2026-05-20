import os
from pathlib import Path
from tools.base import ToolDef

_WORKSPACE = os.getenv("AGENT_WORKSPACE", "/tmp/agent-workspace")


def _resolve(path: str) -> Path:
    workspace = Path(_WORKSPACE).resolve()
    target = (workspace / path).resolve()
    if not str(target).startswith(str(workspace)):
        raise PermissionError(f"Path '{path}' escapes workspace")
    return target


class FileWriteTool(ToolDef):
    name = "file-write"
    description = (
        "Write content to a file in the agent workspace. "
        "Creates parent directories automatically. Overwrites existing files."
    )
    auth_level = "mutating"

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path to file within agent workspace",
                },
                "content": {
                    "type": "string",
                    "description": "Content to write",
                },
                "append": {
                    "type": "boolean",
                    "default": False,
                    "description": "If true, append to existing file instead of overwriting",
                },
            },
            "required": ["path", "content"],
        }

    async def call(self, path: str, content: str, append: bool = False) -> dict:
        target = _resolve(path)
        target.parent.mkdir(parents=True, exist_ok=True)

        mode = "a" if append else "w"
        with target.open(mode, encoding="utf-8") as fh:
            fh.write(content)

        return {
            "path": path,
            "bytes_written": len(content.encode("utf-8")),
            "mode": "append" if append else "overwrite",
        }
