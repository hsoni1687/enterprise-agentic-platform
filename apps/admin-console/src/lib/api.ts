const API_BASE_URL = process.env.NEXT_PUBLIC_ADMIN_API_URL || "http://localhost:8089";

function getAuthHeader() {
  if (typeof window === "undefined") return {};
  const key = sessionStorage.getItem("admin_api_key");
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}

async function request(
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const url = `${API_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const authHeaders = getAuthHeader();
  if (authHeaders.Authorization) {
    headers.Authorization = authHeaders.Authorization;
  }

  const config: RequestInit = {
    method,
    headers,
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(url, config);
  return response;
}

export const adminApi = {
  async verifyAuth(apiKey: string): Promise<any> {
    const response = await fetch(`${API_BASE_URL}/api/v1/admin/auth/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });
    return response.json();
  },

  async listTenants(): Promise<any> {
    const response = await request("GET", "/api/v1/admin/tenants");
    if (!response.ok) throw new Error("Failed to fetch tenants");
    return response.json();
  },

  async createTenant(data: {
    tenant_id: string;
    display_name: string;
    max_concurrent_workflows?: number;
    token_budget_monthly?: number;
  }): Promise<any> {
    const response = await request("POST", "/api/v1/admin/tenants", data);
    if (!response.ok) throw new Error("Failed to create tenant");
    return response.json();
  },

  async getTenant(tenantId: string): Promise<any> {
    const response = await request("GET", `/api/v1/admin/tenants/${tenantId}`);
    if (!response.ok) throw new Error("Failed to fetch tenant");
    return response.json();
  },

  async updateTenantQuota(
    tenantId: string,
    data: { max_concurrent_workflows?: number; token_budget_monthly?: number }
  ): Promise<any> {
    const response = await request(
      "PUT",
      `/api/v1/admin/tenants/${tenantId}/quota`,
      data
    );
    if (!response.ok) throw new Error("Failed to update tenant quota");
    return response.json();
  },

  async updateTenantStatus(tenantId: string, status: "active" | "suspended"): Promise<any> {
    const response = await request(
      "PUT",
      `/api/v1/admin/tenants/${tenantId}/status`,
      { status }
    );
    if (!response.ok) throw new Error("Failed to update tenant status");
    return response.json();
  },

  async getLLMConfig(): Promise<any> {
    const response = await request("GET", "/api/v1/admin/llm/config");
    if (!response.ok) throw new Error("Failed to fetch LLM config");
    return response.json();
  },

  async putLLMConfig(data: {
    anthropic_api_key?: string;
    anthropic_base_url?: string;
    openai_api_key?: string;
  }): Promise<any> {
    const response = await request("PUT", "/api/v1/admin/llm/config", data);
    if (!response.ok) throw new Error("Failed to update LLM config");
    return response.json();
  },

  async listSystemAgents(): Promise<any> {
    const response = await request("GET", "/api/v1/admin/system-agents");
    if (!response.ok) throw new Error("Failed to fetch system agents");
    return response.json();
  },

  async getSystemAgent(agentId: string): Promise<any> {
    const response = await request("GET", `/api/v1/admin/system-agents/${agentId}`);
    if (!response.ok) throw new Error("Failed to fetch system agent");
    return response.json();
  },

  async updateSystemAgent(
    agentId: string,
    data: {
      name?: string;
      version?: string;
      system_prompt?: string;
      model?: string;
      max_iterations?: number;
      memory_budget_mb?: number;
      status?: string;
    }
  ): Promise<any> {
    const response = await request(
      "PUT",
      `/api/v1/admin/system-agents/${agentId}`,
      data
    );
    if (!response.ok) throw new Error("Failed to update system agent");
    return response.json();
  },

  async listExecutions(params?: { limit?: number; tenant_id?: string; status?: string }): Promise<any> {
    const query = new URLSearchParams();
    if (params?.limit) query.append("limit", params.limit.toString());
    if (params?.tenant_id) query.append("tenant_id", params.tenant_id);
    if (params?.status) query.append("status", params.status);

    const url = `/api/v1/admin/executions${query.toString() ? `?${query}` : ""}`;
    const response = await request("GET", url);
    if (!response.ok) throw new Error("Failed to fetch executions");
    return response.json();
  },

  async getExecution(sessionId: string): Promise<any> {
    const response = await request("GET", `/api/v1/admin/executions/${sessionId}`);
    if (!response.ok) throw new Error("Failed to fetch execution");
    return response.json();
  },

  async getExecutionEvents(sessionId: string): Promise<any> {
    const response = await request("GET", `/api/v1/admin/executions/${sessionId}/events`);
    if (!response.ok) throw new Error("Failed to fetch execution events");
    return response.json();
  },

  async getCostSummary(params?: { period?: string }): Promise<any> {
    const query = new URLSearchParams();
    if (params?.period) query.append("period", params.period);

    const url = `/api/v1/admin/cost${query.toString() ? `?${query}` : ""}`;
    const response = await request("GET", url);
    if (!response.ok) throw new Error("Failed to fetch cost data");
    return response.json();
  },

  async getCostByTenant(tenantId: string, params?: { period?: string }): Promise<any> {
    const query = new URLSearchParams();
    if (params?.period) query.append("period", params.period);

    const url = `/api/v1/admin/cost/${tenantId}${query.toString() ? `?${query}` : ""}`;
    const response = await request("GET", url);
    if (!response.ok) throw new Error("Failed to fetch tenant cost data");
    return response.json();
  },

  async getAuditLog(params?: { limit?: number; offset?: number; resource_type?: string; tenant_id?: string }): Promise<any> {
    const query = new URLSearchParams();
    if (params?.limit) query.append("limit", params.limit.toString());
    if (params?.offset) query.append("offset", params.offset.toString());
    if (params?.resource_type) query.append("resource_type", params.resource_type);
    if (params?.tenant_id) query.append("tenant_id", params.tenant_id);

    const url = `/api/v1/admin/audit${query.toString() ? `?${query}` : ""}`;
    const response = await request("GET", url);
    if (!response.ok) throw new Error("Failed to fetch audit log");
    return response.json();
  },

  async listMcpServers(): Promise<any> {
    const response = await request("GET", "/api/v1/admin/mcp/servers");
    if (!response.ok) throw new Error("Failed to fetch MCP servers");
    return response.json();
  },

  async createMcpServer(data: {
    name: string;
    url: string;
    auth_config?: Record<string, unknown>;
  }): Promise<any> {
    const response = await request("POST", "/api/v1/admin/mcp/servers", data);
    if (!response.ok) throw new Error("Failed to create MCP server");
    return response.json();
  },

  async deleteMcpServer(id: string): Promise<any> {
    const response = await request("DELETE", `/api/v1/admin/mcp/servers/${id}`);
    if (!response.ok) throw new Error("Failed to delete MCP server");
    return response.json();
  },

  async listSystemTools(): Promise<any> {
    const response = await request("GET", "/api/v1/admin/system-tools");
    if (!response.ok) throw new Error("Failed to fetch system tools");
    return response.json();
  },

  async createSystemTool(data: {
    name: string;
    version: string;
    description?: string;
    auth_level?: string;
    sandbox_required?: boolean;
    input_schema?: Record<string, unknown>;
    output_schema?: Record<string, unknown>;
    registered_by?: string;
  }): Promise<any> {
    const response = await request("POST", "/api/v1/admin/system-tools", data);
    if (!response.ok) throw new Error("Failed to create system tool");
    return response.json();
  },

  async updateSystemTool(id: string, data: Partial<{
    name: string;
    version: string;
    description: string;
    auth_level: string;
    sandbox_required: boolean;
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
  }>): Promise<any> {
    const response = await request("PUT", `/api/v1/admin/system-tools/${id}`, data);
    if (!response.ok) throw new Error("Failed to update system tool");
    return response.json();
  },

  async transitionSystemTool(id: string, data: {
    target_state: string;
    actor?: string;
  }): Promise<any> {
    const response = await request("POST", `/api/v1/admin/system-tools/${id}/transition`, data);
    if (!response.ok) throw new Error("Failed to transition system tool");
    return response.json();
  },

  async listSystemSkills(): Promise<any> {
    const response = await request("GET", "/api/v1/admin/system-skills");
    if (!response.ok) throw new Error("Failed to fetch system skills");
    return response.json();
  },

  async createSystemSkill(data: {
    name: string;
    version: string;
    description?: string;
    tools?: Array<{ name: string; version: string }>;
    sop?: string;
    mutating?: boolean;
    approval_required?: boolean;
    hooks?: unknown[];
    published_by?: string;
  }): Promise<any> {
    const response = await request("POST", "/api/v1/admin/system-skills", data);
    if (!response.ok) throw new Error("Failed to create system skill");
    return response.json();
  },

  async updateSystemSkill(id: string, data: Partial<{
    name: string;
    version: string;
    description: string;
    tools: Array<{ name: string; version: string }>;
    sop: string;
    mutating: boolean;
    approval_required: boolean;
    hooks: unknown[];
  }>): Promise<any> {
    const response = await request("PUT", `/api/v1/admin/system-skills/${id}`, data);
    if (!response.ok) throw new Error("Failed to update system skill");
    return response.json();
  },

  async transitionSystemSkill(id: string, data: {
    target_state: string;
    actor?: string;
    reason?: string;
  }): Promise<any> {
    const response = await request("POST", `/api/v1/admin/system-skills/${id}/transition`, data);
    if (!response.ok) throw new Error("Failed to transition system skill");
    return response.json();
  },
};
