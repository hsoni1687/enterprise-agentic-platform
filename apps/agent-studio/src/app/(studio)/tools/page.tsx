"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Wrench, Play, Loader2, CheckCircle2, XCircle, Clock,
  Shield, Terminal, Globe, Search, FileText, FilePen,
  FileEdit, FolderSearch, ScanText, ListTodo, ChevronRight,
  AlertTriangle,
} from "lucide-react";
import {
  toolsApi,
  BuiltinToolSpec,
  JsonSchema,
  JsonSchemaProperty,
  ToolInvokeResult,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

// ── Icon map ──────────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, React.ElementType> = {
  bash: Terminal,
  "web-fetch": Globe,
  "web-search": Search,
  "file-read": FileText,
  "file-write": FilePen,
  "file-edit": FileEdit,
  glob: FolderSearch,
  grep: ScanText,
  todo: ListTodo,
};

function ToolIcon({ name, className }: { name: string; className?: string }) {
  const Icon = TOOL_ICONS[name] ?? Wrench;
  return <Icon className={className} />;
}

// ── Auth badge ────────────────────────────────────────────────────────────────

function AuthBadge({ level }: { level: "read" | "mutating" }) {
  return level === "mutating" ? (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-orange-400 bg-orange-500/10">
      <Shield className="h-2.5 w-2.5" /> Mutating
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-blue-400 bg-blue-500/10">
      Read
    </span>
  );
}

// ── Dynamic input form rendered from JSON Schema ──────────────────────────────

function SchemaForm({
  schema,
  values,
  onChange,
}: {
  schema: JsonSchema;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  if (!schema.properties) {
    return (
      <p className="text-xs text-muted-foreground italic">
        This tool takes no inputs.
      </p>
    );
  }

  const required = new Set(schema.required ?? []);

  return (
    <div className="space-y-3">
      {Object.entries(schema.properties).map(([key, prop]: [string, JsonSchemaProperty]) => {
        const isRequired = required.has(key);
        const label = (
          <div className="flex items-center gap-1.5 mb-1">
            <Label className="text-xs font-medium">{key}</Label>
            {isRequired && (
              <span className="text-[10px] text-destructive font-medium">required</span>
            )}
            {prop.default !== undefined && (
              <span className="text-[10px] text-muted-foreground">
                default: {JSON.stringify(prop.default)}
              </span>
            )}
          </div>
        );

        // Boolean
        if (prop.type === "boolean") {
          return (
            <div key={key}>
              {label}
              <select
                value={String(values[key] ?? prop.default ?? false)}
                onChange={(e) => onChange(key, e.target.value === "true")}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
              {prop.description && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{prop.description}</p>
              )}
            </div>
          );
        }

        // Enum
        if (prop.enum) {
          return (
            <div key={key}>
              {label}
              <select
                value={String(values[key] ?? prop.default ?? prop.enum[0])}
                onChange={(e) => onChange(key, e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              >
                {prop.enum.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              {prop.description && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{prop.description}</p>
              )}
            </div>
          );
        }

        // Integer / number
        if (prop.type === "integer" || prop.type === "number") {
          return (
            <div key={key}>
              {label}
              <Input
                type="number"
                value={String(values[key] ?? prop.default ?? "")}
                min={prop.minimum}
                max={prop.maximum}
                onChange={(e) => onChange(key, e.target.value ? Number(e.target.value) : undefined)}
                className="h-8 text-xs"
                placeholder={String(prop.default ?? "")}
              />
              {prop.description && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{prop.description}</p>
              )}
            </div>
          );
        }

        // Object (render as JSON textarea)
        if (prop.type === "object") {
          const raw = values[key] !== undefined
            ? JSON.stringify(values[key], null, 2)
            : "{}";
          return (
            <div key={key}>
              {label}
              <textarea
                rows={3}
                value={raw}
                onChange={(e) => {
                  try {
                    onChange(key, JSON.parse(e.target.value));
                  } catch {
                    // let user keep typing; don't error mid-edit
                  }
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="{}"
              />
              {prop.description && (
                <p className="text-[10px] text-muted-foreground mt-0.5">{prop.description}</p>
              )}
            </div>
          );
        }

        // String (multi-line if it looks like code/script/content)
        const isLong = ["script", "content", "sop", "query"].includes(key);
        return (
          <div key={key}>
            {label}
            {isLong ? (
              <textarea
                rows={5}
                value={String(values[key] ?? "")}
                onChange={(e) => onChange(key, e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder={prop.description ?? key}
              />
            ) : (
              <Input
                value={String(values[key] ?? "")}
                onChange={(e) => onChange(key, e.target.value)}
                className="h-8 text-xs"
                placeholder={prop.description ?? key}
              />
            )}
            {prop.description && !isLong && (
              <p className="text-[10px] text-muted-foreground mt-0.5">{prop.description}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Result display ────────────────────────────────────────────────────────────

function ResultPanel({ result }: { result: ToolInvokeResult }) {
  const succeeded = !result.error;
  return (
    <div className="playground-panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {succeeded
            ? <CheckCircle2 className="h-4 w-4 text-green-400" />
            : <XCircle className="h-4 w-4 text-red-400" />}
          <span className={`text-sm font-medium ${succeeded ? "text-green-400" : "text-red-400"}`}>
            {succeeded ? "Success" : "Error"}
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {result.duration_ms}ms
        </div>
      </div>

      {result.error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          {result.error}
        </div>
      )}

      {result.result !== undefined && (
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Output</p>
          <pre className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-xs font-mono whitespace-pre-wrap overflow-auto max-h-80">
            {typeof result.result === "string"
              ? result.result
              : JSON.stringify(result.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Tool card (left panel) ────────────────────────────────────────────────────

function ToolCard({
  tool,
  selected,
  onClick,
}: {
  tool: BuiltinToolSpec;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`catalog-card w-full text-left transition-colors ${
        selected ? "ring-1 ring-ring bg-accent" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
          tool.auth_level === "mutating"
            ? "bg-orange-500/10 text-orange-400"
            : "bg-blue-500/10 text-blue-400"
        }`}>
          <ToolIcon name={tool.name} className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-medium">{tool.name}</span>
            <AuthBadge level={tool.auth_level} />
            {tool.sandbox_required && (
              <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">sandbox</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{tool.description}</p>
        </div>
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform mt-1 ${selected ? "rotate-90 text-foreground" : ""}`} />
      </div>
    </button>
  );
}

// ── Playground panel (right panel) ───────────────────────────────────────────

function ToolPlayground({ tool }: { tool: BuiltinToolSpec }) {
  const schema = tool.input_schema as JsonSchema;
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ToolInvokeResult | null>(null);
  const [invokeError, setInvokeError] = useState<string | null>(null);

  // Reset state when tool changes
  useEffect(() => {
    setValues({});
    setResult(null);
    setInvokeError(null);
  }, [tool.name]);

  const handleChange = useCallback((key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  async function runTool() {
    setRunning(true);
    setResult(null);
    setInvokeError(null);

    // Build inputs: merge form values with defaults for omitted optional fields
    const inputs: Record<string, unknown> = {};
    if (schema.properties) {
      for (const [key, prop] of Object.entries(schema.properties)) {
        const v = values[key];
        if (v !== undefined && v !== "") {
          inputs[key] = v;
        } else if (prop.default !== undefined) {
          // omit — server-side default applies
        }
      }
    }

    try {
      const res = await toolsApi.invoke(tool.name, inputs);
      setResult(res);
    } catch (e) {
      setInvokeError(String(e));
    } finally {
      setRunning(false);
    }
  }

  const required = schema.required ?? [];
  const hasAllRequired = required.every((k) => {
    const v = values[k];
    return v !== undefined && v !== "";
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
          tool.auth_level === "mutating" ? "bg-orange-500/15" : "bg-blue-500/15"
        }`}>
          <ToolIcon
            name={tool.name}
            className={`h-4 w-4 ${tool.auth_level === "mutating" ? "text-orange-400" : "text-blue-400"}`}
          />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-mono font-semibold text-sm">{tool.name}</h3>
            <span className="text-xs text-muted-foreground">v{tool.version}</span>
            <AuthBadge level={tool.auth_level} />
          </div>
          <p className="text-xs text-muted-foreground">{tool.description}</p>
        </div>
      </div>

      {tool.auth_level === "mutating" && (
        <div className="flex items-start gap-2 rounded-lg border border-orange-500/20 bg-orange-500/5 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-orange-400 shrink-0 mt-0.5" />
          <p className="text-xs text-orange-400">
            Mutating tool — invocation will write files, execute code, or modify state.
          </p>
        </div>
      )}

      {/* Input form */}
      <div className="playground-panel p-4 space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Inputs
        </p>
        <SchemaForm schema={schema} values={values} onChange={handleChange} />

        <Button
          onClick={runTool}
          disabled={running || !hasAllRequired}
          className="w-full gap-2 mt-2"
        >
          {running
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Running…</>
            : <><Play className="h-4 w-4" /> Run Tool</>
          }
        </Button>
      </div>

      {/* Result */}
      {invokeError && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          Request failed: {invokeError}
        </div>
      )}
      {result && <ResultPanel result={result} />}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ToolsPage() {
  const [tools, setTools] = useState<BuiltinToolSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BuiltinToolSpec | null>(null);
  const [filter, setFilter] = useState<"all" | "read" | "mutating">("all");

  useEffect(() => {
    toolsApi
      .listBuiltin()
      .then((data) => {
        setTools(data.tools);
        if (data.tools.length > 0) setSelected(data.tools[0]);
      })
      .catch((e) => setLoadError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const filtered = tools.filter(
    (t) => filter === "all" || t.auth_level === filter
  );

  const readCount = tools.filter((t) => t.auth_level === "read").length;
  const mutatingCount = tools.filter((t) => t.auth_level === "mutating").length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15">
            <Wrench className="h-4 w-4 text-violet-400" />
          </div>
          <h1 className="text-xl font-semibold">Built-in Tools</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Platform-native tools with real Python implementations. Select a tool to inspect
          its contract and run it live in the playground.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Tools", value: tools.length },
          { label: "Read-only", value: readCount },
          { label: "Mutating", value: mutatingCount },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      <Separator />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Left: tool catalog */}
        <div className="lg:col-span-2 space-y-3">
          {/* Filter chips */}
          <div className="flex items-center gap-2">
            {(["all", "read", "mutating"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`filter-chip capitalize ${filter === f ? "filter-chip-active" : ""}`}
              >
                {f}
              </button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            {filtered.length} tool{filtered.length !== 1 ? "s" : ""}
          </p>

          <div className="space-y-2">
            {loading ? (
              [1, 2, 3, 4].map((i) => (
                <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
              ))
            ) : loadError ? (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-xs text-red-400">
                Could not reach agent-workers on :8094. Is it running?
                <br />
                <span className="text-muted-foreground">{loadError}</span>
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No tools match filter.</p>
            ) : (
              filtered.map((tool) => (
                <ToolCard
                  key={tool.name}
                  tool={tool}
                  selected={selected?.name === tool.name}
                  onClick={() => setSelected(tool)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right: playground */}
        <div className="lg:col-span-3">
          {selected ? (
            <ToolPlayground key={selected.name} tool={selected} />
          ) : !loading && (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground text-sm gap-2">
              <Wrench className="h-8 w-8 opacity-30" />
              <p>Select a tool from the catalog to try it.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
