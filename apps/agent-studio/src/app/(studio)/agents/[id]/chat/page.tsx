"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowLeft,
  Send,
  ChevronDown,
  ChevronRight,
  Wrench,
  Bot,
  Terminal,
  AlertCircle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Coins,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react";
import { agentsApi, kgApi, chatSessionsApi } from "@/lib/api";
import { ChatEvent, Message, ChatSession } from "@/lib/types";
import { clearSession } from "@/lib/chat-session-cache";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTenant } from "@/contexts/tenant-context";
import { useModel } from "@/contexts/model-context";

const API_GATEWAY = process.env.NEXT_PUBLIC_API_GATEWAY_URL ?? "http://localhost:8080";
const WORKFLOW_INITIATOR = "http://localhost:8081";
const CHAT_TIMEOUT_MS = 120_000; // 120 s — LLM + planning can take 30-60 s on local models

// Sentinel key used for a brand-new chat that hasn't been saved to the DB yet.
// When the first message is sent and a DB session is created, all state is migrated
// from this key to the real session ID atomically.
const SESSION_NEW = "__new__";

interface SessionData {
  messages: Message[];
  streaming: boolean;
}

function friendlyError(raw: string): string {
  const r = raw?.toUpperCase?.() ?? "";
  if (r === "FAILED" || r.includes("WORKFLOW") || r.includes("TEMPORAL"))
    return "Agent execution failed. The workflow could not complete — check that the agent's skills and tools are valid and the worker is running.";
  if (r.includes("TIMEOUT") || r.includes("DEADLINE"))
    return "The agent timed out while processing your request. Try a simpler prompt or check that the LLM is reachable.";
  if (r.includes("401") || r.includes("UNAUTHORIZED"))
    return "Unauthorized — invalid or missing API key. Open Models → Connect Provider and re-enter your key.";
  // LLM-level 404: model not found in the provider's catalog
  if (r.includes("LLM API ERROR 404") || r.includes("NOTFOUNDERROR") || r.includes("NOT_FOUND_ERROR") || (r.includes("404") && r.includes("LLM")))
    return "Model not found at the AI provider. The model ID may be incorrect or not available in your account. Go to Models → Connect Provider and re-add the model with its correct ID.";
  // Agent-registry 404 (gateway returns 502 wrapping initiator's 404 body)
  if (r.includes("AGENT_ID") && r.includes("NOT FOUND"))
    return "Agent not found. It may have been deleted — go back to the Agents list.";
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

interface ExtendedChatEvent extends ChatEvent {
  name?: string;
  args?: unknown;
  result?: unknown;
}

function ToolCallBlock({ event }: { event: ChatEvent }) {
  const [expanded, setExpanded] = useState(false);
  const ev = event as ExtendedChatEvent;
  const toolName = ev.tool_name || ev.name || "Unknown Tool";
  const toolArgs = ev.tool_args || ev.args;
  const toolResult = ev.tool_result || ev.result;
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

function ThinkingBlock({ content, streaming }: { content: string; streaming?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="my-1 rounded-lg border border-border/30 bg-muted/20 text-xs overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
      >
        <Terminal className="h-3 w-3 text-violet-400 shrink-0" />
        <span className="text-violet-400 font-medium">Thinking</span>
        {streaming && (
          <span className="ml-1 inline-flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
            <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
            <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
          </span>
        )}
        <span className="ml-auto text-muted-foreground/60">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border/30 px-3 py-2 text-muted-foreground/80 whitespace-pre-wrap leading-relaxed">
          {content}
        </div>
      )}
    </div>
  );
}

// ── Message renderers ─────────────────────────────────────────────────────────

function mergeEvents(events: ChatEvent[]): ChatEvent[] {
  const merged: ChatEvent[] = [];
  for (const ev of events) {
    if (ev.type === "thinking") {
      // Always fold ALL thinking events into the single thinking block (first occurrence)
      const thinkingIdx = merged.findIndex(e => e.type === "thinking");
      if (thinkingIdx >= 0) {
        merged[thinkingIdx] = {
          ...merged[thinkingIdx],
          content: (merged[thinkingIdx].content ?? "") + "\n" + (ev.content ?? ""),
        };
        continue;
      }
    }
    if (ev.type === "tool_call") {
      const argsKey = JSON.stringify(ev.tool_args ?? {});
      const existing = merged.findIndex(
        e => e.type === "tool_call" &&
             e.tool_name === ev.tool_name &&
             JSON.stringify(e.tool_args ?? {}) === argsKey &&
             e.tool_result === undefined
      );
      if (existing >= 0 && ev.tool_result !== undefined) {
        merged[existing] = { ...merged[existing], tool_result: ev.tool_result };
        continue;
      }
    }
    merged.push(ev);
  }
  return merged;
}

function AssistantMessage({ message, tenantId }: { message: Message; tenantId: string }) {
  const hasError = message.content?.startsWith("Error:");
  const mergedEvents = useMemo(() => mergeEvents(message.events ?? []), [message.events]);

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
          {mergedEvents.map((ev, i) => {
            if (ev.type === "thinking" && ev.content) {
              return <ThinkingBlock key={i} content={ev.content} streaming={message.streaming} />;
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
          {/* Token usage footer — shown once streaming completes and we have metadata */}
          {!message.streaming && !hasError && (message.model || message.steps) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/60 font-mono select-none border-t border-border/20 pt-2">
              <Coins className="h-3 w-3 shrink-0 text-muted-foreground/40" />
              {/* Tokens — only show when non-zero (some models don't report them) */}
              {(message.tokensIn ?? 0) > 0 && (
                <span title="Prompt tokens sent to the model">
                  <span className="text-muted-foreground/40">in</span>{" "}
                  <span className="text-foreground/70">{(message.tokensIn!).toLocaleString()}</span>
                </span>
              )}
              {(message.tokensOut ?? 0) > 0 && (
                <span title="Completion tokens generated by the model">
                  <span className="text-muted-foreground/40">out</span>{" "}
                  <span className="text-foreground/70">{(message.tokensOut!).toLocaleString()}</span>
                </span>
              )}
              {(message.tokensIn ?? 0) > 0 && (message.tokensOut ?? 0) > 0 && (
                <span title="Total tokens" className="text-muted-foreground/40">
                  ({((message.tokensIn ?? 0) + (message.tokensOut ?? 0)).toLocaleString()} total)
                </span>
              )}
              {/* Always show steps when available */}
              {(message.steps ?? 0) > 0 && (
                <span title="Reasoning steps taken" className="text-muted-foreground/50">
                  · {message.steps} step{message.steps !== 1 ? "s" : ""}
                </span>
              )}
              {/* Model name */}
              {message.model && (
                <span title={`Model: ${message.model}`} className="text-muted-foreground/40 truncate max-w-[200px]">
                  · {message.model.startsWith("ollama/") ? message.model.slice(7) : message.model}
                </span>
              )}
            </div>
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
  const { model: activeModel } = useModel();

  // ── Per-session state ──────────────────────────────────────────────────────
  // Each chat session (including the unsaved new one) gets its own messages +
  // streaming flag so switching sessions never aborts an in-progress stream.
  const [sessionData, setSessionData] = useState<Record<string, SessionData>>({
    [SESSION_NEW]: { messages: [], streaming: false },
  });

  // Which session the user is currently viewing.
  // null  → the brand-new, not-yet-persisted chat (SESSION_NEW key)
  // string → a DB-backed session ID
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Derived: what the main chat area shows right now
  const currentKey = activeSessionId ?? SESSION_NEW;
  const currentData = sessionData[currentKey] ?? { messages: [], streaming: false };
  const messages = currentData.messages;
  const streaming = currentData.streaming;

  const [input, setInput] = useState("");
  const [sessionLoading, setSessionLoading] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Per-session abort controllers and timeout IDs — keyed by session key
  const abortMapRef = useRef(new Map<string, AbortController>());
  const timeoutMapRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Ref mirror of sessionData so async callbacks read latest without stale closures
  const sessionDataRef = useRef<Record<string, SessionData>>(sessionData);
  useEffect(() => { sessionDataRef.current = sessionData; }, [sessionData]);

  // Ref mirror of current messages so sendMessage can snapshot priorMessages
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

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

  // Re-scroll when the browser tab becomes visible again
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") scrollToBottom(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [scrollToBottom]);

  // Track whether user has scrolled up — show "↓" button when they have
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      setShowScrollBtn(!nearBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Abort ALL active streams on unmount
  useEffect(() => () => {
    abortMapRef.current.forEach(abort => abort.abort());
    timeoutMapRef.current.forEach(timeout => clearTimeout(timeout));
  }, []);

  // ── Load session list on mount ─────────────────────────────────────────────
  useEffect(() => {
    chatSessionsApi.list(id).then(setSessions).catch(() => {/* non-fatal */});
  }, [id]);

  // ── Per-session state helpers ──────────────────────────────────────────────

  const setSessionMsgs = useCallback((key: string, updater: (prev: Message[]) => Message[]) => {
    setSessionData(prev => {
      const cur = prev[key] ?? { messages: [], streaming: false };
      return { ...prev, [key]: { ...cur, messages: updater(cur.messages) } };
    });
  }, []);

  const setSessionStreaming = useCallback((key: string, value: boolean) => {
    setSessionData(prev => {
      const cur = prev[key] ?? { messages: [], streaming: false };
      return { ...prev, [key]: { ...cur, streaming: value } };
    });
  }, []);

  // ── Load a past session ────────────────────────────────────────────────────
  // Does NOT abort other sessions' streams — just switches the view.
  const loadSession = useCallback(async (session: ChatSession) => {
    if (activeSessionId === session.id) return;

    // Switch view immediately — other sessions keep streaming in the background
    setActiveSessionId(session.id);

    // Already have data for this session (migrated from SESSION_NEW or previously loaded)
    if (session.id in sessionDataRef.current) return;

    setSessionLoading(true);
    const targetId = session.id; // capture for catch guard below
    try {
      const full = await chatSessionsApi.get(id, session.id);
      const dbMessages = full.messages ?? [];
      if (dbMessages.length === 0) {
        setSessionMsgs(session.id, () => []);
        return;
      }
      const msgs: Message[] = dbMessages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        events: (m.metadata?.events as ChatEvent[] | undefined) ?? [],
        streaming: false,
        tokensIn:  m.metadata?.tokens_in,
        tokensOut: m.metadata?.tokens_out,
        steps:     m.metadata?.steps,
        model:     m.metadata?.model,
      }));
      // Guard: if a stream was started into this session while we were fetching, keep it
      setSessionMsgs(session.id, (prev) => prev.some((m) => m.streaming) ? prev : msgs);
    } catch {
      // Network error — only deselect if no other click has already changed the active session
      setActiveSessionId(prev => (prev === targetId ? null : prev));
    } finally {
      setSessionLoading(false);
    }
  }, [id, activeSessionId, setSessionMsgs]);

  // ── Delete a session ───────────────────────────────────────────────────────
  const deleteSession = useCallback(async (e: React.MouseEvent, session: ChatSession) => {
    e.stopPropagation();
    e.preventDefault();
    // Abort any in-flight stream for this session
    const abort = abortMapRef.current.get(session.id);
    if (abort) { abort.abort(); abortMapRef.current.delete(session.id); }
    const timeout = timeoutMapRef.current.get(session.id);
    if (timeout) { clearTimeout(timeout); timeoutMapRef.current.delete(session.id); }
    try {
      await chatSessionsApi.delete(id, session.id);
      setSessions(prev => prev.filter(s => s.id !== session.id));
      // Drop session data from the map
      setSessionData(prev => {
        const next = { ...prev };
        delete next[session.id];
        return next;
      });
      if (activeSessionId === session.id) setActiveSessionId(null);
    } catch {
      // non-fatal
    }
  }, [id, activeSessionId]);

  // ── Start a brand-new chat ─────────────────────────────────────────────────
  const startNewChat = useCallback(() => {
    // Only abort/clear the SESSION_NEW stream — real sessions keep running
    const newAbort = abortMapRef.current.get(SESSION_NEW);
    if (newAbort) { newAbort.abort(); abortMapRef.current.delete(SESSION_NEW); }
    const newTimeout = timeoutMapRef.current.get(SESSION_NEW);
    if (newTimeout) { clearTimeout(newTimeout); timeoutMapRef.current.delete(SESSION_NEW); }

    setActiveSessionId(null);
    setSessionData(prev => ({ ...prev, [SESSION_NEW]: { messages: [], streaming: false } }));
    clearSession(id);
  }, [id]);

  // ── Send a message ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    // Capture the session key for this send cycle.
    // keyRef is a plain mutable object (not a React ref) so that pump() always reads the
    // latest key even after the SESSION_NEW → real-ID migration that happens mid-function.
    const sendKey = activeSessionId ?? SESSION_NEW;
    const keyRef = { current: sendKey };

    // Snapshot history BEFORE setSessionMsgs adds the new messages.
    // After any await, messagesRef.current would already include the new user message.
    const priorMessages = messagesRef.current.filter((m) => !m.streaming && m.content);

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: text };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId, role: "assistant", content: "", events: [], streaming: true,
    };

    setSessionMsgs(sendKey, prev => [...prev, userMsg, assistantMsg]);
    setInput("");
    setSessionStreaming(sendKey, true);

    // Ensure we have a DB session — create one on first message if needed
    let sessionId = activeSessionId;
    if (!sessionId) {
      try {
        const title = text.length > 60 ? text.slice(0, 60) + "…" : text;
        const created = await chatSessionsApi.create(id, title, tenantId);
        sessionId = created.id;

        // Atomically migrate SESSION_NEW → real session key so the UI reflects the DB session
        // and pump() (via keyRef) starts writing to the correct key immediately.
        setSessionData(prev => {
          const next = { ...prev };
          next[sessionId!] = next[SESSION_NEW] ?? { messages: [], streaming: true };
          delete next[SESSION_NEW];
          return next;
        });
        keyRef.current = sessionId;
        setActiveSessionId(sessionId);
        setSessions(prev => [created, ...prev]);
      } catch {
        // Session creation failed — continue without DB persistence (key stays SESSION_NEW)
      }
    }

    // Persist user message immediately (don't wait for done — agent might fail/timeout)
    if (sessionId) {
      chatSessionsApi.appendMessages(id, sessionId, [{
        id: userMsg.id,
        session_id: sessionId,
        tenant_id: tenantId,
        agent_id: id,
        role: "user",
        content: userMsg.content,
        metadata: {},
        created_at: new Date().toISOString(),
      }]).catch(() => {/* non-fatal */});
    }

    // Inject context from attached knowledge graphs before sending to the agent.
    let enrichedText = text;
    const kgIds: string[] = agent?.knowledge_graph_ids ?? [];
    if (kgIds.length > 0) {
      const contextParts: string[] = [];
      await Promise.allSettled(
        kgIds.map(async (kgId) => {
          try {
            const result = await kgApi.getGraphContext(kgId, text);
            if (result?.context && result.context !== "(No relevant entities found)") {
              const ctx = result.context.length > 1500
                ? result.context.slice(0, 1500) + "\n…(truncated)"
                : result.context;
              contextParts.push(ctx);
            }
          } catch {
            // non-fatal KG context failure
          }
        })
      );
      if (contextParts.length > 0) {
        enrichedText =
          `--- Knowledge Graph Context ---\n${contextParts.join("\n\n")}\n--- End of Context ---\n\n` +
          text;
      }
    }

    // Prepend prior conversation turns so the LLM has context from earlier in this session.
    if (priorMessages.length > 0) {
      const historyLines = priorMessages
        .slice(-8)
        .map((m) => {
          const label = m.role === "user" ? "User" : "Assistant";
          const body  = m.content.length > 600 ? m.content.slice(0, 600) + "…" : m.content;
          return `${label}: ${body}`;
        })
        .join("\n\n");
      enrichedText =
        `--- Conversation History ---\n${historyLines}\n--- End History ---\n\n` +
        enrichedText;
    }

    // Set up per-session abort controller and timeout.
    // Both are registered under keyRef.current so external callers (deleteSession,
    // startNewChat, unmount) can cancel them by session key.
    const abort = new AbortController();
    abortMapRef.current.set(keyRef.current, abort);

    const timeoutId = setTimeout(() => {
      const k = keyRef.current;
      timeoutMapRef.current.delete(k);
      abortMapRef.current.delete(k);
      abort.abort();
      setSessionMsgs(k, prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: friendlyError("TIMEOUT"), streaming: false }
            : m
        )
      );
      setSessionStreaming(k, false);
    }, CHAT_TIMEOUT_MS);
    timeoutMapRef.current.set(keyRef.current, timeoutId);

    fetch(`${API_GATEWAY}/api/v1/agents/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Tenant-ID": tenantId },
      body: JSON.stringify({
        message: enrichedText,
        tenant_id: tenantId,
        ...(activeModel ? { model_override: activeModel } : {}),
      }),
      signal: abort.signal,
    })
      .then((resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const reader = resp.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        // Local tracking vars so we can persist final content without reading stale state
        let assistantContent = "";
        const assistantEvents: ChatEvent[] = [];

        const pump = async () => {
          // Rolling buffer — keeps a partial line when a read() chunk ends mid-line.
          // Without this, large JSON payloads (600-token responses ≈ 2KB+) that span
          // two read() calls produce a malformed first half whose JSON.parse silently
          // fails, making the content appear blank in the UI.
          let lineBuffer = "";

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              lineBuffer += decoder.decode(value, { stream: true });

              // Extract all complete lines; keep the trailing incomplete fragment.
              const lines = lineBuffer.split("\n");
              lineBuffer = lines.pop() ?? "";

              for (const line of lines) {
                if (line === "" || line.startsWith(":")) continue;

                if (line.startsWith("data: ")) {
                  try {
                    const event: ChatEvent = JSON.parse(line.slice(6));
                    // Always read keyRef.current here — may have migrated after the
                    // first awaited DB call above (SESSION_NEW → realId).
                    const k = keyRef.current;

                    if (event.type === "text" && event.content) assistantContent += event.content;
                    if (event.type === "tool_call" || event.type === "approval") assistantEvents.push(event);

                    setSessionMsgs(k, prev =>
                      prev.map(m => {
                        if (m.id !== assistantId) return m;
                        if (event.type === "text" && event.content)
                          return { ...m, content: m.content + event.content };
                        if (event.type === "thinking") {
                          const evs = m.events ?? [];
                          const thinkingIdx = evs.findIndex(e => e.type === "thinking");
                          if (thinkingIdx >= 0) {
                            const updated = [...evs];
                            updated[thinkingIdx] = {
                              ...updated[thinkingIdx],
                              content: (updated[thinkingIdx].content ?? "") + "\n" + (event.content ?? ""),
                            };
                            return { ...m, events: updated };
                          }
                          return { ...m, events: [...evs, event] };
                        }
                        if (event.type === "tool_call" || event.type === "approval")
                          return { ...m, events: [...(m.events ?? []), event] };
                        if (event.type === "done")
                          return {
                            ...m,
                            streaming: false,
                            tokensIn:  event.tokens_in,
                            tokensOut: event.tokens_out,
                            steps:     event.steps,
                            model:     event.model,
                          };
                        if (event.type === "error")
                          return { ...m, content: friendlyError(event.content ?? ""), streaming: false };
                        return m;
                      })
                    );

                    if (event.type === "done") {
                      clearTimeout(timeoutId);
                      timeoutMapRef.current.delete(k);
                      abortMapRef.current.delete(k);
                      setSessionStreaming(k, false);
                      if (sessionId) {
                        chatSessionsApi.appendMessages(id, sessionId, [{
                          id: assistantId,
                          session_id: sessionId,
                          tenant_id: tenantId,
                          agent_id: id,
                          role: "assistant",
                          content: assistantContent,
                          metadata: {
                            tokens_in:  event.tokens_in,
                            tokens_out: event.tokens_out,
                            steps:      event.steps,
                            model:      event.model,
                            events:     assistantEvents,
                          },
                          created_at: new Date().toISOString(),
                        }])
                          .then(() => chatSessionsApi.list(id).then(setSessions).catch(() => {}))
                          .catch(() => {/* non-fatal */});
                      }
                      return;
                    }
                    if (event.type === "error") {
                      clearTimeout(timeoutId);
                      timeoutMapRef.current.delete(k);
                      abortMapRef.current.delete(k);
                      setSessionStreaming(k, false);
                      return;
                    }
                  } catch {
                    // malformed JSON line — skip and continue
                  }
                }
              }
            }
          } catch (err: unknown) {
            const streamErr = err instanceof Error ? err : null;
            const k = keyRef.current;
            clearTimeout(timeoutId);
            timeoutMapRef.current.delete(k);
            abortMapRef.current.delete(k);
            if (streamErr?.name === "AbortError") return;
            setSessionMsgs(k, prev =>
              prev.map(m =>
                m.id === assistantId
                  ? { ...m, content: friendlyError(streamErr?.message ?? "Stream error"), streaming: false }
                  : m
              )
            );
            setSessionStreaming(k, false);
          }
        };

        pump();
      })
      .catch((err: unknown) => {
        const fetchErr = err instanceof Error ? err : null;
        const k = keyRef.current;
        clearTimeout(timeoutId);
        timeoutMapRef.current.delete(k);
        abortMapRef.current.delete(k);
        if (fetchErr?.name === "AbortError") return;
        setSessionMsgs(k, prev =>
          prev.map(m =>
            m.id === assistantId
              ? { ...m, content: friendlyError(fetchErr?.message ?? ""), streaming: false }
              : m
          )
        );
        setSessionStreaming(k, false);
      });
  }, [id, input, streaming, activeSessionId, tenantId, activeModel, agent, setSessionMsgs, setSessionStreaming, setSessions]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // Stop only the CURRENT session's stream — other sessions keep running
  const stopStreaming = useCallback(() => {
    const abort = abortMapRef.current.get(currentKey);
    if (abort) {
      abort.abort();
      abortMapRef.current.delete(currentKey);
    }
    const timeout = timeoutMapRef.current.get(currentKey);
    if (timeout) {
      clearTimeout(timeout);
      timeoutMapRef.current.delete(currentKey);
    }
    setSessionStreaming(currentKey, false);
    setSessionMsgs(currentKey, prev =>
      prev.map(m => m.streaming ? { ...m, streaming: false } : m)
    );
  }, [currentKey, setSessionMsgs, setSessionStreaming]);

  const isActive = agent?.status === "active";

  return (
    <div className="flex h-full bg-background overflow-hidden">

      {/* ── Sessions sidebar ─────────────────────────────────────────────── */}
      <div className="w-60 shrink-0 border-r border-border/40 flex flex-col bg-card/30 overflow-hidden">
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/40 shrink-0">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Chats
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
            onClick={startNewChat}
            title="New chat"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto py-1">
          {/* Pinned "New Chat" row — always visible, highlighted when no session is selected */}
          <div
            role="button"
            tabIndex={0}
            onClick={startNewChat}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startNewChat(); } }}
            className={cn(
              "w-full text-left px-3 py-2 rounded-md mx-1 text-xs flex items-center gap-2 transition-colors cursor-pointer select-none",
              "hover:bg-muted/60",
              activeSessionId === null
                ? "bg-violet-500/10 text-foreground font-medium"
                : "text-muted-foreground"
            )}
            style={{ width: "calc(100% - 8px)" }}
          >
            <Plus className="h-3 w-3 shrink-0 opacity-60" />
            <span className="truncate">New chat</span>
          </div>
          {sessions.length > 0 && <div className="mx-3 my-1 border-t border-border/30" />}
          {sessions.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/50 text-center py-4 px-3">
              No past chats yet
            </p>
          ) : (
            sessions.map((s) => {
              // Pulsing green dot if this session is actively streaming in the background
              const isSessionStreaming = sessionData[s.id]?.streaming ?? false;
              return (
                // Using div[role=button] instead of <button> so that the delete <button>
                // inside is valid HTML. A <button> inside a <button> is illegal HTML and
                // causes a React hydration error that breaks the entire page.
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => loadSession(s)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      loadSession(s);
                    }
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md mx-1 text-xs group flex items-start gap-2 transition-colors cursor-pointer select-none",
                    "hover:bg-muted/60",
                    activeSessionId === s.id
                      ? "bg-violet-500/10 text-foreground"
                      : "text-muted-foreground"
                  )}
                  style={{ width: "calc(100% - 8px)" }}
                >
                  <MessageSquare className="h-3 w-3 mt-0.5 shrink-0 opacity-50" />
                  <span className="flex-1 truncate leading-snug">{s.title}</span>
                  {/* Live streaming indicator — shown on background sessions */}
                  {isSessionStreaming && (
                    <span
                      className="h-2 w-2 rounded-full bg-green-400 animate-pulse shrink-0 mt-0.5"
                      title="Streaming…"
                    />
                  )}
                  <button
                    onClick={(e) => deleteSession(e, s)}
                    className="opacity-0 group-hover:opacity-60 hover:!opacity-100 shrink-0 text-muted-foreground hover:text-destructive transition-opacity"
                    title="Delete chat"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Main chat area ───────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

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
          <span className="text-xs text-muted-foreground font-mono hidden sm:block">
            {activeModel.startsWith("ollama/") ? activeModel.slice(7) : activeModel}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground shrink-0"
          onClick={startNewChat}
        >
          <RefreshCw className="h-3 w-3 mr-1.5" />
          New Chat
        </Button>
      </div>

      {/* Messages — wrapper is relative so the scroll button can be absolutely positioned */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {/* Scroll-to-bottom button — appears when user has scrolled up during a stream */}
        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-6 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card/90 shadow-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            title="Scroll to latest"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}
      <div ref={scrollRef} className="h-full overflow-y-auto px-4 md:px-8 py-4">
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
      </div>{/* end scroll wrapper */}

      {/* Input */}
      <div className="shrink-0 border-t border-border/50 px-4 md:px-8 py-4">
        <div className="max-w-2xl mx-auto">
          <div className="relative rounded-xl border border-border/60 bg-card focus-within:border-violet-500/40 transition-colors">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                !isActive ? "Deploy the agent to start chatting"
                : sessionLoading ? "Loading chat history…"
                : "Message agent… (↵ send · ⇧↵ newline)"
              }
              rows={3}
              disabled={streaming || !isActive || sessionLoading}
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
                  disabled={!input.trim() || !isActive || sessionLoading}
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

      </div>{/* end main chat area */}
    </div>
  );
}
