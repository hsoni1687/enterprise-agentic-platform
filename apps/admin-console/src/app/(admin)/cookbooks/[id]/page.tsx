"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import Link from "next/link";
import { adminApi } from "@/lib/api";

interface CookbookVariable {
  name: string;
  description: string;
  default: string;
  type: string;
}

interface Cookbook {
  id: string;
  name: string;
  version: string;
  description: string;
  domain: string;
  tags: string[];
  variables: CookbookVariable[];
}

interface Tenant {
  tenant_id: string;
  display_name: string;
}

export default function CookbookImportPage() {
  const params = useParams();
  const router = useRouter();
  const cookbookId = params.id as string;

  const [cookbook, setCookbook] = useState<Cookbook | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedTenant, setSelectedTenant] = useState("");
  const [variables, setVariables] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const cbData = await adminApi.listCookbooks();
      const found = cbData.cookbooks?.find(
        (cb: Cookbook) => cb.id === cookbookId
      );
      if (found) {
        setCookbook(found);
        const vars: Record<string, string> = {};
        found.variables?.forEach((v: CookbookVariable) => {
          vars[v.name] = v.default || "";
        });
        setVariables(vars);
      }

      const tData = await adminApi.listTenants();
      setTenants(tData.tenants || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!selectedTenant) {
      setError("Please select a tenant");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const result = await adminApi.importCookbook(
        cookbookId,
        selectedTenant,
        variables
      );
      alert(
        `Cookbook imported successfully! Import ID: ${result.import_id}`
      );
      router.push("/cookbooks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  if (!cookbook) {
    return <div className="p-6 text-red-600">Cookbook not found</div>;
  }

  return (
    <div className="p-6 max-w-2xl">
      <Link href="/cookbooks" className="text-blue-600 hover:underline mb-4 block">
        ← Back to Cookbooks
      </Link>

      <div className="mt-4">
        <h1 className="text-3xl font-bold">{cookbook.name}</h1>
        <p className="text-gray-600 mt-2">{cookbook.description}</p>
        <div className="flex gap-2 mt-3">
          <span className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">
            {cookbook.domain}
          </span>
          <span className="inline-block bg-gray-100 text-gray-800 text-xs px-2 py-1 rounded">
            v{cookbook.version}
          </span>
        </div>
      </div>

      <div className="mt-8 border rounded-lg p-6 bg-gray-50">
        <h2 className="text-xl font-semibold mb-4">Import Configuration</h2>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">
            {error}
          </div>
        )}

        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Tenant</label>
          <select
            value={selectedTenant}
            onChange={(e) => setSelectedTenant(e.target.value)}
            className="w-full border rounded px-3 py-2"
          >
            <option value="">Select a tenant...</option>
            {tenants.map((t) => (
              <option key={t.tenant_id} value={t.tenant_id}>
                {t.display_name} ({t.tenant_id})
              </option>
            ))}
          </select>
        </div>

        {cookbook.variables && cookbook.variables.length > 0 && (
          <div className="mb-6">
            <h3 className="font-semibold mb-4">Configuration Variables</h3>
            {cookbook.variables.map((variable) => (
              <div key={variable.name} className="mb-4">
                <label className="block text-sm font-medium mb-1">
                  {variable.name}
                </label>
                <p className="text-xs text-gray-600 mb-2">
                  {variable.description}
                </p>
                <input
                  type={variable.type === "string" ? "text" : "number"}
                  value={variables[variable.name] || ""}
                  onChange={(e) =>
                    setVariables({
                      ...variables,
                      [variable.name]: e.target.value,
                    })
                  }
                  placeholder={variable.default}
                  className="w-full border rounded px-3 py-2"
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleImport}
            disabled={importing || !selectedTenant}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
          >
            {importing ? "Importing..." : "Import Cookbook"}
          </button>
          <Link href="/cookbooks">
            <button className="px-4 py-2 border rounded hover:bg-gray-100">
              Cancel
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
