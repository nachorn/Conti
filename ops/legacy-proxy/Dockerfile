FROM node:22-alpine AS worker-builder
WORKDIR /app
COPY server ./server
COPY shared ./shared
WORKDIR /app/server
RUN node scripts/fix-pocha-imports.cjs && npm ci && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node ops/legacy-proxy/package.json ops/legacy-proxy/index.mjs ops/legacy-proxy/proxy.mjs ops/legacy-proxy/credentials.mjs ./
COPY --from=worker-builder --chown=node:node /app/server/dist/passwordWorker.js ./passwordWorker.js
USER node
CMD ["node", "index.mjs"]
