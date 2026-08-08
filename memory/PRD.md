# Abhiwacrm CRM — Deployment PRD

## Original problem statement
Publish the uploaded Abhiwacrm CRM app live on the internet, connected to
custom domain `whatsapp.stepsolar.in`. No feature changes — deploy as-is.

## Source
GitHub: https://github.com/abhishekas91-prog/Abhiwacrm_main
(fork of ArnasDon/wacrm — Next.js 16 + Supabase + Meta WhatsApp)

## Stack (as-shipped)
- Frontend + API: Next.js 16 (App Router, React 19, TS, Tailwind v4)
- DB / Auth: Supabase Postgres (project: cvavqjafypyvzjjdrccp)
- WhatsApp: Meta Cloud API
- Encryption: AES-256-GCM for stored per-account tokens

## Emergent runtime adaptation
- `/app/frontend/` = the Next.js app (yarn start → next dev on :3000)
- `/app/backend/server.py` = FastAPI proxy on :8001 that forwards
  `/api/*` -> `http://127.0.0.1:3000/api/*`, so Emergent's ingress
  (which routes `/api/*` to :8001) reaches Next.js API routes.
- No CRM code was modified.

## Env (frontend/.env.local, non-secret keys tracked here)
- NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY — set with user-provided values
- ENCRYPTION_KEY — 32-byte random hex, generated once
- META_APP_ID (2273714456698993), META_APP_SECRET — set
- AUTOMATION_CRON_SECRET — random
- NEXT_PUBLIC_SITE_URL — preview URL for now, update on domain switch
- WhatsApp token / phone-number-id / verify-token are entered by the
  admin in Settings → WhatsApp and stored encrypted in Postgres (this
  is the built-in flow of the app).

## What's done
- Repo cloned into /app/frontend, deps installed via yarn (npm@10
  packageManager field removed to allow yarn install)
- FastAPI ingress proxy written; httpx added to requirements.txt
- Both services running via supervisor; preview URL reachable, login
  page renders
- All 37 Supabase migrations concatenated into
  /app/deploy/supabase_all_migrations.sql
- /app/deploy/DEPLOYMENT.md written with the three remaining
  user-side steps

## What USER must still do (blocker)
1. Paste /app/deploy/supabase_all_migrations.sql into Supabase SQL Editor
   (project cvavqjafypyvzjjdrccp) and run it once.
2. Sign up in the app to become the first workspace owner, then enter
   WhatsApp creds in Settings → WhatsApp.
3. Attach whatsapp.stepsolar.in via Emergent Publish → Custom Domain,
   then add the CNAME shown at the DNS registrar.

## Backlog / future
- P2: After go-live, switch `next dev` → `next build && next start`
  in package.json for a production build (faster, cached).
- P2: Add /api/health hook into Emergent monitoring.
