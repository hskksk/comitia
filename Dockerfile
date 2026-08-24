FROM node:22-bookworm-slim

# Node 22 ships corepack. If its pnpm shim wins, it downloads latest (11+)
# and fails with ERR_PNPM_IGNORED_BUILDS on esbuild.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV COREPACK_ENABLE_PNPM=0
RUN corepack disable \
  && npm install -g pnpm@10.33.3 \
  && pnpm --version

WORKDIR /app

COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.base.json ./

RUN pnpm --version \
  && pnpm install --frozen-lockfile
RUN pnpm build

ENV PORT=8787
ENV HOST=0.0.0.0
EXPOSE 8787

# Image already ran `pnpm build`; do not rebuild web on every start.
CMD ["pnpm", "--filter", "@comitia/board", "start"]
