# Vex Core as one installable image (decision 2 of the master plan: one installation per client).
# Build from the repository root:  docker build -f apps/api/Dockerfile -t vex-core .
#
# No native addons: SQLite is Node's own node:sqlite, and the bundlers run as WebAssembly (the
# overrides in pnpm-workspace.yaml), so the same lockfile installs here as on the Windows machine.

FROM node:24-alpine AS build
RUN npm install -g pnpm@10.34.7
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# What Vex Core serves to the host's page: <vex-assistant> (which carries <vex-avatar>).
RUN pnpm --filter @vexstudio/runtime build && pnpm --filter @vex/assistant build
# Drop the dev tooling (vite, vitest, playwright…); the TypeScript sources run as they are on Node 24.
RUN pnpm prune --prod

FROM node:24-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    VEX_DB=/data/vex.db
# HOST is not loopback here, so the production defaults apply: no demo login, no provider proxy,
# outbound URLs https-only and never private, and CORS_ORIGIN must be set to the host's pages.
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /app /app
USER node
WORKDIR /app/apps/api
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/server.ts"]
