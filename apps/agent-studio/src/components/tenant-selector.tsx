"use client";

import { useTenant } from "@/contexts/tenant-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2 } from "lucide-react";

export function TenantSelector() {
  const { tenantId, setTenantId, availableTenants, isLoading } = useTenant();

  if (isLoading) return null;

  if (availableTenants.length <= 1) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Building2 className="h-3.5 w-3.5" />
        <span>{tenantId}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
      <Select value={tenantId} onValueChange={(v) => v && setTenantId(v)}>
        <SelectTrigger className="h-7 w-[160px] text-xs border-none shadow-none focus:ring-0 bg-transparent">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {availableTenants.map((t) => (
            <SelectItem
              key={t.tenant_id}
              value={t.tenant_id}
              className="text-xs"
            >
              {t.display_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
