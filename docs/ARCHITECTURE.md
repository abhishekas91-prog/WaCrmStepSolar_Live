# WaCrmStepSolar_Live — Architecture & Flow

This document describes the overall architecture, runtime flow, components, data model pointers, important endpoints, environment variables, deployment checklist, and testing notes for the WaCrmStepSolar_Live repository (WhatsApp invoice/quotation + CRM features).

## High level overview

The system connects WhatsApp Cloud (Meta) incoming messages to a backend that can:
- Recognize keywords (quotation / invoice) and create draft invoices (HTML -> PDF)
- Upload generated PDF to Supabase Storage
- Store invoice metadata in Supabase (invoices table)
- Surface drafts to agents in a frontend CRM UI where they can 'Approve & Send'
- On approval, backend uploads the PDF as media to Meta and sends it to the customer

Optional components (present in repo but not enabled by default):
- Multi-provider AI service for agent / bot replies (backend/ai_service.py)
- Payment integration (planned, currently skipped)


## Repo layout (important files)

- backend/
  - whatsapp_webhook.py     — webhook receiver: creates invoice drafts from messages
  - send_invoice.py         — send endpoint: agent approves and triggers Meta send
  - ai_service.py           — AI provider wrapper (fallback across providers)
  - templates/invoice.html  — invoice/quotation HTML template used to render PDF
  - templates/logo.svg      — placeholder logo used by template
  - migrations/
    - 001_create_invoices.sql
    - 002_add_invoice_payload.sql
  - requirements.txt        — Python dependencies for backend service
  - scripts/
    - install_wkhtmltopdf.sh
    - setup_venv.sh
    - run_migrations.sh
  - README_SETUP.md        — setup scripts + instructions

- frontend/
  - src/app/invoices/page.tsx       — invoices list UI (view PDF, Approve & Send)
  - src/app/api/invoices/signed/route.ts — Next server route to request signed Supabase URL
  - src/app/api/proxy/send/route.ts — Proxy route to call backend /invoices/send with agent secret

- .github/workflows/backend-setup.yml — workflow to install wkhtmltopdf, setup venv and run migrations


## Data model (Supabase table: `invoices`)

Schema (from migrations):
- id uuid PRIMARY KEY DEFAULT gen_random_uuid()
- invoice_no text UNIQUE NOT NULL
- contact_phone text
- customer_name text
- amount numeric
- status text
- file_path text
- created_at timestamptz DEFAULT now()
- sent_at timestamptz
- meta_message jsonb
- invoice_payload jsonb (added by migration 002)

Important usage:
- `status` values used: `draft`, `sent` (and `paid` if payment flows are added later)
- `file_path` stores the object path in Supabase Storage (bucket + object)
- `invoice_payload` stores the full generated invoice JSON used to render the template


## Endpoints (summary)

Backend (FastAPI)
- POST /webhook
  - Receives Meta WhatsApp Cloud webhook events
  - Verifies X-Hub-Signature-256 header (if META_APP_SECRET configured)
  - Parses messages and on keywords creates invoice drafts: render HTML -> pdfkit -> upload to Supabase storage -> insert invoices row (status=draft) -> notify customer via WhatsApp text

- POST /invoices/send
  - Called by agents (via frontend or proxy) to approve and send a draft invoice
  - Requires `invoice_id` and optional `secret` (AGENT_APPROVAL_SECRET) for protection
  - Downloads PDF from Supabase, uploads to Meta media endpoint, sends a document message, and updates invoice row to status=sent with `sent_at` and meta message payload

Frontend (Next.js)
- GET /invoices (UI page: frontend/src/app/invoices/page.tsx)
  - Lists invoices from Supabase and shows actions: View PDF (signed URL) and Approve & Send

- POST /api/invoices/signed
  - Server-side route that calls Supabase Storage `sign` endpoint using SUPABASE_SERVICE_ROLE_KEY and returns a signed URL for secure PDF preview

- POST /api/proxy/send
  - Proxy route that calls backend /invoices/send and injects AGENT_APPROVAL_SECRET from server env (so the secret is never exposed to client JS)


## Sequence / Flow (text)

1. Customer messages WhatsApp number (text contains "quotation" / "invoice" / "quote").
2. Meta forwards webhook to our backend /webhook.
3. Backend verifies signature (if enabled) and parses message.
4. Backend constructs invoice data (items, HSN, GST rates), renders invoice.html using Jinja2.
5. pdfkit (wkhtmltopdf) converts HTML to PDF on the server.
6. Backend uploads PDF to Supabase Storage (bucket: invoices) using service-role key.
7. Backend inserts an `invoices` row with status=`draft` and stores `file_path` and `invoice_payload`.
8. Backend notifies customer via WhatsApp text: "Your quotation is prepared (ID: Q-...). Agent will review."
9. Agent logs into CRM frontend and opens /invoices or the chat conversation widget.
10. Agent clicks "View PDF" → frontend requests signed URL from /api/invoices/signed -> opens PDF in new tab.
11. Agent clicks "Approve & Send" → frontend POSTs to /api/proxy/send which forwards to backend /invoices/send with AGENT_APPROVAL_SECRET.
12. Backend /invoices/send downloads PDF from Supabase, uploads media to Meta (media endpoint), and sends the document message to the customer. It updates invoice `status` → `sent` with `sent_at` and stores Meta response in `meta_message`.


## Deployment checklist

- Install wkhtmltopdf on the server (system package or binary). Example (Ubuntu):
  sudo apt-get update && sudo apt-get install -y wkhtmltopdf
  Verify: wkhtmltopdf --version

- Python (backend): create virtualenv and install requirements
  cd backend
  ./scripts/setup_venv.sh
  source .venv/bin/activate

- Supabase
  - Create storage bucket `invoices` (private)
  - Run SQL migrations in Supabase SQL editor: `001_create_invoices.sql` and `002_add_invoice_payload.sql`

- Environment variables (set in your host / process manager / CI secrets):
  - SUPABASE_URL
  - SUPABASE_SERVICE_ROLE_KEY
  - WA_PHONE_ID
  - WA_TOKEN
  - META_APP_SECRET (optional but recommended)
  - INVOICE_BUCKET (optional; default: invoices)
  - AGENT_APPROVAL_SECRET (recommended)
  - WKHTMLTOPDF_PATH (if not in /usr/bin)
  - BACKEND_BASE_URL (used by frontend proxy during dev)

- Start backend: uvicorn backend.whatsapp_webhook:app --host 0.0.0.0 --port 8001
- Start frontend: cd frontend && npm install && npm run dev (configure NEXT_PUBLIC_SUPABASE_* envs for local dev)


## Testing checklist

- Webhook: use ngrok or other HTTPS tunnel to expose backend /webhook and set Meta App webhook to https://<tunnel>/webhook. Send a WhatsApp message containing "quotation" and verify:
  - Backend logs show message processed
  - Supabase Storage contains a PDF object: invoices/Q-....pdf
  - invoices table has a new row with status=draft and invoice_payload JSON
  - Customer receives the English notification text

- Frontend: open /invoices and verify the draft row shows. Click View PDF and Approve & Send to test end‑to‑end sending.

- Approve & Send: ensure backend /invoices/send uploads media to Meta and customer receives the document. Invoice row should change status to `sent` and have `sent_at` and `meta_message` stored.


## Security & production notes

- SUPABASE_SERVICE_ROLE_KEY is powerful. Use it server-side only — never expose in client code or commit to repo.
- AGENT_APPROVAL_SECRET protects send endpoint; keep it secret and rotate if needed.
- Meta tokens must be valid and have correct permissions for media upload & messages.
- Limit who can call costly endpoints (e.g., AI calls) by adding auth / rate limits.


## Where to look in code for specific behaviour

- Invoice HTML/CSS: backend/templates/invoice.html
- PDF generation + Supabase upload: backend/whatsapp_webhook.py (see pdfkit.from_string and upload_file_to_supabase)
- Approve/send: backend/send_invoice.py
- Frontend invoices UI: frontend/src/app/invoices/page.tsx
- Signed URL route: frontend/src/app/api/invoices/signed/route.ts
- Proxy for send: frontend/src/app/api/proxy/send/route.ts
- AI provider wrapper: backend/ai_service.py


## Next recommended improvements

1. Add agent authentication & role-based access for invoices page and approve actions.
2. Add tests & CI coverage for critical flows (PDF generation, Supabase upload, send flow).
3. Add payment integration (Razorpay/Stripe) and paid status lifecycle.
4. Add monitoring and telemetry for backup / retries (storage upload, Meta send failures).
5. Move template assets (logo) to a configurable storage and use absolute URLs to avoid wkhtmltopdf path issues.


---

Document created and committed to repository. If you want a translated Hindi copy or additional diagrams (sequence diagram or PlantUML) I can add them as well.
