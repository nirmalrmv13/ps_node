# WhatsApp invoice integration (GetEcho)

After **Proceed to POS Settlement**, the API sends the bill to the **customer mobile** via **GetEcho WA Gateway**.

## API shape

```bash
curl -X POST https://waengine.getecho.co.in/api/v1/send.php \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "919876543210",
    "type": "document",
    "url": "https://yourdomain.com/api/public/invoices/ID/pdf?token=...",
    "filename": "INV-1001.pdf",
    "message": "Hi Guest, your invoice is attached."
  }'
```

Text-only (no public PDF URL):

```bash
curl -X POST https://waengine.getecho.co.in/api/v1/send.php \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone": "919876543210", "message": "Hello from billing"}'
```

This account supports **images & documents by public URL only** (not base64 / localhost).

## Setup

1. GetEcho panel → **Connection** — connect salon WhatsApp until online.  
2. **API Key** page → copy key into `.env`:

```
GETECHO_API_KEY=w3sg_live_...
GETECHO_SEND_URL=https://waengine.getecho.co.in/api/v1/send.php
PUBLIC_BASE_URL=https://yourdomain.com
```

3. Restart the Node server.

## Behaviour

| Situation | Result |
|-----------|--------|
| API key + customer phone + `PUBLIC_BASE_URL` | PDF document after settle |
| API key + customer phone, no public URL | Text bill after settle |
| Session disconnected | Settle OK; WhatsApp `failed` |
| No customer phone | Settle OK; WhatsApp `skipped` |

Resend: `POST /api/invoices/:id/whatsapp`  
Public PDF: `GET /api/public/invoices/:id/pdf?token=…`
