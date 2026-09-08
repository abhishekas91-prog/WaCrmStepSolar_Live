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

## Solar Assistant (no AI key)

WhatsApp solar quotes run as a **Flow**, not an LLM. There is no provider API key in this project.

1. Open **Flows**
2. New flow → **Solar Assistant**
3. **Activate**

Customers who type solar / rooftop / subsidy get a button menu, pick a bill slab, and receive a Hinglish quote (2 / 3 / 5 / 7.5 kW).
