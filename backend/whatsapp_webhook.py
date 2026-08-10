from __future__ import annotations
import os
import hmac
import hashlib
import json
import uuid
import tempfile
import requests
from typing import Optional
from fastapi import FastAPI, Request, Header, HTTPException
from jinja2 import Environment, FileSystemLoader, select_autoescape
import pdfkit
from datetime import datetime

app = FastAPI(title="WaCrm WhatsApp webhook + invoice draft")

# Required env vars
META_APP_SECRET = os.getenv("META_APP_SECRET")  # for signature verification
WA_PHONE_ID = os.getenv("WA_PHONE_ID")  # Meta phone number id
WA_TOKEN = os.getenv("WA_TOKEN")  # Meta Graph API token (Bearer)
SUPABASE_URL = os.getenv("SUPABASE_URL")  # https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")  # sensitive
INVOICE_BUCKET = os.getenv("INVOICE_BUCKET", "invoices")  # Supabase storage bucket

# wkhtmltopdf path optional
WKHTMLTOPDF_PATH = os.getenv("WKHTMLTOPDF_PATH", "/usr/bin/wkhtmltopdf")
PDFKIT_CONFIG = pdfkit.configuration(wkhtmltopdf=WKHTMLTOPDF_PATH)

# Jinja2 template loader (backend/templates)
TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")
jinja_env = Environment(
    loader=FileSystemLoader(TEMPLATES_DIR),
    autoescape=select_autoescape(["html", "xml"]),
)

def verify_meta_signature(raw_body: bytes, signature_header: Optional[str]) -> bool:
    """
    Verify X-Hub-Signature-256 header from Meta (sha256=...)
    """
    if not META_APP_SECRET:
        # if not configured, skip verification (development)
        return True
    if not signature_header:
        return False
    try:
        expected_prefix = "sha256="
        if not signature_header.startswith(expected_prefix):
            return False
        sig = signature_header[len(expected_prefix) :]
        mac = hmac.new(META_APP_SECRET.encode("utf-8"), raw_body, hashlib.sha256)
        expected = mac.hexdigest()
        return hmac.compare_digest(expected, sig)
    except Exception:
        return False

def send_whatsapp_text(to_number: str, text: str):
    url = f"https://graph.facebook.com/v17.0/{WA_PHONE_ID}/messages"
    body = {
        "messaging_product": "whatsapp",
        "to": to_number,
        "type": "text",
        "text": {"body": text},
    }
    headers = {"Authorization": f"Bearer {WA_TOKEN}"}
    r = requests.post(url, json=body, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json()

def upload_file_to_supabase(local_path: str, object_path: str):
    """
    Upload file to Supabase Storage bucket.
    Uses SERVICE_ROLE_KEY for authorization.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    url = f"{SUPABASE_URL}/storage/v1/object/{INVOICE_BUCKET}/{object_path}"
    headers = {"Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}
    with open(local_path, "rb") as f:
        files = {"file": f}
        # x-upsert optional
        resp = requests.post(url, headers=headers, files=files, timeout=60)
    resp.raise_for_status()
    return resp.json()  # response contains path info in many Supabase setups

def insert_invoice_record(payload: dict):
    """
    Insert into Supabase REST (requires a table `invoices` existing).
    """
    url = f"{SUPABASE_URL}/rest/v1/invoices"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    r = requests.post(url, headers=headers, json=payload, timeout=30)
    r.raise_for_status()
    return r.json()[0]

@app.post("/webhook")
async def webhook(request: Request, x_hub_signature_256: Optional[str] = Header(None)):
    raw = await request.body()
    # Verify signature
    if not verify_meta_signature(raw, x_hub_signature_256):
        raise HTTPException(status_code=401, detail="invalid signature")

    data = await request.json()
    # Basic WhatsApp incoming message parsing (Graph API shape)
    # Be defensive: check for entries/changes/message path
    try:
        entries = data.get("entry", [])
        for entry in entries:
            changes = entry.get("changes", [])
            for change in changes:
                value = change.get("value", {})
                messages = value.get("messages", [])
                for msg in messages:
                    from_number = msg.get("from")
                    text = None
                    if msg.get("type") == "text":
                        text = msg.get("text", {}).get("body", "")
                    # quick keyword-based routing
                    if text and any(w in text.lower() for w in ("quotation", "quote", "invoice")):
                        # Create invoice draft
                        invoice_no = f"Q-{int(datetime.utcnow().timestamp())}-{uuid.uuid4().hex[:6]}"
                        # For demo: create a simple invoice with one item. In real: lookup DB/cart
                        invoice_data = {
                            "invoice_no": invoice_no,
                            "customer_phone": from_number,
                            "customer_name": "Unknown",  # could lookup contacts via Supabase
                            "items": [{"desc": "Solar Panel (sample)", "qty": 1, "price": 50000}],
                            "total": 50000,
                            "status": "draft",
                            "created_at": datetime.utcnow().isoformat(),
                        }
                        # Render HTML
                        tpl = jinja_env.get_template("invoice.html")
                        html = tpl.render(invoice=invoice_data)
                        # PDF generation to temp file
                        tmpf = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
                        tmpf.close()
                        pdfkit.from_string(html, tmpf.name, configuration=PDFKIT_CONFIG)
                        # Upload to Supabase Storage
                        object_path = f"{invoice_no}.pdf"
                        upload_file_to_supabase(tmpf.name, object_path)
                        # Insert invoice db record
                        record_payload = {
                            "invoice_no": invoice_no,
                            "contact_phone": invoice_data["customer_phone"],
                            "customer_name": invoice_data["customer_name"],
                            "amount": invoice_data["total"],
                            "status": "draft",
                            "file_path": object_path,
                        }
                        rec = insert_invoice_record(record_payload)
                        # Notify customer that invoice draft exists and will be sent after agent approval
                        send_whatsapp_text(
                            from_number,
                            f"Dhanyavaad — aapka quotation tayaar kar diya gaya (ID: {invoice_no}). Hamare agent ke approval ke baad aapko PDF bhej diya jayega."
                        )
    except Exception as e:
        # Log and return 200 to avoid webhook retry storms (adjust per your needs)
        print("Webhook processing error:", e)
    return {"status": "ok"}
