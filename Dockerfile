FROM node:22-bookworm-slim

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.base.json ./

RUN pnpm install --frozen-lockfile
RUN pnpm build

ENV PORT=8787
EXPOSE 8787

CMD ["pnpm", "start"]
