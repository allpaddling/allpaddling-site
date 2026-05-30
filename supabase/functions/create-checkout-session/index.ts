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
// Phase 1 (4-weekly Custom billing) reverted 2026-04-29: see commit
// log. We attempted to switch Custom from `custom_race_monthly_aud`
// to `custom_race_4weekly_aud` so Stripe billing would align with
// Mick's calendar-anchored content blocks (Block N = May 4 + N×28d),
// but the live setup script kept failing on Stripe permissions and
// we couldn't safely create the new price under the urgent migration
// deadline. Back on monthly billing — Mick handles the calendar
// alignment manually for now (which he's been doing for years).
// Phase 1 to be retried post-migration.
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
    // For calendar-1st alignment (SELF/ANON only): we need the canonical
    // Stripe Price object (currency, product, unit_amount) so we can build
    // a matching one-time `add_invoice_items` charge for the upfront fee.
    let priceForAlignment: Stripe.Price | null = null;

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
      priceForAlignment = price;
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
      priceForAlignment = price;
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

    // Phase 1 (block-anchored billing) reverted 2026-04-29 — Custom plan
    // now bills monthly from signup date like Progressive. Mick handles
    // calendar alignment with content blocks manually for now.
    const subscriptionData: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
      metadata: { plan_type: planType, plan_key: planKey ?? '' },
    };
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [line];

    // === Calendar-1st billing alignment (2026-05-22, Jake) ===
    //
    // Mick's content blocks drop on the 1st of every month and every
    // paying customer should renew on the 1st. The signup day-of-month
    // (in Sydney time, since Mick is Aussie-based) determines branching:
    //
    //   Day 1–20  → "Pay-Now": one-time A$140 line item at checkout +
    //               trial_end on next 1st for the recurring sub.
    //               Customer pays A$140 immediately for "this month";
    //               recurring sub trials until the 1st, then A$140 fires
    //               on the 1st (and every 1st after).
    //
    //   Day 21+   → "Free-until-1st": trial_end-only on next 1st. $0 at
    //               checkout. Recurring sub trials until the 1st, then
    //               A$140 fires. Avoids the "I paid full price for 3
    //               days of access" perception for late-month signups.
    //
    // Both branches use trial_end (not billing_cycle_anchor) because
    // Stripe Checkout rejects proration_behavior='none' when a one-time
    // line item is present, and we need 'none' to suppress the partial-
    // cycle proration charge. trial_end achieves the same alignment
    // (sub's anchor moves to trial_end on first invoice fire) without
    // the proration conflict.
    //
    // MIGRATE mode keeps its existing behaviour (immediate charge,
    // anniversary billing). Migration is historical and the per-customer
    // audit trail is simpler unchanged.
    if (!isMigration && priceForAlignment) {
      // _test_day in the body forces a specific day-of-month for testing
      // (so the PAY-NOW branch can be exercised today even when Sydney
      // is on day 21+). Real signups never send this field. Safe to keep
      // as a debug hook.
      // deno-lint-ignore no-explicit-any
      const forcedDay  = (body as any)._test_day as number | undefined;
      const sydneyDay  = (typeof forcedDay === 'number' && forcedDay >= 1 && forcedDay <= 31)
                           ? forcedDay
                           : sydneyDayOfMonth();
      // Stripe requires trial_end to be at least 2 days in the future.
      // If the next 1st is too close (e.g. signing up on May 30), advance
      // trial_end to the following month's 1st (e.g. July 1) so Stripe
      // accepts it. The member still gets the same "free until billing
      // starts on the 1st" experience — just a slightly longer free window.
      const TWO_DAYS_S = 2 * 24 * 60 * 60;
      const nowUnix    = Math.floor(Date.now() / 1000);
      let   nextFirst  = nextFirstOfMonthUtcUnix();
      if (nextFirst - nowUnix < TWO_DAYS_S) {
        nextFirst = nextMonthFirstUtcUnix(nextFirst);
      }
      subscriptionData.trial_end = nextFirst;
      if (sydneyDay <= 20) {
        // PAY-NOW: add a one-time A$140 line item alongside the
        // recurring sub. The recurring sub itself charges nothing at
        // checkout (it's trialing); the one-time line item is the
        // upfront month-of-content fee.
        lineItems.push({
          price_data: {
            currency:    priceForAlignment.currency,
            product:     priceForAlignment.product as string,
            unit_amount: priceForAlignment.unit_amount ?? 14000,
          },
          quantity: 1,
        });
      }
    }

    // Create the Checkout Session.
    const session = await stripe.checkout.sessions.create({
      mode:                 'subscription',
      customer_email:       email,
      line_items:           lineItems,
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

/**
 * Day-of-month (1-31) in Sydney timezone. Used to branch new signups
 * between Pay-Now (day 1-20) and Free-until-1st (day 21+).
 *
 * Sydney rather than UTC so an Aussie customer signing up at, say,
 * 9 a.m. local time on the 21st gets the free-trial path even though
 * UTC still reads the 20th. (Mick is Sydney-based; the AEDT/AEST swap
 * is handled automatically by the Intl API.)
 */
function sydneyDayOfMonth (): number {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    day:      'numeric',
  });
  return parseInt(fmt.format(new Date()), 10);
}

/**
 * Unix timestamp for "1st of next month, 00:00 UTC". This is the anchor
 * target for every aligned subscription. Chosen to match the existing
 * 15 customers aligned on 2026-05-22 (anchor = 2026-06-01 00:00 UTC =
 * 10:00 AEST on the 1st — clearly "the 1st" in both UTC and Sydney).
 */
function nextFirstOfMonthUtcUnix (): number {
  // Compute "current month" in Sydney so day-21 cutoff doesn't fire
  // a month early for Aussie customers in the few-hours window where
  // UTC and Sydney disagree on the month.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year:     'numeric',
    month:    '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const year  = parseInt(parts.find(p => p.type === 'year' )!.value, 10);
  const month = parseInt(parts.find(p => p.type === 'month')!.value, 10);
  let nextYear  = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) { nextMonth = 1; nextYear++; }
  return Math.floor(Date.UTC(nextYear, nextMonth - 1, 1, 0, 0, 0) / 1000);
}

/**
 * Given a Unix timestamp that is already a 1st-of-month 00:00 UTC,
 * returns the Unix timestamp for the 1st of the *following* month.
 * Used when trial_end would otherwise be within 2 days and Stripe
 * would reject it.
 */
function nextMonthFirstUtcUnix (firstOfMonthUnix: number): number {
  const d = new Date(firstOfMonthUnix * 1000);
  let nextMonth = d.getUTCMonth() + 1; // 0-indexed, so +1 advances one month
  let nextYear  = d.getUTCFullYear();
  if (nextMonth > 11) { nextMonth = 0; nextYear++; }
  return Math.floor(Date.UTC(nextYear, nextMonth, 1, 0, 0, 0) / 1000);
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
