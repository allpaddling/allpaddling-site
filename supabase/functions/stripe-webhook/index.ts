// ============================================================
// supabase/functions/stripe-webhook/index.ts
//
// Stripe → Supabase webhook handler. Receives subscription
// lifecycle events from Stripe, verifies the signature, mirrors
// the relevant state into the `subscriptions` table, creates the
// matching `progressive_members` or `custom_members` row on first
// signup, and fires transactional emails via _shared/email.ts.
//
// Required environment (set via `supabase secrets set`):
//
//   STRIPE_SECRET_KEY          sk_test_… or sk_live_…
//   STRIPE_WEBHOOK_SECRET      whsec_…  (one per endpoint, NOT the API key)
//   SUPABASE_URL               https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  service_role JWT (bypasses RLS)
//   RESEND_API_KEY             passed through to _shared/email.ts
//   APP_BASE_URL               e.g. "https://allpaddling.online" (defaults if unset).
//                              Eventual canonical domain is allpaddling.com once
//                              the migration window closes — until then, all
//                              member-facing URLs point at allpaddling.online so
//                              the .com Shopify store stays untouched.
//
// Local invocation:
//   supabase functions serve stripe-webhook --env-file ./supabase/.env.local
//   stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook
//
// Deploy:
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// `--no-verify-jwt` is critical: Stripe is not a Supabase user and
// does not send a JWT. Authentication of the caller is performed
// by Stripe's webhook signature instead.
//
// Checkout-session metadata contract — the frontend MUST set:
//   metadata.user_id    Supabase auth.users(id). Required.
//   metadata.plan_type  'progressive' | 'custom'. Required.
//   metadata.plan_key   'prone' | 'sup' | 'oc' | 'ski'. Required if plan_type='progressive'.
// Without these the handler cannot complete and will throw,
// forcing a Stripe retry and leaving the event_id in webhook_events
// with the error column populated.
// ============================================================

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { sendTransactional } from '../_shared/email.ts';

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------
const STRIPE_SECRET_KEY      = Deno.env.get('STRIPE_SECRET_KEY')         ?? '';
const STRIPE_WEBHOOK_SECRET  = Deno.env.get('STRIPE_WEBHOOK_SECRET')     ?? '';
const SUPABASE_URL           = Deno.env.get('SUPABASE_URL')              ?? '';
const SERVICE_ROLE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const APP_BASE_URL           = Deno.env.get('APP_BASE_URL')              ?? 'https://allpaddling.online';

if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('stripe-webhook: missing required environment variable(s)');
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const cryptoProvider = Stripe.createSubtleCryptoProvider();

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Discipline labels used to compose plan names in transactional emails.
const DISCIPLINE_LABELS: Record<string, string> = {
  prone: 'Prone Paddle Board',
  sup:   'Stand Up Paddle Board',
  oc:    'Outrigger Canoe',
  ski:   'Surf Ski',
};

// Static URLs derived once at boot.
const PLAN_URL        = `${APP_BASE_URL}/app/program.html`;
const SETTINGS_URL    = `${APP_BASE_URL}/app/settings.html`;
const UPDATE_CARD_URL = SETTINGS_URL;   // until we wire up Stripe Customer Portal redirects (§3.1)
const COACH_NAME      = 'Mick';

// ------------------------------------------------------------
// Entry point
// ------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  // IMPORTANT: read the body as raw text BEFORE parsing — signature
  // verification hashes the exact bytes Stripe sent.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      STRIPE_WEBHOOK_SECRET,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    console.error('stripe-webhook: signature verification failed', err);
    return new Response(`Webhook signature verification failed: ${err}`, { status: 400 });
  }

  // ------------------------------------------------------------
  // Idempotency claim
  //
  // Three cases:
  //  1. Brand-new event_id — INSERT succeeds; we own this attempt.
  //  2. event_id seen before AND processed_at is set — successful
  //     prior delivery, return 200 without re-running.
  //  3. event_id seen before AND processed_at is NULL — prior
  //     delivery errored out. Reset the error column and retry.
  //
  // (3) lets transient failures recover without manual intervention.
  // The handler body is then expected to be idempotent w.r.t. its
  // own writes (upserts, idempotent inserts).
  // ------------------------------------------------------------
  const { error: claimErr } = await sb.from('webhook_events').insert({
    source:     'stripe',
    event_id:   event.id,
    event_type: event.type,
    livemode:   event.livemode,
  });

  if (claimErr) {
    if ((claimErr as { code?: string }).code === '23505') {
      // Already exists — check if it was successfully processed.
      const { data: prev } = await sb
        .from('webhook_events')
        .select('processed_at')
        .eq('source', 'stripe')
        .eq('event_id', event.id)
        .maybeSingle();
      if (prev?.processed_at) {
        console.log(`stripe-webhook: event ${event.id} already processed, skipping`);
        return new Response('OK (duplicate)', { status: 200 });
      }
      // Prior delivery errored out. Reset the error column and retry.
      console.log(`stripe-webhook: event ${event.id} retrying after prior failure`);
      await sb.from('webhook_events')
        .update({ error: null })
        .eq('source', 'stripe')
        .eq('event_id', event.id);
    } else {
      console.error('stripe-webhook: idempotency-claim insert failed', claimErr);
      return new Response('Internal error claiming event', { status: 500 });
    }
  }

  // ------------------------------------------------------------
  // Route by event type.
  // ------------------------------------------------------------
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      default:
        console.log(`stripe-webhook: ignoring event type ${event.type}`);
    }

    await sb
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('source', 'stripe')
      .eq('event_id', event.id);

    return new Response('OK', { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`stripe-webhook: handler for ${event.type} failed`, err);
    await sb
      .from('webhook_events')
      .update({ error: msg })
      .eq('source', 'stripe')
      .eq('event_id', event.id);
    return new Response(`Handler error: ${msg}`, { status: 500 });
  }
});

// ============================================================
// Helpers
// ============================================================

interface MemberRef {
  table: 'progressive_members' | 'custom_members';
  id: string;
  email: string;
  name: string;
  planLabel: string;     // human-readable plan name for emails
}

interface ResolvedSubscription {
  user_id: string;
  member: MemberRef;
  email: string;
  preferred_name: string;
}

/**
 * Look up the subscriptions row + the linked member + email/name we
 * need to render emails. Throws if the row doesn't exist (Stripe's
 * retry will trigger us again once checkout.session.completed has
 * created the row).
 */
async function resolveSubscription (stripeSubscriptionId: string): Promise<ResolvedSubscription> {
  const { data: subRow, error: subErr } = await sb
    .from('subscriptions')
    .select(`
      user_id,
      progressive_member_id,
      custom_member_id,
      progressive_members ( id, email, name, plan_key ),
      custom_members      ( id, email, name )
    `)
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .maybeSingle();

  if (subErr) throw new Error(`subscriptions lookup failed: ${subErr.message}`);
  if (!subRow) throw new Error(`subscriptions row not found for stripe_subscription_id=${stripeSubscriptionId}`);

  let member: MemberRef;
  // The relation arrays returned by PostgREST may come back as either
  // a single object or an array depending on the FK shape; coerce.
  // deno-lint-ignore no-explicit-any
  const pm: any = Array.isArray(subRow.progressive_members) ? subRow.progressive_members[0] : subRow.progressive_members;
  // deno-lint-ignore no-explicit-any
  const cm: any = Array.isArray(subRow.custom_members)      ? subRow.custom_members[0]      : subRow.custom_members;

  if (subRow.progressive_member_id && pm) {
    const label = DISCIPLINE_LABELS[pm.plan_key as string] ?? pm.plan_key;
    member = {
      table: 'progressive_members',
      id:    pm.id,
      email: pm.email,
      name:  pm.name || pm.email.split('@')[0],
      planLabel: `Progressive ${label} Plan`,
    };
  } else if (subRow.custom_member_id && cm) {
    member = {
      table: 'custom_members',
      id:    cm.id,
      email: cm.email,
      name:  cm.name || cm.email.split('@')[0],
      planLabel: 'Custom Season Race Plan',
    };
  } else {
    throw new Error(`subscriptions row ${stripeSubscriptionId} has no linked member`);
  }

  return {
    user_id:        subRow.user_id,
    member,
    email:          member.email,
    preferred_name: member.name.split(' ')[0] || member.email.split('@')[0],
  };
}

function formatDate (ts: number | string | null | undefined): string {
  if (!ts) return '';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatAmount (cents: number, currency: string): string {
  const sign = currency.toLowerCase() === 'aud' ? '$' : '';
  return `${sign}${(cents / 100).toFixed(2)}`;
}

// ============================================================
// Event handlers
// ============================================================

async function handleCheckoutSessionCompleted (session: Stripe.Checkout.Session): Promise<void> {
  // First-time signup. Session metadata MUST carry user_id, plan_type,
  // and (for progressive) plan_key — set when the Checkout Session was
  // created on the frontend. See "Checkout-session metadata contract"
  // at the top of this file.

  const userId   = session.metadata?.user_id   as string | undefined;
  const planType = session.metadata?.plan_type as string | undefined;
  const planKey  = session.metadata?.plan_key  as string | undefined;
  const email    = session.customer_details?.email?.toLowerCase();
  const fullName = session.customer_details?.name ?? '';
  const customerId     = session.customer     as string | null;
  const subscriptionId = session.subscription as string | null;

  if (!userId)         throw new Error('checkout.session.completed: metadata.user_id is required');
  if (!planType)       throw new Error('checkout.session.completed: metadata.plan_type is required');
  if (!email)          throw new Error('checkout.session.completed: customer_details.email missing');
  if (!customerId)     throw new Error('checkout.session.completed: session.customer missing');
  if (!subscriptionId) throw new Error('checkout.session.completed: session.subscription missing');
  if (planType === 'progressive' && !planKey) {
    throw new Error('checkout.session.completed: plan_key required when plan_type=progressive');
  }
  if (planType !== 'progressive' && planType !== 'custom') {
    throw new Error(`checkout.session.completed: unknown plan_type "${planType}"`);
  }

  // Idempotently create the member row keyed on email. If the user
  // was previously a free trial / manual member, the existing row is
  // reused (and its auth_user_id linked).
  let memberId: string;
  let planLabel: string;

  if (planType === 'progressive') {
    const { data, error } = await sb
      .from('progressive_members')
      .upsert(
        {
          email,
          name:         fullName || email.split('@')[0],
          plan_key:     planKey,
          auth_user_id: userId,
        },
        { onConflict: 'email' },
      )
      .select('id, plan_key')
      .single();
    if (error) throw new Error(`progressive_members upsert: ${error.message}`);
    memberId  = data.id;
    planLabel = `Progressive ${DISCIPLINE_LABELS[data.plan_key as string] ?? data.plan_key} Plan`;
  } else {
    // Custom members upsert: must populate auth_user_id (was missing
    // pre-fix, causing admin lookup pages to fail to join member_profiles
    // and subscriptions data downstream — manifest as "this member could
    // not be found" alerts in admin-edit/admin-custom).
    const { data, error } = await sb
      .from('custom_members')
      .upsert(
        {
          email,
          name:         fullName || email.split('@')[0],
          auth_user_id: userId,
        },
        { onConflict: 'email' },
      )
      .select('id')
      .single();
    if (error) throw new Error(`custom_members upsert: ${error.message}`);
    memberId  = data.id;
    planLabel = 'Custom Season Race Plan';

    // NB: We intentionally DO NOT seed a custom_plans row here.
    //
    // History: an earlier version of this handler seeded custom_plans
    // with the published Primer block as a starter (commit aa4a7b93).
    // Jake reverted that decision (2026-04-29) — Custom signups can
    // now feel confused by the primer content because their plan is
    // intended to be bespoke, not a primer-derived template. New
    // workflow: Custom signups land with no plan content. Mick opens
    // admin-edit and either builds from scratch or uses the new
    // "Copy plan from another customer" feature to bring an existing
    // similar plan over as the starting point.
    //
    // Member-side: dashboard.html shows the empty-state UI (per task
    // 3.4) when programs is empty, which says "your plan is being
    // prepared" — exactly the right message during the 1–2 day
    // window between signup and Mick customising the plan.
  }

  // Make sure a member_profiles row exists so the dashboard's onboarding
  // redirect logic is deterministic. If absent, dashboard.html should
  // already redirect to onboarding.html — but a real test today saw
  // the redirect skipped and no popup. Belt-and-braces: explicitly
  // insert with completed_onboarding_at = null. The user fills it in
  // via onboarding.html (Hi Sarah, race date, etc.) which then sets
  // completed_onboarding_at = now() and redirects to dashboard.
  //
  // ON CONFLICT DO NOTHING: a row may already exist if the user
  // previously signed in (e.g. for a free trial / migration link)
  // and started but didn't finish onboarding. We don't want to RESET
  // their progress on a subsequent checkout — leave existing values.
  const { error: profileErr } = await sb
    .from('member_profiles')
    .upsert(
      {
        user_id:                  userId,
        completed_onboarding_at:  null,
      },
      { onConflict: 'user_id', ignoreDuplicates: true },
    );
  if (profileErr) {
    console.warn(`member_profiles upsert failed for ${email}:`, profileErr.message);
    // Don't fail the webhook — the dashboard will still work; the
    // user just won't be force-redirected to onboarding.
  }

  // Insert / update the subscriptions row. Status starts as
  // 'incomplete'; it flips to 'active' on the first invoice.paid.
  const subPayload = {
    user_id:                userId,
    progressive_member_id:  planType === 'progressive' ? memberId : null,
    custom_member_id:       planType === 'custom'      ? memberId : null,
    stripe_customer_id:     customerId,
    stripe_subscription_id: subscriptionId,
    status:                 'incomplete' as const,
  };
  const { error: subErr } = await sb
    .from('subscriptions')
    .upsert(subPayload, { onConflict: 'stripe_subscription_id' });
  if (subErr) throw new Error(`subscriptions upsert: ${subErr.message}`);

  console.log(`checkout.session.completed: ${planType} member + subscription staged for ${email}`);

  // NB: welcome email used to fire here. Moved (Jake, 2026-04-29) to
  // the post-onboarding trigger function so the email can address the
  // member by their `member_profiles.preferred_name` (set in the
  // onboarding form) rather than `customer_details.name` (the Stripe
  // billing/cardholder name). The trigger is `trigger-welcome-email`,
  // called from the onboarding form submit handler. Idempotency is
  // tracked via `member_profiles.welcome_email_sent_at`.
  //
  // Edge case: if a paying customer never completes onboarding they
  // won't receive a welcome email. Acceptable trade-off for now —
  // most signups complete within minutes. A scheduled fallback job
  // (e.g. send welcome with billing-name 24h post-signup if not yet
  // sent) is parked as future work.
}

async function handleInvoicePaid (invoice: Stripe.Invoice): Promise<void> {
  // Stripe API 2025-03-31 moved invoice.subscription to invoice.parent.subscription_details.subscription.
  // Older API versions still send it at the top level. Read from both with fallback.
  // This was the bug behind +pausetest's stuck-incomplete state on 2026-05-01: invoice.subscription
  // was null in the new payload, handler returned silently with error=null, status never flipped to active.
  // deno-lint-ignore no-explicit-any
  const inv = invoice as any;
  const subscriptionId =
    (invoice.subscription as string | null) ??
    (inv.parent?.subscription_details?.subscription as string | undefined) ??
    (inv.lines?.data?.[0]?.subscription as string | undefined) ??
    null;
  if (!subscriptionId) {
    // Some invoices are not subscription-linked (e.g. one-off charges).
    // We don't currently issue any of those, so log and skip.
    console.log(`invoice.paid: no subscription on invoice ${invoice.id}, skipping`);
    return;
  }

  // Read current state to know whether this is the FIRST paid invoice
  // (we only want to set first_paid_at + cancel_unlocks_at once).
  const { data: existing, error: lookupErr } = await sb
    .from('subscriptions')
    .select('first_paid_at')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  if (lookupErr) throw new Error(`invoice.paid lookup: ${lookupErr.message}`);
  if (!existing) throw new Error(`invoice.paid: no subscriptions row for ${subscriptionId}`);

  // Period window — prefer the line item's period over invoice.period_*
  // because subscription invoices populate it accurately.
  const lineItem    = invoice.lines?.data?.[0];
  const periodStart = lineItem?.period?.start;
  const periodEnd   = lineItem?.period?.end;

  // Stripe price id for cross-reference / display.
  const priceId = lineItem?.price?.id ?? null;

  const updates: Record<string, unknown> = {
    status:                'active',
    stripe_price_id:       priceId,
    current_period_start:  periodStart ? new Date(periodStart * 1000).toISOString() : null,
    current_period_end:    periodEnd   ? new Date(periodEnd   * 1000).toISOString() : null,
  };

  // First-time payment? Set the lock window.
  if (!existing.first_paid_at) {
    const paidAtTs = invoice.status_transitions?.paid_at ?? Math.floor(Date.now() / 1000);
    const paidAt   = new Date(paidAtTs * 1000);
    const unlocks  = new Date(paidAt.getTime() + 12 * 7 * 24 * 60 * 60 * 1000); // +12 weeks
    updates.first_paid_at     = paidAt.toISOString();
    updates.cancel_unlocks_at = unlocks.toISOString();
  }

  const { error: updErr } = await sb
    .from('subscriptions')
    .update(updates)
    .eq('stripe_subscription_id', subscriptionId);
  if (updErr) throw new Error(`invoice.paid update: ${updErr.message}`);

  console.log(`invoice.paid: ${subscriptionId} → active, period ${updates.current_period_start} → ${updates.current_period_end}`);

  // Fire the payment-receipt email.
  try {
    const ctx = await resolveSubscription(subscriptionId);
    const amount   = formatAmount(invoice.amount_paid, invoice.currency);
    const currency = invoice.currency.toUpperCase();
    await sendTransactional('payment-receipt', ctx.email, {
      member_name:       ctx.preferred_name,
      plan_name:         ctx.member.planLabel,
      amount,
      currency,
      period_start:      formatDate(periodStart),
      period_end:        formatDate(periodEnd),
      next_billing_date: formatDate(periodEnd),
      invoice_pdf_url:   invoice.hosted_invoice_url ?? invoice.invoice_pdf ?? `${APP_BASE_URL}/app/settings.html`,
      settings_url:      SETTINGS_URL,
      coach_name:        COACH_NAME,
    });
  } catch (emailErr) {
    console.warn(`payment-receipt email send failed for invoice ${invoice.id}:`, emailErr);
  }
}

async function handleInvoicePaymentFailed (invoice: Stripe.Invoice): Promise<void> {
  const subscriptionId = invoice.subscription as string | null;
  if (!subscriptionId) {
    console.log(`invoice.payment_failed: no subscription on invoice ${invoice.id}, skipping`);
    return;
  }

  const { error: updErr } = await sb
    .from('subscriptions')
    .update({ status: 'past_due' })
    .eq('stripe_subscription_id', subscriptionId);
  if (updErr) throw new Error(`invoice.payment_failed update: ${updErr.message}`);

  console.log(`invoice.payment_failed: ${subscriptionId} → past_due (attempt ${invoice.attempt_count})`);

  // Fire the dunning email.
  try {
    const ctx = await resolveSubscription(subscriptionId);
    const amount   = formatAmount(invoice.amount_due, invoice.currency);
    const currency = invoice.currency.toUpperCase();
    const retryTs  = invoice.next_payment_attempt;
    await sendTransactional('payment-failed', ctx.email, {
      member_name:     ctx.preferred_name,
      amount,
      currency,
      retry_date:      retryTs ? formatDate(retryTs) : 'shortly',
      update_card_url: UPDATE_CARD_URL,
      coach_name:      COACH_NAME,
    });
  } catch (emailErr) {
    console.warn(`payment-failed email send failed for invoice ${invoice.id}:`, emailErr);
  }
}

async function handleSubscriptionUpdated (sub: Stripe.Subscription): Promise<void> {
  // Look up existing row to (a) force a Stripe retry if the row doesn't
  // exist yet (race against checkout.session.completed) and (b) avoid
  // downgrading status from a known-good state to a stale one.
  //
  // The bug we're guarding against — observed live with Paora Monk
  // 2026-04-28 (events arrived simultaneously, processed out of order):
  //
  //   1. customer.subscription.updated  arrives, processes first → silent
  //      no-op because no row exists yet.
  //   2. invoice.paid                   arrives, processes → silent no-op
  //      for the same reason. Then throws on the existing-row guard at
  //      handleInvoicePaid line ~468, returns 500, Stripe will retry.
  //   3. checkout.session.completed     arrives, processes → row inserted
  //      at status='incomplete'.
  //   4. invoice.paid retry             succeeds → status='active' set.
  //   5. customer.subscription.updated retry runs with the ORIGINAL
  //      payload (Stripe replays bytes, doesn't refresh) — if that
  //      payload's sub.status is 'incomplete', it overwrites 'active'
  //      back to 'incomplete'. Wrong end state.
  //
  // Fix: throw if no row (so step 1 above retries instead of no-op'ing),
  // and don't permit a downgrade from active/trialing/past_due to
  // incomplete/incomplete_expired during a replay.
  const { data: existing, error: lookupErr } = await sb
    .from('subscriptions')
    .select('status')
    .eq('stripe_subscription_id', sub.id)
    .maybeSingle();
  if (lookupErr) throw new Error(`customer.subscription.updated lookup: ${lookupErr.message}`);
  if (!existing) throw new Error(`customer.subscription.updated: no subscriptions row for ${sub.id} — likely race with checkout.session.completed; Stripe will retry.`);

  const isDowngrade =
    ['active', 'trialing', 'past_due'].includes(existing.status) &&
    ['incomplete', 'incomplete_expired'].includes(sub.status);

  // Stripe API 2025-03-31 moved subscription.current_period_start/end to
  // subscription.items.data[0].current_period_start/end. Read from both
  // with fallback so we capture the period regardless of API version.
  // deno-lint-ignore no-explicit-any
  const itemPeriodStart = (sub as any).items?.data?.[0]?.current_period_start as number | undefined;
  // deno-lint-ignore no-explicit-any
  const itemPeriodEnd   = (sub as any).items?.data?.[0]?.current_period_end   as number | undefined;
  const periodStartTs = sub.current_period_start ?? itemPeriodStart ?? null;
  const periodEndTs   = sub.current_period_end   ?? itemPeriodEnd   ?? null;

  const updates: Record<string, unknown> = {
    current_period_start: periodStartTs ? new Date(periodStartTs * 1000).toISOString() : null,
    current_period_end:   periodEndTs   ? new Date(periodEndTs   * 1000).toISOString() : null,
    cancel_at:            sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
    stripe_price_id:      sub.items?.data?.[0]?.price?.id ?? null,
    // Pause/cancel mirror — added 2026-05-01 with the member-driven
    // pause+cancel feature. Stripe's pause_collection mechanism fires
    // customer.subscription.updated rather than dedicated paused/resumed
    // events, so this handler is the right place to mirror both.
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    pause_resumes_at:     sub.pause_collection?.resumes_at
                            ? new Date(sub.pause_collection.resumes_at * 1000).toISOString()
                            : null,
  };
  if (!isDowngrade) {
    updates.status = sub.status;
  }

  const { error: updErr } = await sb
    .from('subscriptions')
    .update(updates)
    .eq('stripe_subscription_id', sub.id);
  if (updErr) throw new Error(`customer.subscription.updated: ${updErr.message}`);

  console.log(
    `customer.subscription.updated: ${sub.id} → ` +
    (isDowngrade
      ? `status kept as ${existing.status} (refused downgrade to ${sub.status})`
      : sub.status) +
    (sub.cancel_at_period_end ? ' [cancel_at_period_end=true]' : '') +
    (sub.pause_collection?.resumes_at ? ` [pause_resumes_at=${new Date(sub.pause_collection.resumes_at * 1000).toISOString()}]` : '')
  );
}

async function handleSubscriptionDeleted (sub: Stripe.Subscription): Promise<void> {
  // Subscription has actually ended (after cancel_at, or canceled
  // immediately). The member's content access continues until
  // current_period_end — a separate scheduled job (§2.5) will run
  // through canceled subs whose period has elapsed and revoke their
  // entitlement at that point.
  const { error: updErr } = await sb
    .from('subscriptions')
    .update({
      status:      'canceled',
      canceled_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', sub.id);
  if (updErr) throw new Error(`customer.subscription.deleted: ${updErr.message}`);

  console.log(`customer.subscription.deleted: ${sub.id} → canceled`);

  // Send the goodbye email. Wrapped in try/catch so a Resend hiccup
  // doesn't fail the webhook and trigger a Stripe retry.
  try {
    const ctx = await resolveSubscription(sub.id);
    await sendTransactional('subscription-canceled', ctx.email, {
      member_name: ctx.preferred_name,
      plan_name:   ctx.member.planLabel,
      rejoin_url:  `${APP_BASE_URL}/plans.html`,
      coach_name:  COACH_NAME,
    });
  } catch (emailErr) {
    console.warn(`subscription-canceled email send failed for ${sub.id}:`, emailErr);
  }
}
