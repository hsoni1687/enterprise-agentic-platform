"""
Type-safe Pydantic models for A1 Agent Engine ReAct loop.

These models replace scattered dict unpacking and provide:
- Request validation at workflow entry
- Type-safe activity boundaries
- IDE/mypy support
- Clear contracts for agent reasoning
"""

from pydantic import BaseModel, Field
from typing import Optional, Any


class AgentContext(BaseModel):
    """Request context for agent workflow execution."""

    agent_id: str = Field(..., description="Unique agent identifier")
    tenant_id: str = Field(default="default-tenant", description="Tenant ID for multi-tenancy")
    prompt: str = Field(..., description="User prompt to process")
    model: str = Field(default="gpt-4o", description="LLM model to use")
    max_iterations: int = Field(default=5, description="Max reasoning loop iterations")
    system_prompt: str = Field(
        default="You are a helpful assistant with code execution capabilities.",
        description="System instruction for LLM"
    )
    skills: list[dict] = Field(default_factory=list, description="Available skill definitions")
    tools: list[dict] = Field(default_factory=list, description="Direct tool specs from manifest")
    system_tools: list[dict] = Field(default_factory=list, description="Platform system tools auto-injected")
    mcp_servers: list[str] = Field(
        default_factory=list,
        description="Explicit MCP server IDs to use"
    )
    memory_context: Optional[str] = Field(
        default=None,
        description="Retrieved past memories/findings to inject"
    )
    approved_hitl_tools: dict[str, str] = Field(
        default_factory=dict,
        description="Pre-approved HITL tools: tool_name -> approval_id"
    )

    class Config:
        json_schema_extra = {
            "example": {
                "agent_id": "agent-123",
                "tenant_id": "acme-corp",
                "prompt": "Analyze the deployment logs",
                "model": "gpt-4o",
                "max_iterations": 5,
                "system_prompt": "You are a DevOps assistant...",
                "skills": [{"name": "analyze_logs", "description": "..."}],
                "mcp_servers": ["server-1", "server-2"],
            }
        }


class ToolCall(BaseModel):
    """Single tool invocation from LLM."""

    id: str = Field(..., description="Unique tool call ID")
    name: str = Field(..., description="Tool name (e.g., 'execute_code', 'mcp__server__tool')")
    arguments: dict = Field(default_factory=dict, description="Tool arguments")


class ToolResult(BaseModel):
    """Result of executing a tool."""

    tool_call_id: str = Field(..., description="ID of the tool call this result is for")
    success: bool = Field(..., description="Whether tool execution succeeded")
    content: str = Field(..., description="Tool execution output/result")
    error: Optional[str] = Field(default=None, description="Error message if success=False")


class AgentDecision(BaseModel):
    """Output from a single reasoning step."""

    final_answer: Optional[str] = Field(
        default=None,
        description="Final answer if LLM decided to stop and respond"
    )
    reasoning: Optional[str] = Field(
        default=None,
        description="LLM reasoning/thought process"
    )
    tool_calls: list[ToolCall] = Field(
        default_factory=list,
        description="Tool calls LLM wants to execute"
    )
    messages_delta: list[dict] = Field(
        default_factory=list,
        description="Updated message history (for Temporal checkpointing)"
    )
    continue_loop: bool = Field(
        default=True,
        description="Whether to continue reasoning loop"
    )
    hitl_pending: bool = Field(
        default=False,
        description="Whether a HITL approval is pending"
    )
    hitl_approval_id: Optional[str] = Field(
        default=None,
        description="Approval ID awaiting human decision"
    )
    hitl_tool_name: Optional[str] = Field(
        default=None,
        description="Tool name that requires approval"
    )
    hitl_tool_args: Optional[dict] = Field(
        default=None,
        description="Tool arguments awaiting approval"
    )


class SkillDefinition(BaseModel):
    """Definition of an available skill."""

    name: str = Field(..., description="Skill name")
    description: str = Field(..., description="Skill description")
    input_schema: dict = Field(
        default_factory=dict,
        alias="input_schema",
        description="JSON schema for skill inputs"
    )


class MCPToolDefinition(BaseModel):
    """Tool definition from MCP server."""

    server_id: str = Field(..., description="MCP server ID")
    server_name: str = Field(..., description="Human-readable server name")
    tool_name: str = Field(..., description="Tool name on the server")
    description: str = Field(..., description="Tool description")
    input_schema: dict = Field(default_factory=dict, description="JSON schema for inputs")

    @property
    def qualified_name(self) -> str:
        """Return the fully-qualified tool name (mcp__server_name__tool_name)."""
        return f"mcp__{self.server_name}__{self.tool_name}"


# ─── Orchestration models ─────────────────────────────────────────────────────


class Task(BaseModel):
    """Single atomic task in an execution plan."""

    task_id: str = Field(..., description="Unique task identifier within the plan (e.g. 't1')")
    description: str = Field(..., description="Human-readable description of what this task does")
    resource_type: str = Field(
        ...,
        description="Type of resource to invoke: tool | skill | mcp | llm | code",
    )
    resource_name: str = Field(
        ...,
        description="Exact name of the tool/skill/mcp to call, or 'reasoning' for llm type",
    )
    resource_args: dict = Field(default_factory=dict, description="Arguments to pass to the resource")
    preconditions: list[str] = Field(
        default_factory=list,
        description="Natural language preconditions that must hold before this task runs",
    )
    depends_on: list[str] = Field(
        default_factory=list,
        description="task_ids whose successful completion this task depends on",
    )
    validation: str = Field(
        default="",
        description="How to verify the task succeeded (checked by validate_task_result)",
    )
    critical: bool = Field(
        default=True,
        description="If True, failure aborts the plan. If False, failure is recorded and execution continues.",
    )


class TaskPlan(BaseModel):
    """Structured execution plan produced by the planner."""

    tasks: list[Task] = Field(default_factory=list)
    reasoning: str = Field(default="", description="Planner's explanation of the decomposition")


class TaskStatus(str):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    BLOCKED = "blocked"    # dependency failed
    SKIPPED = "skipped"    # non-critical, recovery decided to skip


class TaskResult(BaseModel):
    """Outcome of executing a single task."""

    task_id: str
    status: str = Field(default="pending")
    output: str = Field(default="")
    error: Optional[str] = None
    validation_passed: bool = Field(default=True)
    validation_reason: str = Field(default="")
    recovery_applied: Optional[str] = None   # retry_with_args | use_alternative | skip | abort


class GuardrailResult(BaseModel):
    """Result of applying guardrails to text."""

    blocked: bool = False
    block_reason: Optional[str] = None
    sanitized_text: str = ""
    violations: list[dict] = Field(default_factory=list)


class HookResult(BaseModel):
    """Result of running lifecycle hooks."""

    blocked: bool = False
    block_reason: Optional[str] = None
    modified_args: dict = Field(default_factory=dict)
