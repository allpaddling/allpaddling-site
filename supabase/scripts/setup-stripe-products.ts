// ============================================================
// supabase/scripts/setup-stripe-products.ts
//
// One-off (idempotent) setup script that creates the canonical
// Stripe Products + Prices used by `create-checkout-session` in
// SELF mode. Migrate-mode prices are created inline per-customer
// from the Shopify export, so they don't need to be in this script.
//
// Run this once per Stripe environment:
//   * Once in test mode (after creating the Stripe test account)
//   * Once in live mode (after Mick activates the Stripe account
//     using ABN 52173453156)
//
// Usage:
//   STRIPE_SECRET_KEY=sk_test_... deno run --allow-net --allow-env \
//     supabase/scripts/setup-stripe-products.ts
//
// The script is fully idempotent:
//   * Products are matched by metadata.allpaddling_id
//   * Prices are matched by lookup_key
//   * Re-running on an up-to-date Stripe account is a no-op
//
// Output: prints the product + price IDs and lookup_keys so you
// can verify in the Stripe Dashboard.
// ============================================================

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
if (!STRIPE_SECRET_KEY) {
  console.error('STRIPE_SECRET_KEY env var required');
  Deno.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

// ------------------------------------------------------------
// Catalogue
// ------------------------------------------------------------
// One Product per plan. The `allpaddling_id` metadata field is
// our stable key — we look up products by it before creating, so
// the script is idempotent even if names change.
//
// Pricing decisions documented in `migration/customer_migration_audit.xlsx`
// → 8 distinct USD price points exist for legacy Custom plan customers.
// Those are grandfathered via inline price_data on migration. The
// prices here are the NEW-CUSTOMER defaults.
//
// All amounts are in cents/lowest denomination.
// ============================================================

interface ProductSpec {
  allpaddling_id: string;            // stable identifier for idempotency
  name:           string;
  description:    string;
}

interface PriceSpec {
  product_id:  string;               // ProductSpec.allpaddling_id
  lookup_key:  string;               // stable key used by create-checkout-session
  unit_amount: number;
  currency:    'aud' | 'usd' | 'nzd' | 'cad';
}

const PRODUCTS: ProductSpec[] = [
  {
    allpaddling_id: 'progressive_prone',
    name:           'Progressive Prone Paddleboard Plan',
    description:    'Monthly subscription. Up to 4 paddle-specific sessions a week — 3 intervals plus 1 longer steady — built around the prone stroke.',
  },
  {
    allpaddling_id: 'progressive_sup',
    name:           'Progressive Stand Up Paddleboard Plan',
    description:    'Monthly subscription. Up to 4 paddle-specific sessions a week — 3 intervals plus 1 longer steady — built around the SUP stroke.',
  },
  {
    allpaddling_id: 'progressive_oc',
    name:           'Progressive Outrigger Canoe Plan',
    description:    'Monthly subscription. Up to 4 paddle-specific sessions a week — 3 intervals plus 1 longer steady — built around the OC stroke.',
  },
  {
    allpaddling_id: 'progressive_ski',
    name:           'Progressive Surf Ski Plan',
    description:    'Monthly subscription. Up to 4 paddle-specific sessions a week — 3 intervals plus 1 longer steady — built around the surf-ski stroke.',
  },
  {
    allpaddling_id: 'custom_race',
    name:           'Custom Season Race Plan',
    description:    'Bespoke season-long custom training plan, written for your specific A-race and current fitness.',
  },
];

// AUD prices for new customers. Other currencies will be added
// when Mick confirms the new-customer pricing for non-AU customers.
// See migration audit "PRICING DECISION" finding.
const PRICES: PriceSpec[] = [
  { product_id: 'progressive_prone', lookup_key: 'progressive_prone_monthly_aud', unit_amount:  8000, currency: 'aud' },
  { product_id: 'progressive_sup',   lookup_key: 'progressive_sup_monthly_aud',   unit_amount:  8000, currency: 'aud' },
  { product_id: 'progressive_oc',    lookup_key: 'progressive_oc_monthly_aud',    unit_amount:  8000, currency: 'aud' },
  { product_id: 'progressive_ski',   lookup_key: 'progressive_ski_monthly_aud',   unit_amount:  8000, currency: 'aud' },
  { product_id: 'custom_race',       lookup_key: 'custom_race_monthly_aud',       unit_amount: 14000, currency: 'aud' },
];

// ------------------------------------------------------------
// Idempotent product upsert
// ------------------------------------------------------------
async function upsertProduct (spec: ProductSpec): Promise<Stripe.Product> {
  // Search by metadata.allpaddling_id. The Stripe search API uses
  // a query string syntax — quote the value.
  const search = await stripe.products.search({
    query: `metadata['allpaddling_id']:'${spec.allpaddling_id}'`,
    limit: 1,
  });

  if (search.data.length > 0) {
    const existing = search.data[0];
    const needsUpdate =
      existing.name        !== spec.name        ||
      existing.description !== spec.description;
    if (needsUpdate) {
      const updated = await stripe.products.update(existing.id, {
        name:        spec.name,
        description: spec.description,
      });
      console.log(`  ↻ updated product ${spec.allpaddling_id} → ${updated.id}`);
      return updated;
    }
    console.log(`  ✓ product ${spec.allpaddling_id} already exists → ${existing.id}`);
    return existing;
  }

  const created = await stripe.products.create({
    name:        spec.name,
    description: spec.description,
    metadata:    { allpaddling_id: spec.allpaddling_id },
  });
  console.log(`  + created product ${spec.allpaddling_id} → ${created.id}`);
  return created;
}

// ------------------------------------------------------------
// Idempotent price upsert
// ------------------------------------------------------------
// Stripe Prices are immutable — if the unit_amount or currency
// changes, the old price must be deactivated and a new one created
// (Stripe's recommendation). This function:
//   * If a price with this lookup_key exists AND matches → no-op
//   * If exists but doesn't match → deactivate it (transfer the lookup_key) and create a new one
//   * If doesn't exist → create
async function upsertPrice (spec: PriceSpec, productId: string): Promise<Stripe.Price> {
  const list = await stripe.prices.list({ lookup_keys: [spec.lookup_key], limit: 5 });

  const existing = list.data.find(p =>
    p.active &&
    p.unit_amount === spec.unit_amount &&
    p.currency    === spec.currency &&
    p.product     === productId
  );
  if (existing) {
    console.log(`    ✓ price ${spec.lookup_key} matches → ${existing.id}`);
    return existing;
  }

  // Deactivate any previous active price holding this lookup_key
  // and unset its lookup_key so the new one can claim it.
  for (const old of list.data.filter(p => p.active)) {
    await stripe.prices.update(old.id, { active: false, lookup_key: '' });
    console.log(`    ↳ deactivated stale price ${old.id} (was ${spec.lookup_key})`);
  }

  const created = await stripe.prices.create({
    product:     productId,
    unit_amount: spec.unit_amount,
    currency:    spec.currency,
    recurring:   { interval: 'month' },
    lookup_key:  spec.lookup_key,
    transfer_lookup_key: true,        // belt-and-braces if the deactivate above raced
  });
  console.log(`    + created price ${spec.lookup_key} → ${created.id} (${(spec.unit_amount / 100).toFixed(2)} ${spec.currency.toUpperCase()})`);
  return created;
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------
async function main (): Promise<void> {
  console.log('Setting up Stripe products and prices…\n');

  const productByAppId = new Map<string, Stripe.Product>();
  console.log('Products:');
  for (const spec of PRODUCTS) {
    const p = await upsertProduct(spec);
    productByAppId.set(spec.allpaddling_id, p);
  }

  console.log('\nPrices:');
  for (const spec of PRICES) {
    const product = productByAppId.get(spec.product_id);
    if (!product) {
      throw new Error(`price ${spec.lookup_key} references unknown product ${spec.product_id}`);
    }
    await upsertPrice(spec, product.id);
  }

  console.log('\nDone.');
  console.log('\nNext steps:');
  console.log('  1. Verify in Stripe Dashboard → Products');
  console.log('  2. Set the same STRIPE_SECRET_KEY in supabase secrets:');
  console.log('     supabase secrets set STRIPE_SECRET_KEY=…');
  console.log('  3. Deploy the functions:');
  console.log('     supabase functions deploy create-checkout-session');
  console.log('     supabase functions deploy stripe-webhook --no-verify-jwt');
}

main().catch(err => {
  console.error('Setup failed:', err);
  Deno.exit(1);
});
