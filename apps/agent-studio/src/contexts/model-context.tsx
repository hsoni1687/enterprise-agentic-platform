"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { modelsApi, ModelInfo } from "@/lib/api";

const STORAGE_KEY = "agent-studio-model";

interface ModelCtx {
  model: string;
  setModel: (id: string) => void;
  availableModels: ModelInfo[];
  isLoading: boolean;
}

const ModelContext = createContext<ModelCtx | null>(null);

export function ModelProvider({ children }: { children: React.ReactNode }) {
  // Stable SSR-safe initial value — localStorage is client-only and cannot be
  // read in a useState initializer (it runs on the server too, causing a
  // hydration mismatch). The useEffect below syncs from storage after mount.
  const [model, _setModel] = useState<string>("");
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    modelsApi
      .list()
      .then((data) => {
        setAvailableModels(data.models);
        const saved = localStorage.getItem(STORAGE_KEY);
        const stillValid = saved && data.models.some((m) => m.id === saved);

        if (stillValid) {
          // Saved model is in the list — keep it (ensure state matches storage)
          _setModel(saved!);
        } else {
          // Saved model is gone (renamed, removed, or was never valid).
          // Always evict it so stale IDs never reach the LLM gateway.
          localStorage.removeItem(STORAGE_KEY);
          if (data.models.length > 0) {
            // Prefer first cloud model; fall back to first local
            const preferred =
              data.models.find((m) => m.source === "cloud") ?? data.models[0];
            _setModel(preferred.id);
            localStorage.setItem(STORAGE_KEY, preferred.id);
          } else {
            // No models configured yet — clear so UI shows "select a model"
            _setModel("");
          }
        }
      })
      .catch(() => setAvailableModels([]))
      .finally(() => setIsLoading(false));
  }, []);

  const setModel = useCallback((id: string) => {
    _setModel(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  return (
    <ModelContext.Provider value={{ model, setModel, availableModels, isLoading }}>
      {children}
    </ModelContext.Provider>
  );
}

export function useModel() {
  const ctx = useContext(ModelContext);
  if (!ctx) throw new Error("useModel must be used within ModelProvider");
  return ctx;
}
