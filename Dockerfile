FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Retain verified package downloads across rebuilds and transient registry failures.
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --no-audit --no-fund

FROM deps AS builder
ARG AUTH_URL="http://localhost:3010"
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID=""
ARG GOOGLE_SITE_VERIFICATION=""
ENV AUTH_URL=$AUTH_URL \
    NEXT_PUBLIC_GA_MEASUREMENT_ID=$NEXT_PUBLIC_GA_MEASUREMENT_ID \
    GOOGLE_SITE_VERIFICATION=$GOOGLE_SITE_VERIFICATION
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM deps AS worker
ENV NODE_ENV=production
COPY src ./src
COPY scripts/ensure-prisma.mjs ./scripts/ensure-prisma.mjs
COPY scripts/check-readiness.ts ./scripts/check-readiness.ts
COPY scripts/verify-smtp.ts ./scripts/verify-smtp.ts
COPY tsconfig.json ./
RUN npx prisma generate
USER node
# Keep the worker itself as PID 1 so SIGTERM reaches its drain handler.
CMD ["node", "--import", "tsx", "src/worker.ts"]

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health', {signal: AbortSignal.timeout(4000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
