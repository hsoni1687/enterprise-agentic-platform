"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { systemAgentsApi, modelsApi } from "@/lib/api";
import { ChatEvent } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronDown } from "lucide-react";
import { KGVisualizer } from "./kg-visualizer";

interface KGBuilderPanelProps {
  graphId: string;
}

export function KGBuilderPanel({ graphId }: KGBuilderPanelProps) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatEvent[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("");
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
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input;
    setInput("");

    setMessages((prev) => [
      ...prev,
      { type: "text", content: userMessage, timestamp: new Date().toISOString() },
    ]);

    setLoading(true);

    try {
      const response = await systemAgentsApi.kgArchitectChat(
        `Graph: ${graphId}\n\n${userMessage}`,
        graphId,
        selectedModel || undefined
      );

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data:")) {
            try {
              const event = JSON.parse(line.slice(5).trim()) as ChatEvent;
              setMessages((prev) => [...prev, event]);

              if (event.type === "tool_call" && event.tool_name?.startsWith("kg-")) {
                queryClient.invalidateQueries({ queryKey: ["kg-nodes", graphId] });
                queryClient.invalidateQueries({ queryKey: ["kg-edges", graphId] });
              }
            } catch (e) {
              console.error("Failed to parse event:", e);
            }
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => [
        ...prev,
        {
          type: "error",
          content: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full gap-4 p-4 overflow-hidden">
      {/* Chat panel (left 70%) */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex-1 flex flex-col border rounded-lg overflow-hidden bg-background">
          <ScrollArea className="flex-1 p-4" ref={scrollRef}>
            <div className="space-y-4">
              {messages.length === 0 && (
                <div className="text-center text-muted-foreground py-8">
                  <p className="text-sm">Chat with KG-Architect to build your knowledge graph.</p>
                  <p className="text-xs mt-2">Describe your domain entities and relationships.</p>
                </div>
              )}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`space-y-2 ${
                    msg.type === "tool_call" || msg.type === "tool_result"
                      ? "bg-muted p-2 rounded-lg"
                      : ""
                  }`}
                >
                  {msg.type === "thinking" && (
                    <div className="text-xs text-muted-foreground italic">
                      Thinking...
                    </div>
                  )}
                  {msg.type === "text" && (
                    <div className="text-sm text-foreground whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  )}
                  {msg.type === "tool_call" && (
                    <div className="text-xs space-y-1">
                      <Badge variant="outline" className="text-xs">
                        Tool Call: {msg.tool_name}
                      </Badge>
                      {!!msg.tool_args && (
                        <pre className="text-xs bg-background p-2 rounded overflow-auto max-h-32 text-foreground whitespace-pre-wrap">
                          {JSON.stringify(msg.tool_args, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                  {msg.type === "tool_result" && (
                    <div className="text-xs space-y-1">
                      <div className="text-muted-foreground">Tool result</div>
                      {typeof msg.tool_result === "object" && (
                        <pre className="text-xs bg-background p-2 rounded overflow-auto max-h-32 text-foreground">
                          {JSON.stringify(msg.tool_result, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                  {msg.type === "error" && (
                    <div className="text-xs text-destructive">
                      Error: {msg.content}
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Processing...
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="border-t p-3 space-y-2">
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
                  <option value="">Default (agent configured)</option>
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}{m.source === "local" ? " (local)" : " (cloud)"}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div className="flex gap-2">
              <Input
                placeholder="Describe nodes, edges, or ask for changes..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={loading}
                className="text-sm h-8"
              />
              <Button
                onClick={handleSendMessage}
                disabled={loading || !input.trim()}
                size="sm"
                className="h-8"
              >
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Send"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Shift+Enter for new line, Enter to send
            </p>
          </div>
        </div>
      </div>

      {/* Preview panel (right 30%) */}
      <div className="w-80 flex flex-col border rounded-lg overflow-hidden bg-background">
        <div className="px-3 py-2 border-b">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase">
            Live Preview
          </h3>
        </div>
        <div className="flex-1 overflow-hidden">
          <KGVisualizer graphId={graphId} mode="preview" />
        </div>
      </div>
    </div>
  );
}
