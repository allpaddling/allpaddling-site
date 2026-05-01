// ============================================================
// supabase/functions/manage-subscription/index.ts
//
// Member-driven subscription management. Called from the Settings
// page on /app/settings.html. Five actions:
//
//   pause              { resumes_at?: ISO8601 }
//     Pauses Stripe collection at end of current period.
//     If resumes_at is given, schedules automatic resume.
//
//   resume
//     Removes pause_collection. Stripe charges the next invoice
//     immediately (or on resumes_at if that's still in the future).
//
//   cancel
//     Sets cancel_at_period_end=true. Member keeps access until
//     current_period_end, then Stripe fires subscription.deleted.
//
//   undo_cancel
//     Sets cancel_at_period_end=false. Reverses a scheduled cancel
//     before period_end has passed.
//
//   change_resume_date { resumes_at: ISO8601 }
//     Updates the auto-resume timestamp on an existing pause.
//
// Auth: member's own user JWT. We verify the JWT and then check
// that the requested subscription belongs to auth.uid().
//
// Required environment:
//   STRIPE_SECRET_KEY          sk_live_… (or sk_test_…)
//   SUPABASE_URL               https://<project>.supabase.co
//   SUPABASE_ANON_KEY          anon key for JWT verification
//   SUPABASE_SERVICE_ROLE_KEY  service-role for ownership check
//
// Deploy:
//   supabase functions deploy manage-subscription --project-ref crlukzkgmydyqpwndjvc
//
// JWT verification stays ON (default) — only signed-in members
// should be able to call this. The webhook will mirror state back
// into the subscriptions table when Stripe fires the resulting
// subscription.updated event, so this function does NOT write to
// Supabase directly.
// ============================================================

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { sendTransactional } from '../_shared/email.ts';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')         ?? '';
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')              ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')         ?? '';
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const APP_BASE_URL      = Deno.env.get('APP_BASE_URL')              ?? 'https://allpaddling.online';

const SETTINGS_URL = `${APP_BASE_URL}/app/settings.html`;
const PLAN_URL     = `${APP_BASE_URL}/app/program.html`;
const COACH_NAME   = 'Mick';

const DISCIPLINE_LABELS: Record<string, string> = {
  prone: 'Prone Paddle Board',
  sup:   'Stand Up Paddle Board',
  oc:    'Outrigger Canoe',
  ski:   'Surf Ski',
};

const PLAN_PRICE: Record<string, string> = {
  progressive: 'A$80',
  custom:      'A$140',
};

if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE_KEY) {
  console.error('manage-subscription: missing required environment variable(s)');
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------
type Action =
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'undo_cancel'
  | 'change_resume_date';

interface ManageRequest {
  action: Action;
  resumes_at?: string; // ISO 8601 — required for pause (optional) and change_resume_date
}

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

  // --- Auth: member JWT ---
  const authHeader = req.headers.get('authorization') ?? '';
  const userJwt = authHeader.replace(/^Bearer\s+/i, '');
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
  const userId = userData.user.id;

  // --- Body ---
  let body: ManageRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  if (!body.action) {
    return jsonResponse({ error: 'missing_action', detail: 'action field is required' }, 400);
  }

  // --- Look up the member's subscription + linked member row for email ctx ---
  // We use the service-role client so we can read the row even if
  // RLS policies are tightened later. Confirm ownership manually.
  const { data: subRow, error: subErr } = await sbAdmin
    .from('subscriptions')
    .select(`
      id, user_id, stripe_subscription_id, status, cancel_at_period_end, pause_resumes_at,
      progressive_member_id, custom_member_id,
      progressive_members ( email, name, plan_key ),
      custom_members      ( email, name )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subErr) {
    console.error('manage-subscription: subscription lookup failed', subErr);
    return jsonResponse({ error: 'lookup_failed' }, 500);
  }
  if (!subRow) {
    return jsonResponse({ error: 'no_subscription', detail: 'No subscription found for this user.' }, 404);
  }
  // Defensive ownership check (the .eq above already enforces it,
  // but being explicit makes the contract obvious).
  if (subRow.user_id !== userId) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }

  const subscriptionId = subRow.stripe_subscription_id;
  const memberCtx = resolveMemberContext(subRow);

  // --- Dispatch ---
  try {
    switch (body.action) {
      case 'pause': {
        // pause_collection with behavior:keep_as_draft means Stripe
        // will skip future invoices entirely (no charge, no draft
        // accumulation) until pause is removed.
        const params: Stripe.SubscriptionUpdateParams = {
          pause_collection: {
            behavior: 'keep_as_draft',
          },
        };
        if (body.resumes_at) {
          const ts = parseIsoToUnix(body.resumes_at);
          if (ts === null) {
            return jsonResponse({ error: 'invalid_resumes_at', detail: 'resumes_at must be a valid ISO 8601 timestamp' }, 400);
          }
          params.pause_collection!.resumes_at = ts;
        }
        const updated = await stripe.subscriptions.update(subscriptionId, params);
        console.log(`manage-subscription: paused ${subscriptionId} (resumes_at=${body.resumes_at ?? 'manual'})`);
        await trySendEmail('subscription-pause-scheduled', memberCtx, {
          access_end_date: formatDate(getPeriodEnd(updated)),
          resume_line: body.resumes_at
            ? `We'll automatically resume on ${formatDate(parseIsoToUnix(body.resumes_at))} and charge ${memberCtx.planPrice} then.`
            : `You'll resume manually — we won't charge you again until you click Resume.`,
          settings_url: SETTINGS_URL,
        });
        return jsonResponse({ ok: true, action: 'pause', subscription_id: subscriptionId, resumes_at: body.resumes_at ?? null });
      }

      case 'resume': {
        // Setting pause_collection: '' (empty string) is the Stripe
        // idiom for clearing the field via the SDK.
        await stripe.subscriptions.update(subscriptionId, {
          pause_collection: '',
        } as Stripe.SubscriptionUpdateParams);
        console.log(`manage-subscription: resumed ${subscriptionId}`);
        await trySendEmail('subscription-resumed', memberCtx, {
          plan_url: PLAN_URL,
        });
        return jsonResponse({ ok: true, action: 'resume', subscription_id: subscriptionId });
      }

      case 'cancel': {
        const updated = await stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: true,
        });
        console.log(`manage-subscription: scheduled cancel for ${subscriptionId} at period end`);
        await trySendEmail('subscription-cancel-scheduled', memberCtx, {
          access_end_date: formatDate(getPeriodEnd(updated) ?? updated.cancel_at),
          settings_url: SETTINGS_URL,
        });
        return jsonResponse({ ok: true, action: 'cancel', subscription_id: subscriptionId });
      }

      case 'undo_cancel': {
        await stripe.subscriptions.update(subscriptionId, {
          cancel_at_period_end: false,
        });
        console.log(`manage-subscription: undid scheduled cancel for ${subscriptionId}`);
        await trySendEmail('subscription-cancel-reversed', memberCtx, {});
        return jsonResponse({ ok: true, action: 'undo_cancel', subscription_id: subscriptionId });
      }

      case 'change_resume_date': {
        if (!body.resumes_at) {
          return jsonResponse({ error: 'missing_resumes_at', detail: 'change_resume_date requires resumes_at' }, 400);
        }
        const ts = parseIsoToUnix(body.resumes_at);
        if (ts === null) {
          return jsonResponse({ error: 'invalid_resumes_at' }, 400);
        }
        // Must already be paused — Stripe will reject otherwise.
        await stripe.subscriptions.update(subscriptionId, {
          pause_collection: {
            behavior: 'keep_as_draft',
            resumes_at: ts,
          },
        });
        console.log(`manage-subscription: changed resume date for ${subscriptionId} to ${body.resumes_at}`);
        // No email — minor adjustment, member sees it in the UI.
        return jsonResponse({ ok: true, action: 'change_resume_date', subscription_id: subscriptionId, resumes_at: body.resumes_at });
      }

      default:
        return jsonResponse({ error: 'unknown_action', detail: `Unknown action: ${body.action}` }, 400);
    }
  } catch (err) {
    const e = err as Error & { type?: string; raw?: { message?: string } };
    console.error(`manage-subscription: action ${body.action} failed for ${subscriptionId}`, e);
    return jsonResponse(
      {
        error: 'stripe_error',
        action: body.action,
        detail: e.raw?.message ?? e.message ?? 'unknown error',
      },
      502,
    );
  }
});

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

interface MemberCtx {
  email: string;
  preferredName: string;
  planLabel: string;       // "Custom Race Plan" / "Progressive Surf Ski Plan"
  planPrice: string;       // "A$80" / "A$140"
  planType: 'progressive' | 'custom' | null;
}

// deno-lint-ignore no-explicit-any
function resolveMemberContext (subRow: any): MemberCtx {
  // Relation arrays from PostgREST may come back as object or single-item array.
  // deno-lint-ignore no-explicit-any
  const pm: any = Array.isArray(subRow.progressive_members) ? subRow.progressive_members[0] : subRow.progressive_members;
  // deno-lint-ignore no-explicit-any
  const cm: any = Array.isArray(subRow.custom_members)      ? subRow.custom_members[0]      : subRow.custom_members;

  if (subRow.progressive_member_id && pm) {
    const label = DISCIPLINE_LABELS[pm.plan_key as string] ?? pm.plan_key;
    const name  = (pm.name as string | null) || (pm.email as string).split('@')[0];
    return {
      email:         pm.email,
      preferredName: name.split(' ')[0] || (pm.email as string).split('@')[0],
      planLabel:     `Progressive ${label} Plan`,
      planPrice:     PLAN_PRICE.progressive,
      planType:      'progressive',
    };
  }
  if (subRow.custom_member_id && cm) {
    const name = (cm.name as string | null) || (cm.email as string).split('@')[0];
    return {
      email:         cm.email,
      preferredName: name.split(' ')[0] || (cm.email as string).split('@')[0],
      planLabel:     'Custom Race Plan',
      planPrice:     PLAN_PRICE.custom,
      planType:      'custom',
    };
  }
  // Defensive fallback — should never hit because the constraint requires one.
  return { email: '', preferredName: '', planLabel: '—', planPrice: '—', planType: null };
}

// Period end with API 2025+ fallback (subscription items level).
function getPeriodEnd (sub: Stripe.Subscription): number | null {
  // deno-lint-ignore no-explicit-any
  const itemEnd = (sub as any).items?.data?.[0]?.current_period_end as number | undefined;
  return sub.current_period_end ?? itemEnd ?? null;
}

function formatDate (ts: number | string | null | undefined): string {
  if (!ts) return '';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// Send a templated email, swallowing errors so a Resend hiccup doesn't fail
// the action (the Stripe state already changed; the email is best-effort).
async function trySendEmail (
  templateName: string,
  ctx: MemberCtx,
  extraVars: Record<string, string | number>,
): Promise<void> {
  if (!ctx.email) {
    console.warn(`trySendEmail: skipping ${templateName}, no member email in context`);
    return;
  }
  try {
    await sendTransactional(templateName, ctx.email, {
      member_name: ctx.preferredName,
      plan_name:   ctx.planLabel,
      coach_name:  COACH_NAME,
      ...extraVars,
    });
  } catch (e) {
    console.warn(`trySendEmail: ${templateName} failed for ${ctx.email}:`, e);
  }
}

function parseIsoToUnix (iso: string): number | null {
  const ms = Date.parse(iso);
  if (isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

function jsonResponse (body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'content-type': 'application/json' },
  });
}

function corsHeaders (): Record<string, string> {
  return {
    'access-control-allow-origin':  '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type',
  };
}
