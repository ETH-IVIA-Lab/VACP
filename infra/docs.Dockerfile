# syntax=docker/dockerfile:1.7
FROM node:24.16.0-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json vite.config.ts vite.shared.ts Makefile ./
COPY apps apps
COPY docs docs
COPY examples examples
COPY packages packages
COPY tools tools
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm --filter '@vacp/docs...' build

FROM nginx:stable-alpine AS runtime
COPY --from=build /app/apps/docs/.vitepress/dist/ /usr/share/nginx/html/
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
