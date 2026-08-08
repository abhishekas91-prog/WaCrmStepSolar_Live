# Abhiwacrm — final deployment steps

The app is running live at:
**https://c3c98d31-c5c7-4148-9411-c1a26f6c7148.preview.emergentagent.com/login**

Two things are left, and they need actions **you** must do (I don't
have access to your Supabase dashboard or your DNS registrar).

---

## Step 1 — Run the database migrations in Supabase (5 minutes, one time)

Your Supabase project is empty right now. Without the schema, sign-up
will fail with a Postgres error.

1. Open <https://supabase.com/dashboard/project/cvavqjafypyvzjjdrccp/sql/new>
2. Open the file **`/app/deploy/supabase_all_migrations.sql`** (37 migrations,
   ~5100 lines) — copy its entire contents.
3. Paste into the SQL editor. Click **Run**.
4. Wait ~30–60 s. You should see "Success. No rows returned."
5. In **Authentication → Providers → Email**, make sure **Enable email
   signups** is on, and turn off "Confirm email" if you want to sign
   in immediately (or leave it on and click the confirmation link).

Now go back to the app URL, click **Create account**, and register the
first user — that user becomes the owner/master admin of the workspace.

---

## Step 2 — Configure the WhatsApp integration inside the app

After you log in as owner, go to **Settings → WhatsApp** and paste:

- **Phone Number ID:** `1290494244138702`
- **Access Token:** `EAAey8txAllQBSDy...` (the long token you provided)
- **Verify Token:** `verify-meTanu`
- **Business Account ID / WABA ID:** (from your Meta business account)

The app stores these AES-256-GCM-encrypted in Postgres. They do **not**
go into any `.env` file — this is exactly the "admin-only settings"
flow you asked for.

Meta webhook URL to paste in your Meta App configuration:
```
https://c3c98d31-c5c7-4148-9411-c1a26f6c7148.preview.emergentagent.com/api/whatsapp/webhook
```
Verify token: `verify-meTanu`

(After the custom domain is attached in Step 3, replace the URL with
`https://whatsapp.stepsolar.in/api/whatsapp/webhook` in Meta.)

For **AI reply** (optional): Settings → AI Assistant → paste OpenAI or
Anthropic key. Also stored encrypted in DB, per-account.

---

## Step 3 — Attach the custom domain `whatsapp.stepsolar.in`

Do this **inside the Emergent chat / dashboard**, not in code:

1. In the Emergent UI, click **Publish** (top-right).
2. Choose **Custom Domain** and enter `whatsapp.stepsolar.in`.
3. Emergent will show you a **CNAME record** to add at your DNS
   registrar for `stepsolar.in`.
4. Add the CNAME. Propagation: 2 min – 24 h. SSL is auto-issued.
5. Once live, update `NEXT_PUBLIC_SITE_URL` in
   `/app/frontend/.env.local` to `https://whatsapp.stepsolar.in`
   and restart the frontend (`sudo supervisorctl restart frontend`).

---

## Runtime config (for reference)

Non-secret env keys are already set in `/app/frontend/.env.local`:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | https://cvavqjafypyvzjjdrccp.supabase.co |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (set) |
| `SUPABASE_SERVICE_ROLE_KEY` | (set) |
| `ENCRYPTION_KEY` | (32-byte random hex, generated once — do NOT rotate, or every stored WhatsApp/AI token gets orphaned) |
| `META_APP_ID` | 2273714456698993 |
| `META_APP_SECRET` | (set — used to verify inbound Meta webhook HMAC) |
| `AUTOMATION_CRON_SECRET` | (random, protects `/api/automations/cron`) |
| `NEXT_PUBLIC_SITE_URL` | preview URL (update to `whatsapp.stepsolar.in` after step 3) |

## Architecture note (why there's a proxy)

Emergent ingress routes `/api/*` to port `:8001` (FastAPI). But this
app is Next.js and its API routes live at `/api/*` on port `:3000`.
So `/app/backend/server.py` is a **thin FastAPI proxy** that forwards
`/api/*` requests it receives on `:8001` to the Next.js server on
`localhost:3000`. Nothing was changed in the CRM code itself.
