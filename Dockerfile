# 物间 Product Agent production image.
# No user databases, credentials, locally stored media, or model weights are included.
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 AI_ALLOW_PAID_CALLS=false WUJIAN_ALLOW_PAID_CALLS=false
LABEL org.opencontainers.image.title="ProductAgent / Wujian" \
      org.opencontainers.image.description="A local-first life agent grounded in everyday belongings" \
      org.opencontainers.image.source="https://github.com/Starry-Curry/ProductAgent"
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates gosu fontconfig \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    AUTH_MODE=public-demo \
    WUJIAN_DEPLOYMENT=cloud \
    WUJIAN_MODELSCOPE_PROXY=true \
    PRODUCT_AGENT_DATA_DIR=/mnt/workspace/wujian \
    DEMO_REQUIRE_VOLUME=true \
    PORT=7860 \
    DEMO_OPEN_ACCESS=true \
    DEMO_AI_ENABLED=false \
    AI_ALLOW_PAID_CALLS=false \
    WUJIAN_ALLOW_PAID_CALLS=false
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/package.json /app/next.config.mjs ./
COPY --from=build --chown=node:node /app/scripts/cloud-start.mjs /app/scripts/cloud-ops.mjs ./scripts/
COPY --from=build --chown=node:node /app/src/lib/life/data-directory.ts ./src/lib/life/data-directory.ts
COPY --from=build --chown=node:node /app/src/lib/cloud/runtime.ts ./src/lib/cloud/runtime.ts
COPY scripts/docker-entrypoint.sh /usr/local/bin/wujian-entrypoint
RUN chmod +x /usr/local/bin/wujian-entrypoint \
    && mkdir -p /mnt/workspace/wujian /app/.runtime \
    && chown node:node /mnt/workspace/wujian /app/.runtime
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["wujian-entrypoint"]
CMD ["node", "scripts/cloud-start.mjs"]
