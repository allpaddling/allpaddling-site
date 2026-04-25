// ============================================================
// supabase/functions/stripe-webhook/index.ts
//
// Stripe → Supabase webhook handler. Receives subscription
// lifecycle events from Stripe, verifies the signature, mirrors
// the relevant state into the `subscriptions` table, and (on
// first paid invoice) creates the matching `progressive_members`
// or `custom_members` row.
//
// Status: SCAFFOLD. The skeleton, idempotency, signature
// verification, and event router are wired. The per-event
// handlers contain TODO blocks marking the SQL writes that
// land once the Stripe account exists and we can stand up
// real test events end-to-end (ROADMAP §1.7).
//
// Required environment (set via `supabase secrets set`):
//
//   STRIPE_SECRET_KEY        sk_test_… or sk_live_…
//   STRIPE_WEBHOOK_SECRET    whsec_…  (one per endpoint, NOT the API key)
//   SUPABASE_URL             https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  service_role JWT (bypasses RLS)
//
// Local invocation:
//   supabase functions serve stripe-webhook --env-file ./supabase/.env.local
//   stripe listen --forward-to localhost:54321/functions/v1/stripe-webhook
//
// Deploy:
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// The `--no-verify-jwt` flag is critical: Stripe is not a
// Supabase user and does not send a JWT. Authentication of the
// caller is performed by Stripe's webhook signature instead.
// ============================================================

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------
const STRIPE_SECRET_KEY      = Deno.env.get('STRIPE_SECRET_KEY')      ?? '';
const STRIPE_WEBHOOK_SECRET  = Deno.env.get('STRIPE_WEBHOOK_SECRET')  ?? '';
const SUPABASE_URL           = Deno.env.get('SUPABASE_URL')           ?? '';
const SERVICE_ROLE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('stripe-webhook: missing required environment variable(s)');
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  // Deno's runtime needs an explicit crypto provider for async sig verification.
  httpClient: Stripe.createFetchHttpClient(),
});

// SubtleCryptoProvider is Deno-friendly (sync HMAC libs aren't available).
const cryptoProvider = Stripe.createSubtleCryptoProvider();

// Service-role client. Bypasses RLS — only ever used inside this
// function. Never expose this key to the browser.
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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
  // verification hashes the exact bytes Stripe sent. JSON.parse-and-
  // re-stringify will produce a different byte sequence and the
  // signature will fail.
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
  // Idempotency: try to claim this event_id. If it's already in
  // webhook_events, Stripe is retrying — return 200 without
  // reprocessing.
  // ------------------------------------------------------------
  const { error: claimErr } = await sb.from('webhook_events').insert({
    source:     'stripe',
    event_id:   event.id,
    event_type: event.type,
    livemode:   event.livemode,
  });

  if (claimErr) {
    // Postgres unique_violation = 23505. Supabase surfaces it as code "23505".
    if ((claimErr as { code?: string }).code === '23505') {
      console.log(`stripe-webhook: event ${event.id} already processed, skipping`);
      return new Response('OK (duplicate)', { status: 200 });
    }
    console.error('stripe-webhook: idempotency-claim insert failed', claimErr);
    return new Response('Internal error claiming event', { status: 500 });
  }

  // ------------------------------------------------------------
  // Route by event type. Each handler returns void on success or
  // throws on failure; we catch and record the error against the
  // webhook_events row, then return 500 so Stripe retries.
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
        // Unhandled event types are still recorded (and idempotency-claimed
        // above) so we have a record of every event Stripe sends. Returning
        // 200 tells Stripe not to retry.
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
// Event handlers — SCAFFOLDS
//
// Each handler is wired up to receive the right Stripe object
// shape. The actual SQL writes are TODOs and will be filled in
// once Mick has the Stripe account stood up and we can run
// real test events end-to-end (ROADMAP §1.7).
// ============================================================

async function handleCheckoutSessionCompleted (session: Stripe.Checkout.Session): Promise<void> {
  // First-time signup. Session metadata carries plan_type and
  // (for progressive) plan_key, set when the Checkout Session was
  // created on the client.
  //
  // TODO §1.4:
  //   1. Read session.metadata.plan_type ('progressive' | 'custom')
  //      and session.metadata.plan_key (for progressive only).
  //   2. Read session.customer (Stripe customer id) and
  //      session.subscription (Stripe subscription id).
  //   3. Read session.customer_details.email (the paying email).
  //   4. Look up the auth.users row by email. If absent, the user
  //      hasn't completed magic-link signup yet — store the
  //      Checkout Session and reconcile on first login (TBD design).
  //   5. Insert the matching progressive_members or custom_members
  //      row if it doesn't already exist (idempotent on email).
  //   6. Insert the subscriptions row (progressive_member_id XOR
  //      custom_member_id, status='incomplete' until invoice.paid
  //      fires).
  //
  // For now: log and noop.
  console.log('checkout.session.completed', {
    id: session.id,
    customer: session.customer,
    subscription: session.subscription,
    email: session.customer_details?.email,
    metadata: session.metadata,
  });
}

async function handleInvoicePaid (invoice: Stripe.Invoice): Promise<void> {
  // Payment succeeded. On the FIRST paid invoice for a
  // subscription, we set first_paid_at + cancel_unlocks_at
  // (= first_paid_at + 12 weeks) — the 12-week minimum lock.
  // On every paid invoice we update the period window.
  //
  // TODO §1.4:
  //   1. SELECT subscriptions WHERE stripe_subscription_id = invoice.subscription.
  //   2. If first_paid_at IS NULL: set it to invoice.status_transitions.paid_at,
  //      set cancel_unlocks_at = first_paid_at + interval '12 weeks',
  //      set status = 'active'.
  //   3. Always update current_period_start / current_period_end
  //      from invoice.lines (or from a fresh stripe.subscriptions.retrieve).
  //
  console.log('invoice.paid', {
    id: invoice.id,
    subscription: invoice.subscription,
    amount_paid: invoice.amount_paid,
  });
}

async function handleInvoicePaymentFailed (invoice: Stripe.Invoice): Promise<void> {
  // Payment failed. Stripe will retry per the smart-retry config;
  // we just mark the sub as past_due so the dashboard can show a
  // "payment failed, update card" banner and the dunning email
  // can fire (ROADMAP §2.2).
  //
  // TODO §1.4:
  //   1. UPDATE subscriptions SET status='past_due'
  //      WHERE stripe_subscription_id = invoice.subscription.
  //   2. Trigger the payment-failed transactional email (§2.3).
  //
  console.log('invoice.payment_failed', {
    id: invoice.id,
    subscription: invoice.subscription,
    attempt_count: invoice.attempt_count,
  });
}

async function handleSubscriptionUpdated (sub: Stripe.Subscription): Promise<void> {
  // Catch-all sync: status, period window, scheduled cancellation.
  //
  // TODO §1.4:
  //   1. UPDATE subscriptions SET
  //        status                = sub.status,
  //        current_period_start  = to_timestamp(sub.current_period_start),
  //        current_period_end    = to_timestamp(sub.current_period_end),
  //        cancel_at             = sub.cancel_at ? to_timestamp(...) : NULL,
  //        stripe_price_id       = sub.items.data[0].price.id
  //      WHERE stripe_subscription_id = sub.id.
  //
  console.log('customer.subscription.updated', {
    id: sub.id,
    status: sub.status,
    cancel_at: sub.cancel_at,
  });
}

async function handleSubscriptionDeleted (sub: Stripe.Subscription): Promise<void> {
  // Subscription has actually ended (after cancel_at, or canceled
  // immediately). Members keep access until current_period_end.
  //
  // TODO §1.4:
  //   1. UPDATE subscriptions SET
  //        status      = 'canceled',
  //        canceled_at = now()
  //      WHERE stripe_subscription_id = sub.id.
  //   2. Do NOT delete the member row immediately — keep it for
  //      history; deactivate after current_period_end via a
  //      scheduled job.
  //
  console.log('customer.subscription.deleted', {
    id: sub.id,
    canceled_at: sub.canceled_at,
  });
}
