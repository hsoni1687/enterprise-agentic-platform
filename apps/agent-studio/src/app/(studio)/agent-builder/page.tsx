"use client";

import { useAgentBuilder } from "@/components/agent-builder/use-agent-builder";
import { BuilderToolbar } from "@/components/agent-builder/builder-toolbar";
import { PrimitiveLibraryPanel } from "@/components/agent-builder/primitive-library-panel";
import { AgentWorkbench } from "@/components/agent-builder/agent-workbench";
import { InspectorPanel } from "@/components/agent-builder/inspector-panel";
import { ManifestPreviewBar } from "@/components/agent-builder/manifest-preview-bar";

export default function AgentBuilderPage() {
  const state = useAgentBuilder();

  return (
    <div
      className="flex flex-col h-full w-full overflow-hidden"
      style={{ background: "rgba(6,6,11,1)" }}
    >
      {/* Top Toolbar */}
      <BuilderToolbar state={state} />

      {/* Main 3-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Component Library */}
        <PrimitiveLibraryPanel state={state} />

        {/* Center: Structured Workbench */}
        <AgentWorkbench state={state} />

        {/* Right: Inspector */}
        <InspectorPanel state={state} />
      </div>

      {/* Bottom: Manifest Preview Bar */}
      <ManifestPreviewBar state={state} />
    </div>
  );
}
