# syntax=docker/dockerfile:1.7
FROM ghcr.io/pnpm/pnpm:12 AS build
# pnpm evaluates .pnpmfile.mjs with Node.js before it installs devEngines.runtime. The node shim
# runs the runtime that devEngines.runtime names, so the pnpmfile and the scripts share it.
RUN pnpm shim add node
WORKDIR /app
COPY .pnpmfile.mjs package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vite.shared.ts ./
COPY patches patches
COPY apps apps
COPY examples examples
COPY packages packages
COPY scripts scripts
COPY tools tools
RUN --mount=type=cache,id=pnpm-store,target=/var/cache/pnpm \
    pnpm install --frozen-lockfile --store-dir /var/cache/pnpm
RUN pnpm --filter @ethivia/vacp-examples build

FROM nginx:stable-alpine AS runtime
COPY --from=build /app/examples/gallery/dist/ /usr/share/nginx/html/
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
