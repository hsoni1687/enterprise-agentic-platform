"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Cable, Plus, Play, Loader2, CheckCircle2, XCircle, Circle,
  ChevronRight, Terminal, Clock, Server, Wrench,
} from "lucide-react";
import { mcpApi } from "@/lib/api";
import { MCPServer } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MCPTool {
  name: string;
  description: string;
  input_schema: unknown;
}

interface ExecutionTrace {
  timestamp: string;
  server: string;
  tool: string;
  input: string;
  result?: unknown;
  error?: string;
  duration_ms?: number;
  status: "pending" | "success" | "error";
}

// ── AddServerSheet ────────────────────────────────────────────────────────────

function AddServerSheet({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [scope, setScope] = useState("tenant");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      mcpApi.createServer({ name: name.trim(), url: url.trim(), scope, enabled: true }),
    onSuccess: () => { setOpen(false); setName(""); setUrl(""); onAdded(); },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed to add server"),
  });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button size="sm" className="gap-1.5" />}>
        <Plus className="h-4 w-4" />
        Add Server
      </SheetTrigger>
      <SheetContent className="w-[420px]">
        <SheetHeader>
          <SheetTitle>Add MCP Server</SheetTitle>
        </SheetHeader>
        <div className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Server Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-mcp-server" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>URL</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:8090" />
            <p className="text-xs text-muted-foreground">The MCP server endpoint URL.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Scope</Label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="tenant">Tenant</option>
              <option value="global">Global (all tenants)</option>
            </select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !name.trim() || !url.trim()}
            className="mt-2"
          >
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Server
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── ServerCard ────────────────────────────────────────────────────────────────

function ServerCard({
  server,
  selected,
  onClick,
}: {
  server: MCPServer;
  selected: boolean;
  onClick: () => void;
}) {
  const qc = useQueryClient();
  const toggleMutation = useMutation({
    mutationFn: () => mcpApi.toggleServer(server.id, !server.enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mcp-servers"] }),
  });

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-4 transition-all duration-200 ${
        selected
          ? "border-violet-500/50 bg-violet-500/5 shadow-sm shadow-violet-500/10"
          : "border-border bg-card hover:border-violet-500/30 hover:bg-muted/30"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
            server.enabled ? "bg-green-500/15" : "bg-muted"
          }`}>
            <Server className={`h-4 w-4 ${server.enabled ? "text-green-400" : "text-muted-foreground"}`} />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{server.name}</p>
            <p className="text-xs text-muted-foreground truncate">{server.url}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="text-xs">{server.scope}</Badge>
          {server.enabled ? (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Active
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Circle className="h-3.5 w-3.5" /> Disabled
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between mt-3">
        <p className="text-[10px] text-muted-foreground">
          Added {new Date(server.created_at).toLocaleDateString()}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); toggleMutation.mutate(); }}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {toggleMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (server.enabled ? "Disable" : "Enable")}
          </button>
          {selected && <ChevronRight className="h-3.5 w-3.5 text-violet-400" />}
        </div>
      </div>
    </button>
  );
}

// ── Playground ────────────────────────────────────────────────────────────────

function MCPPlayground({ server }: { server: MCPServer }) {
  const [selectedTool, setSelectedTool] = useState<MCPTool | null>(null);
  const [inputJson, setInputJson] = useState("{}");
  const [traces, setTraces] = useState<ExecutionTrace[]>([]);

  const { data: toolsData, isLoading: toolsLoading, isError: toolsError } = useQuery({
    queryKey: ["mcp-tools", server.id],
    queryFn: () => mcpApi.listTools(server.id),
    retry: 1,
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      const input = JSON.parse(inputJson) as Record<string, unknown>;
      return mcpApi.executeTool(server.id, selectedTool!.name, input);
    },
    onMutate: () => {
      setTraces((prev) => [
        {
          timestamp: new Date().toISOString(),
          server: server.name,
          tool: selectedTool!.name,
          input: inputJson,
          status: "pending",
        },
        ...prev,
      ]);
    },
    onSuccess: (data) => {
      setTraces((prev) => {
        const updated = [...prev];
        updated[0] = { ...updated[0], result: data.result, duration_ms: data.duration_ms, status: "success" };
        return updated;
      });
    },
    onError: (e) => {
      setTraces((prev) => {
        const updated = [...prev];
        updated[0] = { ...updated[0], error: e instanceof Error ? e.message : "Execution failed", status: "error" };
        return updated;
      });
    },
  });

  const tools = toolsData?.tools ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Terminal className="h-4 w-4 text-violet-400" />
        <h3 className="font-medium text-sm">Interactive Playground</h3>
        <Badge variant="outline" className="text-xs">{server.name}</Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tool selector */}
        <div className="playground-panel p-4 space-y-3">
          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Available Tools</p>
          {toolsLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Connecting to {server.url}…
            </div>
          )}
          {toolsError && (
            <div className="flex items-center gap-2 text-sm text-destructive py-2">
              <XCircle className="h-4 w-4" />
              Cannot reach server. Is it running?
            </div>
          )}
          {!toolsLoading && !toolsError && tools.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">No tools exposed by this server.</p>
          )}
          <div className="space-y-1.5">
            {tools.map((tool) => (
              <button
                key={tool.name}
                onClick={() => { setSelectedTool(tool); setInputJson("{}"); }}
                className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                  selectedTool?.name === tool.name
                    ? "border-violet-500/50 bg-violet-500/10"
                    : "border-border hover:border-violet-500/30 hover:bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="font-mono text-xs font-medium">{tool.name}</span>
                </div>
                {tool.description && (
                  <p className="text-xs text-muted-foreground mt-1 ml-5.5 line-clamp-2">{tool.description}</p>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Input + execute */}
        <div className="playground-panel p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Input</p>
            {selectedTool && (
              <Badge variant="secondary" className="text-xs font-mono">{selectedTool.name}</Badge>
            )}
          </div>
          {!selectedTool ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Select a tool to test it.</p>
          ) : (
            <>
              {selectedTool.input_schema && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">View schema</summary>
                  <pre className="mt-2 rounded bg-muted p-2 overflow-auto max-h-32 text-xs">
                    {JSON.stringify(selectedTool.input_schema, null, 2)}
                  </pre>
                </details>
              )}
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">JSON Input</Label>
                <textarea
                  value={inputJson}
                  onChange={(e) => setInputJson(e.target.value)}
                  rows={6}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="{}"
                />
              </div>
              <Button
                onClick={() => {
                  try { JSON.parse(inputJson); executeMutation.mutate(); }
                  catch { alert("Invalid JSON input"); }
                }}
                disabled={executeMutation.isPending || !server.enabled}
                className="w-full gap-2"
              >
                {executeMutation.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</>
                  : <><Play className="h-4 w-4" /> Execute</>
                }
              </Button>
              {!server.enabled && (
                <p className="text-xs text-muted-foreground text-center">Enable the server to execute tools.</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Execution history */}
      {traces.length > 0 && (
        <div className="playground-panel p-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">Execution Trace</p>
            <button
              onClick={() => setTraces([])}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
          <div className="space-y-2 max-h-72 overflow-auto">
            {traces.map((trace, i) => (
              <div key={i} className="rounded-lg border border-border bg-muted/30 p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {trace.status === "pending" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                    {trace.status === "success" && <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />}
                    {trace.status === "error" && <XCircle className="h-3.5 w-3.5 text-destructive" />}
                    <span className="font-mono font-medium">{trace.tool}</span>
                    <span className="text-muted-foreground">on {trace.server}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {trace.duration_ms !== undefined && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />{trace.duration_ms}ms
                      </span>
                    )}
                    <span>{new Date(trace.timestamp).toLocaleTimeString()}</span>
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground">Input: </span>
                  <span className="font-mono">{trace.input.length > 80 ? trace.input.slice(0, 80) + "…" : trace.input}</span>
                </div>
                {trace.status === "success" && trace.result !== undefined && (
                  <details>
                    <summary className="cursor-pointer text-green-400">Result</summary>
                    <pre className="mt-1 rounded bg-muted p-2 overflow-auto max-h-40">
                      {JSON.stringify(trace.result, null, 2)}
                    </pre>
                  </details>
                )}
                {trace.status === "error" && (
                  <p className="text-destructive">{trace.error}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MCPPage() {
  const qc = useQueryClient();
  const [selectedServer, setSelectedServer] = useState<MCPServer | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["mcp-servers"],
    queryFn: () => mcpApi.listServers(),
  });

  const servers = data?.servers ?? [];
  const activeCount = servers.filter((s) => s.enabled).length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500/15">
              <Cable className="h-4 w-4 text-teal-400" />
            </div>
            <h1 className="text-xl font-semibold">MCP Servers</h1>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl">
            Connect Model Context Protocol servers to expose tools, resources, and prompts to your agents.
          </p>
        </div>
        <AddServerSheet onAdded={() => qc.invalidateQueries({ queryKey: ["mcp-servers"] })} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Servers", value: servers.length },
          { label: "Active", value: activeCount },
          { label: "Disabled", value: servers.length - activeCount },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      <Separator />

      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load MCP servers. Is mcp-registry running on :8090?
        </div>
      )}

      {!isLoading && !isError && servers.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mb-4">
            <Cable className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No MCP servers connected</p>
          <p className="text-xs text-muted-foreground mt-1">Add a server to start exposing tools to your agents.</p>
        </div>
      )}

      {!isLoading && !isError && servers.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Server list */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">
              Servers ({servers.length})
            </p>
            {servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                selected={selectedServer?.id === server.id}
                onClick={() => setSelectedServer(server)}
              />
            ))}
          </div>

          {/* Playground panel */}
          <div className="lg:col-span-2">
            {selectedServer ? (
              <MCPPlayground server={selectedServer} />
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-muted/20 flex flex-col items-center justify-center py-20 text-center">
                <Terminal className="h-8 w-8 text-muted-foreground mb-3" />
                <p className="text-sm font-medium">Select a server</p>
                <p className="text-xs text-muted-foreground mt-1">Choose a server from the left to open the interactive playground.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
