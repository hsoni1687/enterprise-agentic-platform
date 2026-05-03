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

export default function MCPServersPage() {
  const queryClient = useQueryClient();
  const [showServerModal, setShowServerModal] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [newServerUrl, setNewServerUrl] = useState('');
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
    mutationFn: () => adminApi.createMcpServer({ name: newServerName, url: newServerUrl }),
    onSuccess: () => {
      setNewServerName('');
      setNewServerUrl('');
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
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">External MCP Servers</h2>
              <p className="text-sm text-gray-500 mt-1">Global servers available to all tenants</p>
            </div>
            <button
              onClick={() => setShowServerModal(true)}
              className="flex items-center gap-2 px-3 py-2 bg-primary text-white text-sm rounded-md hover:bg-primary/90 transition-colors"
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
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">Name</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">URL</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">Scope</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">Created</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {serversData.servers.map((server: MCPServer) => (
                  <tr key={server.id} className="border-b border-gray-200 hover:bg-gray-50/50">
                    <td className="px-6 py-3 font-medium">{server.name}</td>
                    <td className="px-6 py-3 font-mono text-xs text-gray-600 truncate max-w-xs" title={server.url}>{server.url}</td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                        {server.scope}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-gray-600">{formatDate(server.created_at)}</td>
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
          <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Register Global MCP Server</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Server Name</label>
                <input
                  type="text"
                  value={newServerName}
                  onChange={(e) => setNewServerName(e.target.value)}
                  placeholder="e.g., github-mcp"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Server URL</label>
                <input
                  type="text"
                  value={newServerUrl}
                  onChange={(e) => setNewServerUrl(e.target.value)}
                  placeholder="http://localhost:3000"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="flex gap-2 justify-end pt-4">
                <button
                  onClick={() => {
                    setShowServerModal(false);
                    setNewServerName('');
                    setNewServerUrl('');
                  }}
                  disabled={createServerMutation.isPending}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => createServerMutation.mutate()}
                  disabled={createServerMutation.isPending || !newServerName || !newServerUrl}
                  className="flex items-center gap-2 px-3 py-2 bg-primary text-white text-sm rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
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
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold">MCP Tokens</h2>
          <p className="text-sm text-gray-500 mt-1">Bearer tokens for external MCP clients (e.g., Claude Desktop)</p>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Issue New Token</label>
            <div className="flex gap-2">
              <input
                type="text"
                id="tokenDesc"
                placeholder="Token description (e.g., 'Claude Desktop - John')"
                className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
                className="px-3 py-2 bg-primary text-white text-sm rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {issueTokenMutation.isPending ? 'Issuing...' : 'Issue Token'}
              </button>
            </div>

            {showNewToken && newToken && (
              <div className="p-3 mt-3 bg-green-50 border border-green-200 rounded-md">
                <p className="text-sm font-medium text-green-900 mb-2">✓ Token issued (shown once)</p>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={newToken}
                    readOnly
                    className="flex-1 px-3 py-2 border border-green-300 rounded-md bg-white text-sm font-mono text-xs"
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(newToken)}
                    className="px-3 py-2 border border-green-300 rounded-md text-sm font-medium text-green-700 hover:bg-green-50 transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <p className="text-xs text-green-700">Use in MCP client config: Authorization: Bearer {'{token}'}</p>
                <button
                  onClick={() => setShowNewToken(false)}
                  className="mt-2 text-sm text-green-700 hover:underline"
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
                  <thead className="bg-gray-50 border border-gray-200 rounded-t">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Description</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Tenant</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Created</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Expires</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Status</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="border border-t-0 border-gray-200">
                    {tokensData.tokens && tokensData.tokens.map((token: MCPToken) => (
                      <tr key={token.id} className={`border-b border-gray-200 ${isExpired(token.expires_at) ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-2">{token.description}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{token.tenant_id}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{formatDate(token.created_at)}</td>
                        <td className="px-4 py-2 text-xs text-gray-600">{formatDate(token.expires_at)}</td>
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
