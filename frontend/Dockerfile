# syntax=docker/dockerfile:1

# --------------------------------------------------------------------------
# WaCRM (MongoDB edition) — multi-stage build.
#
# Build args (inlined into the client bundle at build time):
#   NEXT_PUBLIC_SITE_URL    canonical public URL, e.g. https://whatsapp.stepsolar.in
#   NEXT_PUBLIC_APP_LOCALE  default locale (default: en)
#
# Server-only secrets (MONGO_URL, DB_NAME, JWT_SECRET, ENCRYPTION_KEY,
# META_APP_SECRET, ...) are read at RUNTIME from the container env and must
# NOT be baked into the image.
#
# The builder and runner use the same glibc base image: the standalone
# bundle carries sharp's native binary for next/image, which must match the
# runtime platform.
# --------------------------------------------------------------------------

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

FROM node:22-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_LOCALE=en
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_APP_LOCALE=$NEXT_PUBLIC_APP_LOCALE

RUN yarn build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nextjs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nextjs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
