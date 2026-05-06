"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, AlertCircle, Download } from "lucide-react";
import { adminApi } from "@/lib/api";

export default function CostPage() {
  const [period, setPeriod] = useState("30d");
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);

  const { data: costData, isLoading, isError, error } = useQuery({
    queryKey: ["cost", period],
    queryFn: () => adminApi.getCostSummary({ period }),
  });

  const { data: tenantCostData } = useQuery({
    queryKey: ["cost-tenant", selectedTenant, period],
    queryFn: () => {
      if (!selectedTenant) return null;
      return adminApi.getCostByTenant(selectedTenant, { period });
    },
    enabled: !!selectedTenant,
  });

  const costs = costData?.costs || [];
  const breakdown = tenantCostData?.breakdown || [];

  const summaryStats = useMemo(() => {
    const totalIn = costs.reduce((sum: number, c: any) => sum + (c.tokens_in || 0), 0);
    const totalCost = costs.reduce((sum: number, c: any) => sum + (c.cost_usd || 0), 0);
    const totalOut = costs.reduce((sum: number, c: any) => sum + (c.tokens_out || 0), 0);
    const total = totalIn + totalOut;
    const mostExpensive = costs.length > 0 ? costs[0] : null;

    return {
      totalTokens: total,
      totalCost: totalCost,
      mostExpensive: mostExpensive?.tenant_id || "N/A",
      tokenIn: totalIn,
      tokenOut: totalOut,
    };
  }, [costs]);

  function formatNumber(num: number): string {
    if (num >= 1000000000) {
      return (num / 1000000000).toFixed(2) + "B";
    }
    if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + "M";
    }
    if (num >= 1000) {
      return (num / 1000).toFixed(2) + "K";
    }
    return num.toString();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Cost Tracking</h1>
        <p className="text-muted-foreground mt-1">
          Token usage and sandbox compute time by tenant and agent
        </p>
      </div>

      {/* Period Selector */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-sm font-medium mb-2">Time Period</label>
            <div className="flex gap-2">
              {["7d", "30d", "90d"].map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    period === p
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-muted text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/80">
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
      </div>

      {isError && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-md">
          <AlertCircle className="h-4 w-4" />
          <span>{error instanceof Error ? error.message : "Failed to load cost data"}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-sm text-muted-foreground">Total Tokens</div>
              <div className="text-3xl font-bold mt-2">{formatNumber(summaryStats.totalTokens)}</div>
              <div className="text-xs text-muted-foreground mt-2">
                In: {formatNumber(summaryStats.tokenIn)} / Out: {formatNumber(summaryStats.tokenOut)}
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-sm text-muted-foreground">Sandbox Time</div>
              <div className="text-3xl font-bold mt-2">
                {formatNumber(costs.reduce((sum: number, c: any) => sum + (c.sandbox_ms || 0), 0))}ms
              </div>
              <div className="text-xs text-muted-foreground mt-2">Total compute time</div>
            </div>

            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-sm text-muted-foreground">Most Active Tenant</div>
              <div className="text-lg font-bold mt-2">{summaryStats.mostExpensive}</div>
              <div className="text-xs text-muted-foreground mt-2">By token usage</div>
            </div>

            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-sm text-muted-foreground">Total Cost</div>
              <div className="text-3xl font-bold mt-2">${summaryStats.totalCost.toFixed(2)}</div>
              <div className="text-xs text-muted-foreground mt-2">USD</div>
            </div>

            <div className="bg-card border border-border rounded-lg p-6">
              <div className="text-sm text-muted-foreground">Tenants</div>
              <div className="text-3xl font-bold mt-2">{costs.length}</div>
              <div className="text-xs text-muted-foreground mt-2">Active in period</div>
            </div>
          </div>

          {/* Tenant Breakdown */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">By Tenant</h2>

            {costs.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border">
                    <tr>
                      <th className="text-left py-3 px-4 font-medium">Tenant ID</th>
                      <th className="text-right py-3 px-4 font-medium">Tokens In</th>
                      <th className="text-right py-3 px-4 font-medium">Tokens Out</th>
                      <th className="text-right py-3 px-4 font-medium">Sandbox (ms)</th>
                      <th className="text-right py-3 px-4 font-medium">Cost (USD)</th>
                      <th className="text-center py-3 px-4 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costs.map((cost: any) => (
                      <tr key={cost.tenant_id} className="border-b border-border hover:bg-muted/30">
                        <td className="py-3 px-4 font-mono text-xs">{cost.tenant_id}</td>
                        <td className="py-3 px-4 text-right">{formatNumber(cost.tokens_in)}</td>
                        <td className="py-3 px-4 text-right">{formatNumber(cost.tokens_out)}</td>
                        <td className="py-3 px-4 text-right">{cost.sandbox_ms.toLocaleString()}</td>
                        <td className="py-3 px-4 text-right">${(cost.cost_usd || 0).toFixed(2)}</td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => setSelectedTenant(cost.tenant_id === selectedTenant ? null : cost.tenant_id)}
                            className="px-2 py-1 rounded text-xs text-muted-foreground hover:bg-muted"
                          >
                            {selectedTenant === cost.tenant_id ? "Hide" : "View"} Breakdown
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted-foreground py-8 text-center">No cost data for this period</p>
            )}
          </div>

          {/* Breakdown by Agent/Skill */}
          {selectedTenant && breakdown.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">Breakdown: {selectedTenant}</h2>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border">
                    <tr>
                      <th className="text-left py-3 px-4 font-medium">Agent ID</th>
                      <th className="text-left py-3 px-4 font-medium">Skill ID</th>
                      <th className="text-right py-3 px-4 font-medium">Tokens In</th>
                      <th className="text-right py-3 px-4 font-medium">Tokens Out</th>
                      <th className="text-right py-3 px-4 font-medium">Sandbox (ms)</th>
                      <th className="text-right py-3 px-4 font-medium">Cost (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.map((item: any, idx: number) => (
                      <tr key={idx} className="border-b border-border hover:bg-muted/30">
                        <td className="py-3 px-4 font-mono text-xs">{item.agent_id || "—"}</td>
                        <td className="py-3 px-4 font-mono text-xs">{item.skill_id || "—"}</td>
                        <td className="py-3 px-4 text-right">{formatNumber(item.tokens_in)}</td>
                        <td className="py-3 px-4 text-right">{formatNumber(item.tokens_out)}</td>
                        <td className="py-3 px-4 text-right">{item.sandbox_ms.toLocaleString()}</td>
                        <td className="py-3 px-4 text-right">${(item.cost_usd || 0).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
