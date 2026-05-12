"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { adminApi } from "@/lib/api";

type Tab = "overview" | "agents" | "knowledge-graphs" | "mcps";

export default function CookbookDetailPage() {
  const params = useParams();
  const router = useRouter();
  const cookbookId = params.id as string;

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [showImportForm, setShowImportForm] = useState(false);
  const [editingFilePath, setEditingFilePath] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const [selectedTenant, setSelectedTenant] = useState("");
  const [importVariables, setImportVariables] = useState<Record<string, string>>({});

  const { data: cookbook, isLoading, isError } = useQuery({
    queryKey: ["cookbook", cookbookId],
    queryFn: () => adminApi.getCookbook(cookbookId),
  });

  const { data: tenants } = useQuery({
    queryKey: ["tenants"],
    queryFn: () => adminApi.listTenants(),
  });

  const updateFileMutation = useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      adminApi.updateCookbookFile(cookbookId, path, content),
    onSuccess: () => {
      setEditingFilePath(null);
      setEditError(null);
      alert("File saved successfully");
    },
    onError: (err) => {
      setEditError(err instanceof Error ? err.message : "Save failed");
    },
  });

  const importMutation = useMutation({
    mutationFn: () =>
      adminApi.importCookbook(cookbookId, selectedTenant, importVariables),
    onSuccess: () => {
      setShowImportForm(false);
      alert("Cookbook imported successfully");
      router.push("/cookbooks");
    },
    onError: (err) => {
      alert(err instanceof Error ? err.message : "Import failed");
    },
  });

  const handleStartEdit = (path: string, content: string) => {
    setEditingFilePath(path);
    setEditContent(content);
    setEditError(null);
  };

  const handleSaveEdit = () => {
    if (!editingFilePath) return;
    updateFileMutation.mutate({ path: editingFilePath, content: editContent });
  };

  const handleImportClick = () => {
    if (!cookbook) return;
    setSelectedTenant("");
    const vars: Record<string, string> = {};
    cookbook.variables?.forEach((v) => {
      vars[v.name] = v.default || "";
    });
    setImportVariables(vars);
    setShowImportForm(true);
  };

  if (isLoading) {
    return <div className="p-6">Loading cookbook details...</div>;
  }

  if (isError || !cookbook) {
    return (
      <div className="p-6">
        <div style={{ backgroundColor: "#fee", border: "1px solid #fcc", borderRadius: "4px", padding: "16px" }}>
          <h2 style={{ fontWeight: "600", color: "#991b1b", marginBottom: "8px" }}>Error</h2>
          <p style={{ color: "#dc2626", fontSize: "14px" }}>Failed to load cookbook details</p>
        </div>
      </div>
    );
  }

  const tabButtons: { label: string; value: Tab }[] = [
    { label: "Overview", value: "overview" },
    { label: `Agents (${cookbook.agents?.length || 0})`, value: "agents" },
    { label: `Knowledge Graphs (${cookbook.knowledge_graphs?.length || 0})`, value: "knowledge-graphs" },
    { label: `MCPs (${cookbook.mcp_recommendations?.length || 0})`, value: "mcps" },
  ];

  return (
    <div style={{ padding: "24px", maxWidth: "1280px" }}>
      <Link href="/cookbooks" style={{ color: "#2563eb", textDecoration: "underline", display: "inline-block", marginBottom: "16px" }}>
        ← Back to Cookbooks
      </Link>

      <div style={{ marginTop: "24px", marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: "36px", fontWeight: "bold" }}>{cookbook.name}</h1>
            <p style={{ color: "#4b5563", fontSize: "18px", marginTop: "8px" }}>{cookbook.description}</p>
            <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
              <span style={{ backgroundColor: "#dbeafe", color: "#1e40af", fontSize: "12px", padding: "4px 12px", borderRadius: "4px" }}>
                {cookbook.domain}
              </span>
              <span style={{ backgroundColor: "#f3f4f6", color: "#374151", fontSize: "12px", padding: "4px 12px", borderRadius: "4px" }}>
                v{cookbook.version}
              </span>
              {cookbook.tags?.map((tag) => (
                <span key={tag} style={{ backgroundColor: "#dcfce7", color: "#15803d", fontSize: "12px", padding: "4px 12px", borderRadius: "4px" }}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={handleImportClick}
            style={{
              backgroundColor: "#2563eb",
              color: "white",
              padding: "8px 16px",
              borderRadius: "4px",
              border: "none",
              cursor: "pointer",
              fontWeight: "500",
            }}
          >
            Import Cookbook
          </button>
        </div>
      </div>

      {/* Import Form */}
      {showImportForm && (
        <div style={{ backgroundColor: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "24px", marginBottom: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h2 style={{ fontSize: "20px", fontWeight: "600" }}>Import {cookbook.name}</h2>
            <button onClick={() => setShowImportForm(false)} style={{ backgroundColor: "transparent", border: "none", cursor: "pointer", fontSize: "20px" }}>
              ×
            </button>
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "8px" }}>Tenant</label>
            <select
              value={selectedTenant}
              onChange={(e) => setSelectedTenant(e.target.value)}
              style={{
                width: "100%",
                border: "1px solid #d1d5db",
                borderRadius: "4px",
                padding: "8px 12px",
                backgroundColor: "white",
                color: "#111827",
              }}
            >
              <option value="">Select a tenant...</option>
              {tenants?.tenants?.map((t: any) => (
                <option key={t.tenant_id} value={t.tenant_id}>
                  {t.display_name} ({t.tenant_id})
                </option>
              ))}
            </select>
          </div>

          {Object.keys(importVariables).length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <h3 style={{ fontWeight: "600", marginBottom: "16px" }}>Configuration Variables</h3>
              {cookbook.variables?.map((variable) => (
                <div key={variable.name} style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontSize: "14px", fontWeight: "500", marginBottom: "4px" }}>
                    {variable.name}
                  </label>
                  <p style={{ fontSize: "12px", color: "#6b7280", marginBottom: "8px" }}>{variable.description}</p>
                  <input
                    type={variable.type === "string" ? "text" : "number"}
                    value={importVariables[variable.name] || ""}
                    onChange={(e) =>
                      setImportVariables({
                        ...importVariables,
                        [variable.name]: e.target.value,
                      })
                    }
                    placeholder={variable.default}
                    style={{
                      width: "100%",
                      border: "1px solid #d1d5db",
                      borderRadius: "4px",
                      padding: "8px 12px",
                      fontSize: "14px",
                      backgroundColor: "white",
                      color: "#111827",
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending || !selectedTenant}
              style={{
                flex: 1,
                backgroundColor: selectedTenant ? "#2563eb" : "#d1d5db",
                color: "white",
                padding: "8px 16px",
                borderRadius: "4px",
                border: "none",
                cursor: selectedTenant ? "pointer" : "not-allowed",
                fontWeight: "500",
              }}
            >
              {importMutation.isPending ? "Importing..." : "Import Cookbook"}
            </button>
            <button
              onClick={() => setShowImportForm(false)}
              style={{
                flex: 1,
                backgroundColor: "white",
                color: "#111827",
                padding: "8px 16px",
                borderRadius: "4px",
                border: "1px solid #d1d5db",
                cursor: "pointer",
                fontWeight: "500",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ borderBottom: "1px solid #e5e7eb", marginBottom: "24px" }}>
        <div style={{ display: "flex", gap: "32px" }}>
          {tabButtons.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              style={{
                paddingBottom: "12px",
                fontSize: "14px",
                fontWeight: "500",
                border: "none",
                backgroundColor: "transparent",
                cursor: "pointer",
                borderBottom: activeTab === tab.value ? "2px solid #2563eb" : "2px solid transparent",
                color: activeTab === tab.value ? "#2563eb" : "#4b5563",
                transition: "all 0.2s",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div>
        {/* Overview Tab */}
        {activeTab === "overview" && (
          <div style={{ display: "grid", gap: "24px" }}>
            <div style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "24px" }}>
              <h3 style={{ fontWeight: "600", marginBottom: "16px" }}>Variables</h3>
              {cookbook.variables?.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: "14px", borderCollapse: "collapse" }}>
                    <thead style={{ backgroundColor: "#f9fafb" }}>
                      <tr>
                        <th style={{ textAlign: "left", padding: "12px", fontWeight: "600", borderBottom: "1px solid #e5e7eb" }}>Name</th>
                        <th style={{ textAlign: "left", padding: "12px", fontWeight: "600", borderBottom: "1px solid #e5e7eb" }}>Description</th>
                        <th style={{ textAlign: "left", padding: "12px", fontWeight: "600", borderBottom: "1px solid #e5e7eb" }}>Default</th>
                        <th style={{ textAlign: "left", padding: "12px", fontWeight: "600", borderBottom: "1px solid #e5e7eb" }}>Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cookbook.variables.map((v) => (
                        <tr key={v.name}>
                          <td style={{ padding: "12px", borderBottom: "1px solid #e5e7eb", fontFamily: "monospace" }}>{v.name}</td>
                          <td style={{ padding: "12px", borderBottom: "1px solid #e5e7eb" }}>{v.description}</td>
                          <td style={{ padding: "12px", borderBottom: "1px solid #e5e7eb" }}>{v.default}</td>
                          <td style={{ padding: "12px", borderBottom: "1px solid #e5e7eb" }}>{v.type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ color: "#6b7280" }}>No variables</p>
              )}
            </div>

            <div style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "24px" }}>
              <h3 style={{ fontWeight: "600", marginBottom: "16px" }}>Artifacts Summary</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
                <div>
                  <div style={{ fontSize: "24px", fontWeight: "bold" }}>{cookbook.agents?.length || 0}</div>
                  <div style={{ fontSize: "14px", color: "#6b7280" }}>Agents</div>
                </div>
                <div>
                  <div style={{ fontSize: "24px", fontWeight: "bold" }}>{cookbook.knowledge_graphs?.length || 0}</div>
                  <div style={{ fontSize: "14px", color: "#6b7280" }}>Knowledge Graphs</div>
                </div>
                <div>
                  <div style={{ fontSize: "24px", fontWeight: "bold" }}>{cookbook.mcp_recommendations?.length || 0}</div>
                  <div style={{ fontSize: "14px", color: "#6b7280" }}>MCP Recommendations</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Agents Tab */}
        {activeTab === "agents" && (
          <div style={{ display: "grid", gap: "16px" }}>
            {cookbook.agents?.length > 0 ? (
              cookbook.agents.map((agent) => (
                <div key={agent.file} style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ fontWeight: "600", fontFamily: "monospace", fontSize: "14px" }}>{agent.file}</h3>
                      <p style={{ color: "#6b7280", fontSize: "14px", marginTop: "4px" }}>{agent.description}</p>
                    </div>
                    <button
                      onClick={() => handleStartEdit(agent.file, agent.content)}
                      style={{
                        backgroundColor: "white",
                        color: "#2563eb",
                        border: "1px solid #2563eb",
                        padding: "4px 12px",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "500",
                      }}
                    >
                      Edit YAML
                    </button>
                  </div>

                  {editingFilePath === agent.file && (
                    <div style={{ marginTop: "16px", borderTop: "1px solid #e5e7eb", paddingTop: "16px" }}>
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        style={{
                          width: "100%",
                          border: "1px solid #d1d5db",
                          borderRadius: "4px",
                          padding: "8px",
                          fontFamily: "monospace",
                          fontSize: "12px",
                          backgroundColor: "#f9fafb",
                          color: "#111827",
                          height: "300px",
                        }}
                      />
                      {editError && (
                        <div style={{ backgroundColor: "#fee2e2", border: "1px solid #fecaca", borderRadius: "4px", padding: "12px", marginTop: "8px" }}>
                          <p style={{ fontSize: "14px", color: "#991b1b" }}>{editError}</p>
                        </div>
                      )}
                      <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                        <button
                          onClick={handleSaveEdit}
                          disabled={updateFileMutation.isPending}
                          style={{
                            flex: 1,
                            backgroundColor: "#2563eb",
                            color: "white",
                            padding: "8px 16px",
                            borderRadius: "4px",
                            border: "none",
                            cursor: "pointer",
                            fontWeight: "500",
                          }}
                        >
                          {updateFileMutation.isPending ? "Saving..." : "Save Changes"}
                        </button>
                        <button
                          onClick={() => setEditingFilePath(null)}
                          style={{
                            flex: 1,
                            backgroundColor: "white",
                            color: "#111827",
                            padding: "8px 16px",
                            borderRadius: "4px",
                            border: "1px solid #d1d5db",
                            cursor: "pointer",
                            fontWeight: "500",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p style={{ color: "#6b7280" }}>No agents</p>
            )}
          </div>
        )}

        {/* Knowledge Graphs Tab */}
        {activeTab === "knowledge-graphs" && (
          <div style={{ display: "grid", gap: "16px" }}>
            {cookbook.knowledge_graphs?.length > 0 ? (
              cookbook.knowledge_graphs.map((kg) => (
                <div key={kg.name} style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px" }}>
                  <h3 style={{ fontWeight: "600" }}>{kg.name}</h3>
                  <p style={{ color: "#6b7280", fontSize: "14px", marginTop: "4px" }}>{kg.description}</p>
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <button
                      onClick={() => handleStartEdit(kg.schema_file, kg.schema_content)}
                      style={{
                        backgroundColor: "white",
                        color: "#2563eb",
                        border: "1px solid #2563eb",
                        padding: "4px 12px",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "500",
                      }}
                    >
                      Edit Schema
                    </button>
                    <button
                      onClick={() => handleStartEdit(kg.seed_data_file, kg.seed_content)}
                      style={{
                        backgroundColor: "white",
                        color: "#2563eb",
                        border: "1px solid #2563eb",
                        padding: "4px 12px",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "500",
                      }}
                    >
                      Edit Seed Data
                    </button>
                  </div>

                  {(editingFilePath === kg.schema_file || editingFilePath === kg.seed_data_file) && (
                    <div style={{ marginTop: "16px", borderTop: "1px solid #e5e7eb", paddingTop: "16px" }}>
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        style={{
                          width: "100%",
                          border: "1px solid #d1d5db",
                          borderRadius: "4px",
                          padding: "8px",
                          fontFamily: "monospace",
                          fontSize: "12px",
                          backgroundColor: "#f9fafb",
                          color: "#111827",
                          height: "300px",
                        }}
                      />
                      {editError && (
                        <div style={{ backgroundColor: "#fee2e2", border: "1px solid #fecaca", borderRadius: "4px", padding: "12px", marginTop: "8px" }}>
                          <p style={{ fontSize: "14px", color: "#991b1b" }}>{editError}</p>
                        </div>
                      )}
                      <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                        <button
                          onClick={handleSaveEdit}
                          disabled={updateFileMutation.isPending}
                          style={{
                            flex: 1,
                            backgroundColor: "#2563eb",
                            color: "white",
                            padding: "8px 16px",
                            borderRadius: "4px",
                            border: "none",
                            cursor: "pointer",
                            fontWeight: "500",
                          }}
                        >
                          {updateFileMutation.isPending ? "Saving..." : "Save Changes"}
                        </button>
                        <button
                          onClick={() => setEditingFilePath(null)}
                          style={{
                            flex: 1,
                            backgroundColor: "white",
                            color: "#111827",
                            padding: "8px 16px",
                            borderRadius: "4px",
                            border: "1px solid #d1d5db",
                            cursor: "pointer",
                            fontWeight: "500",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p style={{ color: "#6b7280" }}>No knowledge graphs</p>
            )}
          </div>
        )}

        {/* MCPs Tab */}
        {activeTab === "mcps" && (
          <div style={{ display: "grid", gap: "16px" }}>
            {cookbook.mcp_recommendations?.length > 0 ? (
              cookbook.mcp_recommendations.map((mcp) => (
                <div key={mcp.name} style={{ backgroundColor: "white", border: "1px solid #e5e7eb", borderRadius: "8px", padding: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <h3 style={{ fontWeight: "600" }}>{mcp.name}</h3>
                      <p style={{ color: "#6b7280", fontSize: "14px", marginTop: "4px" }}>{mcp.description}</p>
                    </div>
                    {mcp.required && (
                      <span style={{ backgroundColor: "#fee2e2", color: "#991b1b", fontSize: "12px", padding: "4px 8px", borderRadius: "4px" }}>
                        Required
                      </span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p style={{ color: "#6b7280" }}>No MCP recommendations</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
