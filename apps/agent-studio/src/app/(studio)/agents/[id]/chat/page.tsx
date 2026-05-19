"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft,
  Send,
  Loader2,
  ChevronDown,
  ChevronRight,
  Wrench,
  Bot,
  Terminal,
  AlertCircle,
  CheckCircle,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { agentsApi, kgApi } from "@/lib/api";
import { ChatEvent, Message } from "@/lib/types";
import { getSession, setSession, clearSession } from "@/lib/chat-session-cache";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTenant } from "@/contexts/tenant-context";

const API_GATEWAY = process.env.NEXT_PUBLIC_API_GATEWAY_URL ?? "http://localhost:8080";
const WORKFLOW_INITIATOR = "http://localhost:8081";
const CHAT_TIMEOUT_MS = 120_000; // 120 s — LLM + planning can take 30-60 s on local models

function friendlyError(raw: string): string {
  const r = raw?.toUpperCase?.() ?? "";
  if (r === "FAILED" || r.includes("WORKFLOW") || r.includes("TEMPORAL"))
    return "Agent execution failed. The workflow could not complete — check that the agent's skills and tools are valid and the worker is running.";
  if (r.includes("TIMEOUT") || r.includes("DEADLINE"))
    return "The agent timed out while processing your request. Try a simpler prompt or check that the LLM is reachable.";
  if (r.includes("401") || r.includes("UNAUTHORIZED"))
    return "Unauthorized. Check your API key configuration.";
  if (r.includes("404") || r.includes("NOT FOUND"))
    return "Agent not found or not deployed. Deploy the agent first.";
  return raw || "An unknown error occurred.";
}

// ── Approval block ────────────────────────────────────────────────────────────

function ApprovalBlock({ event, tenantId }: { event: ChatEvent; tenantId: string }) {
  const [status, setStatus] = useState<"pending" | "approved" | "denied">("pending");
  const [denialReason, setDenialReason] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (action: "approve" | "deny") => {
    setBusy(true);
    try {
      if (!event.approval_id) throw new Error("approval_id missing");
      const resp = await fetch(
        `${WORKFLOW_INITIATOR}/api/v1/approvals/${event.approval_id}/${action}`,
        {
          method: "POST",
          headers: { "X-Tenant-ID": tenantId, "X-User-ID": "current-user", "Content-Type": "application/json" },
          body: action === "deny" ? JSON.stringify({ reason: denialReason }) : undefined,
        }
      );
      if (resp.ok) setStatus(action === "approve" ? "approved" : "denied");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="my-2 rounded-lg border border-yellow-500/30 bg-yellow-500/8 text-xs overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-yellow-500/20">
        <AlertCircle className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
        <span className="text-yellow-400 font-semibold">Permission Required</span>
        <span className="text-muted-foreground ml-1">— {event.tool_name}</span>
      </div>
      {status === "pending" ? (
        <div className="px-3 py-2 space-y-2">
          {event.reason && <p className="text-muted-foreground">{event.reason}</p>}
          <pre className="bg-muted/40 rounded px-2 py-1 text-foreground/80 whitespace-pre-wrap overflow-auto max-h-32">
            {JSON.stringify(event.tool_args, null, 2)}
          </pre>
          <textarea
            placeholder="Denial reason (optional)"
            value={denialReason}
            onChange={(e) => setDenialReason(e.target.value)}
            className="w-full h-12 rounded border border-border bg-muted/30 px-2 py-1 text-xs font-mono resize-none focus:outline-none"
          />
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act("deny")}>
              <XCircle className="h-3 w-3 mr-1" />Deny
            </Button>
            <Button size="sm" disabled={busy} onClick={() => act("approve")}>
              <CheckCircle className="h-3 w-3 mr-1" />Approve
            </Button>
          </div>
        </div>
      ) : (
        <div className={`px-3 py-2 font-semibold ${status === "approved" ? "text-green-400" : "text-red-400"}`}>
          {status === "approved" ? "✓ Approved — execution will resume" : "✗ Denied"}
        </div>
      )}
    </div>
  );
}

// ── Tool call block ───────────────────────────────────────────────────────────

function ToolCallBlock({ event }: { event: ChatEvent }) {
  const [expanded, setExpanded] = useState(false);
  const toolName = event.tool_name || (event as any).name || "Unknown Tool";
  const toolArgs = event.tool_args || (event as any).args;
  const toolResult = event.tool_result || (event as any).result;
  const hasContent = toolArgs !== undefined || toolResult !== undefined;

  return (
    <div className="my-1 rounded-lg border border-border/50 bg-muted/30 text-xs font-mono overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        <Wrench className="h-3 w-3 text-yellow-400 shrink-0" />
        <span className="text-yellow-400 font-semibold">{toolName}</span>
        {!hasContent && <span className="text-muted-foreground/50 ml-auto italic">pending…</span>}
        <span className="text-muted-foreground ml-auto">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border/50 px-3 py-2 space-y-2">
          {toolArgs !== undefined && (
            <div>
              <div className="text-muted-foreground mb-1">arguments</div>
              <pre className="text-foreground/80 whitespace-pre-wrap">
                {typeof toolArgs === "string" ? toolArgs : JSON.stringify(toolArgs, null, 2)}
              </pre>
            </div>
          )}
          {toolResult !== undefined ? (
            <div>
              <div className="text-green-400 mb-1">result</div>
              <pre className="text-foreground/80 whitespace-pre-wrap">
                {typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult, null, 2)}
              </pre>
            </div>
          ) : (
            <div className="text-muted-foreground/60 italic">Awaiting result…</div>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="my-1 rounded-lg border border-border/30 bg-muted/20 text-xs overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
      >
        <Terminal className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">Reasoning</span>
        <span className="ml-auto text-muted-foreground/60">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border/30 px-3 py-2 font-mono text-muted-foreground whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}

// ── Message renderers ─────────────────────────────────────────────────────────

function AssistantMessage({ message, tenantId }: { message: Message; tenantId: string }) {
  const hasError = message.content?.startsWith("Error:");

  return (
    <div className="group py-4 border-b border-border/20 last:border-0">
      <div className="flex items-start gap-3">
        <div className={cn(
          "mt-0.5 flex h-6 w-6 items-center justify-center rounded shrink-0",
          hasError ? "bg-destructive/10" : "bg-primary/10"
        )}>
          {hasError
            ? <AlertCircle className="h-3.5 w-3.5 text-destructive" />
            : <Bot className="h-3.5 w-3.5 text-primary" />
          }
        </div>
        <div className="flex-1 min-w-0 text-sm leading-relaxed">
          {message.events?.map((ev, i) => {
            // Only show reasoning while the message is still streaming — hide it once done
            if (ev.type === "thinking" && ev.content) {
              if (!message.streaming) return null;
              return <ThinkingBlock key={i} content={ev.content} />;
            }
            if (ev.type === "tool_call") return <ToolCallBlock key={i} event={ev} />;
            if (ev.type === "approval") return <ApprovalBlock key={i} event={ev} tenantId={tenantId} />;
            return null;
          })}
          {message.content && (
            <div className={cn("whitespace-pre-wrap", hasError ? "text-destructive/90 text-xs leading-relaxed" : "text-foreground")}>
              {hasError ? message.content.slice("Error: ".length) : message.content}
              {message.streaming && !hasError && (
                <span className="inline-block h-4 w-0.5 bg-primary ml-0.5 animate-pulse" />
              )}
            </div>
          )}
          {message.streaming && !message.content && (
            <span className="inline-block h-4 w-0.5 bg-primary animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
}

function UserMessage({ message }: { message: Message }) {
  return (
    <div className="py-4 border-b border-border/20 last:border-0 flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary/10 border border-primary/20 px-4 py-2.5">
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">
          {message.content}
        </p>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { tenantId } = useTenant();
  const [messages, setMessages] = useState<Message[]>(() => getSession(id));
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data: agent } = useQuery({
    queryKey: ["agents", id],
    queryFn: () => agentsApi.get(id),
  });

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!streaming && messages.length > 0) setSession(id, messages);
  }, [streaming, id, messages]);

  // Clean up on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", events: [], streaming: true };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setStreaming(true);

    // Inject context from attached knowledge graphs before sending to the agent.
    let enrichedText = text;
    const kgIds: string[] = agent?.knowledge_graph_ids ?? [];
    console.log("[KG] agent knowledge_graph_ids:", kgIds);
    if (kgIds.length > 0) {
      const contextParts: string[] = [];
      await Promise.allSettled(
        kgIds.map(async (kgId) => {
          try {
            console.log("[KG] Fetching context for graph:", kgId, "question:", text);
            const result = await kgApi.getGraphContext(kgId, text);
            console.log("[KG] Context result:", result?.context?.slice(0, 200));
            if (result?.context && result.context !== "(No relevant entities found)") {
              // Cap context per graph at 1500 chars to keep the LLM prompt manageable
              const ctx = result.context.length > 1500
                ? result.context.slice(0, 1500) + "\n…(truncated)"
                : result.context;
              contextParts.push(ctx);
            }
          } catch (err) {
            console.error("[KG] Failed to fetch context for graph:", kgId, err);
          }
        })
      );
      console.log("[KG] contextParts count:", contextParts.length);
      if (contextParts.length > 0) {
        enrichedText =
          `--- Knowledge Graph Context ---\n${contextParts.join("\n\n")}\n--- End of Context ---\n\n` +
          text;
        console.log("[KG] enrichedText length:", enrichedText.length, "first 300 chars:", enrichedText.slice(0, 300));
      }
    }

    const abort = new AbortController();
    abortRef.current = abort;

    // Timeout: if no done/error event within CHAT_TIMEOUT_MS, surface a timeout error
    const timeoutId = setTimeout(() => {
      abort.abort();
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: friendlyError("TIMEOUT"), streaming: false }
            : m
        )
      );
      setStreaming(false);
    }, CHAT_TIMEOUT_MS);

    fetch(`${API_GATEWAY}/api/v1/agents/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Tenant-ID": tenantId },
      body: JSON.stringify({ message: enrichedText, tenant_id: tenantId }),
      signal: abort.signal,
    })
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const reader = resp.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();

        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              for (const line of chunk.split("\n")) {
                // SSE comment (: ...) — ignore
                if (line.startsWith(":")) continue;

                if (line.startsWith("data: ")) {
                  try {
                    const event: ChatEvent = JSON.parse(line.slice(6));

                    setMessages((prev) =>
                      prev.map((m) => {
                        if (m.id !== assistantId) return m;
                        if (event.type === "text" && event.content)
                          return { ...m, content: m.content + event.content };
                        if (event.type === "thinking" || event.type === "tool_call" || event.type === "approval")
                          return { ...m, events: [...(m.events ?? []), event] };
                        if (event.type === "done")
                          return { ...m, streaming: false };
                        if (event.type === "error")
                          return { ...m, content: friendlyError(event.content ?? ""), streaming: false };
                        return m;
                      })
                    );

                    if (event.type === "done" || event.type === "error") {
                      clearTimeout(timeoutId);
                      setStreaming(false);
                      return;
                    }
                  } catch {
                    // malformed JSON — skip
                  }
                }
              }
            }
          } catch (err: any) {
            if (err?.name === "AbortError") return; // timeout already handled
            clearTimeout(timeoutId);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: friendlyError(err?.message ?? "Stream error"), streaming: false }
                  : m
              )
            );
            setStreaming(false);
          }
        };

        pump();
      })
      .catch((err: any) => {
        if (err?.name === "AbortError") return;
        clearTimeout(timeoutId);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: friendlyError(err?.message ?? ""), streaming: false }
              : m
          )
        );
        setStreaming(false);
      });
  }, [id, input, streaming, tenantId, agent]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const stopStreaming = () => {
    abortRef.current?.abort();
    setStreaming(false);
    setMessages((prev) =>
      prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
    );
  };

  const isActive = agent?.status === "active";

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 shrink-0 border-b border-border/50"
        style={{ height: "48px" }}
      >
        <Link href={`/agents/${id}`}>
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground h-7 px-2">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
        </Link>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-violet-500/15 shrink-0">
            <Bot className="h-3.5 w-3.5 text-violet-400" />
          </div>
          <span className="text-sm font-semibold truncate">{agent?.name ?? id}</span>
          {isActive && <span className="h-2 w-2 rounded-full bg-green-400 shrink-0" />}
          {agent && (
            <span className="text-xs text-muted-foreground font-mono hidden sm:block">
              {agent.model}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground shrink-0"
          onClick={() => { clearSession(id); setMessages([]); }}
        >
          <RefreshCw className="h-3 w-3 mr-1.5" />
          New Chat
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-8 py-4">
        <div className="max-w-2xl mx-auto">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-500/10 mb-5">
                <Bot className="h-8 w-8 text-violet-400 opacity-70" />
              </div>
              <p className="text-base font-semibold text-foreground/80 mb-1">
                {agent?.name ?? "Agent"}
              </p>
              {agent?.system_prompt && (
                <p className="text-xs text-muted-foreground max-w-sm mt-1 leading-relaxed">
                  {agent.system_prompt.slice(0, 140)}
                  {agent.system_prompt.length > 140 ? "…" : ""}
                </p>
              )}
              {!isActive && (
                <div className="mt-6 flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/8 px-4 py-2.5 text-xs text-yellow-400">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  This agent is not active. Deploy it first to start chatting.
                </div>
              )}
            </div>
          )}

          {messages.map((msg) =>
            msg.role === "user"
              ? <UserMessage key={msg.id} message={msg} />
              : <AssistantMessage key={msg.id} message={msg} tenantId={tenantId} />
          )}
        </div>
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border/50 px-4 md:px-8 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="relative rounded-xl border border-border/60 bg-card focus-within:border-violet-500/40 transition-colors">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isActive ? "Message agent… (↵ send · ⇧↵ newline)" : "Deploy the agent to start chatting"}
              rows={3}
              disabled={streaming || !isActive}
              className={cn(
                "resize-none border-0 bg-transparent pr-12 text-sm leading-relaxed rounded-xl",
                "focus-visible:ring-0 focus-visible:ring-offset-0",
                "placeholder:text-muted-foreground/40"
              )}
            />
            <div className="absolute bottom-3 right-3">
              {streaming ? (
                <Button size="sm" variant="ghost" onClick={stopStreaming} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                  <span className="h-3 w-3 rounded-sm bg-current" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={sendMessage}
                  disabled={!input.trim() || !isActive}
                  className="h-7 w-7 p-0"
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground/40 mt-2 text-center">
            {streaming ? "Responding… click ■ to stop" : "↵ send · ⇧↵ newline"}
          </p>
        </div>
      </div>
    </div>
  );
}
