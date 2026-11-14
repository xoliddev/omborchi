# ── build ───────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/app/package.json packages/app/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build -w @omborchi/web && npm run build -w @omborchi/api

# ── runtime: one self-contained bundle + the static web app ────────────────
FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 WEB_DIR=/app/web
WORKDIR /app
COPY --from=build /app/apps/api/dist/ ./
COPY --from=build /app/apps/web/dist/ ./web/
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "main.mjs"]
