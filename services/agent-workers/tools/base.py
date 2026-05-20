"""
Base class for all built-in platform tools.

Each tool owns its own:
  - input_schema  → what the LLM sends
  - output_schema → what the tool returns
  - call()        → the actual implementation

No routing table, no dispatcher — the tool is the executor.
"""
from abc import ABC, abstractmethod


class ToolDef(ABC):
    """Base class every built-in tool must subclass."""

    # Subclasses declare these as class attributes
    name: str
    description: str
    auth_level: str          # "read" | "mutating"
    sandbox_required: bool = False
    version: str = "1.0.0"

    @property
    @abstractmethod
    def input_schema(self) -> dict:
        """JSON Schema for tool inputs."""
        ...

    @property
    def output_schema(self) -> dict:
        """JSON Schema for tool output (optional override)."""
        return {
            "type": "object",
            "properties": {"result": {"type": "string"}},
        }

    @abstractmethod
    async def call(self, **kwargs) -> dict:
        """Execute the tool and return a result dict."""
        ...

    def to_tool_spec(self) -> dict:
        """Serialize to tool-registry ToolSpec format."""
        return {
            "id": f"builtin-{self.name}",
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "auth_level": self.auth_level,
            "sandbox_required": self.sandbox_required,
            "input_schema": self.input_schema,
            "output_schema": self.output_schema,
            "status": "approved",
            "registered_by": "platform",
            "scope": "system",
        }
