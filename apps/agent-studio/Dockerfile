# ---- deps stage ----
FROM node:22-alpine AS deps

RUN sed -i "s/https/http/g" /etc/apk/repositories
COPY zscaler.pem /usr/local/share/ca-certificates/zscaler.crt
RUN apk add --no-cache ca-certificates && update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/zscaler.crt

WORKDIR /workspace

COPY package.json package-lock.json ./
# Copy all workspace package.json files so npm can initialize the workspace graph
# and hoist packages correctly. Missing workspace manifests cause incorrect hoisting
# which breaks Turbopack's ability to resolve next/package.json at build time.
COPY apps/agent-studio/package.json ./apps/agent-studio/
COPY apps/admin-console/package.json ./apps/admin-console/
COPY packages/ui-components/package.json ./packages/ui-components/
RUN npm ci --workspace apps/agent-studio --include-workspace-root=false --ignore-scripts --strict-ssl=false

# ---- builder stage ----
FROM node:22-alpine AS builder

RUN sed -i "s/https/http/g" /etc/apk/repositories
COPY zscaler.pem /usr/local/share/ca-certificates/zscaler.crt
RUN apk add --no-cache ca-certificates && update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/zscaler.crt

WORKDIR /workspace

COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/apps/agent-studio/node_modules ./apps/agent-studio/node_modules
COPY apps/agent-studio ./apps/agent-studio
COPY package.json ./

# NEXT_PUBLIC_* vars must be set at build time to be embedded in the JS bundle.
# Pass them via --build-arg if the services are not on localhost.
ARG NEXT_PUBLIC_API_GATEWAY_URL=http://localhost:8080
ARG NEXT_PUBLIC_TOOL_REGISTRY_URL=http://localhost:8086
ARG NEXT_PUBLIC_SKILL_CATALOG_URL=http://localhost:8087
ARG NEXT_PUBLIC_AGENT_REGISTRY_URL=http://localhost:8088
ARG NEXT_PUBLIC_KG_SERVICE_URL=http://localhost:8093
ARG NEXT_PUBLIC_LLM_GATEWAY_URL=http://localhost:4000
ARG NEXT_PUBLIC_LLM_GATEWAY_KEY=sk-litellm-dev
ARG NEXT_PUBLIC_OLLAMA_URL=http://localhost:11434
ARG NEXT_PUBLIC_TENANT_ID=default-tenant

ENV NEXT_PUBLIC_API_GATEWAY_URL=$NEXT_PUBLIC_API_GATEWAY_URL
ENV NEXT_PUBLIC_TOOL_REGISTRY_URL=$NEXT_PUBLIC_TOOL_REGISTRY_URL
ENV NEXT_PUBLIC_SKILL_CATALOG_URL=$NEXT_PUBLIC_SKILL_CATALOG_URL
ENV NEXT_PUBLIC_AGENT_REGISTRY_URL=$NEXT_PUBLIC_AGENT_REGISTRY_URL
ENV NEXT_PUBLIC_KG_SERVICE_URL=$NEXT_PUBLIC_KG_SERVICE_URL
ENV NEXT_PUBLIC_LLM_GATEWAY_URL=$NEXT_PUBLIC_LLM_GATEWAY_URL
ENV NEXT_PUBLIC_LLM_GATEWAY_KEY=$NEXT_PUBLIC_LLM_GATEWAY_KEY
ENV NEXT_PUBLIC_OLLAMA_URL=$NEXT_PUBLIC_OLLAMA_URL
ENV NEXT_PUBLIC_TENANT_ID=$NEXT_PUBLIC_TENANT_ID
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /workspace/apps/agent-studio
RUN npm run build

# ---- runner stage ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# standalone output mirrors the monorepo layout:
#   /app/apps/agent-studio/server.js   <- entry point
#   /app/node_modules/                 <- minimal runtime deps
COPY --from=builder /workspace/apps/agent-studio/.next/standalone ./
# static assets and public dir must be adjacent to the app directory
COPY --from=builder /workspace/apps/agent-studio/.next/static ./apps/agent-studio/.next/static
COPY --from=builder /workspace/apps/agent-studio/public ./apps/agent-studio/public

EXPOSE 3000

WORKDIR /app/apps/agent-studio
CMD ["node", "server.js"]
