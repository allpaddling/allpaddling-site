# Supabase scripts

One-off operational scripts that don't fit neatly into Edge Functions or migrations.

## setup-stripe-products.ts

Creates the canonical Stripe Products + Prices for new-customer signups. Idempotent — run it once per Stripe environment (test, live).

```bash
# Test mode (run after creating the Stripe test account)
STRIPE_SECRET_KEY=sk_test_... \
  deno run --allow-net --allow-env \
  supabase/scripts/setup-stripe-products.ts

# Live mode (run AFTER Mick activates the Stripe account with ABN 52173453156)
STRIPE_SECRET_KEY=sk_live_... \
  deno run --allow-net --allow-env \
  supabase/scripts/setup-stripe-products.ts
```

What it creates:

| Product (allpaddling_id)    | Stripe name                                      | AUD/month |
|------------------------------|--------------------------------------------------|----------:|
| `progressive_prone`          | Progressive Prone Paddleboard Plan               | 80.00     |
| `progressive_sup`            | Progressive Stand Up Paddleboard Plan            | 80.00     |
| `progressive_oc`             | Progressive Outrigger Canoe Plan                 | 80.00     |
| `progressive_ski`            | Progressive Surf Ski Plan                        | 80.00     |
| `custom_race`                | Custom Season Race Plan                          | 140.00    |

Prices are accessed by `lookup_key` (`progressive_prone_monthly_aud`, etc.) — `create-checkout-session` looks them up at runtime so swapping test/live key is just a config change, no code edits.

### Adding new currencies

When Mick decides on USD/NZD/CAD pricing for new (non-AU) customers, add rows to the `PRICES` array in the script and re-run. Existing prices are detected by lookup_key and skipped.

### Updating an existing price

Stripe prices are **immutable** — if you change the `unit_amount` of an existing entry in `PRICES`, the script will deactivate the old price (and unset its lookup_key) and create a new one with the same lookup_key. Existing subscriptions that reference the old price ID continue at the old rate (Stripe billing is bound to the price ID, not the lookup_key) — only NEW signups get the new rate. To migrate existing subs to a new rate, use Stripe's subscription update API.

### Migrate-mode prices

Migrate-mode signup links (created by the coach admin for moving a Shopify customer over) bypass this catalogue entirely — they create a one-off inline `price_data` block with the customer's exact legacy Shopify rate. So you don't need to add per-customer prices to this script.

## migration-runner.ts

Batch generator for the actual migration window. Reads `migration_customers`, calls `create-checkout-session` in MIGRATE mode for each pending customer, renders the migration email body, and writes a JSON file the coach can mass-send from.

```bash
# DRY RUN first — verifies which customers would be processed,
# without burning any Stripe Checkout sessions.
SUPABASE_URL=https://crlukzkgmydyqpwndjvc.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
  deno run --allow-net --allow-env --allow-read --allow-write \
  supabase/scripts/migration-runner.ts --dry-run

# REAL RUN — generates real Stripe Checkout URLs (test mode if
# Stripe is in test mode; live mode if you've already swapped
# the deployed function over to live keys).
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  deno run --allow-net --allow-env --allow-read --allow-write \
  supabase/scripts/migration-runner.ts
```

Flags:

- `--status pending` — which migration_status to filter by (default `pending`)
- `--limit 5` — process only N customers (useful for first-run verification)
- `--out path.json` — output file (default `./migration-output.json`)
- `--dry-run` — skip the actual Stripe API calls; just print the matched rows

Output JSON shape:

```json
{
  "generated_at": "2026-04-26T...",
  "status_filter": "pending",
  "total": 21,
  "successes": 21,
  "errors": 0,
  "records": [
    {
      "customer_id": "uuid",
      "email": "paora.monk@gmail.com",
      "name": "Paora Monk",
      "plan_label": "Custom Season Race Plan",
      "amount_str": "$166.00 NZD",
      "signup_link": "https://checkout.stripe.com/...",
      "session_id": "cs_...",
      "email_subject": "Action needed: ...",
      "email_body": "Hi Paora,\n\n...",
      "error": null
    }
  ]
}
```

Suggested workflow on migration day:

1. Run with `--dry-run` to verify the row set
2. Run for real with a small `--limit 1` to verify one end-to-end
3. Run again without limit to generate all 21 links
4. Bulk-paste the email_body fields into a mail-merge tool, OR send one by one
5. After sending, bulk-update `migration_customers.migration_status` to `signup_link_sent`
