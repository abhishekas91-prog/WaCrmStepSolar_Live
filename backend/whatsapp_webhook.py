from __future__ import annotations
import os
import hmac
import hashlib
import json
import uuid
import tempfile
import requests
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, Request, Header, HTTPException
from jinja2 import Environment, FileSystemLoader, select_autoescape
import pdfkit
from datetime import datetime

# Optional friendly number to words; fall back to simple repr
try:
    from num2words import num2words
except Exception:
    num2words = None

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


def insert_invoice_record(payload: dict) -> dict:
    """
    Insert into Supabase REST (requires a table `invoices` existing).
    Returns the inserted row representation.
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
    data = r.json()
    return data[0] if isinstance(data, list) and data else data


def amount_in_words(amount: float) -> str:
    """Return amount in words (INR). Uses num2words if available, otherwise a fallback."""
    try:
        amt_int = int(round(amount))
        if num2words:
            # use Indian system if supported
            try:
                words = num2words(amt_int, lang="en_IN")
            except Exception:
                words = num2words(amt_int, lang="en")
            return words.replace("  ", " ").title() + " Rupees Only"
        return f"{amt_int} Rupees Only"
    except Exception:
        return f"{amount:.2f} Rupees"


def compute_invoice_totals(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute per-line totals, GST split and invoice totals."""
    total_taxable = 0.0
    total_gst = 0.0
    hsn_summary: Dict[str, Dict[str, Any]] = {}

    for it in items:
        price = float(it.get("price_unit", 0))
        qty = float(it.get("qty", 1))
        gst_rate = float(it.get("gst_rate", 0))
        taxable = price * qty
        gst_amt = round(taxable * gst_rate / 100.0, 2)
        cgst = round(gst_amt / 2, 2)
        sgst = round(gst_amt / 2, 2)
        amount = round(taxable + gst_amt, 2)
        it["taxable"] = round(taxable, 2)
        it["gst_amt"] = gst_amt
        it["cgst"] = cgst
        it["sgst"] = sgst
        it["amount"] = amount

        total_taxable += taxable
        total_gst += gst_amt

        hsn = str(it.get("hsn", ""))
        if hsn not in hsn_summary:
            hsn_summary[hsn] = {"taxable": 0.0, "gst_amt": 0.0, "cgst": 0.0, "sgst": 0.0}
        hsn_summary[hsn]["taxable"] += taxable
        hsn_summary[hsn]["gst_amt"] += gst_amt
        hsn_summary[hsn]["cgst"] += cgst
        hsn_summary[hsn]["sgst"] += sgst

    total_taxable = round(total_taxable, 2)
    total_gst = round(total_gst, 2)
    grand_total = round(total_taxable + total_gst, 2)

    # format hsn_summary rows
    hsn_rows = []
    for h, v in hsn_summary.items():
        hsn_rows.append({
            "hsn": h,
            "taxable": round(v["taxable"], 2),
            "cgst": round(v["cgst"], 2),
            "sgst": round(v["sgst"], 2),
            "total_tax": round(v["gst_amt"], 2),
        })

    return {
        "items": items,
        "total_taxable": total_taxable,
        "total_gst": total_gst,
        "grand_total": grand_total,
        "hsn_rows": hsn_rows,
        "amount_in_words": amount_in_words(grand_total),
    }


@app.post("/webhook")
async def webhook(request: Request, x_hub_signature_256: Optional[str] = Header(None)):
    raw = await request.body()
    # Verify signature
    if not verify_meta_signature(raw, x_hub_signature_256):
        raise HTTPException(status_code=401, detail="invalid signature")

    data = await request.json()
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
                        # Create invoice draft (example: build detailed items similar to your sample)
                        invoice_no = f"Q-{int(datetime.utcnow().timestamp())}-{uuid.uuid4().hex[:6]}"

                        items = [
                            {
                                "sno": 1,
                                "desc": "Livguard- 1PH3KWP DCR 550WP + 3KW ONGRID KIT",
                                "hsn": "85414300",
                                "qty": 1,
                                "unit": "Set",
                                "price_unit": 126857.14,
                                "gst_rate": 5.0,
                            },
                            {
                                "sno": 2,
                                "desc": "BOS - Erection, Installation & Commissioning Services",
                                "hsn": "9954",
                                "qty": 1,
                                "unit": "Nos",
                                "price_unit": 39661.02,
                                "gst_rate": 18.0,
                            },
                        ]

                        invoice_meta = {
                            "invoice_no": invoice_no,
                            "customer_phone": from_number,
                            "customer_name": "Unknown",
                            "place_of_supply": "",
                            "payment_mode": "Online",
                            "invoice_date": datetime.utcnow().strftime("%d-%m-%Y"),
                            "items": items,
                        }

                        computed = compute_invoice_totals(items)
                        payload = {
                            "invoice_no": invoice_no,
                            "contact_phone": invoice_meta["customer_phone"],
                            "customer_name": invoice_meta["customer_name"],
                            "amount": computed["grand_total"],
                            "status": "draft",
                            "file_path": None,
                            "invoice_payload": {**invoice_meta, **computed},
                        }

                        # Render HTML
                        tpl = jinja_env.get_template("invoice.html")
                        html = tpl.render(company={
                            "name": "STEP SOLAR ENERGY PVT. LTD.",
                            "branch": "Dumri Padaw, Varanasi, U.P",
                            "phone": "8081252114",
                            "gstin": "09ABPCS3779K1ZC",
                            "bank_name": "State Bank of India",
                            "account_name": "STEP SOLAR ENERGY PVT LTD",
                            "account_no": "44347774983",
                            "ifsc": "SBIN0064874",
                            "branch_name": "Bhadaura",
                        }, invoice=payload["invoice_payload"], heading="QUOTATION")

                        # PDF generation to temp file
                        tmpf = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
                        tmpf.close()
                        pdfkit.from_string(html, tmpf.name, configuration=PDFKIT_CONFIG)

                        # Upload to Supabase Storage
                        object_path = f"{invoice_no}.pdf"
                        upload_file_to_supabase(tmpf.name, object_path)

                        # Insert invoice db record (with file_path and payload)
                        payload["file_path"] = object_path
                        rec = insert_invoice_record(payload)

                        # Notify customer that invoice draft exists and will be sent after agent approval (English)
                        send_whatsapp_text(
                            from_number,
                            f"Thank you — your quotation has been prepared (ID: {invoice_no}). Our agent will review and send the official PDF shortly."
                        )
    except Exception as e:
        print("Webhook processing error:", e)
    return {"status": "ok"}
