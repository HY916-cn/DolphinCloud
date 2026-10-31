# syntax=docker/dockerfile:1
# Component versions follow Supabase's official self-hosted docker-compose.yml.
# Upgrade them together, then rerun docker/smoke-test.sh.
ARG POSTGRES_MAJOR=17
ARG AUTH_VERSION=v2.197.0
ARG POSTGREST_VERSION=v14.18
ARG STORAGE_VERSION=v1.81.0
ARG CADDY_VERSION=2.10
ARG NODE_VERSION=24

FROM supabase/gotrue:${AUTH_VERSION} AS auth
FROM postgrest/postgrest:${POSTGREST_VERSION} AS postgrest
FROM caddy:${CADDY_VERSION} AS caddy
FROM supabase/storage-api:${STORAGE_VERSION} AS storage-upstream

# The upstream Storage image is Alpine (musl); rebuild its one native module for glibc.
FROM node:${NODE_VERSION}-bookworm-slim AS storage
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY --from=storage-upstream /app /app
RUN cd /app && npm rebuild fs-xattr

FROM node:${NODE_VERSION}-bookworm-slim AS node

# The web app (client/), exported as a single-page app.
FROM node:${NODE_VERSION}-bookworm-slim AS client
WORKDIR /client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM postgres:${POSTGRES_MAJOR}-bookworm
ARG DOLPHIN_VERSION=dev
RUN apt-get update \
 && apt-get install -y --no-install-recommends supervisor curl ca-certificates libcap2-bin age "postgresql-$PG_MAJOR-pgtap" \
 && rm -rf /var/lib/apt/lists/*

COPY --from=auth /usr/local/bin/auth /usr/local/bin/auth
COPY --from=auth /usr/local/etc/auth/migrations /usr/local/etc/auth/migrations
COPY --from=postgrest /bin/postgrest /usr/local/bin/postgrest
COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=storage /app /opt/storage

COPY docker/init/ /docker-entrypoint-initdb.d/
COPY supabase/migrations/ /opt/dolphin/migrations/
COPY docker/bin/ /usr/local/bin/
COPY docker/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=client /client/dist/ /srv/www/
# Every service but Postgres runs as dolphin (supervisord.conf); Caddy still binds 80/443 and must read every site file,
# whatever mode it had in the build context.
RUN useradd --system --user-group --no-create-home --home-dir /nonexistent dolphin \
 && setcap cap_net_bind_service=+ep /usr/local/bin/caddy \
 && chmod -R a+rX /srv/www

ENV DOLPHIN_VERSION=${DOLPHIN_VERSION} \
    PGDATA=/data/postgres \
    TZ=Asia/Shanghai \
    BACKUP_TIME=02:00 \
    BACKUP_RETENTION_DAYS=30 \
    XDG_DATA_HOME=/data/caddy \
    XDG_CONFIG_HOME=/data/caddy

VOLUME /data
EXPOSE 80 443
HEALTHCHECK --interval=30s --timeout=10s --start-period=3m --retries=3 CMD ["dolphin", "health"]
ENTRYPOINT ["dolphin-entrypoint"]
