"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { adminApi, Cookbook, CookbookVariable } from "@/lib/api";
import { useTenant } from "@/contexts/tenant-context";
import { setRuntimeTenant } from "@/lib/api";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

interface ImportResult {
  import_id: string;
  cookbook: string;
  tenant_id: string;
  status: string;
  resources: {
    knowledge_graphs: string[];
    agents: string[];
  };
  warnings?: string[];
}

export default function CookbooksPage() {
  const { tenantId } = useTenant();
  const queryClient = useQueryClient();

  const [selectedCookbook, setSelectedCookbook] = useState<Cookbook | null>(
    null
  );
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Set runtime tenant for consistent behavior with other pages
  useEffect(() => {
    setRuntimeTenant(tenantId);
  }, [tenantId]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["cookbooks"],
    queryFn: () => adminApi.listCookbooks(),
  });

  const importMutation = useMutation({
    mutationFn: () =>
      adminApi.importCookbook(selectedCookbook!.id, tenantId, variables),
    onSuccess: (result) => {
      setImportResult(result as ImportResult);
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      queryClient.invalidateQueries({ queryKey: ["knowledge-graphs"] });
    },
  });

  const handleImportClick = (cookbook: Cookbook) => {
    setSelectedCookbook(cookbook);
    setImportResult(null);
    const vars: Record<string, string> = {};
    cookbook.variables?.forEach((v: CookbookVariable) => {
      vars[v.name] = v.default || "";
    });
    setVariables(vars);
    setSheetOpen(true);
  };

  const handleImportSubmit = () => {
    importMutation.mutate();
  };

  const handleSheetOpenChange = (open: boolean) => {
    setSheetOpen(open);
    if (!open) {
      setSelectedCookbook(null);
      setVariables({});
      setImportResult(null);
      importMutation.reset();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border b-4 border-primary border-t-transparent mx-auto mb-4"></div>
          <p className="text-gray-600">Loading cookbooks...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h2 className="font-semibold text-red-900 mb-2">
            Error Loading Cookbooks
          </h2>
          <p className="text-red-700 text-sm">
            {error instanceof Error
              ? error.message
              : "Unknown error occurred"}
          </p>
          {error instanceof Error &&
            error.message.includes("401") && (
              <p className="text-red-600 text-sm mt-2">
                Please ensure the admin API key is configured correctly.
              </p>
            )}
        </div>
      </div>
    );
  }

  const cookbooks = data?.cookbooks || [];

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Domain Cookbooks</h1>

      {cookbooks.length === 0 ? (
        <div className="border border-dashed rounded-lg p-12 text-center">
          <p className="text-gray-500">No cookbooks available</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cookbooks.map((cookbook) => (
            <div
              key={cookbook.id}
              className="border rounded-lg p-4 hover:bg-gray-50 flex flex-col h-full"
            >
              <div className="flex-1">
                <h2 className="text-lg font-semibold">{cookbook.name}</h2>
                <p className="text-gray-600 text-sm mt-1">
                  {cookbook.description}
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <span className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">
                    {cookbook.domain}
                  </span>
                  <span className="inline-block bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded">
                    v{cookbook.version}
                  </span>
                  {cookbook.tags?.map((tag) => (
                    <span
                      key={tag}
                      className="inline-block bg-green-100 text-green-800 text-xs px-2 py-1 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                {cookbook.variables?.length > 0 && (
                  <div className="mt-2 text-xs text-gray-500">
                    <span className="font-semibold">
                      {cookbook.variables.length}
                    </span>{" "}
                    configuration variable
                    {cookbook.variables.length !== 1 ? "s" : ""}
                  </div>
                )}
              </div>

              <div className="flex gap-2 mt-4">
                <Link href={`/cookbooks/${cookbook.id}`} className="flex-1">
                  <Button variant="outline" className="w-full">
                    View Details
                  </Button>
                </Link>
                <Sheet open={sheetOpen && selectedCookbook?.id === cookbook.id} onOpenChange={handleSheetOpenChange}>
                  <SheetTrigger>
                    <Button
                      className="flex-1"
                      onClick={() => handleImportClick(cookbook)}
                    >
                      Import
                    </Button>
                  </SheetTrigger>

                {selectedCookbook?.id === cookbook.id && (
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle>{selectedCookbook.name}</SheetTitle>
                      <SheetDescription>
                        {selectedCookbook.description}
                      </SheetDescription>
                    </SheetHeader>

                    <div className="space-y-6 mt-6">
                      {/* Target tenant display */}
                      <div>
                        <label className="text-sm font-medium">
                          Importing into
                        </label>
                        <div className="mt-2 inline-block bg-blue-100 text-blue-800 px-3 py-1 rounded text-sm">
                          {tenantId}
                        </div>
                      </div>

                      {/* Variables form */}
                      {selectedCookbook.variables?.length > 0 && (
                        <div>
                          <h3 className="font-semibold text-sm mb-4">
                            Configuration Variables
                          </h3>
                          <div className="space-y-4">
                            {selectedCookbook.variables.map(
                              (variable: CookbookVariable) => (
                                <div key={variable.name}>
                                  <label className="text-sm font-medium">
                                    {variable.name}
                                  </label>
                                  <p className="text-xs text-gray-600 mb-2">
                                    {variable.description}
                                  </p>
                                  <input
                                    type={
                                      variable.type === "string"
                                        ? "text"
                                        : "number"
                                    }
                                    value={variables[variable.name] || ""}
                                    onChange={(e) =>
                                      setVariables({
                                        ...variables,
                                        [variable.name]: e.target.value,
                                      })
                                    }
                                    placeholder={variable.default}
                                    className="w-full border rounded px-3 py-2 text-sm bg-white text-gray-900"
                                  />
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      )}

                      {/* Success state */}
                      {importResult && (
                        <div>
                          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                            <h4 className="font-semibold text-green-900 mb-1">
                              Import Successful
                            </h4>
                            <p className="text-sm text-green-700">
                              Imported {importResult.resources.agents.length}{" "}
                              agent(s) and{" "}
                              {importResult.resources.knowledge_graphs.length}{" "}
                              knowledge graph(s) into{" "}
                              <strong>{tenantId}</strong>
                            </p>
                          </div>

                          {/* Warnings */}
                          {importResult.warnings && importResult.warnings.length > 0 && (
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                              <h5 className="text-sm font-semibold text-yellow-900 mb-2">
                                Warnings
                              </h5>
                              <ul className="text-sm text-yellow-700 list-disc list-inside space-y-1">
                                {importResult.warnings.map((warning, idx) => (
                                  <li key={idx}>{warning}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <div className="flex gap-2">
                            <Link href="/knowledge-graphs">
                              <Button variant="outline" size="sm">
                                View Graphs
                              </Button>
                            </Link>
                            <Link href="/agents">
                              <Button variant="outline" size="sm">
                                View Agents
                              </Button>
                            </Link>
                          </div>

                          <Button
                            onClick={() => handleSheetOpenChange(false)}
                            className="w-full mt-2"
                          >
                            Close
                          </Button>
                        </div>
                      )}

                      {/* Error state */}
                      {importMutation.isError && !importResult && (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                          <p className="text-sm text-red-700">
                            {importMutation.error instanceof Error
                              ? importMutation.error.message
                              : "Import failed"}
                          </p>
                        </div>
                      )}

                      {/* Import button */}
                      {!importResult && (
                        <Button
                          onClick={handleImportSubmit}
                          disabled={importMutation.isPending}
                          className="w-full"
                        >
                          {importMutation.isPending
                            ? "Importing..."
                            : "Import Cookbook"}
                        </Button>
                      )}
                    </div>
                  </SheetContent>
                )}
                </Sheet>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
