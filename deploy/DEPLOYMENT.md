# WaCRM on MongoDB — deployment for `whatsapp.stepsolar.in`

The CRM now runs on MongoDB instead of Supabase. All business data lives in
the same Atlas cluster (and database) the StepSolar backend uses — the
database is `stepsolar`. There is no Postgres schema to migrate; indexes
are created idempotently by the app itself.

---

## Prerequisites

- Docker with `docker compose` (v2) on the host.
- An Atlas connection string for the `stepsolar` database:
  `mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/?appName=...`
  (Network Access must include the host's egress IP).
- Required secrets: `JWT_SECRET`, `ENCRYPTION_KEY` (64 hex chars),
  `META_APP_SECRET`.
- ~10 GB free disk (frontend build layer).

---

## Option A — Docker (recommended for a VPS / the Emergent host)

```bash
cp deploy/.env.example deploy/.env   # then fill in the values
deploy/deploy.sh
```

`deploy/deploy.sh` validates the env file, builds the images, starts the
stack, and waits for both services to be healthy.

Stack (deploy/docker-compose.yml):

| Service   | Port  | Purpose |
|-----------|-------|---------|
| `frontend`| 3000  | Next.js standalone server (screens + all `/api/*` routes) |
| `proxy`   | 8001  | FastAPI ingress proxy: `/api/*` -> `frontend:3000` |

Topology mirrors the Emergent ingress quirk (`/api/*` -> 8001, everything
else -> 3000). If your reverse proxy can point the whole domain at one
upstream, route everything at `frontend:3000` and drop the `proxy`
service — Next.js serves `/api` itself.

Reverse proxy (nginx) mapping:

```
location /api/ { proxy_pass http://127.0.0.1:8001; }   # via proxy
location /     { proxy_pass http://127.0.0.1:3000; }   # direct to Next
```

Health checks: `GET /login` (frontend) and `GET /api/_proxy/health`
(proxy).

### Indexes / first boot

Set `SEED_INDEXES_ON_START=1` in `deploy/.env`. On boot the app creates or
ensures all CRM indexes (unique PKs, partial uniques, TTL on
`realtime.changes`) — idempotent and non-destructive, safe against the
existing StepSolar data. Equivalent manual one-liner:

```bash
cd frontend
MONGO_URL='mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/?appName=...' \
DB_NAME=stepsolar \
node scripts/seed-mongo.mjs
```

---

## Option B — Render (or any Docker platform)

Build context is `frontend/` (its own Dockerfile). Set:

- Build args: `NEXT_PUBLIC_SITE_URL=https://whatsapp.stepsolar.in`,
  `NEXT_PUBLIC_APP_LOCALE=en`
- Runtime env: `MONGO_URL`, `DB_NAME=stepsolar`, `JWT_SECRET`,
  `ENCRYPTION_KEY`, `META_APP_SECRET`, `SEED_INDEXES_ON_START=1`
- Health check: `GET /login`, port 3000.

---

## Environment variables

| Variable | Build/Runtime | Notes |
|---|---|---|
| `MONGO_URL` | runtime | Atlas URI (falls back to `mongodb://localhost:27017`) |
| `DB_NAME` | runtime | default `stepsolar` |
| `JWT_SECRET` | runtime | session tokens; rotating invalidates all sessions |
| `ENCRYPTION_KEY` | runtime | 64 hex chars, AES-256-GCM; do NOT rotate |
| `META_APP_SECRET` | runtime | webhook HMAC verification (required) |
| `META_APP_ID` | runtime | only for image-header message templates |
| `AUTOMATION_CRON_SECRET` | runtime | Wait steps in automations |
| `SEED_INDEXES_ON_START` | runtime | `1` = ensure indexes on boot |
| `NEXT_PUBLIC_SITE_URL` | build | canonical URL, inlined into client bundle |
| `NEXT_PUBLIC_APP_LOCALE` | build | default `en` |

---

## Post-deploy setup (in the app)

1. Open `https://whatsapp.stepsolar.in`, create the first account — it
   becomes the owner of the workspace.
2. **Settings → WhatsApp**: paste Phone Number ID, Access Token, Verify
   Token, WABA ID. These are stored AES-256-GCM-encrypted in Mongo, never
   in the env file.
3. **Meta App → Webhook**: point the webhook URL at
   `https://whatsapp.stepsolar.in/api/whatsapp/webhook`, verify token from
   Settings.
4. **AI Assistant** (optional): paste an OpenAI/Anthropic key under
   Settings → AI Assistant (per-account, encrypted in Mongo).

---

## Updating

```bash
git pull
deploy/deploy.sh          # rebuild + restart; data lives in Atlas
```

The frontend image is stateless (no local writes); media and state live in
Mongo, so redeploys are safe.
