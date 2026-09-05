from __future__ import annotations
import os
import requests
import tempfile
from fastapi import FastAPI, HTTPException, Request
from typing import Dict, Any
from datetime import datetime

app = FastAPI(title="WaCrm send-invoice endpoint")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
WA_PHONE_ID = os.getenv("WA_PHONE_ID")
WA_TOKEN = os.getenv("WA_TOKEN")
INVOICE_BUCKET = os.getenv("INVOICE_BUCKET", "invoices")
# Optional small secret to protect this endpoint (frontend passes it)
AGENT_APPROVAL_SECRET = os.getenv("AGENT_APPROVAL_SECRET")

def get_invoice_record(invoice_id: str) -> Dict[str, Any]:
    url = f"{SUPABASE_URL}/rest/v1/invoices?id=eq.{invoice_id}&select=*"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }
    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    data = r.json()
    if not data:
        raise HTTPException(status_code=404, detail="invoice not found")
    return data[0]

def download_from_supabase(object_path: str) -> bytes:
    """
    Download file from Supabase Storage using service role key.
    """
    url = f"{SUPABASE_URL}/storage/v1/object/{INVOICE_BUCKET}/{object_path}"
    headers = {"Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}
    r = requests.get(url, headers=headers, timeout=60)
    r.raise_for_status()
    return r.content

def upload_to_meta_and_send(to_number: str, file_bytes: bytes, filename: str):
    # 1) upload media
    url_upload = f"https://graph.facebook.com/v17.0/{WA_PHONE_ID}/media"
    files = {"file": (filename, file_bytes)}
    headers = {"Authorization": f"Bearer {WA_TOKEN}"}
    r = requests.post(url_upload, files=files, headers=headers, timeout=60)
    r.raise_for_status()
    mid = r.json().get("id")
    # 2) send document message referencing media id
    send_url = f"https://graph.facebook.com/v17.0/{WA_PHONE_ID}/messages"
    body = {
        "messaging_product": "whatsapp",
        "to": to_number,
        "type": "document",
        "document": {"id": mid, "filename": filename},
    }
    r2 = requests.post(send_url, json=body, headers=headers, timeout=30)
    r2.raise_for_status()
    return {"media_id": mid, "send_resp": r2.json()}

def mark_invoice_sent(invoice_id: str, meta_result: dict):
    url = f"{SUPABASE_URL}/rest/v1/invoices?id=eq.{invoice_id}"
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    payload = {
        "status": "sent",
        "sent_at": datetime.utcnow().isoformat(),
        "meta_message": meta_result,
    }
    r = requests.patch(url, headers=headers, json=payload, timeout=30)
    r.raise_for_status()
    return r.json()

@app.post("/invoices/send")
async def send_invoice(request: Request):
    body = await request.json()
    invoice_id = body.get("invoice_id")
    secret = body.get("secret")
    if AGENT_APPROVAL_SECRET and secret != AGENT_APPROVAL_SECRET:
        raise HTTPException(status_code=403, detail="forbidden")
    if not invoice_id:
        raise HTTPException(status_code=400, detail="invoice_id required")
    inv = get_invoice_record(invoice_id)
    object_path = inv.get("file_path")
    phone = inv.get("contact_phone")
    if not object_path or not phone:
        raise HTTPException(status_code=400, detail="invoice missing file or phone")
    # download binary
    pdf_bytes = download_from_supabase(object_path)
    # upload to Meta and send
    meta_result = upload_to_meta_and_send(phone, pdf_bytes, invoice_id + ".pdf")
    # mark invoice as sent
    mark_invoice_sent(invoice_id, meta_result)
    return {"status": "sent", "meta_result": meta_result}
