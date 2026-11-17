FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node ops/legacy-proxy/package.json ops/legacy-proxy/index.mjs ops/legacy-proxy/proxy.mjs ./
USER node
CMD ["node", "index.mjs"]
