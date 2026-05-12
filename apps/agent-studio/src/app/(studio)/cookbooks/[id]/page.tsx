"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { adminApi } from "@/lib/api";
import { useTenant } from "@/contexts/tenant-context";
import { setRuntimeTenant } from "@/lib/api";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

type Tab = "overview" | "agents" | "knowledge-graphs" | "mcps";

interface ImportResult {
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

export default function CookbookDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();
  const cookbookId = params.id as string;

  const searchParams = useSearchParams();
  const activeTab = (searchParams.get("tab") ?? "overview") as Tab;
  const setActiveTab = (tab: Tab) => {
    router.replace(`/cookbooks/${cookbookId}?tab=${tab}`, { scroll: false });
  };
  const [showImportForm, setShowImportForm] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState(tenantId);
  const [importVariables, setImportVariables] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    setRuntimeTenant(tenantId);
    setSelectedTenant(tenantId);
  }, [tenantId]);

  const { data: cookbook, isLoading, isError } = useQuery({
    queryKey: ["cookbook", cookbookId],
    queryFn: () => adminApi.getCookbook(cookbookId),
  });

  const { data: tenants } = useQuery({
    queryKey: ["tenants"],
    queryFn: () => adminApi.listTenants(),
  });

  const importMutation = useMutation({
    mutationFn: () =>
      adminApi.importCookbook(cookbookId, selectedTenant, importVariables),
    onSuccess: (result) => {
      setImportResult(result as ImportResult);
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-graphs"] });
    },
  });

  const handleImportClick = () => {
    if (!cookbook) return;
    setImportResult(null);
    const vars: Record<string, string> = {};
    cookbook.variables?.forEach((v) => {
      vars[v.name] = v.default || "";
    });
    setImportVariables(vars);
    setShowImportForm(true);
  };

  const handleImportSubmit = () => {
    importMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary border-t-transparent mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading cookbook details...</p>
        </div>
      </div>
    );
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
          <div className="flex gap-2">
            <Button onClick={handleImportClick} className="whitespace-nowrap">
              Import Cookbook
            </Button>
            <Sheet open={showImportForm} onOpenChange={setShowImportForm}>
            <SheetContent className="w-full sm:max-w-md">
              <SheetHeader>
                <SheetTitle>Import {cookbook.name}</SheetTitle>
                <SheetDescription>
                  Import this cookbook into your workspace. Your tenant is pre-selected.
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="block text-sm font-medium">Tenant</label>
                  <select
                    value={selectedTenant}
                    onChange={(e) => setSelectedTenant(e.target.value)}
                    className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                    disabled
                  >
                    <option value={tenantId}>{tenantId}</option>
                  </select>
                  <p className="text-xs text-muted-foreground">Your current tenant is automatically selected</p>
                </div>

                {Object.keys(importVariables).length > 0 && (
                  <div className="space-y-3">
                    <label className="block text-sm font-medium">Configuration Variables</label>
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
                          className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {importResult && (
                  <div className="p-3 bg-green-500/10 text-green-700 rounded text-sm space-y-2">
                    <p className="font-medium">✓ Cookbook imported successfully!</p>
                    <div className="text-xs space-y-1">
                      <p>Import ID: {importResult.import_id}</p>
                      <p>Agents: {importResult.resources.agents.join(", ")}</p>
                      <p>Knowledge Graphs: {importResult.resources.knowledge_graphs.join(", ")}</p>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={handleImportSubmit}
                    disabled={importMutation.isPending}
                    className="flex-1"
                  >
                    {importMutation.isPending ? "Importing..." : "Import"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowImportForm(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>

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
                <div key={agent.file} className="bg-card border border-border rounded-lg p-4">
                  <h3 className="font-semibold font-mono text-sm">{agent.file}</h3>
                  <p className="text-muted-foreground text-sm mt-1">{agent.description}</p>
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
                <div key={kg.name} className="bg-card border border-border rounded-lg p-4">
                  <h3 className="font-semibold">{kg.name}</h3>
                  <p className="text-muted-foreground text-sm mt-1">{kg.description}</p>
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
