"use client";

import Link from "next/link";
import { Cpu, Settings2 } from "lucide-react";
import { useModel } from "@/contexts/model-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ModelSelector() {
  const { model, setModel, availableModels, isLoading } = useModel();

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Cpu className="h-3.5 w-3.5" />
        <span className="opacity-50">loading…</span>
      </div>
    );
  }

  const displayName = (id: string) => id.startsWith("ollama/") ? id.slice(7) : id;

  return (
    <div className="flex items-center gap-1.5">
      <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <Select value={model} onValueChange={(v) => v && setModel(v)}>
        <SelectTrigger className="h-7 w-[160px] text-xs border-none shadow-none focus:ring-0 bg-transparent">
          <SelectValue>
            <span className="truncate">{displayName(model)}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="end" className="min-w-[220px]">
          {availableModels.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No models found</div>
          )}
          {availableModels.map((m) => (
            <SelectItem key={m.id} value={m.id} className="text-xs">
              <div className="flex items-center gap-2 w-full">
                <span className="truncate">{displayName(m.id)}</span>
                <span className={`ml-auto shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                  m.source === "local"
                    ? "bg-green-500/15 text-green-400"
                    : "bg-blue-500/15 text-blue-400"
                }`}>
                  {m.source === "local" ? "Local" : "Cloud"}
                </span>
              </div>
            </SelectItem>
          ))}
          <div className="border-t mt-1 pt-1">
            <Link
              href="/models"
              className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded-sm"
            >
              <Settings2 className="h-3 w-3" />
              Manage models…
            </Link>
          </div>
        </SelectContent>
      </Select>
    </div>
  );
}
