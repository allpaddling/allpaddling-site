#!/usr/bin/env bash
# Reads the most-recent migration-output JSON file, pulls the first
# record (assumes you ran migration-runner-live.sh with --only-email
# so there's only one), and POSTs it to Resend so the email actually
# lands in the customer's (or test alias') inbox.
#
# Why this is separate from migration-runner-live.sh:
#   - The runner generates the email body + signup link.
#   - We didn't want the runner to ALSO send (production-grade real
#     migration sends should go through a controlled batch send,
#     not a per-customer side-effect).
#   - For the smoke test, we want to feel the actual customer
#     experience, so we drive the send manually here.
#
# Reads RESEND_API_KEY silently. Sends FROM the verified
# allpaddling.online domain.
#
# Usage:
#   bash supabase/scripts/send-test-migration-email.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

LATEST_JSON=$(ls -t migration/migration-output-*.json 2>/dev/null | head -1)
if [[ -z "$LATEST_JSON" ]]; then
  echo "Error: no migration-output JSON found in migration/. Run migration-runner-live.sh first." >&2
  exit 1
fi

echo "Reading: $LATEST_JSON"

# Pull the first record. We use python (built-in on macOS) to parse
# the JSON cleanly without trying to grep through quoted strings.
read TO_EMAIL TO_NAME EMAIL_SUBJECT EMAIL_BODY < <(python3 - <<PYEOF
import json, sys
with open("$LATEST_JSON") as f:
    d = json.load(f)
r = d["records"][0]
# Sanity: refuse to send if signup_link is missing or DRY RUN.
link = r.get("signup_link") or ""
if not link or "DRY RUN" in link or "ERROR" in link:
    print("ERROR: signup_link missing or invalid:", link, file=sys.stderr)
    sys.exit(2)
# Print the four fields we need, tab-separated. Body is base64'd
# to avoid mangling newlines through bash's read.
import base64
body_b64 = base64.b64encode(r["email_body"].encode()).decode()
print(r["email"], r["name"], r["email_subject"], body_b64)
PYEOF
)

# Decode body
EMAIL_BODY_TEXT=$(echo "$EMAIL_BODY" | base64 -d)

echo "Will send:"
echo "  To:      $TO_EMAIL ($TO_NAME)"
echo "  Subject: $EMAIL_SUBJECT"
echo "  Body:    [first 100 chars] $(echo "$EMAIL_BODY_TEXT" | head -c 100)..."
echo

read -r -s -p "Paste RESEND_API_KEY (input is hidden), then press Enter: " RESEND_API_KEY
echo

if [[ "$RESEND_API_KEY" != re_* ]]; then
  echo "Error: RESEND_API_KEY should start with 're_'. Aborting." >&2
  unset RESEND_API_KEY
  exit 1
fi

# POST to Resend. Convert plain text body to a simple HTML version
# (just <pre> wrap to preserve newlines without losing the link).
HTML_BODY=$(python3 - <<PYEOF
import json, html, sys, os, re
text = """$EMAIL_BODY_TEXT"""
# Replace 👉 URL pattern with a clickable link
text_html = html.escape(text)
text_html = re.sub(r'(https?://[^\s\)]+)', r'<a href="\1" style="color:#155e75;">\1</a>', text_html)
print('<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;white-space:pre-wrap;">' + text_html + '</div>')
PYEOF
)

PAYLOAD=$(python3 - <<PYEOF
import json, sys
print(json.dumps({
    "from":     "Mick at All Paddling <mick@allpaddling.online>",
    "to":       ["$TO_EMAIL"],
    "subject":  """$EMAIL_SUBJECT""",
    "html":     """$HTML_BODY""",
    "text":     """$EMAIL_BODY_TEXT""",
    "reply_to": "mick@allpaddling.online",
    "tags":     [{"name": "purpose", "value": "migration_smoke_test"}],
}))
PYEOF
)

echo "Sending via Resend..."
RESP=$(curl -sS -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

unset RESEND_API_KEY

echo "Resend response:"
echo "$RESP"
echo
if echo "$RESP" | grep -q '"id"'; then
  echo "✓ Sent. Check $TO_EMAIL inbox (delivers via the +alias to your real Gmail)."
else
  echo "✗ Send failed. See response above." >&2
  exit 1
fi
