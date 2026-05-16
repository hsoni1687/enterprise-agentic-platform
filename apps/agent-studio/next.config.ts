import type { NextConfig } from "next";

type RuntimeGlobal = typeof globalThis & {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

const runtimeEnv = (globalThis as RuntimeGlobal).process?.env ?? {};

const nextConfig: NextConfig = {
  output: "standalone",
  // Turbopack needs to know the monorepo workspace root so it can resolve
  // packages installed in the root node_modules (e.g. next itself).
  turbopack: {
    root: new URL("../..", import.meta.url).pathname,
  },
  async rewrites() {
    const gatewayUrl =
      runtimeEnv.API_GATEWAY_URL ?? "http://localhost:8080";
    return [
      {
        source: "/api/:path*",
        destination: `${gatewayUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
