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


class FileEditTool(ToolDef):
    name = "file-edit"
    description = (
        "Perform an exact-string replacement in a file within the agent workspace. "
        "old_string must match exactly (including whitespace). "
        "Fails if old_string appears more than once unless replace_all is set."
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
                "old_string": {
                    "type": "string",
                    "description": "Exact text to find and replace",
                },
                "new_string": {
                    "type": "string",
                    "description": "Replacement text",
                },
                "replace_all": {
                    "type": "boolean",
                    "default": False,
                    "description": "Replace all occurrences (default: fail if more than one match)",
                },
            },
            "required": ["path", "old_string", "new_string"],
        }

    async def call(
        self,
        path: str,
        old_string: str,
        new_string: str,
        replace_all: bool = False,
    ) -> dict:
        target = _resolve(path)

        if not target.exists():
            return {"error": f"File not found: {path}", "path": path}

        original = target.read_text(encoding="utf-8")
        count = original.count(old_string)

        if count == 0:
            return {"error": "old_string not found in file", "path": path, "replacements": 0}

        if count > 1 and not replace_all:
            return {
                "error": (
                    f"old_string appears {count} times. "
                    "Provide more context to make it unique, or set replace_all=true."
                ),
                "path": path,
                "occurrences": count,
                "replacements": 0,
            }

        updated = original.replace(old_string, new_string) if replace_all else original.replace(old_string, new_string, 1)
        target.write_text(updated, encoding="utf-8")

        return {
            "path": path,
            "replacements": count if replace_all else 1,
        }
