"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/contexts/tenant-context";
import { setRuntimeTenant, modelsApi } from "@/lib/api";
import { kgApi } from "@/lib/api";
import { KGGraph } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Eye, Pencil, Loader2, X, Link, Upload, FileText, ChevronDown } from "lucide-react";

export default function KnowledgeGraphsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { tenantId } = useTenant();

  // Update runtime tenant when it changes
  useEffect(() => {
    setRuntimeTenant(tenantId);
    queryClient.invalidateQueries({ queryKey: ["kg-graphs"] });
  }, [tenantId, queryClient]);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [createDomain, setCreateDomain] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Sources to ingest after graph creation
  const [urlInput, setUrlInput] = useState("");
  const [pendingURLs, setPendingURLs] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [extractionModel, setExtractionModel] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: graphs = [], isLoading, error: graphsError } = useQuery({
    queryKey: ["kg-graphs"],
    queryFn: () => kgApi.listGraphs(),
  });

  const { data: modelsData } = useQuery({
    queryKey: ["models-list"],
    queryFn: () => modelsApi.list(),
    staleTime: 60_000,
  });
  const availableModels = modelsData?.models ?? [];

  const { data: graphDetails = {} } = useQuery({
    queryKey: ["kg-graph-details"],
    queryFn: async () => {
      const details: Record<string, { nodeCount: number; edgeCount: number }> =
        {};
      for (const graph of graphs) {
        try {
          const nodes = await kgApi.listNodes(graph.id);
          const edges = await kgApi.listEdges(graph.id);
          details[graph.id] = {
            nodeCount: nodes.length,
            edgeCount: edges.length,
          };
        } catch (e) {
          details[graph.id] = { nodeCount: 0, edgeCount: 0 };
        }
      }
      return details;
    },
    enabled: graphs.length > 0,
  });

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true);
        try {
      const newGraph = await kgApi.createGraph({
        name: createName,
        domain: createDomain || undefined,
        description: createDescription || undefined,
      });

      // Fire ingestion in the background — don't block navigation.
      // Entity extraction can take 30-60 s per source; waiting here would freeze the UI.
      const totalSources = pendingURLs.length + pendingFiles.length;
      if (totalSources > 0) {
        const model = extractionModel || undefined;
        const urlsToIngest = [...pendingURLs];
        const filesToIngest = [...pendingFiles];
        // Run without await — errors are logged to console only
        Promise.allSettled([
          ...urlsToIngest.map((url) => kgApi.ingestURL(newGraph.id, url, model)),
          ...filesToIngest.map((file) => kgApi.ingestFile(newGraph.id, file, model)),
        ]).then((results) => {
          results.forEach((r, i) => {
            if (r.status === "rejected") {
              console.error(`[ingest] source ${i} failed:`, r.reason);
            }
          });
          // Refresh graph details once all ingestion settles
          queryClient.invalidateQueries({ queryKey: ["kg-graph-details"] });
          queryClient.invalidateQueries({ queryKey: ["kg-nodes", newGraph.id] });
          queryClient.invalidateQueries({ queryKey: ["kg-edges", newGraph.id] });
        });
      }

      // Reset form and navigate immediately — ingestion runs in the background
      setCreateOpen(false);
      setCreateName("");
      setCreateDomain("");
      setCreateDescription("");
      setPendingURLs([]);
      setPendingFiles([]);
      setExtractionModel("");
            queryClient.invalidateQueries({ queryKey: ["kg-graphs"] });

      // Go to Visualizer if sources were queued (so user can watch nodes appear),
      // otherwise go to Builder to add content.
      const tab = totalSources > 0 ? "visualizer" : "builder";
      router.push(`/knowledge-graphs/${newGraph.id}?tab=${tab}`);
    } catch (error) {
      console.error("Failed to create graph:", error);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await kgApi.deleteGraph(deleteId);
      queryClient.invalidateQueries({ queryKey: ["kg-graphs"] });
      setDeleteId(null);
    } catch (error) {
      console.error("Failed to delete graph:", error);
    } finally {
      setDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        Loading knowledge graphs...
      </div>
    );
  }

  if (graphsError) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="font-semibold text-destructive">Error loading knowledge graphs</p>
          <p className="text-sm text-destructive/80 mt-2">
            {graphsError instanceof Error ? graphsError.message : "Unknown error"}
          </p>
          <p className="text-xs text-muted-foreground mt-2">Tenant: {tenantId}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Knowledge Graphs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage domain ontologies for your agents.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(!createOpen)} className="gap-2">
          <Plus className="h-4 w-4" />
          New Graph
        </Button>
      </div>

      {createOpen && (
        <div className="border rounded-lg p-5 bg-muted/50 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">New Knowledge Graph</h3>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setCreateOpen(false); setPendingURLs([]); setPendingFiles([]); setExtractionModel(""); }}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Basic info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="name" className="text-xs">Name *</Label>
              <Input id="name" placeholder="e.g., Ledger Product Docs" value={createName} onChange={(e) => setCreateName(e.target.value)} className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="domain" className="text-xs">Domain</Label>
              <Input id="domain" placeholder="e.g., fintech, devops" value={createDomain} onChange={(e) => setCreateDomain(e.target.value)} className="h-8 text-sm" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="description" className="text-xs">Description</Label>
            <Input id="description" placeholder="Brief description of what this graph contains…" value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} className="h-8 text-sm" />
          </div>

          {/* Sources */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sources (optional)</p>

            {/* Extraction model picker */}
            <div className="space-y-1">
              <Label className="text-xs">Extraction Model</Label>
              <div className="relative">
                <select
                  value={extractionModel}
                  onChange={(e) => setExtractionModel(e.target.value)}
                  className="w-full appearance-none bg-background border border-border rounded px-2 py-1.5 text-xs pr-6 focus:outline-none focus:ring-1 focus:ring-violet-500"
                >
                  <option value="">Default (gemma4 — local)</option>
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}{m.source === "local" ? " (local)" : " (cloud)"}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              </div>
              <p className="text-[10px] text-muted-foreground">LLM used to extract entities and relationships from your sources.</p>
            </div>

            {/* URL input */}
            <div className="space-y-1.5">
              <Label className="text-xs">Add URLs</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://docs.example.com/api"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && urlInput.trim()) {
                      e.preventDefault();
                      setPendingURLs((p) => [...p, urlInput.trim()]);
                      setUrlInput("");
                    }
                  }}
                  className="h-8 text-sm"
                />
                <Button
                  type="button" size="sm" variant="outline"
                  disabled={!urlInput.trim()}
                  onClick={() => { if (urlInput.trim()) { setPendingURLs((p) => [...p, urlInput.trim()]); setUrlInput(""); } }}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              {pendingURLs.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {pendingURLs.map((url, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-full px-2 py-0.5">
                      <Link className="h-2.5 w-2.5" />{new URL(url).hostname}
                      <button onClick={() => setPendingURLs((p) => p.filter((_, j) => j !== i))} className="hover:text-white ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* File upload */}
            <div className="space-y-1.5">
              <Label className="text-xs">Upload Files</Label>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".md,.txt,.pdf,.csv"
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  setPendingFiles((p) => [...p, ...files]);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full border border-dashed border-border rounded-lg py-3 px-4 text-xs text-muted-foreground hover:border-violet-500/40 hover:text-foreground transition-colors flex items-center justify-center gap-2"
              >
                <Upload className="h-3.5 w-3.5" />
                Click to upload .md, .txt, .pdf, .csv
              </button>
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {pendingFiles.map((file, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-violet-500/10 border border-violet-500/20 text-violet-400 rounded-full px-2 py-0.5">
                      <FileText className="h-2.5 w-2.5" />{file.name}
                      <button onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))} className="hover:text-white ml-0.5">×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" size="sm" onClick={() => { setCreateOpen(false); setPendingURLs([]); setPendingFiles([]); setExtractionModel(""); }}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={creating || !createName.trim()} className="gap-1.5">
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      )}

      {graphs.length === 0 ? (
        <div className="border border-dashed rounded-lg p-12 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            No knowledge graphs yet. Create one to get started.
          </p>
          <Button onClick={() => setCreateOpen(true)} variant="outline" className="gap-2">
            <Plus className="h-4 w-4" />
            Create First Graph
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {graphs.map((graph) => {
            const details = graphDetails[graph.id];
            return (
              <div
                key={graph.id}
                className="border rounded-lg p-4 hover:shadow-lg transition-shadow space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{graph.name}</h3>
                    {graph.domain && (
                      <Badge variant="secondary" className="mt-2 text-xs">
                        {graph.domain}
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 flex-shrink-0 text-destructive hover:text-destructive"
                    onClick={() => setDeleteId(graph.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                {graph.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {graph.description}
                  </p>
                )}
                {details && (
                  <div className="flex gap-4 text-sm pt-2 border-t">
                    <div>
                      <span className="text-muted-foreground">Nodes: </span>
                      <span className="font-semibold">{details.nodeCount}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Edges: </span>
                      <span className="font-semibold">{details.edgeCount}</span>
                    </div>
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={() =>
                      router.push(`/knowledge-graphs/${graph.id}?tab=builder`)
                    }
                  >
                    <Pencil className="h-3 w-3" />
                    Build
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={() =>
                      router.push(`/knowledge-graphs/${graph.id}?tab=chat`)
                    }
                  >
                    <Eye className="h-3 w-3" />
                    Ask
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background border rounded-lg p-6 max-w-sm space-y-4">
            <div>
              <h3 className="font-semibold">Delete Knowledge Graph?</h3>
              <p className="text-sm text-muted-foreground mt-1">
                This action cannot be undone. The graph and all its nodes and edges
                will be permanently deleted.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setDeleteId(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Delete"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
