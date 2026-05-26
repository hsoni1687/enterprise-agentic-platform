const DEFAULT_TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "default-tenant";
const DEFAULT_TEAM_ID = process.env.NEXT_PUBLIC_TEAM_ID ?? "default-team";
let _tenantId = DEFAULT_TENANT_ID;
let _teamId = DEFAULT_TEAM_ID;

export function setRuntimeTenant(id: string) {
  _tenantId = id;
}

export function getRuntimeTenant(): string {
  return _tenantId;
}

export function setRuntimeTeam(id: string) {
  _teamId = id;
}

export function getRuntimeTeam(): string {
  return _teamId;
}

const TOOL_REGISTRY =
  process.env.NEXT_PUBLIC_TOOL_REGISTRY_URL ?? "http://localhost:8086";
const SKILL_CATALOG =
  process.env.NEXT_PUBLIC_SKILL_CATALOG_URL ?? "http://localhost:8087";
const AGENT_REGISTRY =
  process.env.NEXT_PUBLIC_AGENT_REGISTRY_URL ?? "http://localhost:8088";
const API_GATEWAY =
  process.env.NEXT_PUBLIC_API_GATEWAY_URL ?? "http://localhost:8080";
const LLM_GATEWAY =
  process.env.NEXT_PUBLIC_LLM_GATEWAY_URL ?? "http://localhost:4000";
const LLM_GATEWAY_KEY =
  process.env.NEXT_PUBLIC_LLM_GATEWAY_KEY ?? "sk-litellm-dev";
const OLLAMA_URL =
  process.env.NEXT_PUBLIC_OLLAMA_URL ?? "http://localhost:11434";
const MCP_REGISTRY =
  process.env.NEXT_PUBLIC_MCP_REGISTRY_URL ?? "http://localhost:8090";
const ADMIN_API =
  process.env.NEXT_PUBLIC_ADMIN_API_URL ?? "http://localhost:8089";
const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_API_KEY ?? "dev-admin-key";
const KG_SERVICE =
  process.env.NEXT_PUBLIC_KG_SERVICE_URL ?? "http://localhost:8093";
const TOOL_WORKERS =
  process.env.NEXT_PUBLIC_TOOL_WORKERS_URL ?? "http://localhost:8094";

async function req<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const url = `${base}${path}`;
  console.log(`[API] Fetching: ${url}`);
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-ID": _tenantId,
        // X-Team-ID omitted: Go services only allow X-Tenant-ID in CORS preflight
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[API] Error ${res.status}: ${text}`);
      throw new Error(`${res.status}: ${text}`);
    }
    // 204 No Content (and any other empty body) — return undefined without parsing JSON.
    if (res.status === 204 || res.headers.get("content-length") === "0") {
      console.log(`[API] Success (no body): ${url}`);
      return undefined as T;
    }
    const data = await res.json() as T;
    console.log(`[API] Success: ${url}`, data);
    return data;
  } catch (error) {
    console.error(`[API] Exception fetching ${url}:`, error);
    throw error;
  }
}

// Tools
export const toolsApi = {
  // Always fetches both tenant-owned tools AND system tools (scope=system created by admin).
  list: (status?: string) => {
    const params = new URLSearchParams({ include_system: "true" });
    if (status) params.set("status", status);
    return req<import("./types").ToolSpec[]>(TOOL_REGISTRY, `/api/v1/tools?${params}`);
  },
  get: (id: string) =>
    req<import("./types").ToolSpec>(TOOL_REGISTRY, `/api/v1/tools/${id}`),
  create: (body: Partial<import("./types").ToolSpec>) =>
    req<import("./types").ToolSpec>(TOOL_REGISTRY, "/api/v1/tools", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: Partial<import("./types").ToolSpec>) =>
    req<import("./types").ToolSpec>(TOOL_REGISTRY, `/api/v1/tools/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  transition: (id: string, body: import("./types").TransitionRequest) =>
    req<import("./types").ToolSpec>(
      TOOL_REGISTRY,
      `/api/v1/tools/${id}/transition`,
      { method: "POST", body: JSON.stringify(body) }
    ),

  // Built-in tool catalog — served directly from agent-workers:8094
  listBuiltin: () =>
    req<{ tools: BuiltinToolSpec[]; count: number }>(TOOL_WORKERS, "/api/v1/tools"),
  getBuiltin: (name: string) =>
    req<BuiltinToolSpec>(TOOL_WORKERS, `/api/v1/tools/${name}`),
  invoke: (name: string, inputs: Record<string, unknown>) =>
    req<ToolInvokeResult>(TOOL_WORKERS, `/api/v1/tools/${name}/invoke`, {
      method: "POST",
      body: JSON.stringify({ inputs }),
    }),
};

// ── Built-in tool types (agent-workers catalog) ───────────────────────────────

export interface BuiltinToolSpec {
  id: string;
  name: string;
  version: string;
  description: string;
  auth_level: "read" | "mutating";
  sandbox_required: boolean;
  input_schema: JsonSchema;
  output_schema: JsonSchema;
  status: string;
  registered_by: string;
  scope: string;
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface JsonSchemaProperty {
  type: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  additionalProperties?: unknown;
}

export interface ToolInvokeResult {
  tool: string;
  result?: unknown;
  error?: string;
  duration_ms: number;
}

// Skills
export const skillsApi = {
  list: (status?: string) =>
    req<import("./types").SkillManifest[]>(
      SKILL_CATALOG,
      `/api/v1/skills${status ? `?status=${status}` : ""}`
    ),
  listWithSystem: (status?: string) =>
    req<import("./types").SkillManifest[]>(
      SKILL_CATALOG,
      `/api/v1/skills?include_system=true&include_public=true${status ? `&status=${status}` : ""}`
    ),
  available: (status?: string) =>
    req<import("./types").SkillManifest[]>(
      SKILL_CATALOG,
      `/api/v1/skills?available=true&include_system=true&include_public=true${status ? `&status=${status}` : ""}`
    ),
  get: (id: string) =>
    req<import("./types").SkillManifest>(SKILL_CATALOG, `/api/v1/skills/${id}`),
  render: (id: string) =>
    req<{ id: string; markdown: string }>(SKILL_CATALOG, `/api/v1/skills/${id}/render`),
  create: (body: Partial<import("./types").SkillManifest>) =>
    req<import("./types").SkillManifest>(SKILL_CATALOG, "/api/v1/skills", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: Partial<import("./types").SkillManifest>) =>
    req<import("./types").SkillManifest>(SKILL_CATALOG, `/api/v1/skills/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  transition: (id: string, body: import("./types").TransitionRequest) =>
    req<import("./types").SkillManifest>(
      SKILL_CATALOG,
      `/api/v1/skills/${id}/transition`,
      { method: "POST", body: JSON.stringify(body) }
    ),
};

// Agents
export const agentsApi = {
  list: (status?: string) =>
    req<import("./types").AgentRecord[]>(
      AGENT_REGISTRY,
      `/api/v1/agents${status ? `?status=${status}` : ""}`
    ),
  get: (id: string) =>
    req<import("./types").AgentRecord>(AGENT_REGISTRY, `/api/v1/agents/${id}`),
  create: (body: Partial<import("./types").AgentManifest>) =>
    req<import("./types").AgentRecord>(AGENT_REGISTRY, "/api/v1/agents", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (id: string, body: Partial<import("./types").AgentManifest>) =>
    req<import("./types").AgentRecord>(
      AGENT_REGISTRY,
      `/api/v1/agents/${id}`,
      { method: "PUT", body: JSON.stringify(body) }
    ),
  transition: (id: string, body: import("./types").TransitionRequest) =>
    req<import("./types").AgentRecord>(
      AGENT_REGISTRY,
      `/api/v1/agents/${id}/transition`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  delete: async (id: string) => {
    // Get current agent to check its status
    const agent = await req<import("./types").AgentRecord>(
      AGENT_REGISTRY,
      `/api/v1/agents/${id}`
    );

    // If agent is draft or paused, first transition to active
    if (agent.status === "draft" || agent.status === "paused") {
      await req<import("./types").AgentRecord>(
        AGENT_REGISTRY,
        `/api/v1/agents/${id}/transition`,
        {
          method: "POST",
          body: JSON.stringify({
            target_state: "staged",
            actor: "studio-user",
          }),
        }
      );
      await req<import("./types").AgentRecord>(
        AGENT_REGISTRY,
        `/api/v1/agents/${id}/transition`,
        {
          method: "POST",
          body: JSON.stringify({
            target_state: "active",
            actor: "studio-user",
          }),
        }
      );
    }

    // Now transition to archived
    return req<import("./types").AgentRecord>(
      AGENT_REGISTRY,
      `/api/v1/agents/${id}/transition`,
      {
        method: "POST",
        body: JSON.stringify({
          target_state: "archived",
          actor: "studio-user",
        }),
      }
    );
  },
};

// Models
export interface ModelInfo {
  id: string;
  name: string;
  source: "local" | "cloud";
}

export interface OllamaModel {
  name: string;
  model: string;
  size: number;        // bytes
  modified_at: string;
  details?: { family?: string; parameter_size?: string; quantization_level?: string };
}

export interface LiteLLMModel {
  model_name: string;   // alias shown to callers e.g. "claude-sonnet"
  litellm_params: {
    model: string;      // real model id e.g. "anthropic/claude-sonnet-4-5"
    api_base?: string;
  };
  model_info: {
    id: string;
    db_model: boolean;  // true = added dynamically; false = from config file
  };
}

export type CloudProvider = "anthropic" | "openai" | "google" | "azure" | "custom";

export interface AddCloudModelParams {
  model_name: string;       // alias e.g. "my-claude"
  provider: CloudProvider;
  litellm_model: string;    // e.g. "anthropic/claude-sonnet-4-5"
  api_key: string;
  api_base?: string;
}

export interface ProviderModel {
  id: string;           // provider model id e.g. "claude-opus-4-5"
  displayName: string;  // human label e.g. "Claude Opus 4.5"
  litellmId: string;    // full litellm id e.g. "anthropic/claude-opus-4-5"
  contextWindow?: number;
  description?: string;
}

// Well-known Claude models — used as fallback when a custom proxy doesn't expose /v1/models
// Verified real Anthropic model IDs — used as fallback when the provider's
// /v1/models endpoint is unreachable (e.g. private proxy without model listing).
// Always prefer fetching live from the API so IDs are accurate for your account.
export const KNOWN_CLAUDE_MODELS: ProviderModel[] = [
  { id: "claude-sonnet-4-5",          displayName: "Claude Sonnet 4.5",  litellmId: "anthropic/claude-sonnet-4-5",          contextWindow: 200000 },
  { id: "claude-opus-4-5",            displayName: "Claude Opus 4.5",    litellmId: "anthropic/claude-opus-4-5",            contextWindow: 200000 },
  { id: "claude-3-7-sonnet-20250219", displayName: "Claude 3.7 Sonnet",  litellmId: "anthropic/claude-3-7-sonnet-20250219", contextWindow: 200000 },
  { id: "claude-3-5-sonnet-20241022", displayName: "Claude 3.5 Sonnet",  litellmId: "anthropic/claude-3-5-sonnet-20241022", contextWindow: 200000 },
  { id: "claude-3-5-haiku-20241022",  displayName: "Claude 3.5 Haiku",   litellmId: "anthropic/claude-3-5-haiku-20241022",  contextWindow: 200000 },
];

// Fetch the live model list from each provider using their public /models endpoint.
// These calls go browser → provider API directly (CORS is allowed by Anthropic & OpenAI).
// Pass `baseUrl` to use a private proxy instead of the public API endpoint.
export const providerModelsApi = {
  anthropic: async (apiKey: string, baseUrl?: string): Promise<ProviderModel[]> => {
    const root = baseUrl ? baseUrl.replace(/\/$/, "") : "https://api.anthropic.com";
    try {
      const resp = await fetch(`${root}/v1/models?limit=100`, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) throw new Error(`API error: ${resp.status}`);
      const body = await resp.json() as { data: Array<{ id: string; display_name?: string; context_window?: number }> };
      const fromApi = (body.data ?? [])
        .filter((m) => m.id.startsWith("claude-") && !m.id.includes("instant"))
        .map((m) => ({
          id: m.id,
          displayName: m.display_name ?? m.id,
          litellmId: `anthropic/${m.id}`,
          contextWindow: m.context_window,
        }));
      // If the proxy returned models, use them; else fall back to known list
      return fromApi.length > 0 ? fromApi : KNOWN_CLAUDE_MODELS;
    } catch {
      // Proxy may not expose /v1/models — return the curated static list instead
      if (baseUrl) return KNOWN_CLAUDE_MODELS;
      throw new Error("Could not reach Anthropic API — check your API key or network.");
    }
  },

  openai: async (apiKey: string): Promise<ProviderModel[]> => {
    const resp = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error(`OpenAI API error: ${resp.status}`);
    const body = await resp.json() as { data: Array<{ id: string; owned_by: string }> };
    // Only show chat-capable models (gpt-*, o1-*, o3-*, o4-*)
    const CHAT_PREFIXES = ["gpt-4", "gpt-3.5", "o1", "o3", "o4"];
    return (body.data ?? [])
      .filter((m) => CHAT_PREFIXES.some((p) => m.id.startsWith(p)) && !m.id.includes("instruct") && !m.id.includes("audio"))
      .sort((a, b) => b.id.localeCompare(a.id))
      .map((m) => ({
        id: m.id,
        displayName: m.id,
        litellmId: `openai/${m.id}`,
      }));
  },

  google: async (apiKey: string): Promise<ProviderModel[]> => {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=50`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) throw new Error(`Google API error: ${resp.status}`);
    const body = await resp.json() as { models: Array<{ name: string; displayName?: string; description?: string; supportedGenerationMethods?: string[] }> };
    return (body.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => {
        const shortId = m.name.replace("models/", "");
        return {
          id: shortId,
          displayName: m.displayName ?? shortId,
          litellmId: `google/${shortId}`,
          description: m.description,
        };
      });
  },
};

export const modelsApi = {
  // ── Ollama (local) ────────────────────────────────────────────────────────

  listOllama: async (): Promise<OllamaModel[]> => {
    try {
      const resp = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!resp.ok) return [];
      const body = await resp.json() as { models?: OllamaModel[] };
      return body.models ?? [];
    } catch { return []; }
  },

  // Returns a ReadableStream — caller reads progress lines (JSON per chunk)
  pullOllama: (name: string): Promise<Response> =>
    fetch(`${OLLAMA_URL}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, stream: true }),
    }),

  deleteOllama: async (name: string): Promise<void> => {
    await fetch(`${OLLAMA_URL}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  },

  // ── LiteLLM cloud models ──────────────────────────────────────────────────

  listLiteLLM: async (): Promise<LiteLLMModel[]> => {
    try {
      const resp = await fetch(`${LLM_GATEWAY}/model/info`, {
        headers: { Authorization: `Bearer ${LLM_GATEWAY_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return [];
      const body = await resp.json() as { data?: LiteLLMModel[] };
      return body.data ?? [];
    } catch { return []; }
  },

  addCloud: async (params: AddCloudModelParams): Promise<void> => {
    const resp = await fetch(`${LLM_GATEWAY}/model/new`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_GATEWAY_KEY}`,
      },
      body: JSON.stringify({
        model_name: params.model_name,
        litellm_params: {
          model: params.litellm_model,
          api_key: params.api_key,
          ...(params.api_base ? { api_base: params.api_base } : {}),
        },
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(err.error?.message ?? `HTTP ${resp.status}`);
    }
  },

  deleteCloud: async (modelId: string): Promise<void> => {
    const resp = await fetch(`${LLM_GATEWAY}/model/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_GATEWAY_KEY}`,
      },
      body: JSON.stringify({ id: modelId }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  },

  // ── Combined list (for ModelSelector / ModelContext) ─────────────────────
  // Returns only meaningfully selectable models:
  //   • Real Ollama models pulled locally (from Ollama /api/tags directly)
  //   • Cloud provider models registered in LiteLLM (Anthropic, OpenAI, Google, Azure, …)
  // Excluded: embedding models, mock/test aliases, internal Ollama-backed LiteLLM aliases
  //           (local-chat, local-embedding, mock-model, mock-gpt-4o, …)
  list: async (): Promise<{ models: ModelInfo[] }> => {
    const models: ModelInfo[] = [];
    const seenIds = new Set<string>();

    // ── 1. Cloud models from LiteLLM /model/info ──────────────────────────
    // Using /model/info (not /v1/models) so we can inspect the underlying model
    // and filter out Ollama-backed entries that are just internal aliases.
    const CLOUD_PREFIXES = ["anthropic/", "openai/", "google/", "azure/", "bedrock/", "vertex_ai/", "cohere/", "mistral/"];
    try {
      const resp = await fetch(`${LLM_GATEWAY}/model/info`, {
        headers: { Authorization: `Bearer ${LLM_GATEWAY_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        const body = await resp.json() as { data?: LiteLLMModel[] };
        for (const m of body.data ?? []) {
          const underlying = m.litellm_params?.model ?? "";
          // Skip Ollama-backed entries — we pull those from Ollama directly
          if (underlying.startsWith("ollama/") || underlying.startsWith("os.environ/OLLAMA")) continue;
          // Skip embedding models
          if (m.model_name.includes("embedding") || underlying.includes("embedding")) continue;
          // Skip mock / test aliases
          if (m.model_name.startsWith("mock-") || m.model_name.startsWith("local-")) continue;
          // Only include if the underlying model is a known cloud provider
          const isCloud = CLOUD_PREFIXES.some((p) => underlying.startsWith(p));
          if (!isCloud) continue;
          // Only show models explicitly connected by the user (db_model = true).
          // Pre-configured models from litellm.config.yaml are managed on the Models
          // settings page only — they should not clutter the workspace selector.
          if (!m.model_info?.db_model) continue;
          if (seenIds.has(m.model_name)) continue;
          seenIds.add(m.model_name);
          models.push({ id: m.model_name, name: m.model_name, source: "cloud" });
        }
      }
    } catch {
      // LiteLLM unreachable — continue to Ollama discovery
    }

    // ── 2. Locally installed Ollama models ────────────────────────────────
    try {
      const resp = await fetch(`${OLLAMA_URL}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) {
        const body = await resp.json() as { models?: Array<{ name: string }> };
        for (const m of body.models ?? []) {
          const id = `ollama/${m.name}`;
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          models.push({ id, name: m.name, source: "local" });
        }
      }
    } catch {
      // Ollama not running — skip local models
    }

    return { models };
  },
};

// LLM Gateway Configuration
export interface LLMConfig {
  anthropic_base_url: string;
  anthropic_key_set: boolean;
  openai_key_set: boolean;
  mode: "mock" | "anthropic" | "custom";
}

export interface LLMConfigUpdate {
  anthropic_api_key?: string;
  anthropic_base_url?: string;
}

export const llmConfigApi = {
  get: () => req<LLMConfig>(ADMIN_API, "/api/v1/admin/llm/config", { headers: { Authorization: `Bearer ${ADMIN_KEY}` } }),
  update: (body: LLMConfigUpdate) =>
    req<LLMConfig>(ADMIN_API, "/api/v1/admin/llm/config", {
      method: "PUT",
      headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      body: JSON.stringify(body),
    }),
};

// Chat SSE (api-gateway)
export function openChatStream(
  agentId: string,
  message: string,
  tenantId: string = _tenantId
): EventSource {
  const url = `${API_GATEWAY}/api/v1/agents/${agentId}/chat?tenant_id=${encodeURIComponent(tenantId)}&message=${encodeURIComponent(message)}`;
  return new EventSource(url);
}

// System Agents (platform-system tenant)
export const systemAgentsApi = {
  chat: (message: string): Promise<Response> =>
    fetch(`${API_GATEWAY}/api/v1/agents/manifest-assistant-system/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-ID": "platform-system",
      },
      body: JSON.stringify({
        message,
        tenant_id: "platform-system",
      }),
    }),
  kgArchitectChat: (message: string, graphId?: string, modelOverride?: string): Promise<Response> =>
    fetch(`${API_GATEWAY}/api/v1/agents/kg-architect/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-ID": "platform-system",
      },
      body: JSON.stringify({
        message,
        tenant_id: "platform-system",
        context: graphId ? { graph_id: graphId } : undefined,
        ...(modelOverride ? { model_override: modelOverride } : {}),
      }),
    }),
};

// Admin API
export interface Tenant {
  tenant_id: string;
  display_name: string;
  status: string;
}

export interface TenantsResponse {
  tenants: Tenant[];
}

export interface CookbookVariable {
  name: string;
  description: string;
  default: string;
  type: string;
}

export interface Cookbook {
  id: string;
  name: string;
  version: string;
  description: string;
  domain: string;
  tags: string[];
  variables: CookbookVariable[];
}

export interface CookbooksResponse {
  cookbooks: Cookbook[];
  count: number;
}

export interface CookbookAgentDetail {
  file: string;
  description: string;
  content: string;
}

export interface CookbookKGDetail {
  name: string;
  description: string;
  schema_file: string;
  seed_data_file: string;
  schema_content: string;
  seed_content: string;
}

export interface CookbookMCPRecommendation {
  name: string;
  description: string;
  required: boolean;
}

export interface CookbookDetail {
  id: string;
  name: string;
  version: string;
  description: string;
  domain: string;
  tags: string[];
  min_platform_version: string;
  variables: CookbookVariable[];
  agents: CookbookAgentDetail[];
  knowledge_graphs: CookbookKGDetail[];
  mcp_recommendations: CookbookMCPRecommendation[];
}

export interface ImportCookbookResult {
  import_id: string;
  cookbook: string;
  tenant_id: string;
  status: string;
  resources: {
    knowledge_graphs: string[];
    agents: string[];
  };
  warnings?: string[];
}

export const adminApi = {
  listTenants: async (): Promise<TenantsResponse> => {
    const res = await fetch(`${ADMIN_API}/api/v1/admin/tenants`, {
      headers: { Authorization: `Bearer ${ADMIN_KEY}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch tenants: ${res.status}`);
    }
    return res.json() as Promise<TenantsResponse>;
  },

  listCookbooks: async (): Promise<CookbooksResponse> => {
    const res = await fetch(`${ADMIN_API}/api/v1/admin/cookbooks`, {
      headers: { Authorization: `Bearer ${ADMIN_KEY}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch cookbooks: ${res.status}`);
    }
    return res.json() as Promise<CookbooksResponse>;
  },

  getCookbook: async (cookbookId: string): Promise<CookbookDetail> => {
    const res = await fetch(`${ADMIN_API}/api/v1/admin/cookbooks/${cookbookId}`, {
      headers: { Authorization: `Bearer ${ADMIN_KEY}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch cookbook: ${res.status}`);
    }
    return res.json() as Promise<CookbookDetail>;
  },

  importCookbook: async (
    cookbookId: string,
    tenantId: string,
    variables: Record<string, string>
  ): Promise<ImportCookbookResult> => {
    const res = await fetch(
      `${ADMIN_API}/api/v1/admin/cookbooks/${cookbookId}/import`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ADMIN_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenant_id: tenantId, variables }),
      }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Import failed (${res.status}): ${body}`);
    }
    return res.json() as Promise<ImportCookbookResult>;
  },
};

// MCP Servers
export const mcpApi = {
  listServers: () =>
    req<{
      servers: import("./types").MCPServer[];
      count: number;
    }>(MCP_REGISTRY, "/api/v1/mcp/servers"),

  getServer: (id: string) =>
    req<import("./types").MCPServer>(MCP_REGISTRY, `/api/v1/mcp/servers/${id}`),

  listTools: (serverId: string) =>
    req<{ tools: Array<{ name: string; description: string; input_schema: unknown }> }>(
      MCP_REGISTRY,
      `/api/v1/mcp/servers/${serverId}/tools`
    ),

  executeTool: (serverId: string, toolName: string, input: Record<string, unknown>) =>
    req<{ result: unknown; duration_ms: number; error?: string }>(
      MCP_REGISTRY,
      `/api/v1/mcp/servers/${serverId}/call`,
      {
        method: "POST",
        body: JSON.stringify({ tool_name: toolName, args: input }),
      }
    ),

  createServer: (body: Partial<import("./types").MCPServer>) =>
    req<import("./types").MCPServer>(MCP_REGISTRY, "/api/v1/mcp/servers", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  toggleServer: (id: string, enabled: boolean) =>
    req<import("./types").MCPServer>(MCP_REGISTRY, `/api/v1/mcp/servers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
};

// Knowledge Graph API
export const kgApi = {
  listGraphs: () =>
    req<import("./types").KGGraph[]>(KG_SERVICE, "/graphs/list"),
  getGraph: (id: string) =>
    req<import("./types").KGGraph>(KG_SERVICE, `/graphs/get?id=${id}`),
  createGraph: (data: Partial<import("./types").KGGraph>) =>
    req<import("./types").KGGraph>(KG_SERVICE, "/graphs/create", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteGraph: (id: string) =>
    req<void>(KG_SERVICE, `/graphs/delete?id=${id}`, { method: "DELETE" }),
  listNodes: (graphId: string) =>
    req<import("./types").KGNode[]>(KG_SERVICE, `/nodes/list?graph_id=${graphId}`),
  listEdges: (graphId: string) =>
    req<import("./types").KGEdge[]>(KG_SERVICE, `/edges/list?graph_id=${graphId}`),
  queryGraph: (graphId: string, startNodeId: string, maxDepth = 2) =>
    req<{ nodes: import("./types").KGNode[]; edges: import("./types").KGEdge[] }>(
      KG_SERVICE,
      "/query",
      {
        method: "POST",
        body: JSON.stringify({
          graph_id: graphId,
          start_node_id: startNodeId,
          max_depth: maxDepth,
        }),
      }
    ),
  searchNodes: (graphId: string, nodeType: string, limit = 100) =>
    req<import("./types").KGNode[]>(
      KG_SERVICE,
      `/search/nodes?graph_id=${graphId}&node_type=${nodeType}&limit=${limit}`
    ),
  graphChat: (graphId: string, question: string, model?: string) =>
    req<{ answer: string; sources: Array<{ id: string; label: string; type: string; description: string }>; model: string }>(
      KG_SERVICE, "/graph/chat", {
        method: "POST",
        body: JSON.stringify({ graph_id: graphId, question, model: model || undefined }),
      }
    ),
  getGraphContext: (graphId: string, question: string) =>
    req<{ context: string; nodes: Array<{ id: string; label: string; type: string; description: string }> }>(
      KG_SERVICE, "/graph/context", {
        method: "POST",
        body: JSON.stringify({ graph_id: graphId, question, top_k: 8 }),
      }
    ),
  ingestURL: (graphId: string, url: string, extractionModel?: string) =>
    req<{ nodes_created: number; edges_created: number; source: string }>(KG_SERVICE, "/ingest/url", {
      method: "POST",
      body: JSON.stringify({ graph_id: graphId, url, extraction_model: extractionModel || undefined }),
    }),
  ingestFile: (graphId: string, file: File, extractionModel?: string) => {
    const form = new FormData();
    form.append("graph_id", graphId);
    form.append("file", file);
    if (extractionModel) form.append("extraction_model", extractionModel);
    // Use fetch directly — browser must set multipart boundary; don't set Content-Type manually
    return fetch(`${KG_SERVICE}/ingest/file`, {
      method: "POST",
      body: form,
      headers: { "X-Tenant-ID": _tenantId },
    }).then(async (r) => {
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ nodes_created: number; edges_created: number; filename: string }>;
    });
  },
};

// ── Platform catalog (public, no admin key) ───────────────────────────────────

export interface PlatformGuardrail {
  id: string;
  name: string;
  description: string;
  category: string;
  action: "block" | "redact" | "flag";
  scope: string;
  admin_managed: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlatformHook {
  id: string;
  name: string;
  type: string;
  description: string;
  phase: "pre" | "post" | "both";
  category: string;
  admin_managed: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export const platformApi = {
  listGuardrails: () =>
    req<PlatformGuardrail[]>(ADMIN_API, "/api/v1/platform/guardrails"),
  listHooks: () =>
    req<PlatformHook[]>(ADMIN_API, "/api/v1/platform/hooks"),
};

// ── Agent Run Event Logs ──────────────────────────────────────────────────────

export type LogLevel  = "info" | "warn" | "error" | "success";
export type LogSource = "agent" | "skill" | "tool" | "guardrail" | "hook" | "llm" | "system";

export interface RunEvent {
  id: string;
  workflow_id: string;
  run_id: string;
  tenant_id: string;
  agent_id: string;
  event_type: string;
  level: LogLevel;
  source: LogSource;
  source_id: string;
  message: string;
  duration_ms?: number;
  details?: Record<string, unknown>;
  timestamp: string;   // ISO8601 created_at from DB
}

export interface LogsResponse {
  events: RunEvent[];
  count: number;
  limit: number;
  offset: number;
}

export interface LogsFilter {
  level?: string;
  source?: string;
  agent_id?: string;
  workflow_id?: string;
  q?: string;
  from?: string;   // ISO8601
  to?: string;     // ISO8601
  limit?: number;
  offset?: number;
}

export const logsApi = {
  list: (filter: LogsFilter = {}) => {
    const params = new URLSearchParams();
    if (filter.level && filter.level !== "all")   params.set("level",       filter.level);
    if (filter.source && filter.source !== "all") params.set("source",      filter.source);
    if (filter.agent_id)    params.set("agent_id",    filter.agent_id);
    if (filter.workflow_id) params.set("workflow_id", filter.workflow_id);
    if (filter.q)           params.set("q",           filter.q);
    if (filter.from)        params.set("from",        filter.from);
    if (filter.to)          params.set("to",          filter.to);
    params.set("limit",  String(filter.limit  ?? 200));
    params.set("offset", String(filter.offset ?? 0));
    const qs = params.toString();
    return req<LogsResponse>(ADMIN_API, `/api/v1/logs${qs ? "?" + qs : ""}`);
  },
};

// ── Agent Runs (grouped by workflow_id) ────────────────────────────────────────

export interface AgentRun {
  workflow_id:   string;
  agent_id:      string;
  tenant_id:     string;
  started_at:    string;   // ISO8601
  last_event_at: string;   // ISO8601
  duration_ms:   number;
  event_count:   number;
  llm_calls:     number;
  tool_calls:    number;
  status:        "success" | "error" | "running";
}

export interface RunsResponse {
  runs:  AgentRun[];
  count: number;
}

export const runsApi = {
  list: (params: { agent_id?: string; from?: string; to?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.agent_id) qs.set("agent_id", params.agent_id);
    if (params.from)     qs.set("from",     params.from);
    if (params.to)       qs.set("to",       params.to);
    qs.set("limit", String(params.limit ?? 100));
    return req<RunsResponse>(ADMIN_API, `/api/v1/logs/runs?${qs}`);
  },
  agents: () =>
    req<{ agents: string[] }>(ADMIN_API, `/api/v1/logs/agents`),
};

/** URL to the self-hosted Langfuse instance — for trace deep-links */
export const LANGFUSE_URL =
  process.env.NEXT_PUBLIC_LANGFUSE_URL ?? "http://localhost:3002";
