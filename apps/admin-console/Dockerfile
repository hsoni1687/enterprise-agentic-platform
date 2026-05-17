# Builder stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root + workspace package manifests only — npm ci cached unless lockfile changes
COPY package.json package-lock.json ./
COPY apps/admin-console/package.json ./apps/admin-console/

# Install all workspace dependencies (cached layer)
RUN npm ci

# Copy full app source AFTER install so code edits don't bust the install cache
COPY apps/admin-console ./apps/admin-console

# Build
WORKDIR /app/apps/admin-console
RUN npm run build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/apps/admin-console/package.json ./
COPY --from=builder /app/apps/admin-console/.next ./.next
COPY --from=builder /app/apps/admin-console/public ./public
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3001

CMD ["npm", "start"]
