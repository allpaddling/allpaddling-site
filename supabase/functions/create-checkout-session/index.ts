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
// Four callers, three modes — auth + body shape determines which:
//
//   1. SELF mode — frontend, customer's own JWT (signed-in returning users)
//      Authorization: Bearer <user JWT>
//      No `email`/`legacy_*` fields in body.
//      We use auth.uid() and look up a canonical Price by lookup_key.
//
//   2. ANON mode — public self-signup, no auth required (NEW customer flow)
//      No Authorization header.
//      Body contains `email` + `plan_type` + `plan_key` (Progressive only).
//      We create the auth user inline (getOrCreateAuthUser), use the
//      canonical Price by lookup_key (same as SELF), and generate a
//      magiclink success_url so the customer lands signed in post-payment.
//      This is the streamlined "click Subscribe → enter email → Stripe"
//      flow on the public plans pages.
//
//   3. MIGRATE mode — coach admin browser, coach's JWT
//      Authorization: Bearer <user JWT> (where the user is in `coaches`)
//      Body contains `email` + `legacy_amount_cents` + `legacy_currency`.
//      We verify the JWT belongs to a coach, then look up/create the
//      target customer's auth user and use inline price_data with the
//      amount supplied in the body. NB: parameter is named
//      `legacy_amount_cents` for backwards compat, but per Mick's
//      Decision B (2026-04-27) every migrating customer is being reset
//      to A$140 Custom / A$80 Progressive. There is no grandfathering.
//      The amount in `migration_customers.amount_cents` (which is what
//      admin-migrate.js posts here) is now uniform Decision B pricing.
//
//   4. MIGRATE mode — server-side script, service-role key
//      Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
//      Body contains `email` + `legacy_amount_cents` + `legacy_currency`.
//      Same as (3) but skips the coach-role check (service role is
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
//
// Custom Plan key updated 2026-04-29 from `custom_race_monthly_aud`
// (calendar-monthly billing) to `custom_race_4weekly_aud` (every 28
// days). Reason: Mick's Custom content is delivered in calendar-
// anchored 4-week blocks (Block 2 = May 4 + 28d = Jun 1). To keep
// billing aligned with content delivery without drift, the Stripe
// price now bills every 4 weeks. The old monthly price stays active
// in Stripe so the 3 already-migrated customers (Daniel, Pat, Paora)
// keep working — they'll be migrated to the new price as a separate
// Phase 2 step. Progressive prices stay monthly (Mick's Progressive
// content isn't calendar-aligned).
const SELF_PRICE_LOOKUP: Record<PlanKey | 'custom', string> = {
  prone:  'progressive_prone_monthly_aud',
  sup:    'progressive_sup_monthly_aud',
  oc:     'progressive_oc_monthly_aud',
  ski:    'progressive_ski_monthly_aud',
  custom: 'custom_race_4weekly_aud',
};

// ------------------------------------------------------------
// Block-anchored billing (Custom Plan only, 2026-04-29)
//
// Mick publishes a new 4-week Custom Plan content block every 28
// days, anchored to Mon 4 May 2026 in Sydney time. Block boundaries
// from there: 4 May → 1 Jun → 29 Jun → 27 Jul → 24 Aug → ...
//
// nextBlockStart(today) returns the next block boundary at or after
// `today`. Used as Stripe Checkout's `subscription_data.billing_cycle_anchor`
// so a customer signing up mid-block:
//   1. Pays a pro-rated portion immediately (Stripe computes from
//      proration_behavior='create_prorations' against the cycle).
//   2. Has their first full $140 charge land on the next block start.
//   3. Renews every 28 days from there, staying aligned with content.
//
// The anchor date is fixed in code intentionally — it's the program's
// real-world calendar event. If the schedule ever shifts (Mick takes
// a break, etc.) we'll update the constant and any sub created from
// the new value will track the new schedule. Existing subs ride out
// at their existing 28-day cadence.
// ------------------------------------------------------------
const BLOCK_ANCHOR_UTC_MS = Date.UTC(2026, 4, 3, 14, 0, 0);
// ↑ 2026-05-04 00:00 Sydney (AEST = UTC+10) → 2026-05-03 14:00 UTC.
//   Hardcoded in UTC ms to avoid Deno edge runtimes' default-tz drift.
const BLOCK_LENGTH_MS    = 28 * 24 * 60 * 60 * 1000;

function nextBlockStart (today: Date): Date {
  const elapsed = today.getTime() - BLOCK_ANCHOR_UTC_MS;
  if (elapsed <= 0) return new Date(BLOCK_ANCHOR_UTC_MS);
  const blocksElapsed = Math.floor(elapsed / BLOCK_LENGTH_MS);
  return new Date(BLOCK_ANCHOR_UTC_MS + (blocksElapsed + 1) * BLOCK_LENGTH_MS);
}

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
  // Service role detection: accept either the legacy JWT format (decode
  // and check role claim is "service_role") OR an exact-match against
  // the env var (covers the new sb_secret_ format and any future
  // formats without us having to know about them).
  //
  // Why both: Supabase rotated their default service-role key format on
  // 2026-04-27 from JWT (eyJ...) to opaque (sb_secret_...). The auto-
  // injected SUPABASE_SERVICE_ROLE_KEY env var on Edge Functions might
  // be either format depending on when the project was created, and a
  // caller might still be using a legacy key from the dashboard. The
  // JWT-decode path is robust to both rotations and stale env vars; the
  // exact-match path covers opaque tokens that aren't decodable.
  const isServiceRoleJwt = (jwt: string): boolean => {
    try {
      const [, payload] = jwt.split('.');
      if (!payload) return false;
      // base64url -> base64
      const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
      const decoded = JSON.parse(atob(padded));
      return decoded.role === 'service_role';
    } catch {
      return false;
    }
  };
  const isServiceRole = (
    isServiceRoleJwt(userJwt) ||
    (SERVICE_ROLE_KEY && authHeader === `Bearer ${SERVICE_ROLE_KEY}`)
  );
  const wantsMigrate   = !!body.email && !!body.legacy_amount_cents;
  // ANON mode (Jake, 2026-04-29): public self-signup with no pre-existing
  // auth. Customer enters their email on the plans page, we create their
  // auth user inline, and the magiclink success_url signs them in
  // post-payment. Triggered when body has email but no legacy_amount_cents
  // and no auth header. Removes the "click Subscribe → bounce to login →
  // click Subscribe again" friction in the public funnel.
  const wantsAnon      = !!body.email && !body.legacy_amount_cents && !userJwt;

  try {
    let userId: string;
    let email:  string;
    let line:   Stripe.Checkout.SessionCreateParams.LineItem;
    let isMigration = false;
    let isAnon      = false;

    if (wantsMigrate && isServiceRole) {
      // ----- MIGRATE mode (3): server-side script with service-role key -----
      isMigration = true;
    } else if (wantsAnon) {
      // ----- ANON mode: public self-signup, no auth required -----
      isAnon = true;
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

      // Inline price — uses the amount from migration_customers.amount_cents
      // posted by the caller. Per Decision B (2026-04-27) this is the
      // uniform A$140 (Custom) / A$80 (Progressive) rate; no per-customer
      // grandfathering. Inline price_data is kept (vs the canonical
      // lookup_key path used by SELF/ANON) so a future per-customer
      // exception (e.g. a goodwill discount) can be done without touching
      // the Stripe price catalog.
      line = {
        price_data: {
          currency: body.legacy_currency,
          product_data: { name: PRODUCT_NAMES[planKey ?? 'custom'] },
          unit_amount: body.legacy_amount_cents,
          recurring:   { interval: 'month' },
        },
        quantity: 1,
      };
    } else if (isAnon) {
      // ----- ANON mode: public self-signup, no auth required -----
      // Validate the email format. Permissive — Stripe will do the
      // rigorous validation when it tries to charge the card.
      const rawEmail = (body.email ?? '').toLowerCase().trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        return jsonResponse({ error: 'invalid_email', detail: 'A valid email address is required.' }, 400);
      }
      email  = rawEmail;
      userId = await getOrCreateAuthUser(email);

      // Use canonical Price by lookup_key — same as self mode.
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
    // Include plan_type so welcome.html can branch its "what happens
    // next" copy — Progressive members get instant access; Custom
    // members get the "Mick is preparing your block" wait language.
    //
    // MIGRATE-MODE AUTH HANDOFF (Jake, 2026-04-27):
    //
    // In self mode the user already has a Supabase session (they signed
    // in via magic link before clicking Subscribe), so post-Stripe
    // they're still signed in and the dashboard works.
    //
    // In migrate mode the auth user was created server-side
    // (getOrCreateAuthUser above) but no session was minted in the
    // browser. After Stripe redirects to welcome.html the user has
    // no session — clicking "Skip ahead to dashboard" bounces them
    // to login.
    //
    // Fix: generate a one-time magiclink for the target email and use
    // its action_link as the Stripe success_url. After payment Stripe
    // redirects to action_link → Supabase verify endpoint sets the
    // session cookie + redirects to redirectTo (welcome.html). The user
    // lands on welcome already signed in; dashboard works on first click.
    //
    // Failure handling: if generateLink fails (rare, but e.g. SMTP rate
    // limit) we fall back to the bare welcome URL — same UX as before
    // (user sees welcome, has to click magic link from their inbox to
    // continue). No regression.
    // Post-checkout flow (Jake, 2026-04-28): land on onboarding.html FIRST so
    // we capture preferred_name + discipline/ability before any celebration
    // copy. After onboarding submit, the user is redirected to welcome.html
    // ("you're in" + Getting Started CTA), then on to getting-started.html.
    // Order: Stripe success → onboarding → welcome → getting-started.
    let successUrl: string;
    if (body.success_url) {
      successUrl = body.success_url;
    } else if (isMigration || isAnon) {
      // Both paths created the auth user server-side without minting a
      // browser session — use a magiclink as success_url so they land
      // on onboarding.html already signed in. (For self mode the user
      // already has a session from their pre-checkout sign-in, so the
      // plain onboarding URL is fine.)
      const modeLabel = isAnon ? 'anon' : 'migrate';
      const baseOnboarding = `${APP_BASE_URL}/app/onboarding.html?type=${planType}`;
      try {
        const { data: linkData, error: linkErr } = await sbAdmin.auth.admin.generateLink({
          type: 'magiclink',
          email,
          options: { redirectTo: baseOnboarding },
        });
        if (linkErr) {
          console.warn(`${modeLabel}-mode magiclink generation failed for ${email}: ${linkErr.message}`);
          successUrl = baseOnboarding;
        } else if (linkData?.properties?.action_link) {
          successUrl = linkData.properties.action_link;
        } else {
          console.warn(`${modeLabel}-mode magiclink returned no action_link for ${email}`);
          successUrl = baseOnboarding;
        }
      } catch (e) {
        console.warn(`${modeLabel}-mode magiclink threw for ${email}:`, e);
        successUrl = baseOnboarding;
      }
    } else {
      successUrl = `${APP_BASE_URL}/app/onboarding.html?session_id={CHECKOUT_SESSION_ID}&type=${planType}`;
    }
    const cancelUrl  = body.cancel_url  ?? `${APP_BASE_URL}/getting-started.html?cancelled=1`;

    // Custom-plan-only: anchor billing to the next 4-week block boundary
    // and pro-rate the current partial cycle. See nextBlockStart() block
    // comment above for the rationale. Progressive plans don't get this
    // treatment — their content isn't calendar-anchored, so plain
    // signup-anchored cycles are fine.
    //
    // Edge case: if the customer signs up exactly on a block start,
    // nextBlockStart() returns today, and Stripe's billing_cycle_anchor
    // must be in the future — so in that case we set anchor to the
    // block AFTER (i.e. they pay full $140 today for the current block,
    // next charge is +28 days as you'd expect).
    const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
      metadata: { plan_type: planType, plan_key: planKey ?? '' },
    };
    if (planType === 'custom') {
      const now = new Date();
      let anchor = nextBlockStart(now);
      // Stripe rejects an anchor at-or-before the subscription start time.
      // If signup happens to fall on a block boundary, push anchor to the
      // next-but-one block (28 days later).
      if (anchor.getTime() - now.getTime() < 60 * 1000) {
        anchor = new Date(anchor.getTime() + BLOCK_LENGTH_MS);
      }
      subscriptionData.billing_cycle_anchor = Math.floor(anchor.getTime() / 1000);
      subscriptionData.proration_behavior   = 'create_prorations';
      console.log(
        `custom-plan billing anchor for ${email}: signup ${now.toISOString()} → ` +
        `anchor ${anchor.toISOString()} (pro-rated first invoice + $140 then every 28d).`
      );
    }

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
        source:    isMigration ? 'migrate' : (isAnon ? 'self_anon' : 'self'),
        ...(isMigration && body.email ? { migrated_from_email: body.email.toLowerCase() } : {}),
      },
      subscription_data:    subscriptionData,
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
      mode:       isMigration ? 'migrate' : (isAnon ? 'self_anon' : 'self'),
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
