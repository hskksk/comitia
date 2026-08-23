FROM node:22-bookworm-slim

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.base.json ./

# Pin pnpm (corepack otherwise fetches latest, which may refuse ignored esbuild builds).
RUN corepack enable && corepack prepare pnpm@10.33.3 --activate
RUN pnpm install --frozen-lockfile
RUN pnpm build

ENV PORT=8787
ENV HOST=0.0.0.0
EXPOSE 8787

# Image already ran `pnpm build`; do not rebuild web on every start.
CMD ["pnpm", "--filter", "@comitia/board", "start"]
