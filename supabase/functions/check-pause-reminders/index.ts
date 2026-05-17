// ============================================================
// supabase/functions/check-pause-reminders/index.ts
//
// Daily batch job — sends the "subscription-resuming-soon" email
// to members whose paused subscription is set to auto-resume in
// approximately 3 days (window: 2 – 4 days from now).
//
// Triggered by a pg_cron job at 8 am UTC daily (set up in
// migration 017). Also callable manually for testing.
//
// Auth: verify_jwt: false. The function is idempotent — it checks
// pause_resume_reminder_sent_at before sending, so accidental
// duplicate calls are harmless. The endpoint is not user-facing.
//
// Email template: subscription-resuming-soon
//   vars: member_name, plan_name, plan_price, auto_resume_date,
//         card_last4, settings_url, coach_name
//
// Deploy:
//   supabase functions deploy check-pause-reminders \
//     --no-verify-jwt --project-ref crlukzkgmydyqpwndjvc
// ============================================================

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')         ?? '';
const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')              ?? '';
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const APP_BASE_URL      = Deno.env.get('APP_BASE_URL')              ?? 'https://allpaddling.online';

const SEND_EMAIL_URL = `${SUPABASE_URL}/functions/v1/send-email`;
const SETTINGS_URL   = `${APP_BASE_URL}/app/settings.html`;
const COACH_NAME     = 'Mick';

const PLAN_PRICES: Record<string, string> = {
  progressive: 'A$80',
  custom:      'A$140',
};

const DISCIPLINE_LABELS: Record<string, string> = {
  prone: 'Prone Paddle Board',
  sup:   'Stand Up Paddle Board',
  oc:    'Outrigger Canoe',
  ski:   'Surf Ski',
};

if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('check-pause-reminders: missing required env vars');
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

// Get the card last 4 for a Stripe customer. Returns 'on file' if
// no default payment method is set (edge case: old customers, portal-only
// payment method changes that haven't synced yet).
async function getCardLast4(stripeCustomerId: string): Promise<string> {
  try {
    const customer = await stripe.customers.retrieve(stripeCustomerId, {
      expand: ['invoice_settings.default_payment_method'],
    });
    if (customer.deleted) return 'on file';
    // deno-lint-ignore no-explicit-any
    const pm = (customer as any).invoice_settings?.default_payment_method;
    if (pm && typeof pm === 'object' && pm.card?.last4) {
      return pm.card.last4 as string;
    }
    // Fall back to the customer's default source (older Stripe accounts).
    if (customer.default_source && typeof customer.default_source === 'object') {
      // deno-lint-ignore no-explicit-any
      const src = customer.default_source as any;
      if (src.last4) return src.last4 as string;
    }
    return 'on file';
  } catch (err) {
    console.warn(`check-pause-reminders: could not fetch card for ${stripeCustomerId}:`, err);
    return 'on file';
  }
}

async function sendReminderEmail(vars: {
  to:              string;
  member_name:     string;
  plan_name:       string;
  plan_price:      string;
  auto_resume_date: string;
  card_last4:      string;
}): Promise<boolean> {
  try {
    const res = await fetch(SEND_EMAIL_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        template: 'subscription-resuming-soon',
        to:       vars.to,
        vars: {
          member_name:      vars.member_name,
          plan_name:        vars.plan_name,
          plan_price:       vars.plan_price,
          auto_resume_date: vars.auto_resume_date,
          card_last4:       vars.card_last4,
          settings_url:     SETTINGS_URL,
          coach_name:       COACH_NAME,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`check-pause-reminders: send-email failed ${res.status} — ${text}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('check-pause-reminders: send-email fetch failed', err);
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const now      = new Date();
  const in2days  = new Date(now.getTime() + 2 * 24 * 3600 * 1000).toISOString();
  const in4days  = new Date(now.getTime() + 4 * 24 * 3600 * 1000).toISOString();

  // Find subscriptions that will auto-resume in 2–4 days and haven't
  // had a reminder sent yet.
  const { data: rows, error } = await sb
    .from('subscriptions')
    .select(`
      id, stripe_customer_id,
      progressive_member_id, custom_member_id,
      pause_resumes_at,
      progressive_members ( email, name, plan_key ),
      custom_members      ( email, name )
    `)
    .gte('pause_resumes_at', in2days)
    .lte('pause_resumes_at', in4days)
    .is('pause_resume_reminder_sent_at', null);

  if (error) {
    console.error('check-pause-reminders: query failed', error);
    return jsonResponse({ error: 'query_failed', detail: error.message }, 500);
  }

  let sent = 0, skipped = 0, failed = 0;

  for (const row of (rows ?? [])) {
    // deno-lint-ignore no-explicit-any
    const pm: any = Array.isArray(row.progressive_members)
      ? row.progressive_members[0]
      : row.progressive_members;
    // deno-lint-ignore no-explicit-any
    const cm: any = Array.isArray(row.custom_members)
      ? row.custom_members[0]
      : row.custom_members;

    let email:      string;
    let name:       string;
    let planName:   string;
    let planPrice:  string;

    if (row.progressive_member_id && pm) {
      const disc = DISCIPLINE_LABELS[pm.plan_key as string] ?? pm.plan_key;
      email     = pm.email;
      name      = ((pm.name || pm.email.split('@')[0]) as string).split(' ')[0];
      planName  = `Progressive ${disc} Plan`;
      planPrice = PLAN_PRICES.progressive;
    } else if (row.custom_member_id && cm) {
      email     = cm.email;
      name      = ((cm.name || cm.email.split('@')[0]) as string).split(' ')[0];
      planName  = 'Custom Season Race Plan';
      planPrice = PLAN_PRICES.custom;
    } else {
      console.warn(`check-pause-reminders: subscription ${row.id} has no linked member, skipping`);
      skipped++;
      continue;
    }

    const card_last4      = await getCardLast4(row.stripe_customer_id);
    const auto_resume_date = formatDate(row.pause_resumes_at);

    const ok = await sendReminderEmail({ to: email, member_name: name, plan_name: planName, plan_price: planPrice, auto_resume_date, card_last4 });

    if (ok) {
      // Mark as sent so we don't re-send on the next daily run.
      await sb
        .from('subscriptions')
        .update({ pause_resume_reminder_sent_at: now.toISOString() })
        .eq('id', row.id);
      console.log(`check-pause-reminders: reminder sent to ${email} (sub ${row.id})`);
      sent++;
    } else {
      failed++;
    }
  }

  console.log(`check-pause-reminders: done. sent=${sent} skipped=${skipped} failed=${failed}`);
  return jsonResponse({ ok: true, sent, skipped, failed });
});
