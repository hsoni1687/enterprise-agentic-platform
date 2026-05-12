"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { adminApi, CookbookDetail } from "@/lib/api";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

type Tab = "overview" | "agents" | "knowledge-graphs" | "mcps";

export default function CookbookDetailPage() {
  const params = useParams();
  const router = useRouter();
  const cookbookId = params.id as string;

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [importSheetOpen, setImportSheetOpen] = useState(false);
  const [editingFile, setEditingFile] = useState<{ type: string; path: string; content: string } | null>(null);
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
      setEditingFile(null);
      setEditError(null);
    },
    onError: (err) => {
      setEditError(err instanceof Error ? err.message : "Save failed");
    },
  });

  const importMutation = useMutation({
    mutationFn: () =>
      adminApi.importCookbook(cookbookId, selectedTenant, importVariables),
    onSuccess: () => {
      setImportSheetOpen(false);
      alert("Cookbook imported successfully");
      router.push("/cookbooks");
    },
  });

  const handleStartEdit = (type: string, path: string, content: string) => {
    setEditingFile({ type, path, content });
    setEditContent(content);
    setEditError(null);
  };

  const handleSaveEdit = () => {
    updateFileMutation.mutate({ path: editingFile!.path, content: editContent });
  };

  const handleImportClick = () => {
    if (!cookbook) return;
    setSelectedTenant("");
    const vars: Record<string, string> = {};
    cookbook.variables?.forEach((v) => {
      vars[v.name] = v.default || "";
    });
    setImportVariables(vars);
    setImportSheetOpen(true);
  };

  if (isLoading) {
    return <div className="p-6">Loading cookbook details...</div>;
  }

  if (isError || !cookbook) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h2 className="font-semibold text-red-900 mb-2">Error</h2>
          <p className="text-red-700 text-sm">Failed to load cookbook details</p>
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
    <div className="p-6 max-w-6xl">
      <Link href="/cookbooks" className="text-blue-600 hover:underline mb-4 inline-block">
        ← Back to Cookbooks
      </Link>

      <div className="mt-6 mb-8">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h1 className="text-4xl font-bold">{cookbook.name}</h1>
            <p className="text-gray-600 text-lg mt-2">{cookbook.description}</p>
            <div className="flex gap-2 mt-4">
              <span className="inline-block bg-blue-100 text-blue-800 text-xs px-3 py-1 rounded">
                {cookbook.domain}
              </span>
              <span className="inline-block bg-gray-100 text-gray-800 text-xs px-3 py-1 rounded">
                v{cookbook.version}
              </span>
              {cookbook.tags?.map((tag) => (
                <span key={tag} className="inline-block bg-green-100 text-green-800 text-xs px-3 py-1 rounded">
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <Sheet open={importSheetOpen} onOpenChange={setImportSheetOpen}>
            <SheetTrigger asChild>
              <Button onClick={handleImportClick} className="bg-blue-600 text-white hover:bg-blue-700">
                Import Cookbook
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Import {cookbook.name}</SheetTitle>
                <SheetDescription>Choose a tenant and configure variables</SheetDescription>
              </SheetHeader>

              <div className="space-y-6 mt-6">
                <div>
                  <label className="block text-sm font-medium mb-2">Tenant</label>
                  <select
                    value={selectedTenant}
                    onChange={(e) => setSelectedTenant(e.target.value)}
                    className="w-full border rounded px-3 py-2 bg-white text-gray-900"
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
                  <div>
                    <h3 className="font-semibold mb-4">Configuration Variables</h3>
                    {cookbook.variables?.map((variable) => (
                      <div key={variable.name} className="mb-4">
                        <label className="block text-sm font-medium mb-1">{variable.name}</label>
                        <p className="text-xs text-gray-600 mb-2">{variable.description}</p>
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
                          className="w-full border rounded px-3 py-2 text-sm bg-white text-gray-900"
                        />
                      </div>
                    ))}
                  </div>
                )}

                <Button
                  onClick={() => importMutation.mutate()}
                  disabled={importMutation.isPending || !selectedTenant}
                  className="w-full"
                >
                  {importMutation.isPending ? "Importing..." : "Import Cookbook"}
                </Button>

                {importMutation.isError && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-sm text-red-700">
                      {importMutation.error instanceof Error
                        ? importMutation.error.message
                        : "Import failed"}
                    </p>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-8">
          {tabButtons.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.value
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div>
        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h3 className="font-semibold mb-4">Variables</h3>
              {cookbook.variables?.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium">Name</th>
                        <th className="text-left px-4 py-2 font-medium">Description</th>
                        <th className="text-left px-4 py-2 font-medium">Default</th>
                        <th className="text-left px-4 py-2 font-medium">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cookbook.variables.map((v) => (
                        <tr key={v.name} className="border-t border-gray-200">
                          <td className="px-4 py-2 font-mono">{v.name}</td>
                          <td className="px-4 py-2">{v.description}</td>
                          <td className="px-4 py-2">{v.default}</td>
                          <td className="px-4 py-2">{v.type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-500">No variables</p>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h3 className="font-semibold mb-4">Artifacts Summary</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-2xl font-bold">{cookbook.agents?.length || 0}</div>
                  <div className="text-sm text-gray-600">Agents</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{cookbook.knowledge_graphs?.length || 0}</div>
                  <div className="text-sm text-gray-600">Knowledge Graphs</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">{cookbook.mcp_recommendations?.length || 0}</div>
                  <div className="text-sm text-gray-600">MCP Recommendations</div>
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
                <div key={agent.file} className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold font-mono text-sm">{agent.file}</h3>
                      <p className="text-gray-600 text-sm mt-1">{agent.description}</p>
                    </div>
                    <Sheet
                      open={editingFile?.file === agent.file}
                      onOpenChange={(open) => {
                        if (!open) setEditingFile(null);
                      }}
                    >
                      <SheetTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStartEdit("agent", agent.file, agent.content)}
                        >
                          Edit YAML
                        </Button>
                      </SheetTrigger>
                      <SheetContent className="w-2/3">
                        <SheetHeader>
                          <SheetTitle>Edit {agent.file}</SheetTitle>
                        </SheetHeader>

                        <div className="space-y-4 mt-6">
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="w-full border rounded p-2 font-mono text-xs bg-white text-gray-900"
                            rows={30}
                          />

                          {editError && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                              <p className="text-sm text-red-700">{editError}</p>
                            </div>
                          )}

                          <Button
                            onClick={handleSaveEdit}
                            disabled={updateFileMutation.isPending}
                            className="w-full"
                          >
                            {updateFileMutation.isPending ? "Saving..." : "Save Changes"}
                          </Button>
                        </div>
                      </SheetContent>
                    </Sheet>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500">No agents</p>
            )}
          </div>
        )}

        {/* Knowledge Graphs Tab */}
        {activeTab === "knowledge-graphs" && (
          <div className="space-y-4">
            {cookbook.knowledge_graphs?.length > 0 ? (
              cookbook.knowledge_graphs.map((kg) => (
                <div key={kg.name} className="bg-white border border-gray-200 rounded-lg p-4">
                  <h3 className="font-semibold">{kg.name}</h3>
                  <p className="text-gray-600 text-sm mt-1">{kg.description}</p>
                  <div className="flex gap-2 mt-4">
                    <Sheet>
                      <SheetTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStartEdit("kg-schema", kg.schema_file, kg.schema_content)}
                        >
                          Edit Schema
                        </Button>
                      </SheetTrigger>
                      <SheetContent className="w-2/3">
                        <SheetHeader>
                          <SheetTitle>Edit {kg.schema_file}</SheetTitle>
                        </SheetHeader>

                        <div className="space-y-4 mt-6">
                          <textarea
                            value={editingFile?.path === kg.schema_file ? editContent : kg.schema_content}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="w-full border rounded p-2 font-mono text-xs bg-white text-gray-900"
                            rows={30}
                            onFocus={() => handleStartEdit("kg-schema", kg.schema_file, kg.schema_content)}
                          />

                          {editError && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                              <p className="text-sm text-red-700">{editError}</p>
                            </div>
                          )}

                          <Button
                            onClick={handleSaveEdit}
                            disabled={updateFileMutation.isPending}
                            className="w-full"
                          >
                            {updateFileMutation.isPending ? "Saving..." : "Save Changes"}
                          </Button>
                        </div>
                      </SheetContent>
                    </Sheet>

                    <Sheet>
                      <SheetTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStartEdit("kg-seed", kg.seed_data_file, kg.seed_content)}
                        >
                          Edit Seed Data
                        </Button>
                      </SheetTrigger>
                      <SheetContent className="w-2/3">
                        <SheetHeader>
                          <SheetTitle>Edit {kg.seed_data_file}</SheetTitle>
                        </SheetHeader>

                        <div className="space-y-4 mt-6">
                          <textarea
                            value={editingFile?.path === kg.seed_data_file ? editContent : kg.seed_content}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="w-full border rounded p-2 font-mono text-xs bg-white text-gray-900"
                            rows={30}
                            onFocus={() => handleStartEdit("kg-seed", kg.seed_data_file, kg.seed_content)}
                          />

                          {editError && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                              <p className="text-sm text-red-700">{editError}</p>
                            </div>
                          )}

                          <Button
                            onClick={handleSaveEdit}
                            disabled={updateFileMutation.isPending}
                            className="w-full"
                          >
                            {updateFileMutation.isPending ? "Saving..." : "Save Changes"}
                          </Button>
                        </div>
                      </SheetContent>
                    </Sheet>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500">No knowledge graphs</p>
            )}
          </div>
        )}

        {/* MCPs Tab */}
        {activeTab === "mcps" && (
          <div className="space-y-4">
            {cookbook.mcp_recommendations?.length > 0 ? (
              cookbook.mcp_recommendations.map((mcp) => (
                <div key={mcp.name} className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{mcp.name}</h3>
                      <p className="text-gray-600 text-sm mt-1">{mcp.description}</p>
                    </div>
                    {mcp.required && (
                      <span className="inline-block bg-red-100 text-red-800 text-xs px-2 py-1 rounded">
                        Required
                      </span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500">No MCP recommendations</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
