// ============================================================
// supabase/functions/create-checkout-session/index.ts
//
// The other half of the Stripe pipeline. Generates a Stripe
// Checkout Session URL that the frontend (or coach migration
// flow) redirects the customer to. The session is created with
// metadata that the existing `stripe-webhook` handler reads
// back to wire the subscription up correctly.
//
// Required environment (set via `supabase secrets set`):
//
//   STRIPE_SECRET_KEY          sk_test_… or sk_live_…
//   SUPABASE_URL               https://<project>.supabase.co
//   SUPABASE_ANON_KEY          anon key (for self-mode JWT verification)
//   SUPABASE_SERVICE_ROLE_KEY  service-role key (for migrate-mode user lookup)
//   APP_BASE_URL               e.g. "https://allpaddling.online" (during the
//                              migration window — flips to allpaddling.com after
//                              cutover; .com still serves the Shopify store).
//
// Three callers, two modes — auth + body shape determines which:
//
//   1. SELF mode — frontend, customer's own JWT
//      Authorization: Bearer <user JWT>
//      No `email`/`legacy_*` fields in body.
//      We use auth.uid() and look up a canonical Price by lookup_key.
//
//   2. MIGRATE mode — coach admin browser, coach's JWT
//      Authorization: Bearer <user JWT> (where the user is in `coaches`)
//      Body contains `email` + `legacy_amount_cents` + `legacy_currency`.
//      We verify the JWT belongs to a coach, then look up/create the
//      target customer's auth user and use inline price_data to
//      grandfather their exact Shopify monthly amount.
//
//   3. MIGRATE mode — server-side script, service-role key
//      Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
//      Body contains `email` + `legacy_amount_cents` + `legacy_currency`.
//      Same as (2) but skips the coach-role check (service role is
//      already trusted). Used by batch migration scripts.
//
// Both modes attach the same metadata contract that
// `stripe-webhook` requires:
//   metadata.user_id    — Supabase auth.users(id)
//   metadata.plan_type  — 'progressive' | 'custom'
//   metadata.plan_key   — 'prone' | 'sup' | 'oc' | 'ski' (progressive only)
//   metadata.source     — 'self' | 'migrate' (analytics + audit)
//
// Deploy:
//   supabase functions deploy create-checkout-session
//
// JWT verification stays ON for this function — we want the
// SELF path to require a valid user JWT. The MIGRATE path
// detects the service-role key by signature and bypasses the
// user-id-from-JWT step.
// ============================================================

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------
const STRIPE_SECRET_KEY     = Deno.env.get('STRIPE_SECRET_KEY')         ?? '';
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')              ?? '';
const SUPABASE_ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')         ?? '';
const SERVICE_ROLE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const APP_BASE_URL          = Deno.env.get('APP_BASE_URL')              ?? 'https://allpaddling.online';

if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  console.error('create-checkout-session: missing required environment variable(s)');
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

// Service-role client for admin operations (user lookup/create).
const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ------------------------------------------------------------
// Type definitions
// ------------------------------------------------------------
type PlanType = 'progressive' | 'custom';
type PlanKey  = 'prone' | 'sup' | 'oc' | 'ski';
type Currency = 'aud' | 'usd' | 'nzd' | 'cad';

interface CheckoutRequest {
  plan_type: PlanType;
  plan_key?: PlanKey;          // required if plan_type='progressive'

  // MIGRATE-mode-only fields. Ignored in SELF mode.
  email?:               string;       // customer email
  legacy_amount_cents?: number;       // e.g. 14000 = $140.00
  legacy_currency?:     Currency;

  // Optional URL overrides
  success_url?: string;
  cancel_url?:  string;
}

// Lookup keys for canonical (new-customer) Prices created by the
// setup-stripe-products script. SELF mode resolves these via the
// Stripe API rather than hardcoding price IDs, so the function
// keeps working across test/live mode swaps.
const SELF_PRICE_LOOKUP: Record<PlanKey | 'custom', string> = {
  prone:  'progressive_prone_monthly_aud',
  sup:    'progressive_sup_monthly_aud',
  oc:     'progressive_oc_monthly_aud',
  ski:    'progressive_ski_monthly_aud',
  custom: 'custom_race_monthly_aud',
};

// Human-readable product names used when we have to create a
// price inline for migrate-mode (Stripe requires a product name
// in price_data when the product is created on the fly).
const PRODUCT_NAMES: Record<PlanKey | 'custom', string> = {
  prone:  'Progressive Prone Paddleboard Plan',
  sup:    'Progressive Stand Up Paddleboard Plan',
  oc:     'Progressive Outrigger Canoe Plan',
  ski:    'Progressive Surf Ski Plan',
  custom: 'Custom Season Race Plan',
};

// ------------------------------------------------------------
// Entry point
// ------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  let body: CheckoutRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  // Validate plan_type / plan_key combination
  const planType = body.plan_type;
  if (planType !== 'progressive' && planType !== 'custom') {
    return jsonResponse({ error: 'invalid_plan_type', detail: 'plan_type must be "progressive" or "custom"' }, 400);
  }
  let planKey: PlanKey | undefined;
  if (planType === 'progressive') {
    if (!body.plan_key || !['prone', 'sup', 'oc', 'ski'].includes(body.plan_key)) {
      return jsonResponse({ error: 'invalid_plan_key', detail: 'plan_key must be one of prone/sup/oc/ski for progressive plans' }, 400);
    }
    planKey = body.plan_key;
  }

  // Auth + body inspection determine mode.
  const authHeader     = req.headers.get('authorization') ?? '';
  const userJwt        = authHeader.replace(/^Bearer\s+/i, '');
  const isServiceRole  = authHeader === `Bearer ${SERVICE_ROLE_KEY}`;
  const wantsMigrate   = !!body.email && !!body.legacy_amount_cents;

  try {
    let userId: string;
    let email:  string;
    let line:   Stripe.Checkout.SessionCreateParams.LineItem;
    let isMigration = false;

    if (wantsMigrate && isServiceRole) {
      // ----- MIGRATE mode (3): server-side script with service-role key -----
      isMigration = true;
    } else if (wantsMigrate) {
      // ----- MIGRATE mode (2): coach JWT in browser. Verify role. -----
      if (!userJwt) {
        return jsonResponse({ error: 'unauthorized', detail: 'Authorization header required' }, 401);
      }
      const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${userJwt}` } },
        auth:   { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData, error: userErr } = await sbUser.auth.getUser();
      if (userErr || !userData?.user || !userData.user.email) {
        return jsonResponse({ error: 'unauthorized', detail: 'Invalid user JWT' }, 401);
      }
      // is_coach() — same predicate the frontend uses for admin gating.
      const callerEmail = userData.user.email.toLowerCase();
      const { data: coachRow, error: coachErr } = await sbUser
        .from('coaches')
        .select('email')
        .eq('email', callerEmail)
        .maybeSingle();
      if (coachErr) {
        console.error('coach lookup failed', coachErr);
        return jsonResponse({ error: 'role_check_failed' }, 500);
      }
      if (!coachRow) {
        return jsonResponse({ error: 'forbidden', detail: 'Migrate mode requires a coach role.' }, 403);
      }
      isMigration = true;
    }

    if (isMigration) {
      // Validate migrate-mode body fields.
      if (!body.legacy_currency || !['aud', 'usd', 'nzd', 'cad'].includes(body.legacy_currency)) {
        return jsonResponse({ error: 'invalid_legacy_currency', detail: 'legacy_currency must be aud/usd/nzd/cad' }, 400);
      }
      if (body.legacy_amount_cents! <= 0 || body.legacy_amount_cents! > 1_000_000) {
        return jsonResponse({ error: 'legacy_amount_out_of_range' }, 400);
      }

      email  = body.email!.toLowerCase().trim();
      userId = await getOrCreateAuthUser(email);

      // Inline price — grandfathers the customer's existing Shopify rate.
      line = {
        price_data: {
          currency: body.legacy_currency,
          product_data: { name: PRODUCT_NAMES[planKey ?? 'custom'] },
          unit_amount: body.legacy_amount_cents,
          recurring:   { interval: 'month' },
        },
        quantity: 1,
      };
    } else {
      // ----- SELF MODE -----
      if (!userJwt) {
        return jsonResponse({ error: 'unauthorized', detail: 'Authorization header required' }, 401);
      }
      const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${userJwt}` } },
        auth:   { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData, error: userErr } = await sbUser.auth.getUser();
      if (userErr || !userData?.user) {
        return jsonResponse({ error: 'unauthorized', detail: 'Invalid user JWT' }, 401);
      }
      userId = userData.user.id;
      email  = userData.user.email?.toLowerCase() ?? '';
      if (!email) {
        return jsonResponse({ error: 'no_email_on_user', detail: 'auth user has no email' }, 400);
      }

      // Look up the canonical Price by lookup_key.
      const lookupKey = SELF_PRICE_LOOKUP[planKey ?? 'custom'];
      const prices = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
      const price = prices.data[0];
      if (!price) {
        return jsonResponse(
          { error: 'price_not_found', detail: `No active Stripe Price with lookup_key=${lookupKey}. Run setup-stripe-products.ts first.` },
          500,
        );
      }
      line = { price: price.id, quantity: 1 };
    }

    // Build success / cancel URLs. Default success goes to a
    // post-checkout welcome page that can read ?session_id=... if
    // we want client-side confirmation; webhook fires either way.
    const successUrl = body.success_url ?? `${APP_BASE_URL}/app/welcome.html?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl  = body.cancel_url  ?? `${APP_BASE_URL}/getting-started.html?cancelled=1`;

    // Create the Checkout Session.
    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      customer_email:       email,
      line_items:           [line],
      success_url:          successUrl,
      cancel_url:           cancelUrl,
      client_reference_id:  userId,
      metadata: {
        user_id:   userId,
        plan_type: planType,
        plan_key:  planKey ?? '',
        source:    isMigration ? 'migrate' : 'self',
        ...(isMigration && body.email ? { migrated_from_email: body.email.toLowerCase() } : {}),
      },
      // Pass tax-collection setting through; Stripe Tax (if enabled
      // on the account) will compute AU GST for AU customers.
      automatic_tax: { enabled: true },
      // Allow promotion codes (for migration grace, future referrals).
      allow_promotion_codes: true,
    });

    if (!session.url) {
      return jsonResponse({ error: 'no_session_url', detail: 'Stripe returned a session with no URL' }, 500);
    }

    return jsonResponse({
      url:        session.url,
      session_id: session.id,
      mode:       isMigration ? 'migrate' : 'self',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('create-checkout-session: failed', err);
    return jsonResponse({ error: 'internal', detail: msg }, 500);
  }
});

// ============================================================
// Helpers
// ============================================================

/**
 * Look up an existing Supabase auth user by email, or create one.
 * Used in MIGRATE mode where the coach is generating a signup
 * link for a customer who has never logged in to the new site.
 *
 * The created user is `email_confirm: true` so the magic-link
 * step is skipped — the customer's identity is implicitly
 * confirmed by the coach handing them the signed link.
 */
async function getOrCreateAuthUser (email: string): Promise<string> {
  // Look up first. supabase-js provides listUsers with filter.
  const { data: list, error: listErr } = await sbAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) throw new Error(`listUsers: ${listErr.message}`);

  const existing = list?.users.find(u => (u.email ?? '').toLowerCase() === email);
  if (existing) return existing.id;

  // Create.
  const { data: created, error: createErr } = await sbAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createErr) throw new Error(`createUser(${email}): ${createErr.message}`);
  if (!created?.user?.id) throw new Error(`createUser(${email}): no user id returned`);
  return created.user.id;
}

function corsHeaders (): HeadersInit {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, content-type, x-migration',
  };
}

function jsonResponse (body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
