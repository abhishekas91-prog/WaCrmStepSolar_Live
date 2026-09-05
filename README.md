# WaCrmStepSolar

WhatsApp CRM (inbox, contacts, pipelines, broadcasts, automations, flows, solar quotes, invoices) plus a native Android app that runs every one of those functions.

## Android app

The `android/` folder is a native WebView app. Same login, same APIs, same data as the web CRM.

```bash
# Android Studio: open the android/ folder, then Run
# or
cd android && ./gradlew assembleDebug
```

Full install notes: `android/README.md`

On a phone you can also Add to Home Screen (PWA) from the web CRM — standalone, with a bottom tab bar for Inbox, Contacts, Deals, Solar, and More.

## Web CRM

See `frontend/README.md` and `deploy/DEPLOYMENT.md`.

## Multi AI Integration

Priority: Meta AI > Gemini > Groq > OpenAI > Anthropic

```bash
pip install requests python-dotenv
```

Copy `.env.example` to `.env` and add keys, then:

```python
from ai_service import AIService
ai = AIService()
reply = ai.get_reply(customer_msg, "Your FAQ here")
```
