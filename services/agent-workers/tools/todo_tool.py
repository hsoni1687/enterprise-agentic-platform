import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from tools.base import ToolDef

_WORKSPACE = os.getenv("AGENT_WORKSPACE", "/tmp/agent-workspace")
_TODO_FILE = "todos.json"


def _todo_path() -> Path:
    workspace = Path(_WORKSPACE).resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    return workspace / _TODO_FILE


def _load() -> list[dict]:
    p = _todo_path()
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text())
    except Exception:
        return []


def _save(todos: list[dict]) -> None:
    _todo_path().write_text(json.dumps(todos, indent=2))


class TodoTool(ToolDef):
    name = "todo"
    description = (
        "Manage a persistent to-do list within the agent workspace. "
        "Supports create, read, update (status/content), and delete operations."
    )
    auth_level = "mutating"

    @property
    def input_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list", "add", "update", "delete", "clear"],
                    "description": "Operation to perform",
                },
                "content": {
                    "type": "string",
                    "description": "Todo item text (required for add/update)",
                },
                "id": {
                    "type": "string",
                    "description": "Todo item ID (required for update/delete)",
                },
                "status": {
                    "type": "string",
                    "enum": ["pending", "in_progress", "completed"],
                    "description": "New status (for update action)",
                },
                "priority": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                    "default": "medium",
                    "description": "Priority for new items",
                },
            },
            "required": ["action"],
        }

    async def call(
        self,
        action: str,
        content: str = None,
        id: str = None,
        status: str = None,
        priority: str = "medium",
    ) -> dict:
        todos = _load()

        if action == "list":
            return {"todos": todos, "count": len(todos)}

        if action == "add":
            if not content:
                return {"error": "content is required for add"}
            item = {
                "id": str(uuid.uuid4())[:8],
                "content": content,
                "status": "pending",
                "priority": priority,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            todos.append(item)
            _save(todos)
            return {"created": item}

        if action == "update":
            if not id:
                return {"error": "id is required for update"}
            for item in todos:
                if item["id"] == id:
                    if content is not None:
                        item["content"] = content
                    if status is not None:
                        item["status"] = status
                    item["updated_at"] = datetime.now(timezone.utc).isoformat()
                    _save(todos)
                    return {"updated": item}
            return {"error": f"Todo '{id}' not found"}

        if action == "delete":
            if not id:
                return {"error": "id is required for delete"}
            original_len = len(todos)
            todos = [t for t in todos if t["id"] != id]
            if len(todos) == original_len:
                return {"error": f"Todo '{id}' not found"}
            _save(todos)
            return {"deleted": id, "remaining": len(todos)}

        if action == "clear":
            _save([])
            return {"cleared": True}

        return {"error": f"Unknown action: {action}"}
