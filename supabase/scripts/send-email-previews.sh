#!/usr/bin/env bash
# Send a preview copy of every customer-facing email to one recipient
# so the coach team can read them on their commute. Uses sample
# customer data.
#
#   5 migration emails (T-7, T-3, T-0, T+3, T+14) — sent via send-email
#     Edge Function in raw mode.
#   6 transactional emails (welcome, payment-receipt, plan-ready,
#     block-delivered, payment-failed, upcoming-renewal) — sent via
#     send-email Edge Function in template mode.
#
# Each preview is tagged with `purpose=preview` and the subject is
# prefixed with "[PREVIEW] " so it's distinguishable from real sends.
# (EMAIL_BCC also applies — Jake + Mick automatically get a copy of
# every send. Specifying a different recipient via the arg below is
# only needed when you want the previews in someone's PRIMARY inbox
# rather than BCC view.)
#
# Service-role key is read silently via stdin (silent stdin pattern;
# see project_allpaddling_secret_handling memory).
#
# Pre-req: send-email Edge Function deployed with EMAIL_BCC support
# (commit f87f071c). If you haven't deployed yet, do that first:
#   supabase functions deploy send-email --no-verify-jwt --project-ref crlukzkgmydyqpwndjvc
#
# Usage:
#   bash supabase/scripts/send-email-previews.sh                      # defaults to jakedibetta@gmail.com
#   bash supabase/scripts/send-email-previews.sh dibetta1@gmail.com   # send to Mick instead
set -euo pipefail

PROJECT_REF="crlukzkgmydyqpwndjvc"
PREVIEW_TO="${1:-jakedibetta@gmail.com}"

echo "Will send 11 preview emails to: $PREVIEW_TO"
echo

read -r -s -p "Paste SUPABASE_SERVICE_ROLE_KEY (input is hidden), then press Enter: " SERVICE_ROLE_KEY
echo

if [[ "$SERVICE_ROLE_KEY" != eyJ* && "$SERVICE_ROLE_KEY" != sb_secret_* ]]; then
  echo "Error: key should start with 'eyJ' (legacy JWT) or 'sb_secret_' (new format). Aborting." >&2
  unset SERVICE_ROLE_KEY
  exit 1
fi

ENDPOINT="https://${PROJECT_REF}.supabase.co/functions/v1/send-email"

# ============================================================
# Helper: send one POST. Suppresses the secret from any error trace.
# ============================================================
send_one () {
  local label="$1"
  local payload="$2"

  echo "▸ Sending $label..."
  resp=$(curl -sS -X POST "$ENDPOINT" \
    -H "x-service-role-key: $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>&1)
  if echo "$resp" | grep -q '"id"'; then
    id=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "?")
    echo "  ✓ sent (id=$id)"
  else
    echo "  ✗ FAILED: $resp" >&2
  fi
}

# ============================================================
# Sample customer data (used for both migration + transactional)
# ============================================================
SAMPLE_NAME="Sarah Williams"
SAMPLE_FIRST="Sarah"
SAMPLE_PLAN_LABEL="Custom Season Race Plan"
SAMPLE_MONTHLY="140.00 AUD"
SAMPLE_RENEWAL="15 May 2026"
SAMPLE_SIGNUP_LINK="https://example.stripe.com/sample-signup-link-not-real-just-a-preview"
SAMPLE_AMOUNT="140.00"
SAMPLE_CURRENCY="AUD"
SAMPLE_PERIOD_START="15 April 2026"
SAMPLE_PERIOD_END="15 May 2026"
SAMPLE_NEXT_BILLING="15 May 2026"
SAMPLE_INVOICE_URL="https://invoice.stripe.com/sample-not-real"
SAMPLE_SETTINGS_URL="https://allpaddling.online/app/settings.html"
SAMPLE_PLAN_URL="https://allpaddling.online/app/program.html"
SAMPLE_UPDATE_CARD_URL="https://billing.stripe.com/p/sample-not-real"
SAMPLE_RETRY_DATE="22 April 2026"
SAMPLE_DAYS_UNTIL_RENEWAL="3"

# ============================================================
# Migration emails (raw mode)
# Bodies are kept in sync with rebuild/assets/admin-migrate.js
# renderEmail* functions.
# ============================================================
build_migration_email_payload () {
  local kind="$1"
  python3 <<PYEOF
import json
kind = "$kind"
first = "$SAMPLE_FIRST"
plan = "$SAMPLE_PLAN_LABEL"
monthly = "$SAMPLE_MONTHLY"
renewal = "$SAMPLE_RENEWAL"
link = "$SAMPLE_SIGNUP_LINK"

bodies = {
  "heads_up_t7": {
    "subject": "[PREVIEW] Quick heads-up: we're moving the All Paddling site",
    "text": f"""Hi {first},

Quick note from me — over the next couple of weeks I'm moving All Paddling onto a new platform. Same coaching, same plans, just a much better home for it all (faster, cleaner, no more clunky Shopify portal).

Here's what this means for you:

- Your {plan} continues without interruption.
- Your monthly amount stays the same: {monthly} per month.
- Your next renewal is {renewal}.
- You don't need to do anything today — I'll send you a one-click link in a few days to move you across.

The only small ask when the time comes will be re-entering your card. The new system runs on Stripe (way more secure than what we had), and unfortunately the old Shopify card details don't transfer across — that's the one bit of friction I can't engineer away.

If you've got any questions in the meantime, just hit reply.

Thanks for being on this journey with me.

Mick
""",
  },
  "signup_link_t3": {
    "subject": "[PREVIEW] Action needed: your one-click link to move to the new All Paddling",
    "text": f"""Hi {first},

Here's your link to move across to the new All Paddling site:

👉 {link}

It takes about 60 seconds. Your plan and price are already filled in for you — all you need to do is enter your card details.

What's set up for you:

- Plan: {plan}
- Price: {monthly} per month
- First charge on Stripe: {renewal}
- Your old Shopify subscription: I'll cancel it before it bills, so you'll never be double-charged.

Once you sign up, you'll get instant access to the new member dashboard — your training plan, threshold pace tracking, and a much cleaner program view.

If anything looks off when you click through (price, plan name, anything), reply to this email and I'll fix it before you sign up.

See you on the other side,

Mick
""",
  },
  "renewal_day_t0": {
    "subject": "[PREVIEW] Today's your renewal day — quick action needed",
    "text": f"""Hi {first},

Just a quick one — today is your usual All Paddling renewal day, and your Shopify sub will bill you {monthly} as normal in the next few hours.

If you haven't moved across to the new site yet, your link is here:

👉 {link}

A few options for what happens today:

- Best path: click the link, sign up on Stripe in 60 seconds. I'll cancel the Shopify sub before it bills, and you start fresh on the new platform tomorrow.
- Fine path: Shopify bills you today as usual, you keep coaching for another month, and we move you across before the next renewal.
- No-rush path: if you want to take a break or have a question, just reply.

No pressure — your training keeps going either way. But the new site is much better and I'd love to have you on it.

Mick
""",
  },
  "followup_tplus3": {
    "subject": "[PREVIEW] Everything OK?",
    "text": f"""Hey {first},

Just checking in — I sent you the link to move to the new All Paddling site about a week ago and I haven't heard back. No drama, just want to make sure nothing's gone wrong on your end.

Possible explanations and how I can help with each:

- The email got lost. Here's the link again: {link}
- You're trying to take a break from training. No problem at all — reply and let me know, I'll pause the move so you don't get more reminders.
- Something's not working when you click through. Reply with what you see and I'll sort it.
- You've decided to stop coaching with me. That's OK too — just a quick reply so I know to close things off cleanly. No hard feelings.

Whatever it is, just hit reply. Two-line response is plenty.

Mick
""",
  },
  "lapse_tplus14": {
    "subject": "[PREVIEW] Your All Paddling subscription has been paused",
    "text": f"""Hi {first},

I haven't heard from you about moving to the new All Paddling site, so I've gone ahead and cancelled your Shopify subscription today. That means:

- No more charges to your card from the old system.
- Your training history is safe — I keep a record of everything you've done with me.
- The door is open if you want to come back. Whenever you're ready, your one-click link still works: {link}

If this was a mistake or you'd like to chat about it, just reply. I'm easy to find.

Wishing you well on the water either way.

Mick
""",
  },
}

b = bodies[kind]
import html, re
escaped = html.escape(b["text"])
linked = re.sub(r'(https?://[^\s)]+)', r'<a href="\1" style="color:#155e75;">\1</a>', escaped)
html_body = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;white-space:pre-wrap;">' + linked + '</div>'

print(json.dumps({
  "mode":    "raw",
  "to":      "$PREVIEW_TO",
  "subject": b["subject"],
  "text":    b["text"],
  "html":    html_body,
  "tags":    [{"name": "purpose", "value": "preview"}, {"name": "kind", "value": kind}],
}))
PYEOF
}

for kind in heads_up_t7 signup_link_t3 renewal_day_t0 followup_tplus3 lapse_tplus14; do
  payload=$(build_migration_email_payload "$kind")
  send_one "migration:$kind" "$payload"
done

# ============================================================
# Transactional emails (template mode)
# ============================================================
build_transactional_payload () {
  local template="$1"
  python3 <<PYEOF
import json

template = "$template"
common = {
  "member_name":  "$SAMPLE_FIRST",
  "plan_name":    "$SAMPLE_PLAN_LABEL",
  "plan_url":     "$SAMPLE_PLAN_URL",
  "settings_url": "$SAMPLE_SETTINGS_URL",
  "coach_name":   "Mick",
}

vars_by_template = {
  "welcome": {
    **common,
    "post_signup_message": "Mick will be in touch within 1-2 days to tailor your custom plan.",
  },
  "payment-receipt": {
    **common,
    "amount":            "$SAMPLE_AMOUNT",
    "currency":          "$SAMPLE_CURRENCY",
    "period_start":      "$SAMPLE_PERIOD_START",
    "period_end":        "$SAMPLE_PERIOD_END",
    "next_billing_date": "$SAMPLE_NEXT_BILLING",
    "invoice_pdf_url":   "$SAMPLE_INVOICE_URL",
  },
  "plan-ready": {
    **common,
  },
  "block-delivered": {
    **common,
    "block_number": 2,
  },
  "payment-failed": {
    **common,
    "amount":          "$SAMPLE_AMOUNT",
    "currency":        "$SAMPLE_CURRENCY",
    "retry_date":      "$SAMPLE_RETRY_DATE",
    "update_card_url": "$SAMPLE_UPDATE_CARD_URL",
  },
  "upcoming-renewal": {
    **common,
    "amount":              "$SAMPLE_AMOUNT",
    "currency":            "$SAMPLE_CURRENCY",
    "renewal_date":        "$SAMPLE_NEXT_BILLING",
    "days_until_renewal":  "$SAMPLE_DAYS_UNTIL_RENEWAL",
  },
}

print(json.dumps({
  "template": template,
  "to":       "$PREVIEW_TO",
  "vars":     vars_by_template[template],
  "tags":     [{"name": "purpose", "value": "preview"}, {"name": "template", "value": template}],
}))
PYEOF
}

for tpl in welcome payment-receipt plan-ready block-delivered payment-failed upcoming-renewal; do
  payload=$(build_transactional_payload "$tpl")
  send_one "transactional:$tpl" "$payload"
done

unset SERVICE_ROLE_KEY

echo
echo "Done. 11 preview emails dispatched to $PREVIEW_TO."
echo "Subject lines start with '[PREVIEW]' so they're easy to find."
echo
echo "Heads up: transactional templates show their real subject line (e.g."
echo "'You're in — welcome to All Paddling') — only the migration ones got"
echo "a [PREVIEW] subject prefix because their bodies are inlined here."
