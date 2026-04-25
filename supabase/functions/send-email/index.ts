// ============================================================
// supabase/functions/send-email/index.ts
//
// HTTP wrapper around the email helpers in _shared/email.ts.
// Lets cron jobs, scheduled tasks, and ad-hoc test scripts send
// transactional emails without having to bundle the helpers
// themselves.
//
// In-process callers (e.g. stripe-webhook) should import
// sendTransactional() from _shared/email.ts directly — that's
// faster (no extra HTTP hop) and gets richer error context.
//
// Auth: callers must present the Supabase service-role key in
// the `x-service-role-key` header. The function never accepts
// anonymous traffic; it is deployed with --no-verify-jwt because
// Stripe-style external callers don't apply here, but the
// service-role check below provides equivalent protection.
//
// Required environment:
//   RESEND_API_KEY              Resend API key (sk_test_… or sk_live_…)
//   SUPABASE_SERVICE_ROLE_KEY   Auto-injected by Supabase
//   EMAIL_FROM                  e.g. "All Paddling <team@allpaddling.com>"
//   EMAIL_REPLY_TO              e.g. "mick@allpaddling.com"
//
// Request body (JSON):
//   {
//     "template": "welcome" | "payment-receipt" | ...   // required
//     "to":       "user@example.com" | ["a@…", "b@…"]   // required
//     "vars":     { "member_name": "Sarah", ... }       // required
//     "tags":     [{ "name": "purpose", "value": "..." }]  // optional
//   }
//
// Response (JSON):
//   200 { "id": "abc-123" }                  — message accepted by Resend
//   400 { "error": "..." }                   — invalid request
//   401 { "error": "missing or invalid service-role-key" }
//   500 { "error": "..." }                   — render error or Resend rejected
// ============================================================

import {
  sendTransactional,
  TEMPLATE_NAMES,
  type TemplateName,
} from '../_shared/email.ts';

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

interface SendEmailBody {
  template: string;
  to:       string | string[];
  vars:     Record<string, string | number>;
  tags?:    Array<{ name: string; value: string }>;
}

function jsonResponse (status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function isValidEmail (s: unknown): s is string {
  // Permissive check — Resend will do the rigorous validation.
  // We just want to reject obvious garbage early.
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  // -- auth --
  const presentedKey = req.headers.get('x-service-role-key');
  if (!SERVICE_ROLE_KEY || !presentedKey || presentedKey !== SERVICE_ROLE_KEY) {
    return jsonResponse(401, { error: 'missing or invalid service-role-key' });
  }

  // -- body --
  let body: SendEmailBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'invalid JSON body' });
  }

  // -- validation --
  if (!body.template || typeof body.template !== 'string') {
    return jsonResponse(400, { error: '`template` is required (string)' });
  }
  if (!(TEMPLATE_NAMES as readonly string[]).includes(body.template)) {
    return jsonResponse(400, {
      error: `unknown template "${body.template}". Allowed: ${TEMPLATE_NAMES.join(', ')}`,
    });
  }
  if (!body.to) {
    return jsonResponse(400, { error: '`to` is required (string or string[])' });
  }
  const recipients = Array.isArray(body.to) ? body.to : [body.to];
  if (recipients.length === 0 || !recipients.every(isValidEmail)) {
    return jsonResponse(400, { error: '`to` must be a non-empty list of valid email addresses' });
  }
  if (!body.vars || typeof body.vars !== 'object') {
    return jsonResponse(400, { error: '`vars` is required (object)' });
  }

  // -- send --
  try {
    const result = await sendTransactional(
      body.template as TemplateName,
      recipients,
      body.vars,
      body.tags ? { tags: body.tags } : undefined,
    );
    return jsonResponse(200, { id: result.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`send-email: failed for template="${body.template}" to=${recipients.join(',')} — ${msg}`);
    // Distinguish bad-input errors (e.g. missing var) from infrastructure errors.
    const isClientError = msg.startsWith('renderTemplate:') || msg.startsWith('loadTemplate:');
    return jsonResponse(isClientError ? 400 : 500, { error: msg });
  }
});
