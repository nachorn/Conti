# Server only. Railway uses this instead of Railpack when present.
# Fix script runs before tsc so shared/pochaTypes import is rewritten to local.
FROM node:22-alpine AS builder

WORKDIR /app
COPY server ./server
COPY shared ./shared

WORKDIR /app/server
RUN node scripts/fix-pocha-imports.cjs
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/package.json ./
RUN npm install --omit=dev

CMD ["node", "dist/index.js"]
