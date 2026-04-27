# stripe-webhook Edge Function

Receives Stripe subscription lifecycle events and mirrors the relevant state into Supabase.

**Status: live.** All five handlers are implemented and the function is running against `sk_live_…`. Verified end-to-end on 2026-04-27 with one real A$1 checkout (subscription created → member row + member_profiles row + `subscriptions` row written). See HANDOFF.md "Latest session" for the test trace and known-pending bug fixes.

## Architecture

Stripe sends every webhook event as a POST. The handler:

1. Reads the **raw body** (not parsed JSON — the signature hashes the exact bytes Stripe sent).
2. Verifies the `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET` using `stripe.webhooks.constructEventAsync` with Deno's `SubtleCryptoProvider`.
3. Inserts a row into `webhook_events` keyed on `(source='stripe', event_id)`. If the row already exists (Stripe retried), returns 200 immediately without re-processing.
4. Routes by `event.type` to a handler. On success, stamps `processed_at`. On failure, records the error and returns 500 so Stripe retries.

## Required secrets

```
STRIPE_SECRET_KEY            sk_live_… (currently live; rotate via Stripe dashboard)
STRIPE_WEBHOOK_SECRET        whsec_… — one per endpoint, NOT the API key
SUPABASE_URL                 https://crlukzkgmydyqpwndjvc.supabase.co
SUPABASE_SERVICE_ROLE_KEY    service_role key — auto-injected by platform
EMAIL_FROM                   "Mick at All Paddling <mick@allpaddling.online>"
RESEND_API_KEY               re_… — used by the send-email helper
```

Set them with:

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by the
# Supabase platform — no need to set them manually for deployed functions.
```

## Local development

Two terminals:

```bash
# Terminal 1 — run the function locally
supabase functions serve stripe-webhook --env-file ./supabase/.env.local

# Terminal 2 — forward Stripe events to localhost
stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook
# Copy the printed `whsec_…` into supabase/.env.local as STRIPE_WEBHOOK_SECRET
```

Trigger sample events:

```bash
stripe trigger checkout.session.completed
stripe trigger invoice.paid
stripe trigger invoice.payment_failed
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
```

## Deploy

```bash
supabase functions deploy stripe-webhook --no-verify-jwt
```

`--no-verify-jwt` is **critical**: Stripe is not a Supabase user and does not send a JWT. Authentication of the caller is handled by Stripe's own webhook signature verification inside the function.

## Configuring the Stripe endpoint

In Stripe dashboard → Developers → Webhooks:

- URL: `https://crlukzkgmydyqpwndjvc.supabase.co/functions/v1/stripe-webhook`
- Events to send: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`
- Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`

## Idempotency

Stripe may deliver the same event multiple times. The unique constraint on `webhook_events(source, event_id)` is the deduplication mechanism. The first delivery succeeds, claims the row, and runs the handler. Subsequent deliveries hit the unique-violation, log "already processed", and return 200.

## Handlers (current implementation)

| Event | What it writes |
|---|---|
| `checkout.session.completed` | Inserts/updates `progressive_members` or `custom_members` (matched on email + `auth_user_id`), upserts `member_profiles` with `completed_onboarding_at: null` (so the dashboard onboarding redirect is deterministic), inserts a `subscriptions` row, sends the welcome email via the `send-email` function. |
| `invoice.paid` | Stamps `subscriptions.last_payment_at`, sends the payment-receipt email. |
| `invoice.payment_failed` | Marks the subscription `past_due`, sends the payment-failed email. |
| `customer.subscription.updated` | Mirrors `current_period_end`, `cancel_at_period_end`, and `status` to the matching `subscriptions` row. Used to drive the upcoming-renewal email + the cancel-with-12-week-lock UI. |
| `customer.subscription.deleted` | Marks the subscription `canceled` and clears the member's plan. |

The `checkout.session.completed` handler reads three required fields from `session.metadata`: `user_id`, `plan_type` (`progressive` or `custom`), and (Progressive only) `plan_key`. These are set by the `create-checkout-session` function during Stripe session creation.
