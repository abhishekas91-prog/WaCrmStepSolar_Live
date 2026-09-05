"""WhatsApp Meta webhook integration tests."""
import os
import hmac
import hashlib
import json
import requests
import pytest

BASE_URL = "https://crm-solar-hub.preview.emergentagent.com"
WEBHOOK_URL = f"{BASE_URL}/api/whatsapp/webhook"
VERIFY_TOKEN = "verify-meTanu"
APP_SECRET = "af28a9accce874aa70ac8b645c33f12e"
APP_ID = "2167080984024660"
SUPABASE_URL = "https://cvavqjafypyvzjjdrccp.supabase.co"
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or open("/app/frontend/.env.local").read().split("SUPABASE_SERVICE_ROLE_KEY=")[1].split("\n")[0].strip()

SAMPLE_BODY = {
    "object": "whatsapp_business_account",
    "entry": [{
        "id": "2094685578111813",
        "changes": [{
            "value": {
                "messaging_product": "whatsapp",
                "metadata": {"display_phone_number": "919519956600", "phone_number_id": "1290494244138702"},
                "contacts": [{"profile": {"name": "QA_Probe"}, "wa_id": "911111111111"}],
                "messages": [{
                    "from": "911111111111",
                    "id": "wamid.qatest_verify_9911",
                    "timestamp": "1700000000",
                    "text": {"body": "qa probe payload"},
                    "type": "text"
                }]
            },
            "field": "messages"
        }]
    }]
}


def _sign(body_bytes: bytes) -> str:
    return "sha256=" + hmac.new(APP_SECRET.encode(), body_bytes, hashlib.sha256).hexdigest()


def test_webhook_challenge_success():
    r = requests.get(WEBHOOK_URL, params={
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "CHAL_ABC"
    }, timeout=15)
    assert r.status_code == 200, f"Got {r.status_code}: {r.text}"
    assert r.text == "CHAL_ABC", f"Body mismatch: {r.text!r}"


def test_webhook_challenge_wrong_token():
    r = requests.get(WEBHOOK_URL, params={
        "hub.mode": "subscribe",
        "hub.verify_token": "WRONG",
        "hub.challenge": "CHAL_ABC"
    }, timeout=15)
    assert r.status_code != 200, f"Expected non-200, got {r.status_code}: {r.text}"
    assert "CHAL_ABC" not in r.text


def test_webhook_post_valid_signature():
    body = json.dumps(SAMPLE_BODY).encode()
    sig = _sign(body)
    r = requests.post(WEBHOOK_URL, data=body, headers={
        "Content-Type": "application/json",
        "X-Hub-Signature-256": sig
    }, timeout=20)
    assert r.status_code == 200, f"Got {r.status_code}: {r.text}"
    data = r.json()
    assert data.get("status") == "received", f"Unexpected: {data}"


def test_webhook_post_missing_signature():
    body = json.dumps(SAMPLE_BODY).encode()
    r = requests.post(WEBHOOK_URL, data=body, headers={"Content-Type": "application/json"}, timeout=15)
    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"
    assert "Invalid signature" in r.text


def test_webhook_post_bad_signature():
    body = json.dumps(SAMPLE_BODY).encode()
    r = requests.post(WEBHOOK_URL, data=body, headers={
        "Content-Type": "application/json",
        "X-Hub-Signature-256": "sha256=deadbeef" + "0" * 56
    }, timeout=15)
    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"


def test_meta_subscription_active():
    token = f"{APP_ID}|{APP_SECRET}"
    r = requests.get(f"https://graph.facebook.com/v20.0/{APP_ID}/subscriptions",
                     params={"access_token": token}, timeout=20)
    assert r.status_code == 200, f"{r.status_code}: {r.text}"
    data = r.json().get("data", [])
    waba = [s for s in data if s.get("object") == "whatsapp_business_account"]
    assert waba, f"No WABA subscription: {data}"
    sub = waba[0]
    assert sub.get("active") is True
    assert sub.get("callback_url") == f"{BASE_URL}/api/whatsapp/webhook"
    fields = sub.get("fields", [])
    field_names = [f.get("name") if isinstance(f, dict) else f for f in fields]
    assert "messages" in field_names
    assert "message_template_status_update" in field_names


def test_probe_row_persisted_then_cleanup():
    # Query supabase for the probe row
    import time
    headers = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}
    rows = []
    for _ in range(6):
        r = requests.get(f"{SUPABASE_URL}/rest/v1/messages",
                         params={"select": "*", "message_id": "eq.wamid.qatest_verify_9911"},
                         headers=headers, timeout=15)
        assert r.status_code == 200, f"{r.status_code}: {r.text}"
        rows = r.json()
        if rows:
            break
        time.sleep(1.5)
    assert len(rows) >= 1, f"Probe row not found. rows={rows}"
    row = rows[0]
    assert row.get("sender_type") == "customer"
    assert row.get("content_text") == "qa probe payload"

    # Cleanup
    d = requests.delete(f"{SUPABASE_URL}/rest/v1/messages",
                        params={"message_id": "eq.wamid.qatest_verify_9911"},
                        headers=headers, timeout=15)
    assert d.status_code in (200, 204), f"Delete failed: {d.status_code} {d.text}"
