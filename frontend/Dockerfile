# syntax=docker/dockerfile:1

# Production Dockerfile for the WaCRM Next.js app.
# This app serves BOTH the frontend UI and the /api/* routes
# (including /api/whatsapp/webhook) directly — no separate proxy needed.

FROM node:20-slim AS deps
WORKDIR /app
COPY package.json yarn.lock .yarnrc ./
RUN corepack enable && yarn install --frozen-lockfile

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN NODE_OPTIONS=--max-old-space-size=6144 npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.* ./

EXPOSE 3000
CMD ["npm", "run", "start"]
