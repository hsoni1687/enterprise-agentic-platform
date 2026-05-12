"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { adminApi } from "@/lib/api";

type Tab = "overview" | "agents" | "knowledge-graphs" | "mcps";

export default function CookbookDetailPage() {
  const params = useParams();
  const router = useRouter();
  const cookbookId = params.id as string;

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [showImportForm, setShowImportForm] = useState(false);
  const [editingFilePath, setEditingFilePath] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const [selectedTenant, setSelectedTenant] = useState("");
  const [importVariables, setImportVariables] = useState<Record<string, string>>({});

  const { data: cookbook, isLoading, isError } = useQuery({
    queryKey: ["cookbook", cookbookId],
    queryFn: () => adminApi.getCookbook(cookbookId),
  });

  const { data: tenants } = useQuery({
    queryKey: ["tenants"],
    queryFn: () => adminApi.listTenants(),
  });

  const updateFileMutation = useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      adminApi.updateCookbookFile(cookbookId, path, content),
    onSuccess: () => {
      setEditingFilePath(null);
      setEditError(null);
      alert("File saved successfully");
    },
    onError: (err) => {
      setEditError(err instanceof Error ? err.message : "Save failed");
    },
  });

  const importMutation = useMutation({
    mutationFn: () =>
      adminApi.importCookbook(cookbookId, selectedTenant, importVariables),
    onSuccess: () => {
      setShowImportForm(false);
      alert("Cookbook imported successfully");
      router.push("/cookbooks");
    },
    onError: (err) => {
      alert(err instanceof Error ? err.message : "Import failed");
    },
  });

  const handleStartEdit = (path: string, content: string) => {
    setEditingFilePath(path);
    setEditContent(content);
    setEditError(null);
  };

  const handleSaveEdit = () => {
    if (!editingFilePath) return;
    updateFileMutation.mutate({ path: editingFilePath, content: editContent });
  };

  const handleImportClick = () => {
    if (!cookbook) return;
    setSelectedTenant("");
    const vars: Record<string, string> = {};
    cookbook.variables?.forEach((v) => {
      vars[v.name] = v.default || "";
    });
    setImportVariables(vars);
    setShowImportForm(true);
  };

  if (isLoading) {
    return <div className="p-6">Loading cookbook details...</div>;
  }

  if (isError || !cookbook) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-md">
          <AlertCircle className="h-4 w-4" />
          <span>Failed to load cookbook details</span>
        </div>
      </div>
    );
  }

  const tabButtons: { label: string; value: Tab }[] = [
    { label: "Overview", value: "overview" },
    { label: `Agents (${cookbook.agents?.length || 0})`, value: "agents" },
    { label: `Knowledge Graphs (${cookbook.knowledge_graphs?.length || 0})`, value: "knowledge-graphs" },
    { label: `MCPs (${cookbook.mcp_recommendations?.length || 0})`, value: "mcps" },
  ];

  return (
    <div className="space-y-6">
      <Link href="/cookbooks" className="text-primary hover:underline inline-block">
        ← Back to Cookbooks
      </Link>

      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h1 className="text-3xl font-bold">{cookbook.name}</h1>
            <p className="text-muted-foreground mt-2">{cookbook.description}</p>
            <div className="flex gap-2 mt-4 flex-wrap">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                {cookbook.domain}
              </span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                v{cookbook.version}
              </span>
              {cookbook.tags?.map((tag) => (
                <span key={tag} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={handleImportClick}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium text-sm whitespace-nowrap"
          >
            Import Cookbook
          </button>
        </div>
      </div>

      {/* Import Form */}
      {showImportForm && (
        <div className="bg-card border border-border rounded-lg p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Import {cookbook.name}</h2>
            <button onClick={() => setShowImportForm(false)} className="text-2xl hover:opacity-60">
              ×
            </button>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">Tenant</label>
            <select
              value={selectedTenant}
              onChange={(e) => setSelectedTenant(e.target.value)}
              className="w-full px-3 py-2 border border-border rounded-md bg-card text-foreground"
            >
              <option value="">Select a tenant...</option>
              {tenants?.tenants?.map((t: any) => (
                <option key={t.tenant_id} value={t.tenant_id}>
                  {t.display_name} ({t.tenant_id})
                </option>
              ))}
            </select>
          </div>

          {Object.keys(importVariables).length > 0 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-sm">Configuration Variables</h3>
              {cookbook.variables?.map((variable) => (
                <div key={variable.name} className="space-y-1.5">
                  <label className="block text-sm font-medium">{variable.name}</label>
                  <p className="text-xs text-muted-foreground">{variable.description}</p>
                  <input
                    type={variable.type === "string" ? "text" : "number"}
                    value={importVariables[variable.name] || ""}
                    onChange={(e) =>
                      setImportVariables({
                        ...importVariables,
                        [variable.name]: e.target.value,
                      })
                    }
                    placeholder={variable.default}
                    className="w-full px-3 py-2 border border-border rounded-md bg-card text-foreground text-sm"
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending || !selectedTenant}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importMutation.isPending ? "Importing..." : "Import Cookbook"}
            </button>
            <button
              onClick={() => setShowImportForm(false)}
              className="flex-1 px-4 py-2 border border-border rounded-md hover:bg-muted font-medium text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-8">
          {tabButtons.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.value
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-semibold mb-4">Variables</h3>
              {cookbook.variables?.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 border-b border-border">
                      <tr>
                        <th className="text-left p-3 font-semibold">Name</th>
                        <th className="text-left p-3 font-semibold">Description</th>
                        <th className="text-left p-3 font-semibold">Default</th>
                        <th className="text-left p-3 font-semibold">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cookbook.variables.map((v) => (
                        <tr key={v.name} className="border-b border-border hover:bg-muted/50">
                          <td className="p-3 font-mono text-xs">{v.name}</td>
                          <td className="p-3">{v.description}</td>
                          <td className="p-3">{v.default}</td>
                          <td className="p-3">{v.type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No variables</p>
              )}
            </div>

            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-semibold mb-4">Artifacts Summary</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-2xl font-bold">{cookbook.agents?.length || 0}</div>
                  <div className="text-sm text-muted-foreground">Agents</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{cookbook.knowledge_graphs?.length || 0}</div>
                  <div className="text-sm text-muted-foreground">Knowledge Graphs</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{cookbook.mcp_recommendations?.length || 0}</div>
                  <div className="text-sm text-muted-foreground">MCP Recommendations</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Agents Tab */}
        {activeTab === "agents" && (
          <div className="space-y-4">
            {cookbook.agents?.length > 0 ? (
              cookbook.agents.map((agent) => (
                <div key={agent.file} className="bg-card border border-border rounded-lg p-4 space-y-3">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1">
                      <h3 className="font-semibold font-mono text-sm">{agent.file}</h3>
                      <p className="text-muted-foreground text-sm mt-1">{agent.description}</p>
                    </div>
                    <button
                      onClick={() => handleStartEdit(agent.file, agent.content)}
                      className="px-3 py-1.5 border border-primary text-primary rounded text-sm font-medium hover:bg-primary/5"
                    >
                      Edit YAML
                    </button>
                  </div>

                  {editingFilePath === agent.file && (
                    <div className="border-t border-border pt-3 space-y-2">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-md bg-muted font-mono text-xs h-64 text-foreground"
                      />
                      {editError && (
                        <div className="flex items-start gap-2 p-3 bg-destructive/10 text-destructive rounded text-sm">
                          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                          <p>{editError}</p>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveEdit}
                          disabled={updateFileMutation.isPending}
                          className="flex-1 px-3 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                        >
                          {updateFileMutation.isPending ? "Saving..." : "Save Changes"}
                        </button>
                        <button
                          onClick={() => setEditingFilePath(null)}
                          className="flex-1 px-3 py-2 border border-border rounded text-sm font-medium hover:bg-muted"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="text-muted-foreground text-sm">No agents</p>
            )}
          </div>
        )}

        {/* Knowledge Graphs Tab */}
        {activeTab === "knowledge-graphs" && (
          <div className="space-y-4">
            {cookbook.knowledge_graphs?.length > 0 ? (
              cookbook.knowledge_graphs.map((kg) => (
                <div key={kg.name} className="bg-card border border-border rounded-lg p-4 space-y-3">
                  <div>
                    <h3 className="font-semibold">{kg.name}</h3>
                    <p className="text-muted-foreground text-sm mt-1">{kg.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleStartEdit(kg.schema_file, kg.schema_content)}
                      className="px-3 py-1.5 border border-primary text-primary rounded text-sm font-medium hover:bg-primary/5"
                    >
                      Edit Schema
                    </button>
                    <button
                      onClick={() => handleStartEdit(kg.seed_data_file, kg.seed_content)}
                      className="px-3 py-1.5 border border-primary text-primary rounded text-sm font-medium hover:bg-primary/5"
                    >
                      Edit Seed Data
                    </button>
                  </div>

                  {(editingFilePath === kg.schema_file || editingFilePath === kg.seed_data_file) && (
                    <div className="border-t border-border pt-3 space-y-2">
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full px-3 py-2 border border-border rounded-md bg-muted font-mono text-xs h-64 text-foreground"
                      />
                      {editError && (
                        <div className="flex items-start gap-2 p-3 bg-destructive/10 text-destructive rounded text-sm">
                          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                          <p>{editError}</p>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveEdit}
                          disabled={updateFileMutation.isPending}
                          className="flex-1 px-3 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                        >
                          {updateFileMutation.isPending ? "Saving..." : "Save Changes"}
                        </button>
                        <button
                          onClick={() => setEditingFilePath(null)}
                          className="flex-1 px-3 py-2 border border-border rounded text-sm font-medium hover:bg-muted"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="text-muted-foreground text-sm">No knowledge graphs</p>
            )}
          </div>
        )}

        {/* MCPs Tab */}
        {activeTab === "mcps" && (
          <div className="space-y-4">
            {cookbook.mcp_recommendations?.length > 0 ? (
              cookbook.mcp_recommendations.map((mcp) => (
                <div key={mcp.name} className="bg-card border border-border rounded-lg p-4 flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold">{mcp.name}</h3>
                    <p className="text-muted-foreground text-sm mt-1">{mcp.description}</p>
                  </div>
                  {mcp.required && (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
                      Required
                    </span>
                  )}
                </div>
              ))
            ) : (
              <p className="text-muted-foreground text-sm">No MCP recommendations</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
