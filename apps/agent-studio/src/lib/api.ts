const DEFAULT_TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "default-tenant";
let _tenantId = DEFAULT_TENANT_ID;

export function setRuntimeTenant(id: string) {
  _tenantId = id;
}

export function getRuntimeTenant(): string {
  return _tenantId;
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
  process.env.NEXT_PUBLIC_LLM_GATEWAY_URL ?? "http://localhost:8083";
const MCP_REGISTRY =
  process.env.NEXT_PUBLIC_MCP_REGISTRY_URL ?? "http://localhost:8090";
const ADMIN_API =
  process.env.NEXT_PUBLIC_ADMIN_API_URL ?? "http://localhost:8089";
const ADMIN_KEY = process.env.NEXT_PUBLIC_ADMIN_API_KEY ?? "dev-admin-key";
const KG_SERVICE =
  process.env.NEXT_PUBLIC_KG_SERVICE_URL ?? "http://localhost:8093";

async function req<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const url = `${base}${path}`;
  console.log(`[API] Fetching: ${url}`);
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Tenant-ID": _tenantId,
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[API] Error ${res.status}: ${text}`);
      throw new Error(`${res.status}: ${text}`);
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
  listWithSystem: (status?: string) =>
    req<import("./types").SkillManifest[]>(
      SKILL_CATALOG,
      `/api/v1/skills?include_system=true${status ? `&status=${status}` : ""}`
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
  kgArchitectChat: (message: string, graphId?: string): Promise<Response> =>
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
};
