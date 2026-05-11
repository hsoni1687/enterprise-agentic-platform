"use client";

import { useSearchParams } from "next/navigation";
import { ApprovalsPanel } from "@/components/approvals-panel";

export default function ApprovalsPage() {
  const searchParams = useSearchParams();
  const tenantId = searchParams.get("tenant") || "default-tenant";

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tool Approvals</h1>
          <p className="text-muted-foreground mt-2">
            Review and approve or deny pending tool execution requests that require human verification.
          </p>
        </div>

        <ApprovalsPanel tenantId={tenantId} />
      </div>
    </div>
  );
}
