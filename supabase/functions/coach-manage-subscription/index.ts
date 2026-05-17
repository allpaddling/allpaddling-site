// ============================================================
// supabase/functions/coach-manage-subscription/index.ts
//
// Coach-side subscription management. Lets Mick (or any coach)
// pause, resume, or cancel a paying member's Stripe subscription
// on their behalf directly from the admin edit pages — without
// needing to touch the Stripe dashboard.
//
// Actions (POST body: { action, target_user_id, resumes_at? }):
//   status      — fetch live Stripe state for the member's sub
//   pause       — pause_collection at end of current period
//                 { resumes_at?: ISO8601 } for auto-resume
//   resume      — remove pause_collection
//   cancel      — cancel_at_period_end = true
//   undo_cancel — cancel_at_period_end = false
//
// Auth: coach JWT (verified against the coaches table).
// Emails: sent via the existing send-email Edge Function using
// service-role auth — BCC audit trail is maintained automatically.
//
// No _shared imports — self-contained so it can be deployed via
// the Supabase MCP without inlining dependency files.
//
// Deploy:
//   supabase functions deploy coach-manage-subscription \
//     --project-ref crlukzkgmydyqpwndjvc
//   (verify_jwt:true is correct — coach JWT validated inside)
// ============================================================

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')         ?? '';
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')              ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')         ?? '';
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const APP_BASE_URL      = Deno.env.get('APP_BASE_URL')              ?? 'https://allpaddling.online';

const SEND_EMAIL_URL = `${SUPABASE_URL}/functions/v1/send-email`;
const SETTINGS_URL   = `${APP_BASE_URL}/app/settings.html`;
const PLAN_URL       = `${APP_BASE_URL}/app/program.html`;

const DISCIPLINE_LABELS: Record<string, string> = {
  prone: 'Prone Paddle Board',
  sup:   'Stand Up Paddle Board',
  oc:    'Outrigger Canoe',
  ski:   'Surf Ski',
};

if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('coach-manage-subscription: missing required env vars');
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---- helpers ------------------------------------------------

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

function formatDate(ts: number | null | undefined): string {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

function parseIsoToUnix(iso: string): number | null {
  const ts = Date.parse(iso);
  return isNaN(ts) ? null : Math.floor(ts / 1000);
}

function getPeriodEnd(sub: Stripe.Subscription): number | null {
  // deno-lint-ignore no-explicit-any
  const item = (sub as any).items?.data?.[0];
  return item?.current_period_end ?? sub.current_period_end ?? null;
}

interface MemberCtx {
  email:     string;
  name:      string;
  planLabel: string;
  planPrice: string;
}

// Calls the existing send-email Edge Function in template mode using
// the service-role key. BCC is applied automatically by that function
// via the EMAIL_BCC env var, maintaining the audit trail.
async function trySendEmail(
  template:  string,
  ctx:       MemberCtx,
  vars:      Record<string, string>,
): Promise<void> {
  try {
    const res = await fetch(SEND_EMAIL_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        template,
        to: ctx.email,
        vars: {
          member_name: ctx.name,
          plan_name:   ctx.planLabel,
          coach_name:  'Mick',
          ...vars,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`coach-manage-subscription/trySendEmail: send-email ${res.status} — ${text}`);
    }
  } catch (err) {
    console.warn('coach-manage-subscription/trySendEmail: fetch failed', err);
  }
}

// ---- entry point --------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  // ---- Verify caller is a coach ----
  const authHeader = req.headers.get('authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return jsonResponse({ error: 'unauthorized' }, 401);

  const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userData?.user?.email) {
    return jsonResponse({ error: 'unauthorized', detail: 'Invalid or expired JWT' }, 401);
  }
  const callerEmail = userData.user.email.toLowerCase();

  const { data: coachRow } = await sbAdmin
    .from('coaches')
    .select('email')
    .eq('email', callerEmail)
    .maybeSingle();
  if (!coachRow) {
    return jsonResponse({ error: 'forbidden', detail: 'Coach access required' }, 403);
  }

  // ---- Parse body ----
  let body: { action: string; target_user_id: string; resumes_at?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const { action, target_user_id, resumes_at } = body;
  if (!action || !target_user_id) {
    return jsonResponse({
      error:  'missing_fields',
      detail: 'action and target_user_id are required',
    }, 400);
  }

  // ---- Look up the target member's subscription ----
  const { data: subRow, error: subErr } = await sbAdmin
    .from('subscriptions')
    .select(`
      id, user_id, stripe_subscription_id, status, cancel_at_period_end, pause_resumes_at,
      progressive_member_id, custom_member_id,
      progressive_members ( email, name, plan_key ),
      custom_members      ( email, name )
    `)
    .eq('user_id', target_user_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subErr) {
    console.error('coach-manage-subscription: subscription lookup failed', subErr);
    return jsonResponse({ error: 'lookup_failed' }, 500);
  }
  if (!subRow) {
    return jsonResponse({
      error:  'no_subscription',
      detail: 'No subscription found for this member.',
    }, 404);
  }

  const subscriptionId = subRow.stripe_subscription_id;

  // Resolve member context (used for email template vars)
  // deno-lint-ignore no-explicit-any
  const pm: any = Array.isArray(subRow.progressive_members)
    ? subRow.progressive_members[0]
    : subRow.progressive_members;
  // deno-lint-ignore no-explicit-any
  const cm: any = Array.isArray(subRow.custom_members)
    ? subRow.custom_members[0]
    : subRow.custom_members;

  let ctx: MemberCtx;
  if (subRow.progressive_member_id && pm) {
    const disc = DISCIPLINE_LABELS[pm.plan_key as string] ?? pm.plan_key;
    ctx = {
      email:     pm.email,
      name:      ((pm.name || pm.email.split('@')[0]) as string).split(' ')[0],
      planLabel: `Progressive ${disc} Plan`,
      planPrice: 'A$80',
    };
  } else if (subRow.custom_member_id && cm) {
    ctx = {
      email:     cm.email,
      name:      ((cm.name || cm.email.split('@')[0]) as string).split(' ')[0],
      planLabel: 'Custom Season Race Plan',
      planPrice: 'A$140',
    };
  } else {
    return jsonResponse({
      error:  'member_not_found',
      detail: 'Subscription exists but member FK is not set.',
    }, 404);
  }

  // ---- Dispatch action ----
  try {
    switch (action) {

      // Returns live Stripe subscription state. The UI calls this to
      // get the authoritative current state (including is_paused which
      // is not reliably mirrored for manual-resume pauses in the DB).
      case 'status': {
        const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
        const periodEnd = getPeriodEnd(stripeSub);
        return jsonResponse({
          ok:                   true,
          status:               stripeSub.status,
          is_paused:            !!stripeSub.pause_collection,
          cancel_at_period_end: stripeSub.cancel_at_period_end,
          pause_resumes_at:     stripeSub.pause_collection?.resumes_at
            ? new Date(stripeSub.pause_collection.resumes_at * 1000).toISOString()
            : null,
          current_period_end:   periodEnd
            ? new Date(periodEnd * 1000).toISOString()
            : null,
          member_name:          ctx.name,
          plan_label:           ctx.planLabel,
        });
      }

      case 'pause': {
        const params: Stripe.SubscriptionUpdateParams = {
          pause_collection: { behavior: 'keep_as_draft' },
        };
        if (resumes_at) {
          const ts = parseIsoToUnix(resumes_at);
          if (ts === null) {
            return jsonResponse({ error: 'invalid_resumes_at' }, 400);
          }
          params.pause_collection!.resumes_at = ts;
        }
        const updated   = await stripe.subscriptions.update(subscriptionId, params);
        const periodEnd = getPeriodEnd(updated);
        console.log(`coach-manage-subscription: paused ${subscriptionId} by ${callerEmail}`);
        await trySendEmail('subscription-pause-scheduled', ctx, {
          access_end_date: formatDate(periodEnd),
          resume_line:     resumes_at
            ? `Your coach has scheduled an automatic resume on ${formatDate(parseIsoToUnix(resumes_at))}. We'll charge ${ctx.planPrice} then.`
            : `Your coach has paused your subscription. They'll resume it manually when you're ready to get back into training.`,
          settings_url: SETTINGS_URL,
        });
        return jsonResponse({ ok: true, action: 'pause', subscription_id: subscriptionId });
      }

      case 'resume': {
        // Empty string removes pause_collection on Stripe's API.
        // deno-lint-ignore no-explicit-any
        await stripe.subscriptions.update(subscriptionId, { pause_collection: '' as any });
        console.log(`coach-manage-subscription: resumed ${subscriptionId} by ${callerEmail}`);
        await trySendEmail('subscription-resumed', ctx, {
          plan_url:     PLAN_URL,
          settings_url: SETTINGS_URL,
        });
        return jsonResponse({ ok: true, action: 'resume', subscription_id: subscriptionId });
      }

      case 'cancel': {
        const updated   = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
        const periodEnd = getPeriodEnd(updated);
        console.log(`coach-manage-subscription: cancel scheduled for ${subscriptionId} by ${callerEmail}`);
        await trySendEmail('subscription-cancel-scheduled', ctx, {
          access_end_date: formatDate(periodEnd),
          settings_url:    SETTINGS_URL,
        });
        return jsonResponse({ ok: true, action: 'cancel', subscription_id: subscriptionId });
      }

      case 'undo_cancel': {
        await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false });
        console.log(`coach-manage-subscription: undo cancel for ${subscriptionId} by ${callerEmail}`);
        // No email — same convention as the member-side undo_cancel.
        return jsonResponse({ ok: true, action: 'undo_cancel', subscription_id: subscriptionId });
      }

      default:
        return jsonResponse({
          error:  'unknown_action',
          detail: `"${action}" is not a supported action.`,
        }, 400);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`coach-manage-subscription: action "${action}" failed`, err);
    return jsonResponse({ error: 'action_failed', detail: msg }, 500);
  }
});
