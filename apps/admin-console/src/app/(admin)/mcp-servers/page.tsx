'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { Trash2, Plus, Loader2 } from 'lucide-react';

interface MCPServer {
  id: string;
  tenant_id: string;
  name: string;
  url: string;
  scope: string;
  created_at: string;
  updated_at: string;
}

interface MCPToken {
  id: string;
  description: string;
  tenant_id: string;
  created_at: string;
  expires_at: string | null;
}

interface AuthConfig {
  type?: 'bearer_token' | 'api_key' | 'oauth2';
  token?: string;
  header_name?: string;
  key?: string;
  key_name?: string;
  key_in?: 'header' | 'query';
  client_id?: string;
  client_secret?: string;
  token_url?: string;
  scope?: string;
}

export default function MCPServersPage() {
  const queryClient = useQueryClient();
  const [showServerModal, setShowServerModal] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [newServerUrl, setNewServerUrl] = useState('');
  const [authConfig, setAuthConfig] = useState<AuthConfig>({});
  const [showNewToken, setShowNewToken] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  // Fetch MCP servers
  const { data: serversData = { servers: [], count: 0 }, isLoading: serversLoading } = useQuery({
    queryKey: ['mcp-servers'],
    queryFn: () => adminApi.listMcpServers(),
  });

  // Fetch tokens
  const { data: tokensData = { tokens: [], count: 0 }, isLoading: tokensLoading } = useQuery({
    queryKey: ['mcp-tokens'],
    queryFn: async () => {
      const response = await fetch('/api/v1/admin/mcp/tokens', {
        headers: {
          'Authorization': `Bearer ${typeof window !== 'undefined' ? sessionStorage.getItem('admin_api_key') : ''}`,
        },
      });
      if (!response.ok) throw new Error('Failed to fetch tokens');
      return response.json();
    },
  });

  // Create server mutation
  const createServerMutation = useMutation({
    mutationFn: () => adminApi.createMcpServer({
      name: newServerName,
      url: newServerUrl,
      auth_config: authConfig.type ? authConfig : undefined,
    }),
    onSuccess: () => {
      setNewServerName('');
      setNewServerUrl('');
      setAuthConfig({});
      setShowServerModal(false);
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
    },
  });

  // Delete server mutation
  const deleteServerMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteMcpServer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
    },
  });

  // Issue token mutation
  const issueTokenMutation = useMutation({
    mutationFn: async (description: string) => {
      const response = await fetch('/api/v1/admin/mcp/tokens', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${typeof window !== 'undefined' ? sessionStorage.getItem('admin_api_key') : ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ description }),
      });
      if (!response.ok) throw new Error('Failed to issue token');
      return response.json();
    },
    onSuccess: (data) => {
      setNewToken(data.token);
      setShowNewToken(true);
      queryClient.invalidateQueries({ queryKey: ['mcp-tokens'] });
    },
  });

  // Revoke token mutation
  const revokeTokenMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/v1/admin/mcp/tokens/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${typeof window !== 'undefined' ? sessionStorage.getItem('admin_api_key') : ''}`,
        },
      });
      if (!response.ok) throw new Error('Failed to revoke token');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-tokens'] });
    },
  });

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString();
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">MCP Server Management</h1>
        <p className="text-gray-500 mt-2">Manage global MCP servers and external client access</p>
      </div>

      {/* ============================================================ */}
      {/* SECTION 1: EXTERNAL MCP SERVERS */}
      {/* ============================================================ */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">External MCP Servers</h2>
              <p className="text-sm text-gray-500 mt-1">Global servers available to all tenants</p>
            </div>
            <button
              onClick={() => setShowServerModal(true)}
              className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Register Server
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {serversLoading ? (
            <div className="p-6 text-center text-sm text-gray-500">Loading...</div>
          ) : serversData.servers.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">No global MCP servers registered</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted border-b border-border">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-foreground">Name</th>
                  <th className="px-6 py-3 text-left font-medium text-foreground">URL</th>
                  <th className="px-6 py-3 text-left font-medium text-foreground">Scope</th>
                  <th className="px-6 py-3 text-left font-medium text-foreground">Created</th>
                  <th className="px-6 py-3 text-left font-medium text-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {serversData.servers.map((server: MCPServer) => (
                  <tr key={server.id} className="border-b border-border hover:bg-muted/50">
                    <td className="px-6 py-3 font-medium text-foreground">{server.name}</td>
                    <td className="px-6 py-3 font-mono text-xs text-muted-foreground truncate max-w-xs" title={server.url}>{server.url}</td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        {server.scope}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">{formatDate(server.created_at)}</td>
                    <td className="px-6 py-3">
                      <button
                        onClick={() => {
                          if (confirm(`Delete "${server.name}"? This cannot be undone.`)) {
                            deleteServerMutation.mutate(server.id);
                          }
                        }}
                        disabled={deleteServerMutation.isPending}
                        className="text-red-600 hover:text-red-700 disabled:opacity-50 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Register Server Modal */}
      {showServerModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg border border-border p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4 text-foreground">Register Global MCP Server</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Server Name</label>
                <input
                  type="text"
                  value={newServerName}
                  onChange={(e) => setNewServerName(e.target.value)}
                  placeholder="e.g., github-mcp"
                  className="w-full px-3 py-2 bg-input text-foreground border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Server URL</label>
                <input
                  type="text"
                  value={newServerUrl}
                  onChange={(e) => setNewServerUrl(e.target.value)}
                  placeholder="http://localhost:3000"
                  className="w-full px-3 py-2 bg-input text-foreground border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Auth Configuration Section */}
              <div className="pt-2 border-t border-border">
                <label className="block text-sm font-medium text-foreground mb-3">Authentication (Optional)</label>

                <div className="mb-3">
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Auth Type</label>
                  <select
                    value={authConfig.type || ''}
                    onChange={(e) => setAuthConfig(e.target.value ? { type: e.target.value as any } : {})}
                    className="w-full px-3 py-2 bg-input text-foreground border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">None</option>
                    <option value="bearer_token">Bearer Token</option>
                    <option value="api_key">API Key</option>
                    <option value="oauth2">OAuth 2.0</option>
                  </select>
                </div>

                {authConfig.type === 'bearer_token' && (
                  <>
                    <div className="mb-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Token</label>
                      <input
                        type="password"
                        value={authConfig.token || ''}
                        onChange={(e) => setAuthConfig({ ...authConfig, token: e.target.value })}
                        placeholder="Bearer token"
                        className="w-full px-3 py-2 bg-input text-foreground border border-border rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Header Name</label>
                      <input
                        type="text"
                        value={authConfig.header_name || 'Authorization'}
                        onChange={(e) => setAuthConfig({ ...authConfig, header_name: e.target.value })}
                        placeholder="Authorization"
                        className="w-full px-3 py-2 bg-input text-foreground border border-border rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </>
                )}

                {authConfig.type === 'api_key' && (
                  <>
                    <div className="mb-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">API Key</label>
                      <input
                        type="password"
                        value={authConfig.key || ''}
                        onChange={(e) => setAuthConfig({ ...authConfig, key: e.target.value })}
                        placeholder="API key value"
                        className="w-full px-3 py-2 bg-input text-foreground border border-border rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div className="mb-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Header/Param Name</label>
                      <input
                        type="text"
                        value={authConfig.key_name || ''}
                        onChange={(e) => setAuthConfig({ ...authConfig, key_name: e.target.value })}
                        placeholder="X-API-Key"
                        className="w-full px-3 py-2 bg-input text-foreground border border-border rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Send In</label>
                      <select
                        value={authConfig.key_in || 'header'}
                        onChange={(e) => setAuthConfig({ ...authConfig, key_in: e.target.value as any })}
                        className="w-full px-3 py-2 bg-input text-foreground border border-border rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <option value="header">Header</option>
                        <option value="query">Query Parameter</option>
                      </select>
                    </div>
                  </>
                )}

                {authConfig.type === 'oauth2' && (
                  <>
                    <div className="mb-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Client ID</label>
                      <input
                        type="text"
                        value={authConfig.client_id || ''}
                        onChange={(e) => setAuthConfig({ ...authConfig, client_id: e.target.value })}
                        placeholder="OAuth client ID"
                        className="w-full px-3 py-2 bg-input text-foreground border border-border rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div className="mb-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Client Secret</label>
                      <input
                        type="password"
                        value={authConfig.client_secret || ''}
                        onChange={(e) => setAuthConfig({ ...authConfig, client_secret: e.target.value })}
                        placeholder="OAuth client secret"
                        className="w-full px-3 py-2 bg-input text-foreground border border-border rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div className="mb-2">
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Token URL</label>
                      <input
                        type="text"
                        value={authConfig.token_url || ''}
                        onChange={(e) => setAuthConfig({ ...authConfig, token_url: e.target.value })}
                        placeholder="https://oauth.example.com/token"
                        className="w-full px-3 py-2 bg-input text-foreground border border-border rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Scope (optional)</label>
                      <input
                        type="text"
                        value={authConfig.scope || ''}
                        onChange={(e) => setAuthConfig({ ...authConfig, scope: e.target.value })}
                        placeholder="read write"
                        className="w-full px-3 py-2 bg-input text-foreground border border-border rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="flex gap-2 justify-end pt-4">
                <button
                  onClick={() => {
                    setShowServerModal(false);
                    setNewServerName('');
                    setNewServerUrl('');
                    setAuthConfig({});
                  }}
                  disabled={createServerMutation.isPending}
                  className="px-3 py-2 border border-border rounded-md text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => createServerMutation.mutate()}
                  disabled={createServerMutation.isPending || !newServerName || !newServerUrl}
                  className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {createServerMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Register
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* SECTION 2: MCP TOKENS FOR EXTERNAL CLIENTS */}
      {/* ============================================================ */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-xl font-semibold">MCP Tokens</h2>
          <p className="text-sm text-gray-500 mt-1">Bearer tokens for external MCP clients (e.g., Claude Desktop)</p>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">Issue New Token</label>
            <div className="flex gap-2">
              <input
                type="text"
                id="tokenDesc"
                placeholder="Token description (e.g., 'Claude Desktop - John')"
                className="flex-1 px-3 py-2 bg-input text-foreground border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                onClick={() => {
                  const desc = (document.getElementById('tokenDesc') as HTMLInputElement).value;
                  if (desc.trim()) {
                    issueTokenMutation.mutate(desc);
                    (document.getElementById('tokenDesc') as HTMLInputElement).value = '';
                  }
                }}
                disabled={issueTokenMutation.isPending}
                className="px-3 py-2 bg-primary text-primary-foreground text-sm rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {issueTokenMutation.isPending ? 'Issuing...' : 'Issue Token'}
              </button>
            </div>

            {showNewToken && newToken && (
              <div className="p-3 mt-3 bg-secondary/20 border border-secondary rounded-md">
                <p className="text-sm font-medium text-secondary mb-2">✓ Token issued (shown once)</p>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={newToken}
                    readOnly
                    className="flex-1 px-3 py-2 border border-secondary rounded-md bg-input text-foreground text-sm font-mono text-xs"
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(newToken)}
                    className="px-3 py-2 border border-secondary rounded-md text-sm font-medium text-secondary hover:bg-secondary/20 transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <p className="text-xs text-secondary">Use in MCP client config: Authorization: Bearer {'{token}'}</p>
                <button
                  onClick={() => setShowNewToken(false)}
                  className="mt-2 text-sm text-secondary hover:underline"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>

          {/* Tokens Table */}
          <div className="mt-6">
            <h3 className="text-sm font-semibold mb-3">Active Tokens</h3>
            <div className="overflow-x-auto">
              {tokensLoading ? (
                <div className="text-sm text-gray-500">Loading tokens...</div>
              ) : tokensData.tokens && tokensData.tokens.length === 0 ? (
                <div className="text-sm text-gray-500">No tokens issued yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted border border-border rounded-t">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-foreground">Description</th>
                      <th className="px-4 py-2 text-left font-medium text-foreground">Tenant</th>
                      <th className="px-4 py-2 text-left font-medium text-foreground">Created</th>
                      <th className="px-4 py-2 text-left font-medium text-foreground">Expires</th>
                      <th className="px-4 py-2 text-left font-medium text-foreground">Status</th>
                      <th className="px-4 py-2 text-left font-medium text-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="border border-t-0 border-border">
                    {tokensData.tokens && tokensData.tokens.map((token: MCPToken) => (
                      <tr key={token.id} className={`border-b border-border ${isExpired(token.expires_at) ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-2 text-foreground">{token.description}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{token.tenant_id}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{formatDate(token.created_at)}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{formatDate(token.expires_at)}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                            isExpired(token.expires_at)
                              ? 'bg-red-100 text-red-700'
                              : 'bg-green-100 text-green-700'
                          }`}>
                            {isExpired(token.expires_at) ? 'Expired' : 'Active'}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <button
                            onClick={() => {
                              if (confirm('Revoke this token? This cannot be undone.')) {
                                revokeTokenMutation.mutate(token.id);
                              }
                            }}
                            disabled={revokeTokenMutation.isPending}
                            className="text-red-600 hover:text-red-700 disabled:opacity-50 transition-colors text-sm font-medium"
                          >
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
