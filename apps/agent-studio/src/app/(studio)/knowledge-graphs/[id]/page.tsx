"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/contexts/tenant-context";
import { setRuntimeTenant, modelsApi } from "@/lib/api";
import { kgApi } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ChevronLeft,
  ChevronDown,
  Loader2,
  Plus,
  Link,
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { KGChatPanel } from "@/components/kg-chat-panel";
import { KGVisualizer } from "@/components/kg-visualizer";

export default function KnowledgeGraphDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || "chat";
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();

  const [resolvedParams, setResolvedParams] = useState<{ id: string } | null>(null);
  useEffect(() => {
    if (params instanceof Promise) {
      params.then(setResolvedParams);
    } else {
      setResolvedParams(params as { id: string });
    }
  }, [params]);

  const graphId = resolvedParams?.id;

  useEffect(() => {
    setRuntimeTenant(tenantId);
    if (graphId) {
      queryClient.invalidateQueries({ queryKey: ["kg-graph", graphId] });
    }
  }, [tenantId, graphId, queryClient]);

  const { data: graph, isLoading, error: graphError } = useQuery({
    queryKey: ["kg-graph", graphId],
    queryFn: () => {
      if (!graphId) throw new Error("Graph ID not loaded");
      return kgApi.getGraph(graphId);
    },
    enabled: !!graphId,
  });

  const { data: modelsData } = useQuery({
    queryKey: ["models-list"],
    queryFn: () => modelsApi.list(),
    staleTime: 60_000,
  });
  const availableModels = modelsData?.models ?? [];

  if (!graphId) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading graph...
      </div>
    );
  }

  if (graphError) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-destructive font-semibold">Error loading graph</p>
          <p className="text-sm text-muted-foreground mt-2">
            {graphError instanceof Error ? graphError.message : "Unknown error"}
          </p>
          <Button variant="outline" className="mt-4" onClick={() => router.push("/knowledge-graphs")}>
            Back to Graphs
          </Button>
        </div>
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-muted-foreground">Graph not found</p>
          <Button variant="outline" className="mt-4" onClick={() => router.push("/knowledge-graphs")}>
            Back to Graphs
          </Button>
        </div>
      </div>
    );
  }

  const handleTabChange = (newTab: string) => {
    router.push(`/knowledge-graphs/${graphId}?tab=${newTab}`);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() => router.push("/knowledge-graphs")}
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{graph.name}</h1>
              {graph.domain && <Badge variant="secondary">{graph.domain}</Badge>}
            </div>
            {graph.description && (
              <p className="text-sm text-muted-foreground mt-1">{graph.description}</p>
            )}
          </div>
        </div>
      </div>

      {/* Tab buttons */}
      <div className="border-b px-6 pt-4 flex gap-2">
        {([
            { key: "chat",       label: "Chat" },
            { key: "builder",    label: "Builder" },
            { key: "visualizer", label: "Visualizer" },
          ] as const).map(({ key, label }) => (
          <Button
            key={key}
            variant={tab === key ? "default" : "outline"}
            size="sm"
            onClick={() => handleTabChange(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === "chat" && <KGChatPanel graphId={graphId} />}
        {tab === "builder" && (
          <IngestTab
            graphId={graphId}
            availableModels={availableModels}
            onIngestComplete={() => {
              queryClient.invalidateQueries({ queryKey: ["kg-nodes", graphId] });
              queryClient.invalidateQueries({ queryKey: ["kg-edges", graphId] });
              queryClient.invalidateQueries({ queryKey: ["kg-graph-details"] });
            }}
          />
        )}
        {tab === "visualizer" && <KGVisualizer graphId={graphId} mode="explore" />}
      </div>
    </div>
  );
}

// ── Ingest tab ────────────────────────────────────────────────────────────────

interface ModelInfo { id: string; name: string; source: string }

function IngestTab({
  graphId,
  availableModels,
  onIngestComplete,
}: {
  graphId: string;
  availableModels: ModelInfo[];
  onIngestComplete: () => void;
}) {
  const [urlInput, setUrlInput] = useState("");
  const [pendingURLs, setPendingURLs] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [extractionModel, setExtractionModel] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const [status, setStatus] = useState<{
    done: number;
    total: number;
    results: Array<{ label: string; nodes: number; edges: number; error?: string }>;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleIngest = async () => {
    const total = pendingURLs.length + pendingFiles.length;
    if (total === 0) return;
    setIngesting(true);
    setStatus({ done: 0, total, results: [] });

    const model = extractionModel || undefined;
    const results: Array<{ label: string; nodes: number; edges: number; error?: string }> = [];
    let done = 0;

    for (const url of pendingURLs) {
      try {
        const res = await kgApi.ingestURL(graphId, url, model);
        results.push({ label: new URL(url).hostname, nodes: res.nodes_created, edges: res.edges_created });
      } catch (e) {
        results.push({ label: url, nodes: 0, edges: 0, error: e instanceof Error ? e.message : "Failed" });
      }
      done++;
      setStatus({ done, total, results: [...results] });
    }

    for (const file of pendingFiles) {
      try {
        const res = await kgApi.ingestFile(graphId, file, model);
        results.push({ label: file.name, nodes: res.nodes_created, edges: res.edges_created });
      } catch (e) {
        results.push({ label: file.name, nodes: 0, edges: 0, error: e instanceof Error ? e.message : "Failed" });
      }
      done++;
      setStatus({ done, total, results: [...results] });
    }

    setPendingURLs([]);
    setPendingFiles([]);
    setIngesting(false);
    onIngestComplete();
  };

  const isComplete = status !== null && status.done === status.total && !ingesting;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6 overflow-y-auto h-full">
      <div>
        <h2 className="text-lg font-semibold">Add Content to Graph</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Upload files or point to URLs. The extraction model reads each source and
          converts it into named entities and relationships.
        </p>
      </div>

      {/* Model picker */}
      <div className="space-y-1.5">
        <Label className="text-xs">Extraction Model</Label>
        <div className="relative">
          <select
            value={extractionModel}
            onChange={(e) => setExtractionModel(e.target.value)}
            disabled={ingesting}
            className="w-full appearance-none bg-background border border-border rounded px-3 py-2 text-sm pr-8 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50"
          >
            <option value="">Default (gemma4 — local)</option>
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}{m.source === "local" ? " (local)" : " (cloud)"}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        </div>
        <p className="text-[11px] text-muted-foreground">
          LLM used to extract entities and relationships. Local models are free; cloud models require API keys.
        </p>
      </div>

      {/* URL input */}
      <div className="space-y-2">
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
            disabled={ingesting}
            className="text-sm h-9"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9"
            disabled={!urlInput.trim() || ingesting}
            onClick={() => { if (urlInput.trim()) { setPendingURLs((p) => [...p, urlInput.trim()]); setUrlInput(""); } }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {pendingURLs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
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
      <div className="space-y-2">
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
          disabled={ingesting}
          className="w-full border border-dashed border-border rounded-lg py-4 px-4 text-xs text-muted-foreground hover:border-violet-500/40 hover:text-foreground transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          Click to upload .md, .txt, .pdf, .csv
        </button>
        {pendingFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pendingFiles.map((file, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-[11px] bg-violet-500/10 border border-violet-500/20 text-violet-400 rounded-full px-2 py-0.5">
                <FileText className="h-2.5 w-2.5" />{file.name}
                <button onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))} className="hover:text-white ml-0.5">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Ingest button */}
      <Button
        onClick={handleIngest}
        disabled={ingesting || (pendingURLs.length === 0 && pendingFiles.length === 0)}
        className="gap-2"
      >
        {ingesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {ingesting ? `Extracting ${status?.done ?? 0} / ${status?.total ?? 0}…` : "Extract & Index"}
      </Button>

      {/* Progress / results */}
      {status && status.results.length > 0 && (
        <div className="border rounded-lg divide-y">
          {status.results.map((r, i) => (
            <div key={i} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                {r.error
                  ? <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  : <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />}
                <span className="text-sm truncate">{r.label}</span>
              </div>
              {r.error
                ? <span className="text-xs text-destructive shrink-0">{r.error}</span>
                : <span className="text-xs text-muted-foreground shrink-0">
                    {r.nodes} nodes · {r.edges} edges
                  </span>}
            </div>
          ))}
          {isComplete && (
            <div className="px-4 py-3 bg-muted/30">
              <p className="text-xs text-muted-foreground">
                Total: <strong className="text-foreground">{status.results.reduce((s, r) => s + r.nodes, 0)} nodes</strong>
                {" · "}
                <strong className="text-foreground">{status.results.reduce((s, r) => s + r.edges, 0)} edges</strong>
                {" "}added to graph.{" "}
                <button className="text-violet-400 hover:underline" onClick={() => setStatus(null)}>Clear</button>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
