const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "default-tenant";

const TOOL_REGISTRY =
  process.env.NEXT_PUBLIC_TOOL_REGISTRY_URL ?? "http://localhost:8086";
const SKILL_CATALOG =
  process.env.NEXT_PUBLIC_SKILL_CATALOG_URL ?? "http://localhost:8087";
const AGENT_REGISTRY =
  process.env.NEXT_PUBLIC_AGENT_REGISTRY_URL ?? "http://localhost:8088";
const API_GATEWAY =
  process.env.NEXT_PUBLIC_API_GATEWAY_URL ?? "http://localhost:8080";
const LLM_GATEWAY =
  process.env.NEXT_PUBLIC_LLM_GATEWAY_URL ?? "http://localhost:8083";
const MCP_REGISTRY =
  process.env.NEXT_PUBLIC_MCP_REGISTRY_URL ?? "http://localhost:8090";

async function req<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-ID": TENANT_ID,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// Tools
export const toolsApi = {
  list: (status?: string) =>
    req<import("./types").ToolSpec[]>(
      TOOL_REGISTRY,
      `/api/v1/tools${status ? `?status=${status}` : ""}`
    ),
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
};

// Skills
export const skillsApi = {
  list: (status?: string) =>
    req<import("./types").SkillManifest[]>(
      SKILL_CATALOG,
      `/api/v1/skills${status ? `?status=${status}` : ""}`
    ),
  get: (id: string) =>
    req<import("./types").SkillManifest>(SKILL_CATALOG, `/api/v1/skills/${id}`),
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
};

// Models
export const modelsApi = {
  list: () =>
    req<{ models: Array<{ id: string; name: string }> }>(
      LLM_GATEWAY,
      "/v1/models"
    ),
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
  get: () => req<LLMConfig>(LLM_GATEWAY, "/admin/config"),
  update: (body: LLMConfigUpdate) =>
    req<LLMConfig>(LLM_GATEWAY, "/admin/config", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};

// Chat SSE (api-gateway)
export function openChatStream(
  agentId: string,
  message: string,
  tenantId: string = TENANT_ID
): EventSource {
  const url = `${API_GATEWAY}/api/v1/agents/${agentId}/chat?tenant_id=${encodeURIComponent(tenantId)}&message=${encodeURIComponent(message)}`;
  return new EventSource(url);
}

// System Agents (platform-system tenant)
export const systemAgentsApi = {
  chat: (message: string): Promise<Response> =>
    fetch(`${API_GATEWAY}/api/v1/agents/manifest-assistant/chat`, {
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
};

// MCP Servers
export const mcpApi = {
  listServers: () =>
    req<{
      servers: import("./types").MCPServer[];
      count: number;
    }>(MCP_REGISTRY, "/api/v1/mcp/servers"),
};
