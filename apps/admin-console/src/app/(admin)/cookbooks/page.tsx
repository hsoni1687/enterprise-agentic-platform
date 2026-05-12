"use client";

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

export default function CookbooksPage() {
  const [cookbooks, setCookbooks] = useState<Cookbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCookbooks();
  }, []);

  const fetchCookbooks = async () => {
    try {
      const data = await adminApi.listCookbooks();
      setCookbooks(data.cookbooks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-6">Loading cookbooks...</div>;
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h2 className="font-semibold text-red-900 mb-2">Error Loading Cookbooks</h2>
          <p className="text-red-700 text-sm mb-3">{error}</p>
          {error?.includes("Unauthorized") && (
            <p className="text-red-600 text-sm">
              Please ensure you are logged in with the correct admin API key.
              <a href="/login" className="underline ml-2">Go to login →</a>
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">Domain Cookbooks</h1>

      {cookbooks.length === 0 ? (
        <div className="text-gray-500">No cookbooks available</div>
      ) : (
        <div className="grid gap-4">
          {cookbooks.map((cookbook) => (
            <div
              key={cookbook.id}
              className="border rounded-lg p-4 hover:bg-gray-50"
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h2 className="text-xl font-semibold">{cookbook.name}</h2>
                  <p className="text-gray-600 text-sm mt-1">
                    {cookbook.description}
                  </p>
                  <div className="flex gap-2 mt-2">
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
                <Link href={`/cookbooks/${cookbook.id}`}>
                  <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                    View Details
                  </button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
