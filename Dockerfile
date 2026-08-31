# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# ---- runtime --------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# HOME decides where the Google OAuth token cache lives (~/.gsc-mcp), so it
# points at the mounted volume — otherwise a refreshed token would be lost on
# every container restart.
ENV HOME=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Runs as the image's built-in non-root user (uid 1000). The mounted ./data
# directory on the host must be writable by that uid — see the README runbook.
USER node

EXPOSE 8787

# Liveness via the app's own /healthz, using node so the image needs no curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.GSC_HTTP_PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js", "http"]
