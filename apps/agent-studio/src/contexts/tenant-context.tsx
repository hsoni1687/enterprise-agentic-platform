"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { setRuntimeTenant, getRuntimeTenant, adminApi, Tenant } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

const STORAGE_KEY = "agent-studio-tenant-id";

interface TenantCtx {
  tenantId: string;
  setTenantId: (id: string) => void;
  availableTenants: Tenant[];
  isLoading: boolean;
}

const TenantContext = createContext<TenantCtx | null>(null);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  // Use a stable SSR-safe initial value. Reading localStorage in the useState
  // initializer causes a hydration mismatch because the server has no window.
  const [tenantId, _setTenantId] = useState<string>(getRuntimeTenant());
  const [availableTenants, setAvailableTenants] = useState<Tenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // After hydration, sync from localStorage (client-only).
  // Also pushes the resolved tenant into the api module.
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const resolved = stored ?? getRuntimeTenant();
    if (resolved !== tenantId) {
      _setTenantId(resolved);
    }
    setRuntimeTenant(resolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch tenant list from Admin API
  useEffect(() => {
    adminApi
      .listTenants()
      .then((data) =>
        setAvailableTenants(data.tenants.filter((t) => t.status === "active"))
      )
      .catch(() =>
        setAvailableTenants([
          { tenant_id: tenantId, display_name: tenantId, status: "active" },
        ])
      )
      .finally(() => setIsLoading(false));
  }, [tenantId]);

  const setTenantId = useCallback(
    (id: string) => {
      _setTenantId(id);
      setRuntimeTenant(id);
      localStorage.setItem(STORAGE_KEY, id);
      queryClient.invalidateQueries();
    },
    [queryClient]
  );

  return (
    <TenantContext.Provider
      value={{ tenantId, setTenantId, availableTenants, isLoading }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error("useTenant must be used within TenantProvider");
  return ctx;
}
