"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTenant } from "@/contexts/tenant-context";
import { setRuntimeTenant } from "@/lib/api";
import { kgApi } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Loader2 } from "lucide-react";
import { KGBuilderPanel } from "@/components/kg-builder-panel";
import { KGVisualizer } from "@/components/kg-visualizer";

export default function KnowledgeGraphDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") || "builder";
  const graphId = params.id;
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();

  // Update runtime tenant when it changes
  useEffect(() => {
    setRuntimeTenant(tenantId);
    queryClient.invalidateQueries({ queryKey: ["kg-graph", graphId] });
  }, [tenantId, graphId, queryClient]);

  const { data: graph, isLoading } = useQuery({
    queryKey: ["kg-graph", graphId],
    queryFn: () => kgApi.getGraph(graphId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Loading graph...
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-muted-foreground">Graph not found</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => router.push("/knowledge-graphs")}
          >
            Back to Graphs
          </Button>
        </div>
      </div>
    );
  }

  const handleTabChange = (newTab: string) => {
    router.push(`/knowledge-graphs/${graphId}?tab=${newTab}`);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() => router.push("/knowledge-graphs")}
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{graph.name}</h1>
              {graph.domain && (
                <Badge variant="secondary">{graph.domain}</Badge>
              )}
            </div>
            {graph.description && (
              <p className="text-sm text-muted-foreground mt-1">
                {graph.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Tab buttons */}
      <div className="border-b px-6 pt-4 flex gap-2">
        <Button
          variant={tab === "builder" ? "default" : "outline"}
          size="sm"
          onClick={() => handleTabChange("builder")}
        >
          Builder
        </Button>
        <Button
          variant={tab === "visualizer" ? "default" : "outline"}
          size="sm"
          onClick={() => handleTabChange("visualizer")}
        >
          Visualizer
        </Button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {tab === "builder" && <KGBuilderPanel graphId={graphId} />}
        {tab === "visualizer" && (
          <KGVisualizer graphId={graphId} mode="explore" />
        )}
      </div>
    </div>
  );
}
