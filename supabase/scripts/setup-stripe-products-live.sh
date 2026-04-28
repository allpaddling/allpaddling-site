#!/usr/bin/env bash
# Helper for going live with Stripe products.
#
# Accepts either a Standard secret key (sk_live_...) or a Restricted
# key (rk_live_...). Restricted is preferred operationally — it can be
# scoped narrowly, avoiding the risk of any broader misuse if it were
# to leak. To create one:
#   Stripe Dashboard → Developers → API keys → "Create restricted key"
#   Set: Products = Write, Prices = Write, everything else = None.
# Save the key to your password manager — Stripe shows it once.
#
# Note on permissions: this script intentionally lists prices by
# `product` (not by `lookup_keys`) so it does NOT require the legacy
# "Plans" permission. Some Stripe accounts no longer expose Plans in
# the restricted-key UI at all — Products+Prices Write is sufficient.
#
# Reads the key silently (no echo, no history) into an env var, then
# runs setup-stripe-products.ts. The key is unset again after the run
# so it can't accidentally leak into a later command.
#
# Usage:
#   bash supabase/scripts/setup-stripe-products-live.sh
#
# The script will prompt:
#   "Paste sk_live_ or rk_live_ key (input is hidden), then press Enter:"
# Cmd+V to paste, Enter, done.
set -euo pipefail

cd "$(dirname "$0")/../.."

# Quick prereq check
if ! command -v deno >/dev/null 2>&1; then
  echo "Error: deno not found. Run: brew install deno" >&2
  exit 1
fi

# Read the key silently. No characters echoed; no shell history.
read -r -s -p "Paste sk_live_ or rk_live_ key (input is hidden), then press Enter: " STRIPE_SECRET_KEY
echo

# Trim leading/trailing whitespace + carriage returns. With hidden input it's
# easy to grab a stray space from the clipboard, and the prefix check below
# is anchored to the start of the string so even one space would fail it.
STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY#"${STRIPE_SECRET_KEY%%[![:space:]]*}"}"
STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY%"${STRIPE_SECRET_KEY##*[![:space:]]}"}"

# Sanity-check it actually starts with sk_live_ or rk_live_ — we do NOT want
# to accidentally point the live setup at a sandbox key (would create
# duplicate test products) or vice versa.
if [[ "$STRIPE_SECRET_KEY" != sk_live_* && "$STRIPE_SECRET_KEY" != rk_live_* ]]; then
  # Show only the prefix (up to the first underscore + 2 chars) so we can
  # diagnose what was actually pasted without leaking the secret. Useful
  # for catching pk_live_ (publishable), whsec_ (webhook), sk_test_ etc.
  prefix="$(printf '%s' "$STRIPE_SECRET_KEY" | head -c 10)"
  if [[ -z "$STRIPE_SECRET_KEY" ]]; then
    echo "Error: nothing was pasted. Try again and Cmd+V before pressing Enter." >&2
  else
    echo "Error: key starts with '${prefix}…' — expected 'sk_live_' or 'rk_live_'. Aborting." >&2
  fi
  unset STRIPE_SECRET_KEY
  exit 1
fi

echo "Running setup against LIVE Stripe..."
export STRIPE_SECRET_KEY
deno run --allow-net --allow-env supabase/scripts/setup-stripe-products.ts
RC=$?

# Always clear the key, regardless of script exit status.
unset STRIPE_SECRET_KEY
exit $RC
