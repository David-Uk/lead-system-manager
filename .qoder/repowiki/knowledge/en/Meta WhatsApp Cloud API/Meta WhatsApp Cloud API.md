---
kind: external_dependency
name: Meta WhatsApp Cloud API
slug: meta-whatsapp-cloud-api
category: external_dependency
category_hints:
    - auth_protocol
    - client_constraint
scope:
    - '**'
source_files:
    - src/services/whatsapp.adapter.js
    - src/middleware/signature.js
    - src/controllers/webhook.controller.js
    - .env.example
---

### Meta WhatsApp Cloud API
- The only external messaging channel. Outbound messages go through the Graph API when `WHATSAPP_MODE=cloud`; otherwise the adapter runs in simulated mode and logs to stdout + `logs/whatsapp-outbound.log`.
- Inbound webhooks arrive at `POST /webhook`; the server verifies the `x-hub-signature-256` HMAC-SHA256 header against `WHATSAPP_APP_SECRET` before accepting the payload. The GET handshake echoes `hub.challenge` after validating `hub.verify_token` against `WHATSAPP_VERIFY_TOKEN`.
- Requires a public HTTPS endpoint (e.g. ngrok) so Meta can reach it; webhook subscription is configured on the Meta developer dashboard for the `messages` field.
- Required env vars: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` (temporary token valid 24 h or permanent system-user token with `whatsapp_business_messaging` permission), `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_API_VERSION` (default `v19.0`).
- A test hook `WHATSAPP_FORCE_SEND_FAILURE=true` forces every send to fail to exercise the notifier-failure path.