# syntax=docker/dockerfile:1.7

FROM node:24-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY packages/examples packages/examples
COPY packages/lib packages/lib

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --filter 'vacp-example-index...' --frozen-lockfile

RUN pnpm build:examples

FROM oven/bun:1-alpine AS runtime

WORKDIR /srv

RUN bunx -y serve --version >/dev/null

COPY --from=build /app/packages/examples/index/dist/ /srv/

EXPOSE 3000

CMD ["bunx", "-y", "serve", "-l", "tcp://0.0.0.0:3000", "/srv"]
