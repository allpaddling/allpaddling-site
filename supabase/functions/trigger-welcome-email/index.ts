// ============================================================
// supabase/functions/trigger-welcome-email/index.ts
//
// Fires the welcome email for a member who's just completed their
// onboarding form. Called from the onboarding.html submit handler
// using the member's own user JWT.
//
// Why this exists separately from `send-email`:
//   - send-email's template mode requires service-role or coach
//     auth. A regular member calling it from the browser would be
//     rejected. We don't want to widen send-email's surface to
//     accept any user JWT.
//   - This function is single-purpose: a member can trigger their
//     OWN welcome email, after onboarding, exactly once. It pulls
//     all the personalisation server-side (preferred_name, plan
//     info) so the caller can't spoof anything.
//
// Idempotency:
//   member_profiles.welcome_email_sent_at is checked + set within
//   the same call. Concurrent calls would race but Resend's send
//   is fast and the worst case is two emails (acceptable).
//
// Required environment:
//   RESEND_API_KEY              — used by _shared/email.ts
//   EMAIL_FROM, EMAIL_REPLY_TO  — used by _shared/email.ts
//   EMAIL_BCC                   — copies to Jake + Mick (audit)
//   SUPABASE_URL                — auto-injected
//   SUPABASE_ANON_KEY           — for verifying the user JWT
//   SUPABASE_SERVICE_ROLE_KEY   — for the privileged DB reads/writes
//
// Deploy:
//   supabase functions deploy trigger-welcome-email --no-verify-jwt --project-ref crlukzkgmydyqpwndjvc
//
// (--no-verify-jwt is required so the edge layer doesn't reject
// requests; auth is verified inside the function.)
// ============================================================

import { sendTransactional } from '../_shared/email.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const APP_BASE_URL      = Deno.env.get('APP_BASE_URL') ?? 'https://allpaddling.online';

const COACH_NAME = 'Mick';
const PLAN_URL   = `${APP_BASE_URL}/app/program.html`;

// Service-role client for privileged reads (member_profiles + member rows).
const sbAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function jsonResponse (status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  // Verify the caller's JWT and resolve to a Supabase user.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse(401, { error: 'unauthorized' });
  }
  const jwt = authHeader.slice('Bearer '.length).trim();
  if (!jwt) return jsonResponse(401, { error: 'unauthorized' });

  let userId: string;
  let email:  string;
  try {
    const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth:   { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await sbUser.auth.getUser();
    if (userErr || !userData?.user?.email) {
      return jsonResponse(401, { error: 'unauthorized', detail: 'Invalid user JWT' });
    }
    userId = userData.user.id;
    email  = userData.user.email.toLowerCase();
  } catch (e) {
    console.warn('trigger-welcome-email: JWT verification threw —', e);
    return jsonResponse(401, { error: 'unauthorized' });
  }

  // Pull profile + member rows server-side (don't trust client-supplied data).
  const [profileRes, pmRes, cmRes] = await Promise.all([
    sbAdmin.from('member_profiles')
      .select('preferred_name, welcome_email_sent_at')
      .eq('user_id', userId)
      .maybeSingle(),
    sbAdmin.from('progressive_members')
      .select('name, plan_key')
      .eq('email', email)
      .maybeSingle(),
    sbAdmin.from('custom_members')
      .select('name')
      .eq('email', email)
      .maybeSingle(),
  ]);

  // Idempotency: already sent? No-op.
  if (profileRes?.data?.welcome_email_sent_at) {
    return jsonResponse(200, { already_sent: true, sent_at: profileRes.data.welcome_email_sent_at });
  }

  // Resolve member context: progressive vs custom + plan label.
  let planType: 'progressive' | 'custom';
  let planLabel: string;
  if (pmRes?.data) {
    planType = 'progressive';
    const DISCIPLINE: Record<string, string> = { prone: 'Prone', sup: 'SUP', oc: 'OC', ski: 'Ski' };
    const disc = DISCIPLINE[pmRes.data.plan_key as string] ?? pmRes.data.plan_key;
    planLabel = `Progressive ${disc} Plan`;
  } else if (cmRes?.data) {
    planType = 'custom';
    planLabel = 'Custom Season Race Plan';
  } else {
    // No member row for this user. They might not have actually
    // paid yet (e.g. abandoned signup, or the webhook is racing).
    // Don't send and don't mark sent — let a retry pick it up.
    console.warn(`trigger-welcome-email: no member row found for ${email} (user ${userId}). Skipping.`);
    return jsonResponse(404, { error: 'no_member_row', detail: 'Pay first; welcome email fires after that.' });
  }

  // Resolve display name with the same hierarchy as the dashboard
  // sidebar: preferred_name > Stripe billing name > email prefix.
  const preferred  = profileRes?.data?.preferred_name?.trim();
  const stripeName = pmRes?.data?.name?.trim() || cmRes?.data?.name?.trim();
  const emailPrefix = email.split('@')[0];
  const memberName = preferred || (stripeName ? stripeName.split(' ')[0] : '') || emailPrefix;

  // Branch the "what happens next" copy by plan type.
  const postSignupMessage = planType === 'progressive'
    ? `Your training plan is ready in your dashboard right now — open it up and get started today. Every interval scales to your threshold pace, so set that first if you haven't already.`
    : `${COACH_NAME} is putting your first 4-week block together right now — you'll get a separate email the moment it's live in your dashboard. Usually that's within a day or two.`;

  // Send.
  try {
    const result = await sendTransactional('welcome', email, {
      member_name:         memberName,
      plan_name:           planLabel,
      plan_url:            PLAN_URL,
      coach_name:          COACH_NAME,
      post_signup_message: postSignupMessage,
    });
    // Mark sent. Soft-fail on the timestamp write — the email was
    // delivered, that's the important bit.
    const { error: updErr } = await sbAdmin
      .from('member_profiles')
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (updErr) {
      console.warn(`trigger-welcome-email: timestamp update failed for ${email}:`, updErr.message);
    }
    return jsonResponse(200, { sent: true, message_id: result.id, member_name: memberName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`trigger-welcome-email: send failed for ${email}: ${msg}`);
    return jsonResponse(500, { error: 'send_failed', detail: msg });
  }
});
