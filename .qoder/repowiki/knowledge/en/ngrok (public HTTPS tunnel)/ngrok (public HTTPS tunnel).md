---
kind: external_dependency
name: ngrok (public HTTPS tunnel)
slug: ngrok
category: external_dependency
category_hints:
    - client_constraint
scope:
    - '**'
source_files:
    - README.md
---

### ngrok
- Used to expose the local API behind a public HTTPS URL so Meta's WhatsApp Cloud API can deliver webhooks to `http://localhost:3000/webhook`.
- The README documents running `ngrok http 3000` and pasting the resulting callback URL into the Meta developer dashboard's webhook configuration.