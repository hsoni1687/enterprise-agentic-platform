"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  modelsApi,
  providerModelsApi,
  OllamaModel,
  LiteLLMModel,
  ProviderModel,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Cpu,
  Cloud,
  Plus,
  Trash2,
  Download,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  Server,
  ChevronRight,
  Key,
  Sparkles,
  Check,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

function fmtCtx(n?: number) {
  if (!n) return null;
  if (n >= 1000) return `${Math.round(n / 1000)}k ctx`;
  return `${n} ctx`;
}

// ── Pull progress dialog ──────────────────────────────────────────────────────

interface PullLine {
  status?: string;
  completed?: number;
  total?: number;
  error?: string;
}

function PullDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [modelName, setModelName] = useState("");
  const [pulling, setPulling] = useState(false);
  const [lines, setLines] = useState<PullLine[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  const handlePull = async () => {
    if (!modelName.trim()) return;
    setPulling(true); setLines([]); setDone(false); setError(null);
    try {
      const resp = await modelsApi.pullOllama(modelName.trim());
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done: rdone, value } = await reader.read();
        if (rdone) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.trim()) continue;
          try {
            const line = JSON.parse(part) as PullLine;
            setLines((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.status === line.status && line.total && line.total > 0) return [...prev.slice(0, -1), line];
              return [...prev, line];
            });
          } catch { /* ignore */ }
        }
      }
      setDone(true); onDone();
    } catch (e) { setError(e instanceof Error ? e.message : "Pull failed"); }
    finally { setPulling(false); }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-background border rounded-xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold">Pull Ollama Model</h3>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose} disabled={pulling}><X className="h-4 w-4" /></Button>
        </div>
        <div className="p-5 space-y-4 flex-1 overflow-y-auto">
          <div className="space-y-1.5">
            <Label className="text-xs">Model name</Label>
            <Input placeholder="e.g. llama3.2:latest, mistral, phi3" value={modelName} onChange={(e) => setModelName(e.target.value)} disabled={pulling || done} onKeyDown={(e) => { if (e.key === "Enter") handlePull(); }} className="h-9 text-sm font-mono" />
            <p className="text-[11px] text-muted-foreground">Browse at <a href="https://ollama.com/library" target="_blank" rel="noreferrer" className="text-violet-400 hover:underline">ollama.com/library</a></p>
          </div>
          {lines.length > 0 && (
            <div ref={logRef} className="bg-muted/40 rounded-lg p-3 max-h-48 overflow-y-auto space-y-1 font-mono text-[11px]">
              {lines.map((l, i) => {
                const pct = l.total && l.total > 0 ? Math.round((l.completed ?? 0) / l.total * 100) : null;
                return (
                  <div key={i} className="flex items-center gap-2 text-muted-foreground">
                    <span className="text-foreground/60">{l.status}</span>
                    {pct !== null && (<><div className="flex-1 bg-border rounded-full h-1"><div className="bg-violet-500 h-1 rounded-full transition-all" style={{ width: `${pct}%` }} /></div><span className="text-[10px] w-8 text-right">{pct}%</span></>)}
                  </div>
                );
              })}
            </div>
          )}
          {done && <div className="flex items-center gap-2 text-green-400 text-sm"><CheckCircle2 className="h-4 w-4" />Model pulled successfully!</div>}
          {error && <div className="flex items-center gap-2 text-destructive text-sm"><AlertCircle className="h-4 w-4" />{error}</div>}
        </div>
        <div className="border-t px-5 py-3 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={pulling}>{done ? "Close" : "Cancel"}</Button>
          {!done && <Button size="sm" onClick={handlePull} disabled={pulling || !modelName.trim()} className="gap-1.5">{pulling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}{pulling ? "Pulling…" : "Pull"}</Button>}
        </div>
      </div>
    </div>
  );
}

// ── Local tab ─────────────────────────────────────────────────────────────────

function LocalTab() {
  const queryClient = useQueryClient();
  const [pullOpen, setPullOpen] = useState(false);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  const { data: models = [], isLoading, refetch } = useQuery({
    queryKey: ["ollama-models"],
    queryFn: () => modelsApi.listOllama(),
    refetchInterval: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => modelsApi.deleteOllama(name),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["ollama-models"] }); queryClient.invalidateQueries({ queryKey: ["models"] }); setDeletingName(null); },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Local Models</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Models installed in your local Ollama instance. Available instantly, no API key required.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>
          <Button size="sm" className="gap-1.5 h-8" onClick={() => setPullOpen(true)}><Download className="h-3.5 w-3.5" />Pull Model</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" />Connecting to Ollama…</div>
      ) : models.length === 0 ? (
        <div className="border border-dashed rounded-lg p-10 text-center">
          <Server className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">No local models found.</p>
          <p className="text-xs text-muted-foreground mt-1">Make sure Ollama is running, then pull a model.</p>
          <Button size="sm" className="mt-4 gap-1.5" onClick={() => setPullOpen(true)}><Download className="h-3.5 w-3.5" />Pull your first model</Button>
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {models.map((m) => {
            const shortName = m.name.includes(":") ? m.name : `${m.name}:latest`;
            const [name, tag] = shortName.split(":");
            return (
              <div key={m.name} className="px-4 py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium truncate">{name}</span>
                    <Badge variant="outline" className="text-[10px] font-mono shrink-0">{tag}</Badge>
                    <Badge className="bg-green-500/10 text-green-400 border-green-500/20 text-[10px] shrink-0">local</Badge>
                  </div>
                  <div className="flex gap-3 mt-0.5 text-[11px] text-muted-foreground">
                    {m.details?.family && <span>{m.details.family}</span>}
                    {m.details?.parameter_size && <span>{m.details.parameter_size}</span>}
                    {m.details?.quantization_level && <span className="font-mono">{m.details.quantization_level}</span>}
                    <span>{fmtBytes(m.size)}</span>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0" onClick={() => { setDeletingName(m.name); deleteMutation.mutate(m.name); }} disabled={deletingName === m.name && deleteMutation.isPending}>
                  {deletingName === m.name && deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <PullDialog open={pullOpen} onClose={() => setPullOpen(false)} onDone={() => { queryClient.invalidateQueries({ queryKey: ["ollama-models"] }); queryClient.invalidateQueries({ queryKey: ["models"] }); }} />
    </div>
  );
}

// ── Connect Provider Wizard ───────────────────────────────────────────────────

type WizardProvider = "anthropic" | "openai" | "google" | "azure" | "custom";

const PROVIDER_META: Record<WizardProvider, {
  label: string;
  logo: string;
  color: string;
  keyPlaceholder: string;
  keyHint: string;
  supportsBaseUrl: boolean;
  baseUrlLabel?: string;
  baseUrlPlaceholder?: string;
  fetcher?: (key: string, baseUrl?: string) => Promise<ProviderModel[]>;
  docsUrl: string;
}> = {
  anthropic: {
    label: "Anthropic",
    logo: "🔶",
    color: "border-orange-500/30 bg-orange-500/5 hover:border-orange-500/60",
    keyPlaceholder: "sk-ant-api03-…",
    keyHint: "Direct key or key from your internal proxy / Bedrock gateway",
    supportsBaseUrl: true,
    baseUrlLabel: "Custom Base URL",
    baseUrlPlaceholder: "https://llm-inference.internal.example.com/",
    fetcher: providerModelsApi.anthropic,
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    label: "OpenAI",
    logo: "🟢",
    color: "border-green-500/30 bg-green-500/5 hover:border-green-500/60",
    keyPlaceholder: "sk-proj-…",
    keyHint: "Get your key at platform.openai.com → API keys",
    supportsBaseUrl: false,
    fetcher: providerModelsApi.openai,
    docsUrl: "https://platform.openai.com/api-keys",
  },
  google: {
    label: "Google (Gemini)",
    logo: "🔵",
    color: "border-blue-500/30 bg-blue-500/5 hover:border-blue-500/60",
    keyPlaceholder: "AIzaSy…",
    keyHint: "Get your key at aistudio.google.com → Get API key",
    supportsBaseUrl: false,
    fetcher: providerModelsApi.google,
    docsUrl: "https://aistudio.google.com/apikey",
  },
  azure: {
    label: "Azure OpenAI",
    logo: "☁️",
    color: "border-sky-500/30 bg-sky-500/5 hover:border-sky-500/60",
    keyPlaceholder: "Your Azure API key",
    keyHint: "Requires Azure OpenAI resource endpoint + deployment name",
    fetcher: undefined,
    supportsBaseUrl: true,
    baseUrlLabel: "Azure Endpoint",
    baseUrlPlaceholder: "https://my-resource.openai.azure.com",
    docsUrl: "https://portal.azure.com",
  },
  custom: {
    label: "Custom / Other",
    logo: "⚙️",
    color: "border-violet-500/30 bg-violet-500/5 hover:border-violet-500/60",
    keyPlaceholder: "API key",
    keyHint: "Any OpenAI-compatible provider (Bedrock, Together, Groq, …)",
    supportsBaseUrl: true,
    baseUrlLabel: "Base URL",
    baseUrlPlaceholder: "https://api.your-provider.com/v1",
    fetcher: undefined,
    docsUrl: "",
  },
};

type WizardStep = "pick" | "key" | "models" | "done";

function ConnectProviderWizard({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [step, setStep] = useState<WizardStep>("pick");
  const [provider, setProvider] = useState<WizardProvider>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<ProviderModel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);
  // For manual entry (azure/custom or when fetch fails)
  const [manualId, setManualId] = useState("");
  const [manualAlias, setManualAlias] = useState("");

  const meta = PROVIDER_META[provider];

  const reset = () => {
    setStep("pick"); setApiKey(""); setApiBase(""); setFetching(false);
    setFetchError(null); setAvailableModels([]); setSelected(new Set());
    setAdding(false); setAddError(null); setAddedCount(0);
    setManualId(""); setManualAlias("");
  };

  const handleClose = () => { reset(); onClose(); };

  const handleFetchModels = async () => {
    setFetching(true); setFetchError(null); setAvailableModels([]);
    try {
      if (!meta.fetcher) {
        // Azure/Custom — skip model fetch, go to manual entry
        setStep("models");
        setFetching(false);
        return;
      }
      const models = await meta.fetcher(apiKey.trim(), apiBase.trim() || undefined);
      setAvailableModels(models);
      setStep("models");
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to fetch models");
    } finally {
      setFetching(false);
    }
  };

  const toggleModel = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAddSelected = async () => {
    const toAdd = availableModels.filter((m) => selected.has(m.id));
    if (toAdd.length === 0) return;
    setAdding(true); setAddError(null);
    let count = 0;
    for (const m of toAdd) {
      try {
        await modelsApi.addCloud({
          model_name: m.id,
          provider,
          litellm_model: m.litellmId,
          api_key: apiKey.trim(),
          api_base: apiBase.trim() || undefined,
        });
        count++;
      } catch (e) {
        setAddError(`Failed to add ${m.id}: ${e instanceof Error ? e.message : "error"}`);
        break;
      }
    }
    setAddedCount(count);
    if (!addError) { setStep("done"); onAdded(); }
    setAdding(false);
  };

  const handleAddManual = async () => {
    if (!manualId.trim() || !manualAlias.trim()) return;
    setAdding(true); setAddError(null);
    try {
      await modelsApi.addCloud({
        model_name: manualAlias.trim(),
        provider,
        litellm_model: manualId.trim(),
        api_key: apiKey.trim(),
        api_base: apiBase.trim() || undefined,
      });
      setAddedCount(1); setStep("done"); onAdded();
    } catch (e) { setAddError(e instanceof Error ? e.message : "Failed to add model"); }
    finally { setAdding(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-background border rounded-xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            {step !== "pick" && (
              <button onClick={() => setStep(step === "models" ? "key" : step === "key" ? "pick" : "pick")} className="text-muted-foreground hover:text-foreground text-xs flex items-center gap-1">
                ← Back
              </button>
            )}
            <h3 className="font-semibold text-sm">
              {step === "pick" && "Connect a Cloud Provider"}
              {step === "key" && `Connect ${meta.label}`}
              {step === "models" && `Select ${meta.label} Models`}
              {step === "done" && "Models Added"}
            </h3>
          </div>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleClose}><X className="h-4 w-4" /></Button>
        </div>

        {/* Step: Pick provider */}
        {step === "pick" && (
          <div className="p-5 space-y-3 overflow-y-auto">
            <p className="text-xs text-muted-foreground">Choose your AI provider. We'll connect to their API and show you which models are available with your key.</p>
            <div className="grid grid-cols-1 gap-2">
              {(Object.entries(PROVIDER_META) as [WizardProvider, typeof PROVIDER_META[WizardProvider]][]).map(([id, m]) => (
                <button
                  key={id}
                  onClick={() => { setProvider(id); setStep("key"); }}
                  className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all ${m.color}`}
                >
                  <span className="text-xl">{m.logo}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{m.label}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{m.keyHint}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step: Enter API key */}
        {step === "key" && (
          <div className="p-5 space-y-4 overflow-y-auto">
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
              <span className="text-2xl">{meta.logo}</span>
              <div>
                <p className="text-sm font-medium">{meta.label}</p>
                <a href={meta.docsUrl} target="_blank" rel="noreferrer" className="text-[11px] text-violet-400 hover:underline">{meta.docsUrl.replace("https://", "")}</a>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1"><Key className="h-3 w-3" />API Key</Label>
              <Input
                type="password"
                placeholder={meta.keyPlaceholder}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="h-9 text-sm font-mono"
                onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) handleFetchModels(); }}
              />
              <p className="text-[11px] text-muted-foreground">{meta.keyHint}</p>
            </div>

            {meta.supportsBaseUrl && (
              <div className="space-y-1.5">
                <Label className="text-xs">
                  {meta.baseUrlLabel ?? "Custom Base URL"}{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  placeholder={meta.baseUrlPlaceholder}
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  className="h-9 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Leave blank to use {meta.label}&apos;s official API endpoint. Set this if you&apos;re routing through a private proxy or gateway.
                </p>
              </div>
            )}

            {fetchError && (
              <div className="flex items-start gap-2 text-destructive text-sm bg-destructive/10 rounded-lg p-3">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Couldn't fetch models</p>
                  <p className="text-xs mt-0.5 text-destructive/80">{fetchError}</p>
                  <p className="text-xs mt-1 text-muted-foreground">Double-check your API key. You can still add models manually.</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step: Select models */}
        {step === "models" && (
          <div className="p-5 space-y-3 overflow-y-auto flex-1 min-h-0">
            {availableModels.length > 0 ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">{availableModels.length} models available — select which ones to add</p>
                  <button
                    className="text-[11px] text-violet-400 hover:underline"
                    onClick={() => setSelected(selected.size === availableModels.length ? new Set() : new Set(availableModels.map((m) => m.id)))}
                  >
                    {selected.size === availableModels.length ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div className="border rounded-lg divide-y overflow-y-auto max-h-72">
                  {availableModels.map((m) => {
                    const isSelected = selected.has(m.id);
                    return (
                      <button
                        key={m.id}
                        onClick={() => toggleModel(m.id)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors ${isSelected ? "bg-violet-500/5" : ""}`}
                      >
                        <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors ${isSelected ? "bg-violet-600 border-violet-600" : "border-border"}`}>
                          {isSelected && <Check className="h-3 w-3 text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-mono truncate">{m.id}</p>
                          {m.displayName !== m.id && <p className="text-[11px] text-muted-foreground">{m.displayName}</p>}
                        </div>
                        {fmtCtx(m.contextWindow) && (
                          <span className="text-[10px] text-muted-foreground shrink-0">{fmtCtx(m.contextWindow)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              /* Manual entry for Azure/Custom or when fetch fails */
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Enter the model identifier manually. For {meta.label}, you'll need the exact model/deployment name.</p>
                <div className="space-y-1.5">
                  <Label className="text-xs">Model ID <span className="text-muted-foreground">(e.g. gpt-4o, claude-opus-4-5)</span></Label>
                  <Input placeholder="provider/model-id" value={manualId} onChange={(e) => setManualId(e.target.value)} className="h-9 text-sm font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Alias <span className="text-muted-foreground">(shown in model selector)</span></Label>
                  <Input placeholder="my-model-name" value={manualAlias} onChange={(e) => setManualAlias(e.target.value)} className="h-9 text-sm font-mono" />
                </div>
              </div>
            )}

            {addError && (
              <div className="flex items-center gap-2 text-destructive text-sm"><AlertCircle className="h-4 w-4" />{addError}</div>
            )}
          </div>
        )}

        {/* Step: Done */}
        {step === "done" && (
          <div className="p-8 text-center space-y-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/15 mx-auto">
              <CheckCircle2 className="h-7 w-7 text-green-400" />
            </div>
            <p className="font-semibold">{addedCount} model{addedCount !== 1 ? "s" : ""} added!</p>
            <p className="text-xs text-muted-foreground">
              {meta.label} models are now available in the workspace model selector. Switch to them any time in the top-right.
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="border-t px-5 py-3 flex justify-end gap-2">
          {step === "key" && (
            <>
              <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
              <Button size="sm" onClick={handleFetchModels} disabled={fetching || !apiKey.trim()} className="gap-1.5">
                {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {fetching ? "Fetching models…" : "Fetch Available Models"}
              </Button>
            </>
          )}
          {step === "models" && availableModels.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
              <Button size="sm" onClick={handleAddSelected} disabled={adding || selected.size === 0} className="gap-1.5">
                {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {adding ? "Adding…" : `Add ${selected.size > 0 ? selected.size : ""} Model${selected.size !== 1 ? "s" : ""}`}
              </Button>
            </>
          )}
          {step === "models" && availableModels.length === 0 && (
            <>
              <Button variant="outline" size="sm" onClick={handleClose}>Cancel</Button>
              <Button size="sm" onClick={handleAddManual} disabled={adding || !manualId.trim() || !manualAlias.trim()} className="gap-1.5">
                {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {adding ? "Adding…" : "Add Model"}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button size="sm" onClick={handleClose}>Done</Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Cloud tab ─────────────────────────────────────────────────────────────────

const CLOUD_PREFIXES = ["anthropic/", "openai/", "google/", "azure/", "bedrock/", "vertex_ai/", "cohere/", "mistral/"];

function isRealCloudModel(m: LiteLLMModel): boolean {
  const underlying = m.litellm_params?.model ?? "";
  if (underlying.startsWith("ollama/") || underlying.startsWith("os.environ/OLLAMA")) return false;
  if (m.model_name.includes("embedding") || underlying.includes("embedding")) return false;
  if (m.model_name.startsWith("mock-") || m.model_name.startsWith("local-")) return false;
  return CLOUD_PREFIXES.some((p) => underlying.startsWith(p));
}

function providerLabel(underlying: string): string {
  if (underlying.startsWith("anthropic/")) return "Anthropic";
  if (underlying.startsWith("openai/")) return "OpenAI";
  if (underlying.startsWith("google/")) return "Google";
  if (underlying.startsWith("azure/")) return "Azure";
  return underlying.split("/")[0];
}

function providerColor(underlying: string): string {
  if (underlying.startsWith("anthropic/")) return "bg-orange-500/10 text-orange-400 border-orange-500/20";
  if (underlying.startsWith("openai/")) return "bg-green-500/10 text-green-400 border-green-500/20";
  if (underlying.startsWith("google/")) return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  if (underlying.startsWith("azure/")) return "bg-sky-500/10 text-sky-400 border-sky-500/20";
  return "bg-violet-500/10 text-violet-400 border-violet-500/20";
}

function CloudTab() {
  const queryClient = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: allModels = [], isLoading, refetch } = useQuery({
    queryKey: ["litellm-models"],
    queryFn: () => modelsApi.listLiteLLM(),
    refetchInterval: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => modelsApi.deleteCloud(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["litellm-models"] }); queryClient.invalidateQueries({ queryKey: ["models"] }); setDeletingId(null); },
  });

  const cloudModels = allModels.filter(isRealCloudModel);
  const configModels = cloudModels.filter((m) => !m.model_info?.db_model);
  const dynamicModels = cloudModels.filter((m) => m.model_info?.db_model);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Cloud Models</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Connect a provider with your API key — we fetch the available models live and let you pick which ones to enable.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={() => refetch()}><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>
          <Button size="sm" className="gap-1.5 h-8" onClick={() => setWizardOpen(true)}><Plus className="h-3.5 w-3.5" />Connect Provider</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" />Connecting to LiteLLM…</div>
      ) : (
        <>
          {/* Dynamically added models */}
          {dynamicModels.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">Your connected models</p>
              <div className="border rounded-lg divide-y">
                {dynamicModels.map((m) => {
                  const underlying = m.litellm_params?.model ?? "";
                  const colorClass = providerColor(underlying);
                  return (
                    <div key={m.model_info?.id ?? m.model_name} className="px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-medium truncate">{m.model_name}</span>
                          <Badge className={`text-[10px] border ${colorClass} shrink-0`}>{providerLabel(underlying)}</Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">{underlying}</p>
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0" onClick={() => { const id = m.model_info?.id; if (!id) return; setDeletingId(id); deleteMutation.mutate(id); }} disabled={deletingId === m.model_info?.id && deleteMutation.isPending}>
                        {deletingId === m.model_info?.id && deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty state CTA */}
          {dynamicModels.length === 0 && (
            <div className="border border-dashed rounded-xl p-8 text-center space-y-3">
              <Cloud className="h-9 w-9 mx-auto text-muted-foreground/30" />
              <div>
                <p className="text-sm font-medium">No cloud models connected yet</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                  Click <strong>Connect Provider</strong>, enter your API key, and pick from the live list of available models. They'll appear in your workspace selector instantly.
                </p>
              </div>
              <Button size="sm" className="gap-1.5 mt-1" onClick={() => setWizardOpen(true)}><Plus className="h-3.5 w-3.5" />Connect Provider</Button>
            </div>
          )}

          {/* Pre-configured from config file */}
          {configModels.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">Pre-configured <span className="normal-case font-normal">(from litellm.config.yaml — read only)</span></p>
              <div className="border rounded-lg divide-y opacity-60">
                {configModels.map((m) => {
                  const underlying = m.litellm_params?.model ?? "";
                  const colorClass = providerColor(underlying);
                  return (
                    <div key={m.model_info?.id ?? m.model_name} className="px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm truncate">{m.model_name}</span>
                          <Badge className={`text-[10px] border ${colorClass} shrink-0`}>{providerLabel(underlying)}</Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">{underlying}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">API keys for these come from environment variables in <span className="font-mono">infra/local/.env</span>.</p>
            </div>
          )}
        </>
      )}

      <ConnectProviderWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onAdded={() => { queryClient.invalidateQueries({ queryKey: ["litellm-models"] }); queryClient.invalidateQueries({ queryKey: ["models"] }); }}
      />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = "local" | "cloud";

export default function ModelsPage() {
  const [tab, setTab] = useState<Tab>("local");

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Models</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage local Ollama models and connect cloud providers. The active model is selected in the top-right workspace selector.
        </p>
      </div>

      <div className="flex gap-2 border-b pb-0">
        {(["local", "cloud"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-violet-500 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {t === "local" ? <Cpu className="h-3.5 w-3.5" /> : <Cloud className="h-3.5 w-3.5" />}
            {t === "local" ? "Local" : "Cloud"}
          </button>
        ))}
      </div>

      {tab === "local" && <LocalTab />}
      {tab === "cloud" && <CloudTab />}
    </div>
  );
}
