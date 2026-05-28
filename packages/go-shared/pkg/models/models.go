package models

import (
	"encoding/json"
	"time"
)

// ResourceStatus covers lifecycle states for all four tiers.
type ResourceStatus string

const (
	StatusDraft         ResourceStatus = "draft"
	StatusStaged        ResourceStatus = "staged"
	StatusActive        ResourceStatus = "active"
	StatusPaused        ResourceStatus = "paused"
	StatusArchived      ResourceStatus = "archived"
	StatusPendingReview ResourceStatus = "pending_review"
	StatusApproved      ResourceStatus = "approved"
	StatusDeprecated    ResourceStatus = "deprecated"
)

// AuthLevel classifies tool invocation impact.
type AuthLevel string

const (
	AuthLevelRead     AuthLevel = "read"
	AuthLevelMutating AuthLevel = "mutating"
)

// CoordinationStrategy defines how sub-agents in a team execute.
type CoordinationStrategy string

const (
	StrategyParallel    CoordinationStrategy = "parallel"
	StrategySequential  CoordinationStrategy = "sequential"
	StrategyConditional CoordinationStrategy = "conditional"
)

// --- Tier 1: Tools ---

// ToolSpec is a primitive, stateless operation registered in the Tool Registry.
type ToolSpec struct {
	ID              string          `json:"id"`
	TenantID        string          `json:"tenant_id"`
	Name            string          `json:"name"`
	Version         string          `json:"version"` // semver
	Description     string          `json:"description"`
	AuthLevel       AuthLevel       `json:"auth_level"`
	SandboxRequired bool            `json:"sandbox_required"`
	InputSchema     json.RawMessage `json:"input_schema,omitempty"`
	OutputSchema    json.RawMessage `json:"output_schema,omitempty"`
	Status          ResourceStatus  `json:"status"`
	RegisteredBy    string          `json:"registered_by"`
	CreatedAt       time.Time       `json:"created_at"`
	Scope           string          `json:"scope"` // "tenant" | "system"
}

// ToolRef is a version-pinned reference to a tool used inside a SkillManifest.
type ToolRef struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// --- Tier 2: Skills ---

// HookSpec is a declarative hook configuration attached to a SkillManifest.
type HookSpec struct {
	Phase  string         `json:"phase"` // "pre" | "post"
	Type   string         `json:"type"`  // "audit_log" | "cost_meter" | "hitl_intercept" | "rate_limit"
	Config map[string]any `json:"config,omitempty"`
}

// SkillManifest is a governed composition of tools with an SOP and RBAC flags.
// AgentID enables agent-backed skills (alternative to tool-backed).
type SkillManifest struct {
	ID               string         `json:"id"`
	TenantID         string         `json:"tenant_id"`
	Name             string         `json:"name"`
	Version          string         `json:"version"` // semver
	Description      string         `json:"description"`
	AgentID          string         `json:"agent_id,omitempty"` // if set, delegate to this agent instead of tools
	Tools            []ToolRef      `json:"tools"`
	SOP              string         `json:"sop"` // system operating procedure
	Mutating         bool           `json:"mutating"`
	ApprovalRequired bool           `json:"approval_required"`
	Hooks            []HookSpec     `json:"hooks,omitempty"`
	Status           ResourceStatus `json:"status"`
	PublishedBy      string         `json:"published_by"`
	CreatedAt        time.Time      `json:"created_at"`
	Scope            string         `json:"scope"`      // "tenant" | "system"
	Visibility       string         `json:"visibility"` // "private" | "public"
	TeamID           string         `json:"team_id,omitempty"`
}

// SkillRef is a version-pinned reference to a skill used inside SubAgentContract.
type SkillRef struct {
	ID      string `json:"id,omitempty"`
	Name    string `json:"name"`
	Version string `json:"version"`
}

// --- Tier 3: Sub-Agents ---

// SubAgentContract defines a specialized sub-agent's capability scope.
type SubAgentContract struct {
	ID            string          `json:"id"`
	TenantID      string          `json:"tenant_id"`
	Name          string          `json:"name"`
	Version       string          `json:"version"` // semver
	Persona       string          `json:"persona"`
	AllowedSkills []SkillRef      `json:"allowed_skills"`
	Model         string          `json:"model"`
	MaxIterations int             `json:"max_iterations"`
	InputSchema   json.RawMessage `json:"input_schema,omitempty"`
	OutputSchema  json.RawMessage `json:"output_schema,omitempty"`
	Status        ResourceStatus  `json:"status"`
	CreatedAt     time.Time       `json:"created_at"`
}

// --- Tier 4: Agent Teams ---

// TeamMember is a sub-agent with a role in a TeamManifest.
type TeamMember struct {
	SubAgentID      string `json:"sub_agent_id"`
	SubAgentVersion string `json:"sub_agent_version"`
	Role            string `json:"role"` // "orchestrator" | "specialist"
}

// TeamManifest defines a collaborative multi-agent pipeline.
type TeamManifest struct {
	ID                   string               `json:"id"`
	TenantID             string               `json:"tenant_id"`
	Name                 string               `json:"name"`
	Version              string               `json:"version"`
	Members              []TeamMember         `json:"members"`
	CoordinationStrategy CoordinationStrategy `json:"coordination_strategy"`
	SharedMemoryScope    string               `json:"shared_memory_scope"` // "shared" | "isolated"
	Status               ResourceStatus       `json:"status"`
	CreatedAt            time.Time            `json:"created_at"`
}

// --- Agent Tiers ---

// AgentTier classifies the execution model of an agent.
// lite     → single-shot, no Temporal, <2 s target
// workflow → multi-step static DAG, Temporal durable
// deep     → autonomous planning + memory, Temporal orchestrated
type AgentTier string

const (
	AgentTierLite     AgentTier = "lite"
	AgentTierWorkflow AgentTier = "workflow"
	AgentTierDeep     AgentTier = "deep"
)

// AutonomyLevel describes how much the agent acts without human oversight.
type AutonomyLevel string

const (
	AutonomyNone       AutonomyLevel = "none"
	AutonomySupervised AutonomyLevel = "supervised"
	AutonomyAutonomous AutonomyLevel = "autonomous"
)

// ExecutionConfig holds tier-specific runtime constraints. Fields are pointers
// so callers can distinguish "not set" from "zero". Workflow-tier agents also
// carry their step DAG here.
type ExecutionConfig struct {
	// Common
	MaxDurationSeconds int     `json:"max_duration_seconds"`
	MaxToolCalls       *int    `json:"max_tool_calls"` // nil = unlimited
	MaxTokens          int     `json:"max_tokens"`
	MaxCostUSD         float64 `json:"max_cost_usd"`

	// Workflow tier
	Steps          []WorkflowStep `json:"steps,omitempty"`
	HITLOnMutating bool           `json:"hitl_on_mutating,omitempty"`

	// Deep tier
	PlanningMode       string `json:"planning_mode,omitempty"`        // "dynamic" | "static" | "none"
	SelfCorrection     bool   `json:"self_correction,omitempty"`
	MemoryCrossSession bool   `json:"memory_cross_session,omitempty"`
	HITLOnUncertainty  bool   `json:"hitl_on_uncertainty,omitempty"`
}

// WorkflowStep is a single node in a Workflow-tier agent's static execution DAG.
type WorkflowStep struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Type        string            `json:"type"` // "llm" | "tool" | "skill" | "condition" | "approval" | "loop"

	// Tool / Skill steps
	ToolID       string            `json:"tool_id,omitempty"`
	SkillID      string            `json:"skill_id,omitempty"`
	InputMapping map[string]string `json:"input_mapping,omitempty"`

	// Condition steps
	Condition  string `json:"condition,omitempty"`
	OnTrue     string `json:"on_true,omitempty"`
	OnFalse    string `json:"on_false,omitempty"`

	// Approval steps
	ApprovalMessage        string `json:"approval_message,omitempty"`
	ApprovalTimeoutSeconds int    `json:"approval_timeout_seconds,omitempty"`
	OnTimeout              string `json:"on_timeout,omitempty"` // "proceed" | "abort" | "escalate"

	// Retry / ordering
	RetryOnFailure bool     `json:"retry_on_failure,omitempty"`
	MaxRetries     int      `json:"max_retries,omitempty"`
	FallbackStepID string   `json:"fallback_step_id,omitempty"`
	DependsOn      []string `json:"depends_on,omitempty"`
	NextStepID     string   `json:"next_step_id,omitempty"`
}

// TierDefaults returns the canonical ExecutionConfig for a given tier.
func TierDefaults(tier AgentTier) ExecutionConfig {
	switch tier {
	case AgentTierLite:
		maxCalls := 2
		return ExecutionConfig{
			MaxDurationSeconds: 10,
			MaxToolCalls:       &maxCalls,
			MaxTokens:          2000,
			MaxCostUSD:         0.01,
			PlanningMode:       "none",
		}
	case AgentTierWorkflow:
		maxCalls := 20
		return ExecutionConfig{
			MaxDurationSeconds: 300,
			MaxToolCalls:       &maxCalls,
			MaxTokens:          10000,
			MaxCostUSD:         0.10,
			PlanningMode:       "static",
			HITLOnMutating:     true,
		}
	default: // deep
		return ExecutionConfig{
			MaxDurationSeconds: 3600,
			MaxToolCalls:       nil, // unlimited
			MaxTokens:          100000,
			MaxCostUSD:         5.00,
			PlanningMode:       "dynamic",
			SelfCorrection:     true,
			MemoryCrossSession: true,
			HITLOnMutating:     true,
		}
	}
}

// TierAutonomy returns the default AutonomyLevel for a tier.
func TierAutonomy(tier AgentTier) AutonomyLevel {
	switch tier {
	case AgentTierLite:
		return AutonomyNone
	case AgentTierWorkflow:
		return AutonomySupervised
	default:
		return AutonomyAutonomous
	}
}

// --- Agent Manifests (updated) ---

// AgentManifest defines the configuration and capabilities of an agent.
type AgentManifest struct {
	ID             string         `json:"id"`
	TenantID       string         `json:"tenant_id"`
	Name           string         `json:"name"`
	Version        string         `json:"version"`
	Description    string         `json:"description,omitempty"`
	Tags           []string       `json:"tags,omitempty"`
	SystemPrompt   string         `json:"system_prompt"`
	Skills         []SkillRef     `json:"skills"`
	Tools          []ToolRef      `json:"tools,omitempty"`
	Model          string         `json:"model"`
	MaxIterations  int            `json:"max_iterations"`
	MemoryBudgetMB int            `json:"memory_budget_mb"`
	MCPServers     []string       `json:"mcp_servers,omitempty"`
	Status         ResourceStatus `json:"status"`

	// Tier classification (new)
	Tier            AgentTier       `json:"tier"`
	AutonomyLevel   AutonomyLevel   `json:"autonomy_level"`
	ExecutionConfig ExecutionConfig `json:"execution_config"`
	TemplateID      string          `json:"template_id,omitempty"`

	// Guardrails & hooks selected by the user from the platform catalog
	GuardrailIDs []string `json:"guardrail_ids,omitempty"`
	HookIDs      []string `json:"hook_ids,omitempty"`

	// Knowledge graphs attached to this agent — IDs reference kg_graphs.id.
	// At runtime the Memory Service performs semantic search across all attached
	// graphs and injects the top-K chunks into the LLM prompt.
	KnowledgeGraphIDs []string `json:"knowledge_graph_ids,omitempty"`
}

// SkillDefinition defines a tool-call parameter schema (used in LLM tool-call formatting).
// Distinct from SkillManifest which is the platform-level governed entity.
type SkillDefinition struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

// --- Lifecycle ---

// LifecycleEvent is an immutable audit record for a state transition across any tier.
type LifecycleEvent struct {
	ID           string    `json:"id"`
	ResourceType string    `json:"resource_type"` // tool|skill|sub_agent|agent|team
	ResourceID   string    `json:"resource_id"`
	TenantID     string    `json:"tenant_id"`
	FromState    string    `json:"from_state,omitempty"`
	ToState      string    `json:"to_state"`
	Actor        string    `json:"actor"`
	Reason       string    `json:"reason,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}

// TransitionRequest is the payload for state machine transition endpoints.
type TransitionRequest struct {
	TargetState string `json:"target_state"`
	Actor       string `json:"actor"`
	Reason      string `json:"reason,omitempty"`
}

// --- HITL ---

// HITLRequest carries workflow suspension metadata to the approver.
type HITLRequest struct {
	WorkflowID    string         `json:"workflow_id"`
	RunID         string         `json:"run_id"`
	ToolName      string         `json:"tool_name"`
	AgentID       string         `json:"agent_id"`
	TenantID      string         `json:"tenant_id"`
	Justification string         `json:"justification"`
	Evidence      map[string]any `json:"evidence,omitempty"`
}

// HITLSignal is the approval or rejection payload sent via Temporal signal.
type HITLSignal struct {
	Approved bool   `json:"approved"`
	MFAToken string `json:"mfa_token"`
	ActorID  string `json:"actor_id"`
}

// --- Session / Workflow ---

// TriggerRequest represents the external request to trigger an agent.
type TriggerRequest struct {
	EventSource    string         `json:"event_source"`
	Payload        map[string]any `json:"payload"`
	IdempotencyKey string         `json:"idempotency_key,omitempty"`
}

// TriggerResponse is the response sent back to the external client.
type TriggerResponse struct {
	WorkflowID string `json:"workflow_id"`
	RunID      string `json:"run_id"`
	Status     string `json:"status"`
}

// StartSessionRequest represents the internal request to the Workflow Initiator for a single agent.
type StartSessionRequest struct {
	AgentID        string            `json:"agent_id"`
	SessionID      string            `json:"session_id"`
	TenantID       string            `json:"tenant_id"`
	Prompt         string            `json:"prompt,omitempty"`
	IdempotencyKey string            `json:"idempotency_key,omitempty"`
	Context        map[string]string `json:"context"`
	Manifest       *AgentManifest    `json:"manifest,omitempty"`
	ModelOverride  string            `json:"model_override,omitempty"` // optional: override the agent's configured model
}

// AgentEvent is a single observable event emitted by a running agent workflow,
// streamed to the client via SSE.
type AgentEvent struct {
	Type       string      `json:"type"`                  // "thinking" | "tool_call" | "text" | "done" | "error" | "approval"
	Content    string      `json:"content,omitempty"`     // text / thinking / error content
	ToolName   string      `json:"tool_name,omitempty"`   // tool_call: tool name
	ToolArgs   interface{} `json:"tool_args,omitempty"`   // tool_call: tool arguments (object, not string)
	ToolResult interface{} `json:"tool_result,omitempty"` // tool_call: execution result
	ApprovalID string      `json:"approval_id,omitempty"` // approval: approval request ID
	Reason     string      `json:"reason,omitempty"`      // approval: why approval is needed
	// Token usage — populated on "done" events by the ReAct loop
	TokensIn  int    `json:"tokens_in,omitempty"`  // total prompt tokens across all reasoning steps
	TokensOut int    `json:"tokens_out,omitempty"` // total completion tokens across all reasoning steps
	Steps     int    `json:"steps,omitempty"`      // number of reasoning steps taken
	Model     string `json:"model,omitempty"`      // model used for this run
}

// ChatRequest is the body for POST /api/v1/agents/{id}/chat.
type ChatRequest struct {
	Message       string `json:"message"`
	TenantID      string `json:"tenant_id,omitempty"`
	ModelOverride string `json:"model_override,omitempty"` // optional: override the agent's configured model
}


// StartTeamRequest represents the internal request to start a team Temporal workflow.
type StartTeamRequest struct {
	TeamID         string            `json:"team_id"`
	SessionID      string            `json:"session_id"`
	TenantID       string            `json:"tenant_id"`
	IdempotencyKey string            `json:"idempotency_key,omitempty"`
	Context        map[string]string `json:"context"`
}

// StartTeamResponse is returned after successfully dispatching a team workflow.
type StartTeamResponse struct {
	WorkflowID     string   `json:"workflow_id"`
	RunID          string   `json:"run_id"`
	Status         string   `json:"status"`
	SubWorkflowIDs []string `json:"sub_workflow_ids,omitempty"`
}

// SessionStatus represents the current status of an agent or team session.
type SessionStatus struct {
	WorkflowID string `json:"workflow_id"`
	RunID      string `json:"run_id"`
	Status     string `json:"status"`
	Result     string `json:"result,omitempty"`
}

// PollResponse combines events and workflow status into a single response.
type PollResponse struct {
	Events []AgentEvent `json:"events"`
	Status string       `json:"status"`
}

// IdempotencyEntry is stored in Redis and Postgres for webhook deduplication.
type IdempotencyEntry struct {
	WorkflowID string    `json:"workflow_id"`
	RunID      string    `json:"run_id"`
	CreatedAt  time.Time `json:"created_at"`
}

// --- Cost Attribution ---

// CostEvent records cost attribution for a single platform action.
type CostEvent struct {
	Time      time.Time `json:"time"`
	TenantID  string    `json:"tenant_id"`
	AgentID   string    `json:"agent_id"`
	SkillID   string    `json:"skill_id,omitempty"`
	TokensIn  int       `json:"tokens_in"`
	TokensOut int       `json:"tokens_out"`
	SandboxMs int       `json:"sandbox_ms"`
	VectorOps int       `json:"vector_ops"`
}

// --- LLM Gateway ---

// ChatMessage represents a single message in a conversation.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// LLMRequest represents a request to the LLM Gateway.
type LLMRequest struct {
	Model    string        `json:"model"`
	Messages []ChatMessage `json:"messages"`
	Stream   bool          `json:"stream,omitempty"`
}

// LLMResponse represents a response from the LLM Gateway.
type LLMResponse struct {
	ID      string `json:"id"`
	Content string `json:"content"`
	Model   string `json:"model"`
}

// --- Admin Console Models ---

// TenantStatus represents the operational status of a tenant.
type TenantStatus string

const (
	TenantStatusActive    TenantStatus = "active"
	TenantStatusSuspended TenantStatus = "suspended"
)

// TenantSettings stores quota and configuration for a tenant.
type TenantSettings struct {
	TenantID               string       `json:"tenant_id"`
	DisplayName            string       `json:"display_name"`
	Status                 TenantStatus `json:"status"`
	MaxConcurrentWorkflows int          `json:"max_concurrent_workflows"`
	TokenBudgetMonthly     int64        `json:"token_budget_monthly"`
	CreatedAt              time.Time    `json:"created_at"`
	UpdatedAt              time.Time    `json:"updated_at"`
}

// TenantSettingsUpdate is used to update tenant settings.
type TenantSettingsUpdate struct {
	DisplayName            *string       `json:"display_name,omitempty"`
	Status                 *TenantStatus `json:"status,omitempty"`
	MaxConcurrentWorkflows *int          `json:"max_concurrent_workflows,omitempty"`
	TokenBudgetMonthly     *int64        `json:"token_budget_monthly,omitempty"`
}

// ModelAccess controls which models a tenant can use and per-model quotas.
type ModelAccess struct {
	TenantID        string    `json:"tenant_id"`
	ModelID         string    `json:"model_id"`
	Enabled         bool      `json:"enabled"`
	DailyTokenLimit *int64    `json:"daily_token_limit,omitempty"` // nil = no limit
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// PlatformConfig stores platform-wide settings (e.g., LLM proxy URL, API keys).
type PlatformConfig struct {
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

// AdminAuthResponse is returned after successful admin authentication.
type AdminAuthResponse struct {
	Valid bool   `json:"valid"`
	Role  string `json:"role"` // "admin" for V1
}

// TenantStats provides aggregated statistics for a tenant.
type TenantStats struct {
	TenantID    string          `json:"tenant_id"`
	AgentCount  int             `json:"agent_count"`
	SkillCount  int             `json:"skill_count"`
	ToolCount   int             `json:"tool_count"`
	MonthlyCost float64         `json:"monthly_cost"`
	Settings    *TenantSettings `json:"settings,omitempty"`
}

// --- LLM Configuration ---

// LLMConfigResponse is returned by GET /admin/config.
type LLMConfigResponse struct {
	AnthropicBaseURL string `json:"anthropic_base_url"`
	AnthropicKeySet  bool   `json:"anthropic_key_set"`
	OpenAIKeySet     bool   `json:"openai_key_set"`
	Mode             string `json:"mode"` // "mock" | "anthropic" | "custom"
}

// LLMConfigRequest is sent to PUT /admin/config.
type LLMConfigRequest struct {
	AnthropicAPIKey  string `json:"anthropic_api_key,omitempty"`
	AnthropicBaseURL string `json:"anthropic_base_url,omitempty"`
	OpenAIAPIKey     string `json:"openai_api_key,omitempty"`
}

// --- Chat Sessions ---

// ChatSession is a persistent conversation thread between a user and an agent.
type ChatSession struct {
	ID        string    `json:"id"`
	TenantID  string    `json:"tenant_id"`
	AgentID   string    `json:"agent_id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	// Messages is populated only when loading a single session (not in list view).
	Messages []ChatSessionMessage `json:"messages,omitempty"`
}

// ChatSessionMessage is a single message stored inside a ChatSession.
type ChatSessionMessage struct {
	ID        string                 `json:"id"`
	SessionID string                 `json:"session_id"`
	TenantID  string                 `json:"tenant_id"`
	AgentID   string                 `json:"agent_id"`
	Role      string                 `json:"role"` // "user" | "assistant"
	Content   string                 `json:"content"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"` // tokens_in, tokens_out, steps, model, events
	CreatedAt time.Time              `json:"created_at"`
}

// AppendMessagesRequest is the body for POST /api/v1/agents/{id}/chat/sessions/{sid}/messages.
type AppendMessagesRequest struct {
	Messages []ChatSessionMessage `json:"messages"`
}

// CreateSessionRequest is the body for POST /api/v1/agents/{id}/chat/sessions.
type CreateSessionRequest struct {
	Title    string `json:"title"`
	TenantID string `json:"tenant_id,omitempty"`
}

// SystemAgent represents a platform-system agent (Manifest Assistant, etc).
type SystemAgent struct {
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	Version        string         `json:"version"`
	SystemPrompt   string         `json:"system_prompt"`
	Skills         []SkillRef     `json:"skills"`
	Model          string         `json:"model"`
	MaxIterations  int            `json:"max_iterations"`
	MemoryBudgetMB int            `json:"memory_budget_mb"`
	Status         ResourceStatus `json:"status"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}
