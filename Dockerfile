FROM node:22-bookworm-slim

# Do not let corepack fetch latest pnpm (11+ fails on unapproved esbuild scripts).
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install -g pnpm@10.33.3

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.base.json ./

RUN pnpm install --frozen-lockfile
RUN pnpm build

ENV PORT=8787
# Railway healthchecks are IPv6. 0.0.0.0 is IPv4-only.
ENV HOST=::
EXPOSE 8787

# Image already ran `pnpm build`; do not rebuild web on every start.
CMD ["pnpm", "--filter", "@comitia/board", "start"]
