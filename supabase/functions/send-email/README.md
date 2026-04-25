# send-email Edge Function

HTTP wrapper that loads one of the templates in `_shared/email-templates/`, renders it with caller-supplied variables, and sends via Resend.

**Status: scaffold + helpers wired.** End-to-end Resend delivery waits on `RESEND_API_KEY` being set and a verified sender domain (ROADMAP §2.1).

## When to use this vs. importing `_shared/email.ts` directly

- **In-process callers** (other Edge Functions, e.g. `stripe-webhook`): import `sendTransactional` from `../_shared/email.ts` directly. One less hop, richer errors.
- **Out-of-process callers** (cron jobs, manual test scripts, anything that doesn't already run inside an Edge Function): POST to this endpoint.

## Required secrets

```
RESEND_API_KEY              re_…                         (Resend API key)
EMAIL_FROM                  "All Paddling <team@allpaddling.com>"
EMAIL_REPLY_TO              "mick@allpaddling.com"
SUPABASE_SERVICE_ROLE_KEY   auto-injected, used to authenticate callers
```

Set with:
```bash
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set EMAIL_FROM='All Paddling <team@allpaddling.com>'
supabase secrets set EMAIL_REPLY_TO=mick@allpaddling.com
```

## Deploy

```bash
supabase functions deploy send-email --no-verify-jwt
```

`--no-verify-jwt` is set because the function does its own auth via the `x-service-role-key` header. Don't expose this endpoint to anonymous traffic — without the header check, anyone with the URL could spam emails to anyone.

## API

```http
POST /functions/v1/send-email
x-service-role-key: <SUPABASE_SERVICE_ROLE_KEY>
Content-Type: application/json

{
  "template": "welcome",
  "to":       "sarah@example.com",
  "vars": {
    "member_name":  "Sarah",
    "plan_name":    "Custom Season Race Plan",
    "plan_url":     "https://allpaddling.com/app/program.html",
    "coach_name":   "Mick"
  },
  "tags": [
    { "name": "purpose",  "value": "welcome" },
    { "name": "user_id",  "value": "uuid-of-the-user" }
  ]
}
```

### Responses

| Status | Body | When |
|---|---|---|
| 200 | `{ "id": "msg-abc" }` | Resend accepted the email; id is the message id for cross-reference |
| 400 | `{ "error": "..." }` | Missing field, unknown template name, missing required `vars` placeholder |
| 401 | `{ "error": "..." }` | Missing or wrong `x-service-role-key` header |
| 500 | `{ "error": "..." }` | Resend returned non-2xx, or upstream infrastructure error |

## Local development

```bash
# 1. Start the function locally
supabase functions serve send-email --env-file ./supabase/.env.local

# 2. Send a test request
curl -X POST http://localhost:54321/functions/v1/send-email \
  -H "x-service-role-key: $LOCAL_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "template": "welcome",
    "to": "you@example.com",
    "vars": {
      "member_name":  "Test",
      "plan_name":    "Custom Season Race Plan",
      "plan_url":     "https://allpaddling.com/app/program.html",
      "coach_name":   "Mick"
    }
  }'
```

If `RESEND_API_KEY` isn't set, you'll get a 500 with `RESEND_API_KEY env var not set` — useful as a "wiring test" to confirm template loading and rendering work without actually sending mail.

## Required vars per template

Each template's HTML file declares its placeholders in an opening comment. Quick reference:

| Template | Required vars |
|---|---|
| `welcome` | member_name, plan_name, plan_url, coach_name |
| `payment-receipt` | member_name, plan_name, amount, currency, period_start, period_end, next_billing_date, invoice_pdf_url, settings_url, coach_name |
| `plan-ready` | member_name, plan_name, plan_url, coach_name |
| `block-delivered` | member_name, plan_name, block_number, plan_url, coach_name |
| `payment-failed` | member_name, amount, currency, retry_date, update_card_url, coach_name |
| `upcoming-renewal` | member_name, plan_name, amount, currency, renewal_date, days_until_renewal, settings_url, coach_name |

Missing a required var triggers a 400 with `renderTemplate: missing variable "<name>"` rather than shipping a broken email.
