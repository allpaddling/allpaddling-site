// ============================================================
// supabase/functions/create-portal-session/index.ts
//
// Creates a Stripe Billing Portal session for the calling member,
// letting them update their payment method, download invoices, or
// manage billing details — without needing to contact Mick.
//
// Called from settings.html when the member clicks "Update payment
// method". Returns { url } which the frontend redirects to.
//
// Auth: member JWT (verify_jwt: true). The function looks up the
// caller's stripe_customer_id from the subscriptions table using
// their auth user_id.
//
// No _shared imports — self-contained for MCP deploy.
//
// Deploy:
//   supabase functions deploy create-portal-session \
//     --project-ref crlukzkgmydyqpwndjvc
//   (verify_jwt:true is correct)
// ============================================================

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')         ?? '';
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')              ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')         ?? '';
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const APP_BASE_URL      = Deno.env.get('APP_BASE_URL')              ?? 'https://allpaddling.online';

const RETURN_URL = `${APP_BASE_URL}/app/settings.html`;

if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('create-portal-session: missing required env vars');
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  // Verify the caller is a signed-in member.
  const authHeader = req.headers.get('authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return jsonResponse({ error: 'unauthorized' }, 401);

  const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userData?.user?.id) {
    return jsonResponse({ error: 'unauthorized', detail: 'Invalid or expired JWT' }, 401);
  }
  const userId = userData.user.id;

  // Look up the Stripe customer ID from the subscriptions table.
  const { data: subRow, error: subErr } = await sbAdmin
    .from('subscriptions')
    .select('stripe_customer_id, status')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subErr) {
    console.error('create-portal-session: subscription lookup failed', subErr);
    return jsonResponse({ error: 'lookup_failed' }, 500);
  }
  if (!subRow?.stripe_customer_id) {
    return jsonResponse({
      error:  'no_subscription',
      detail: 'No Stripe subscription found for this account.',
    }, 404);
  }

  // Create the Stripe Billing Portal session.
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer:   subRow.stripe_customer_id,
      return_url: RETURN_URL,
    });
    console.log(`create-portal-session: portal session created for user ${userId}`);
    return jsonResponse({ ok: true, url: session.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('create-portal-session: Stripe portal session creation failed', err);
    return jsonResponse({ error: 'portal_failed', detail: msg }, 500);
  }
});
