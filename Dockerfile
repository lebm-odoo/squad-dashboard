# syntax=docker/dockerfile:1
FROM oven/bun:1.4.3 AS base
WORKDIR /app

FROM base AS manifests
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

FROM manifests AS build
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY apps apps
COPY packages packages
RUN bun run build

FROM manifests AS runtime-deps
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.3-slim
# The commit the image is built from, shown in the settings: the image holds no .git.
ARG COMMIT
ENV COMMIT=$COMMIT
RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && git config --system --add safe.directory '*' \
  && mkdir -p /data \
  && chown bun:bun /data
WORKDIR /app
COPY --from=runtime-deps /app ./
COPY packages/shared/src packages/shared/src
COPY apps/server/src apps/server/src
COPY apps/server/drizzle apps/server/drizzle
COPY --from=build /app/apps/web/build apps/web/build
ENV NODE_ENV=production RUNTIME=docker HOST=0.0.0.0 PORT=8766 CONFIG_PATH=/data/config.json DATA_DIR=/data SECRET_STORE=file
USER bun
EXPOSE 8766
HEALTHCHECK --interval=30s --timeout=5s \
  CMD bun -e "fetch('http://127.0.0.1:8766/api/health', { headers: { host: 'localhost' } }).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["bun", "apps/server/src/main.ts"]
