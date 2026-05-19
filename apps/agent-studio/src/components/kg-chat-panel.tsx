"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { kgApi, modelsApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, ChevronDown, Send, BookOpen } from "lucide-react";

interface Source {
  id: string;
  label: string;
  type: string;
  description: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  error?: boolean;
}

interface KGChatPanelProps {
  graphId: string;
}

export function KGChatPanel({ graphId }: KGChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: modelsData } = useQuery({
    queryKey: ["models-list"],
    queryFn: () => modelsApi.list(),
    staleTime: 60_000,
  });
  const availableModels = modelsData?.models ?? [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = async () => {
    const question = input.trim();
    if (!question || loading) return;
    setInput("");

    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setLoading(true);

    try {
      const res = await kgApi.graphChat(graphId, question, selectedModel || undefined);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.answer, sources: res.sources },
      ]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: e instanceof Error ? e.message : "Something went wrong.",
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat history */}
      <ScrollArea className="flex-1 px-4 py-4" ref={scrollRef}>
        <div className="max-w-2xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="text-center py-16 space-y-3">
              <BookOpen className="h-10 w-10 text-muted-foreground mx-auto opacity-40" />
              <p className="text-sm font-medium text-muted-foreground">Ask anything about this knowledge graph</p>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {[
                  "What are the main services?",
                  "What depends on the database?",
                  "How does authentication work?",
                  "What are the key relationships?",
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => { setInput(q); }}
                    className="text-[11px] border border-border rounded-full px-3 py-1 text-muted-foreground hover:text-foreground hover:border-violet-500/50 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`space-y-2 ${msg.role === "user" ? "flex justify-end" : ""}`}>
              {msg.role === "user" ? (
                <div className="bg-violet-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm max-w-[80%]">
                  {msg.content}
                </div>
              ) : (
                <div className="space-y-3 max-w-[90%]">
                  <div className={`text-sm leading-relaxed whitespace-pre-wrap ${msg.error ? "text-destructive" : "text-foreground"}`}>
                    {msg.content}
                  </div>

                  {/* Source nodes used */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                        From graph ({msg.sources.length} entities)
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {msg.sources.map((s) => (
                          <span
                            key={s.id}
                            title={s.description}
                            className="inline-flex items-center gap-1 text-[11px] bg-muted border border-border rounded-full px-2 py-0.5 text-muted-foreground"
                          >
                            <span className="text-[9px] opacity-60">{s.type}</span>
                            {s.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Searching graph and generating answer…
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t p-4 space-y-2 bg-background">
        <div className="max-w-2xl mx-auto space-y-2">
          {/* Model picker */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">Model:</span>
            <div className="relative flex-1">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={loading}
                className="w-full appearance-none bg-muted border border-border rounded px-2 py-1 text-xs pr-6 focus:outline-none focus:ring-1 focus:ring-violet-500 disabled:opacity-50"
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
          </div>

          {/* Message input */}
          <div className="flex gap-2">
            <Input
              placeholder="Ask a question about this knowledge graph…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={loading}
              className="text-sm"
            />
            <Button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              size="sm"
              className="gap-1.5 px-4"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Ask
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
