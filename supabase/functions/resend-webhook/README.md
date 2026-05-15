# resend-webhook

Receives Resend webhook events and mirrors engagement (delivered, opened, clicked, bounced, complained) into `outreach_sends`. Also handles a one-shot backfill mode for past sends.

## Deploy

```bash
supabase functions deploy resend-webhook --no-verify-jwt --project-ref crlukzkgmydyqpwndjvc
```

`--no-verify-jwt` is mandatory — Resend isn't a Supabase user. The function does its own signature check.

## Required secrets

```bash
supabase secrets set RESEND_WEBHOOK_SECRET=whsec_… --project-ref crlukzkgmydyqpwndjvc
```

Already set from other functions: `RESEND_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Configure in Resend

1. Resend dashboard → Webhooks → Add endpoint
2. URL: `https://crlukzkgmydyqpwndjvc.supabase.co/functions/v1/resend-webhook`
3. Events: `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.opened`, `email.clicked`, `email.bounced`, `email.complained`
4. Copy the signing secret into `RESEND_WEBHOOK_SECRET` (above).

## Backfill past sends

After deploy, run once to populate `last_event` for rows that already have a `resend_id`:

```bash
curl -X POST \
  "https://crlukzkgmydyqpwndjvc.supabase.co/functions/v1/resend-webhook" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"backfill"}'
```

Optionally scope to one campaign:

```bash
… -d '{"action":"backfill","campaign_name":"Newsletter launch — May 2026"}'
```

The backfill calls Resend's `GET /emails/{id}` per row, which returns only `last_event` (no per-event timestamps), so the `*_at` columns get stamped with the time of the backfill call. The webhook handles real timestamps going forward.

## What it writes

For each event we match `outreach_sends.resend_id` to `data.email_id` and update:

| Event | Columns written |
| --- | --- |
| `email.delivered` | `status='delivered'`, `delivered_at`, `last_event`, `last_event_at` |
| `email.opened` | `status='opened'`, `opened_at` (first), `open_count++`, `last_event`, `last_event_at` |
| `email.clicked` | `status='clicked'`, `clicked_at`, `opened_at` (if null), `click_count++`, `last_event`, `last_event_at` |
| `email.bounced` | `status='bounced'`, `bounced_at`, `last_event`, `last_event_at` |
| `email.complained` | `status='complained'`, `complained_at`, `last_event`, `last_event_at` |
| `email.delivery_delayed` | `status='delivered_delayed'`, `last_event`, `last_event_at` |
| any | append `{ type, created_at, svix_id, data }` to `events` jsonb |

Idempotency: events whose `svix-id` is already present in `events[]` are no-ops.
