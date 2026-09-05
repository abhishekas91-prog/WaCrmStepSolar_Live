# StepSolar WA — Android app

Native Android wrapper for the WaCRM web app. Every CRM function
(inbox, contacts, pipelines, broadcasts, automations, flows, solar
quotes, invoices, settings, team) runs inside this app — same backend,
same APIs, same data.

## What you get

- Full-screen WebView of `https://whatsapp.stepsolar.in` (configurable)
- Session cookies persist across launches
- Mic permission for WhatsApp voice notes
- File picker for image / video / document send
- Pull-to-refresh
- Offline retry screen
- Hardware back = in-app back

## Build APK (Android Studio)

1. Open the `android/` folder in Android Studio.
2. Wait for Gradle sync.
3. Run on a device or emulator, or **Build → Build APK(s)**.

Command line:

```bash
cd android
./gradlew assembleDebug
```

APK path: `android/app/build/outputs/apk/debug/app-debug.apk`

## Point at another URL

Default URL is production: `https://whatsapp.stepsolar.in`

Local / staging:

```bash
./gradlew assembleDebug -PcrmUrl=http://10.0.2.2:3000
```

`10.0.2.2` is the Android emulator alias for the host machine.

## Features mapped 1:1 with the web CRM

| App screen | CRM function |
|---|---|
| Inbox | Shared WhatsApp inbox, media, voice, templates, AI draft, assign |
| Contacts | Search, tags, CSV import, notes, custom fields |
| Pipelines | Kanban deals, stages, analytics |
| Broadcasts | Template campaigns, audience, delivery tracking |
| Automations | Triggers, steps, logs |
| Flows | Visual WhatsApp flows (beta) |
| Solar Assistant | Rooftop solar quoting bot config |
| Invoices | Draft quotations, View PDF, Approve & Send |
| Settings | WhatsApp, templates, team, API keys, profile |
| Notifications | Assignment alerts |

Login with the same CRM email and password.
