export type ResourceStatus =
  | "draft"
  | "staged"
  | "active"
  | "paused"
  | "archived"
  | "pending_review"
  | "approved"
  | "deprecated";

export type AuthLevel = "read" | "mutating";

export interface ToolSpec {
  id: string;
  tenant_id: string;
  name: string;
  version: string;
  description: string;
  auth_level: AuthLevel;
  sandbox_required: boolean;
  input_schema?: unknown;
  output_schema?: unknown;
  status: ResourceStatus;
  registered_by: string;
  created_at: string;
  scope?: "tenant" | "system";
}

export interface ToolRef {
  name: string;
  version: string;
}

export interface HookSpec {
  phase: "pre" | "post";
  type: "audit_log" | "cost_meter" | "hitl_intercept" | "rate_limit";
  config?: Record<string, unknown>;
}

export interface SkillManifest {
  id: string;
  tenant_id: string;
  name: string;
  version: string;
  description: string;
  tools: ToolRef[];
  sop: string;
  mutating: boolean;
  approval_required: boolean;
  hooks?: HookSpec[];
  status: ResourceStatus;
  published_by: string;
  created_at: string;
  scope?: "tenant" | "system";
  visibility?: "private" | "public";
  team_id?: string;
}

export interface SkillRef {
  id?: string;
  name: string;
  version: string;
}

export interface MCPServer {
  id: string;
  tenant_id: string;
  name: string;
  url: string;
  scope: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ── Agent Tiers ──────────────────────────────────────────────────────────────

export type AgentTier = "lite" | "workflow" | "deep";
export type AutonomyLevel = "none" | "supervised" | "autonomous";

export interface ExecutionConfig {
  max_duration_seconds: number;
  max_tool_calls: number | null;   // null = unlimited
  max_tokens: number;
  max_cost_usd: number;
  // workflow tier
  steps?: WorkflowStep[];
  hitl_on_mutating?: boolean;
  // deep tier
  planning_mode?: "none" | "static" | "dynamic";
  self_correction?: boolean;
  memory_cross_session?: boolean;
  hitl_on_uncertainty?: boolean;
}

export interface WorkflowStep {
  id: string;
  name: string;
  description?: string;
  type: "llm" | "tool" | "skill" | "condition" | "approval" | "loop";
  tool_id?: string;
  skill_id?: string;
  input_mapping?: Record<string, string>;
  condition?: string;
  on_true?: string;
  on_false?: string;
  approval_message?: string;
  approval_timeout_seconds?: number;
  on_timeout?: "proceed" | "abort" | "escalate";
  retry_on_failure?: boolean;
  max_retries?: number;
  fallback_step_id?: string;
  depends_on?: string[];
  next_step_id?: string;
}

/** Tier-specific defaults used when pre-filling the wizard */
export const TIER_DEFAULTS: Record<AgentTier, Partial<ExecutionConfig>> = {
  lite: {
    max_duration_seconds: 10,
    max_tool_calls: 2,
    max_tokens: 2000,
    max_cost_usd: 0.01,
    planning_mode: "none",
  },
  workflow: {
    max_duration_seconds: 300,
    max_tool_calls: 20,
    max_tokens: 10000,
    max_cost_usd: 0.10,
    planning_mode: "static",
    hitl_on_mutating: true,
    steps: [],
  },
  deep: {
    max_duration_seconds: 3600,
    max_tool_calls: null,
    max_tokens: 100000,
    max_cost_usd: 5.0,
    planning_mode: "dynamic",
    self_correction: true,
    memory_cross_session: true,
    hitl_on_mutating: true,
    hitl_on_uncertainty: false,
  },
};

export const TIER_AUTONOMY: Record<AgentTier, AutonomyLevel> = {
  lite: "none",
  workflow: "supervised",
  deep: "autonomous",
};

// ── Agent Manifest & Record ───────────────────────────────────────────────────

export interface AgentManifest {
  id: string;
  tenant_id: string;
  name: string;
  version: string;
  description?: string;
  tags?: string[];
  system_prompt: string;
  skills: SkillRef[];
  tools?: ToolRef[];
  model: string;
  max_iterations: number;
  memory_budget_mb: number;
  mcp_servers?: string[];
  // Tier (new)
  tier: AgentTier;
  autonomy_level: AutonomyLevel;
  execution_config: ExecutionConfig;
  template_id?: string;
  guardrail_ids?: string[];
  hook_ids?: string[];
  knowledge_graph_ids?: string[];
}

export interface AgentRecord {
  id: string;
  tenant_id: string;
  name: string;
  version: string;
  description?: string;
  tags?: string[];
  system_prompt: string;
  skills: SkillRef[];
  tools?: ToolRef[];
  model: string;
  max_iterations: number;
  memory_budget_mb: number;
  mcp_servers?: string[];
  status: ResourceStatus;
  created_at: string;
  // Tier (new)
  tier: AgentTier;
  autonomy_level: AutonomyLevel;
  execution_config: ExecutionConfig;
  template_id?: string;
  guardrail_ids?: string[];
  hook_ids?: string[];
  knowledge_graph_ids?: string[];
}

export interface TransitionRequest {
  target_state: string;
  actor: string;
  reason?: string;
}

export interface ChatEvent {
  type: "thinking" | "tool_call" | "tool_result" | "text" | "error" | "done" | "approval";
  content?: string;
  tool_name?: string;
  tool_args?: unknown;
  tool_result?: unknown;
  timestamp?: string;
  approval_id?: string;
  reason?: string;
  // Token usage — populated on "done" events from the ReAct loop
  tokens_in?: number;
  tokens_out?: number;
  steps?: number;
  model?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  events?: ChatEvent[];
  streaming?: boolean;
  // Token usage captured when streaming completes
  tokensIn?: number;
  tokensOut?: number;
  steps?: number;
  model?: string;
}

// ── Chat Sessions ─────────────────────────────────────────────────────────────

export interface ChatSessionMessage {
  id: string;
  session_id: string;
  tenant_id: string;
  agent_id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: {
    tokens_in?: number;
    tokens_out?: number;
    steps?: number;
    model?: string;
    events?: ChatEvent[];
  };
  created_at: string;
}

export interface ChatSession {
  id: string;
  tenant_id: string;
  agent_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages?: ChatSessionMessage[];
}

export interface KGGraph {
  id: string;
  tenant_id: string;
  name: string;
  domain?: string;
  description?: string;
  scope: string;
  schema?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface KGNode {
  id: string;
  graph_id: string;
  tenant_id: string;
  node_type: string;
  label: string;
  properties?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface KGEdge {
  id: string;
  graph_id: string;
  tenant_id: string;
  from_node_id: string;
  to_node_id: string;
  relationship_type: string;
  properties?: Record<string, unknown>;
  weight?: number;
  created_at: string;
  updated_at: string;
}
