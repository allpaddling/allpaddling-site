// ============================================================
// supabase/scripts/migration-runner.ts
//
// Batch migration runner for the Shopify→Stripe transition.
//
// What it does:
//   1. Reads `migration_customers` from Supabase (with the
//      service-role key, so RLS is bypassed).
//   2. Filters to the migration_status the operator selected
//      (default: 'pending').
//   3. For each customer, calls `create-checkout-session` in
//      MIGRATE mode — generates a one-time signup link with the
//      customer's exact Shopify rate inline-priced.
//   4. Renders the migration email body for each customer using
//      the same Mustache substitution the admin-migrate page
//      uses (mirrors `migration/emails/02_signup-link_T-3.md`).
//   5. Writes the results to a JSON file (one record per
//      customer with email body, signup_link, customer detail)
//      for the operator to bulk-paste into their inbox or feed
//      into a future Resend send loop.
//
// Why script (not just the admin-migrate page UI):
//   - On the morning of migration, the coach has 21 emails to
//     send. Clicking each row + Generate + Copy + paste into
//     gmail is ~2 min × 21 = 45 minutes of repetitive work.
//   - This collapses it to "run script → review JSON →
//     mass-send via the email provider of choice".
//   - It also catches errors early (e.g. a duplicate Stripe
//     customer rejection) before the coach hits Send.
//
// Usage:
//   STRIPE_SECRET_KEY=sk_test_...  (set in supabase secrets)
//   SUPABASE_URL=...
//   SUPABASE_SERVICE_ROLE_KEY=...
//
//   deno run --allow-net --allow-env --allow-read --allow-write \
//     supabase/scripts/migration-runner.ts \
//     [--status pending] [--limit 0] [--out ./migration-output.json] \
//     [--dry-run]
//
//   --status     migration_status to filter by (default 'pending')
//   --limit      max customers to process (default 0 = all)
//   --out        path to write the output JSON (default
//                ./migration-output.json)
//   --dry-run    don't actually call create-checkout-session,
//                just print the input data we WOULD send. Useful
//                for verifying the script picks the right rows
//                before burning Stripe sessions.
//
// CRITICAL:
//   - Run in TEST mode first (`STRIPE_SECRET_KEY=sk_test_...`).
//   - Each successful call creates a real Stripe Checkout
//     session that lives for 24h. Don't re-run on the same
//     batch in live mode without intent — it'll generate fresh
//     URLs that supersede the prior ones.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  Deno.exit(1);
}

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/create-checkout-session`;

// ------------------------------------------------------------
// CLI flag parsing — minimal, no dependency on a flag lib.
// ------------------------------------------------------------
function arg (name: string, fallback: string): string {
  const flag = `--${name}`;
  const i = Deno.args.indexOf(flag);
  if (i === -1) return fallback;
  const v = Deno.args[i + 1];
  if (!v || v.startsWith('--')) return ''; // boolean flag
  return v;
}
function flag (name: string): boolean {
  return Deno.args.includes(`--${name}`);
}

const STATUS_FILTER = arg('status', 'pending');
const LIMIT         = parseInt(arg('limit', '0'), 10) || 0;
const OUT_PATH      = arg('out', './migration-output.json');
const DRY_RUN       = flag('dry-run');

// ------------------------------------------------------------
// Types — mirror migration_customers schema
// ------------------------------------------------------------
interface MigrationCustomer {
  id:                string;
  legacy_id:         string | null;
  email:             string;
  name:              string;
  country_code:      string | null;
  plan_type:         'progressive' | 'custom';
  plan_key:          'prone' | 'sup' | 'oc' | 'ski' | null;
  amount_cents:      number;
  currency:          string;
  next_renewal:      string | null;
  shopify_created_at:string | null;
  migration_status:  string;
}

interface OutputRecord {
  customer_id:  string;
  email:        string;
  name:         string;
  plan_label:   string;
  amount_str:   string;       // "$140.00 AUD"
  next_renewal: string | null;
  signup_link:  string | null;
  session_id:   string | null;
  email_subject:string;
  email_body:   string;
  error:        string | null;
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
const PLAN_LABELS: Record<string, string> = {
  custom:           'Custom Season Race Plan',
  progressive_prone:'Progressive — Prone Paddleboard Plan',
  progressive_sup:  'Progressive — Stand Up Paddleboard Plan',
  progressive_oc:   'Progressive — Outrigger Canoe Plan',
  progressive_ski:  'Progressive — Surf Ski Plan',
};
function planLabelFor (c: MigrationCustomer): string {
  if (c.plan_type === 'custom') return PLAN_LABELS.custom;
  return PLAN_LABELS[`progressive_${c.plan_key}`] ?? `Progressive — ${c.plan_key}`;
}
function formatMoney (cents: number, currency: string): string {
  return `$${(cents / 100).toFixed(2)} ${(currency || '').toUpperCase()}`;
}
function formatDate (iso: string | null): string {
  if (!iso) return '[next renewal date]';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return iso; }
}
function firstName (full: string, email: string): string {
  return (full || '').split(' ')[0] || email.split('@')[0];
}

function renderEmail (c: MigrationCustomer, signupUrl: string): { subject: string; body: string } {
  const fn       = firstName(c.name, c.email);
  const plan     = planLabelFor(c);
  const amount   = formatMoney(c.amount_cents, c.currency);
  const renewal  = formatDate(c.next_renewal);

  const subject = "Action needed: your one-click link to move to the new All Paddling";

  const body = `Hi ${fn},

Here's your link to move across to the new All Paddling site:

👉 ${signupUrl}

It takes about 60 seconds. Your plan and price are already filled in for you — all you need to do is enter your card details.

What's set up for you:

- Plan: ${plan}
- Price: ${amount} per month (same as today)
- First charge on Stripe: ${renewal}
- Your old Shopify subscription: I'll cancel it before it bills, so you'll never be double-charged.

Once you sign up, you'll get instant access to the new member dashboard — your training plan, threshold pace tracking, and a much cleaner program view.

If anything looks off when you click through (price, plan name, anything), reply to this email and I'll fix it before you sign up. Don't enter card details for the wrong amount.

See you on the other side,

Mick
`;
  return { subject, body };
}

// ------------------------------------------------------------
// Step 1: load customers
// ------------------------------------------------------------
const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log(`Loading customers with migration_status = '${STATUS_FILTER}'…`);

const { data: customers, error: loadErr } = await sb
  .from('migration_customers')
  .select('id, legacy_id, email, name, country_code, plan_type, plan_key, amount_cents, currency, next_renewal, shopify_created_at, migration_status')
  .eq('migration_status', STATUS_FILTER)
  .order('next_renewal', { ascending: true, nullsFirst: false });

if (loadErr) {
  console.error('Failed to load migration_customers:', loadErr.message);
  Deno.exit(1);
}
if (!customers || customers.length === 0) {
  console.log('No customers match — nothing to do.');
  Deno.exit(0);
}

const targetCustomers = LIMIT > 0 ? customers.slice(0, LIMIT) : customers;
console.log(`Found ${customers.length} customer(s); processing ${targetCustomers.length}.\n`);

// ------------------------------------------------------------
// Step 2: generate Stripe Checkout sessions + email bodies
// ------------------------------------------------------------
const results: OutputRecord[] = [];
let successCount = 0;
let errorCount = 0;

for (const c of targetCustomers as MigrationCustomer[]) {
  const planLabel = planLabelFor(c);
  const amountStr = formatMoney(c.amount_cents, c.currency);

  let signupLink: string | null = null;
  let sessionId:  string | null = null;
  let errorMsg:   string | null = null;

  if (DRY_RUN) {
    signupLink = '[DRY RUN — no link generated]';
  } else {
    try {
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({
          plan_type:           c.plan_type,
          plan_key:            c.plan_key ?? undefined,
          email:               c.email,
          legacy_amount_cents: c.amount_cents,
          legacy_currency:     c.currency.toLowerCase(),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.detail || payload.error || `${res.status} ${res.statusText}`);
      }
      signupLink = payload.url;
      sessionId  = payload.session_id;
      successCount++;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
      errorCount++;
    }
  }

  const email = signupLink
    ? renderEmail(c, signupLink)
    : { subject: '[ERROR — no link]', body: `Failed to generate link for ${c.email}: ${errorMsg ?? 'unknown'}` };

  results.push({
    customer_id:  c.id,
    email:        c.email,
    name:         c.name,
    plan_label:   planLabel,
    amount_str:   amountStr,
    next_renewal: c.next_renewal,
    signup_link:  signupLink,
    session_id:   sessionId,
    email_subject:email.subject,
    email_body:   email.body,
    error:        errorMsg,
  });

  const status = errorMsg ? '✗' : (DRY_RUN ? '·' : '✓');
  console.log(`  ${status} ${c.name.padEnd(30)} ${c.email.padEnd(38)} ${amountStr}${errorMsg ? '  ←  ' + errorMsg : ''}`);
}

// ------------------------------------------------------------
// Step 3: write JSON output
// ------------------------------------------------------------
await Deno.writeTextFile(OUT_PATH, JSON.stringify({
  generated_at:   new Date().toISOString(),
  status_filter:  STATUS_FILTER,
  total:          targetCustomers.length,
  successes:      successCount,
  errors:         errorCount,
  dry_run:        DRY_RUN,
  records:        results,
}, null, 2));

console.log(`\nWrote ${results.length} records to ${OUT_PATH}`);
console.log(`  ${successCount} successful, ${errorCount} errored${DRY_RUN ? ', dry-run mode' : ''}.`);

if (!DRY_RUN && successCount > 0) {
  console.log(`\nNext step:`);
  console.log(`  - Review the JSON for any errors`);
  console.log(`  - Mass-send the emails via your provider of choice`);
  console.log(`  - Update each customer's migration_status to 'signup_link_sent' (admin-migrate.html UI or SQL)`);
}
