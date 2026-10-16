# syntax=docker/dockerfile:1.7
FROM ghcr.io/pnpm/pnpm:12 AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json vite.config.ts vite.shared.ts ./
COPY patches patches
COPY apps apps
COPY docs docs
COPY examples examples
COPY packages packages
COPY tools tools
RUN --mount=type=cache,id=pnpm-store,target=/var/cache/pnpm \
    pnpm install --frozen-lockfile --store-dir /var/cache/pnpm
# VitePress reads each page's last commit for its "Last updated" stamp.
RUN --mount=type=bind,source=.git,target=.git \
    pnpm --filter '@vacp/docs...' build

FROM nginx:stable-alpine AS runtime
COPY --from=build /app/apps/docs/.vitepress/dist/ /usr/share/nginx/html/
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
