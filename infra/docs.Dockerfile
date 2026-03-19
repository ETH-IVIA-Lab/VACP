# syntax=docker/dockerfile:1.7

FROM node:24-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY docs/package.json docs/package.json

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --filter @vacp/docs... --frozen-lockfile

COPY tsconfig.base.json tsconfig.base.json
COPY docs docs

RUN pnpm docs:build

FROM oven/bun:1-alpine AS runtime

WORKDIR /srv

RUN bunx -y serve --version >/dev/null

COPY --from=build /app/docs/.vitepress/dist/ /srv/

EXPOSE 3000

CMD ["bunx", "-y", "serve", "-l", "tcp://0.0.0.0:3000", "/srv"]
