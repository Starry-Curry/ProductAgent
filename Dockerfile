FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 AI_ALLOW_PAID_CALLS=false WUJIAN_ALLOW_PAID_CALLS=false
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates gosu fontconfig && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 AUTH_MODE=public-demo WUJIAN_DEPLOYMENT=cloud PRODUCT_AGENT_DATA_DIR=/data/wujian DEMO_REQUIRE_VOLUME=true PORT=3000 DEMO_AI_ENABLED=false AI_ALLOW_PAID_CALLS=false WUJIAN_ALLOW_PAID_CALLS=false
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/package.json /app/next.config.mjs ./
COPY --from=build --chown=node:node /app/scripts/cloud-start.mjs /app/scripts/cloud-ops.mjs ./scripts/
COPY --from=build --chown=node:node /app/src/lib/life/data-directory.ts ./src/lib/life/data-directory.ts
COPY --from=build --chown=node:node /app/src/lib/cloud/runtime.ts ./src/lib/cloud/runtime.ts
COPY scripts/docker-entrypoint.sh /usr/local/bin/wujian-entrypoint
RUN chmod +x /usr/local/bin/wujian-entrypoint && mkdir -p /data/wujian /app/.runtime && chown node:node /data/wujian /app/.runtime
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["wujian-entrypoint"]

CMD ["node", "scripts/cloud-start.mjs"]
