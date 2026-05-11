"use client";

import { useState } from "react";
import { useApprovals } from "@/hooks/use-approvals";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle, XCircle } from "lucide-react";

interface ApprovalsPanelProps {
  tenantId: string;
}

export function ApprovalsPanel({ tenantId }: ApprovalsPanelProps) {
  const { approvals, loading, error, approve, deny } = useApprovals(tenantId);
  const [denialReasons, setDenialReasons] = useState<Record<string, string>>({});

  if (loading && approvals.length === 0) {
    return <div className="p-4 text-muted-foreground">Loading approvals...</div>;
  }

  if (approvals.length === 0) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No pending approvals
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="border border-destructive/50 bg-destructive/10 p-3 rounded flex gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Error</p>
            <p>{error}</p>
          </div>
        </div>
      )}

      {approvals.map((approval) => (
        <div
          key={approval.id}
          className="border rounded-lg p-4 bg-card space-y-3"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{approval.tool_name}</h3>
                <Badge variant="secondary">Requires Approval</Badge>
              </div>
              <p className="text-sm text-muted-foreground">{approval.reason}</p>
              <p className="text-xs text-muted-foreground">
                Agent: {approval.agent_id}
              </p>
            </div>
          </div>

          {/* Auto-generated tool arguments display */}
          <div className="bg-muted p-3 rounded text-sm">
            <p className="font-semibold mb-2">Tool Arguments:</p>
            <pre className="overflow-auto max-h-40 text-xs whitespace-pre-wrap break-words">
              {JSON.stringify(approval.tool_args, null, 2)}
            </pre>
          </div>

          {/* Denial reason input */}
          <Textarea
            placeholder="Denial reason (optional)"
            value={denialReasons[approval.id] || ""}
            onChange={(e) =>
              setDenialReasons({
                ...denialReasons,
                [approval.id]: e.target.value,
              })
            }
            className="h-20"
          />

          {/* Action buttons */}
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() =>
                deny(approval.id, denialReasons[approval.id] || "")
              }
            >
              <XCircle className="h-4 w-4 mr-2" />
              Deny
            </Button>
            <Button
              variant="default"
              onClick={() => approve(approval.id)}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Approve
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
