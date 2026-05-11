import { useEffect, useState } from "react";

export interface HITLApproval {
  id: string;
  workflow_id: string;
  agent_id: string;
  tool_name: string;
  tool_args: Record<string, any>;
  reason: string;
  created_at: string;
  status: "pending" | "approved" | "denied";
  approved_by?: string;
  approved_at?: string;
  denial_reason?: string;
}

export function useApprovals(tenantId: string) {
  const [approvals, setApprovals] = useState<HITLApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchApprovals = async () => {
      try {
        const response = await fetch(
          "http://localhost:8081/api/v1/approvals/pending",
          {
            headers: { "X-Tenant-ID": tenantId },
          }
        );
        if (!response.ok) throw new Error("Failed to fetch approvals");
        const data = await response.json();
        setApprovals(data || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchApprovals();
    const interval = setInterval(fetchApprovals, 2000); // Poll every 2 seconds
    return () => clearInterval(interval);
  }, [tenantId]);

  const approve = async (id: string) => {
    try {
      const response = await fetch(
        `http://localhost:8081/api/v1/approvals/${id}/approve`,
        {
          method: "POST",
          headers: {
            "X-Tenant-ID": tenantId,
            "X-User-ID": "current-user", // TODO: get from auth context
          },
        }
      );
      if (!response.ok) throw new Error("Failed to approve");
      // Refresh list
      setApprovals(approvals.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const deny = async (id: string, reason: string) => {
    try {
      const response = await fetch(
        `http://localhost:8081/api/v1/approvals/${id}/deny`,
        {
          method: "POST",
          headers: {
            "X-Tenant-ID": tenantId,
            "X-User-ID": "current-user",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reason }),
        }
      );
      if (!response.ok) throw new Error("Failed to deny");
      // Refresh list
      setApprovals(approvals.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  return { approvals, loading, error, approve, deny };
}
