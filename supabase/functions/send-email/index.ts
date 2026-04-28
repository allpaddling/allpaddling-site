// ============================================================
// supabase/functions/send-email/index.ts
//
// HTTP wrapper around the email helpers in _shared/email.ts.
// Used by:
//   - In-process callers should import sendTransactional() directly
//     from _shared/email.ts (no extra HTTP hop, richer errors).
//   - Out-of-process callers (cron jobs, scheduled tasks, ad-hoc
//     scripts) hit this endpoint with the service-role key.
//   - Coach admin pages (admin-migrate.html) hit this endpoint with
//     a coach JWT, restricted to migration emails (raw mode).
//
// Auth (one of):
//   1. `x-service-role-key: <SUPABASE_SERVICE_ROLE_KEY>` header
//      → grants full access to all modes.
//   2. `Authorization: Bearer <coach JWT>` header
//      → user is verified as being in the `coaches` table; restricted
//      to the migration-email use case (raw mode only). The JWT comes
//      from sb.auth.getSession() in the browser.
//
// Two body modes:
//   A. TEMPLATE mode — renders one of the 6 transactional templates.
//        { template: "welcome", to: "...", vars: {...}, tags: [...] }
//      Service-role auth required (transactional emails should go
//      through the server-side trigger, not be coach-triggered ad-hoc).
//   B. RAW mode — sends pre-rendered subject/text/html. Used by
//      admin-migrate to send migration emails.
//        { to, subject, text, html, tags?, replyTo?, from? }
//      Either auth method works. Coaches get this for migration sends.
//
// EMAIL_BCC (env): comma-separated list of addresses BCC'd on every
// outgoing email. Lets Jake + Mick maintain a permanent audit trail
// in their own Gmail of every transactional + migration email sent.
//
// Required environment:
//   RESEND_API_KEY              Resend API key (re_…)
//   SUPABASE_SERVICE_ROLE_KEY   Auto-injected by Supabase
//   EMAIL_FROM                  e.g. "Mick at All Paddling <mick@allpaddling.online>"
//   EMAIL_REPLY_TO              e.g. "hello@allpaddling.online"
//   EMAIL_BCC                   comma-separated, e.g. "jakedibetta@gmail.com,dibetta1@gmail.com"
//
// Response:
//   200 { id }                                — accepted by Resend
//   400 { error }                             — invalid request
//   401 { error: "unauthorized" }             — missing or invalid auth
//   403 { error: "forbidden" }                — auth valid but role not allowed for this mode
//   500 { error }                             — Resend rejected or render error
// ============================================================

import {
  sendTransactional,
  sendEmail,
  TEMPLATE_NAMES,
  type TemplateName,
} from '../_shared/email.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY  = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

interface TemplateModeBody {
  mode?:    'template';
  template: string;
  to:       string | string[];
  vars:     Record<string, string | number>;
  tags?:    Array<{ name: string; value: string }>;
}

interface RawModeBody {
  mode:     'raw';
  to:       string | string[];
  subject:  string;
  text:     string;
  html:     string;
  from?:    string;
  replyTo?: string;
  tags?:    Array<{ name: string; value: string }>;
}

type SendEmailBody = TemplateModeBody | RawModeBody;

function jsonResponse (status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-service-role-key, x-client-info, apikey, content-type',
    },
  });
}

function isValidEmail (s: unknown): s is string {
  // Permissive — Resend will do the rigorous validation.
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * If the JWT decodes successfully and has role='service_role',
 * trust it as service-role auth. This is robust to Supabase rotating
 * the auto-injected SERVICE_ROLE_KEY env var format (legacy `eyJ...`
 * JWT vs new `sb_secret_...` opaque) — the env var exact-match path
 * fails when formats diverge, but JWT-decode keeps working.
 *
 * Same pattern used in create-checkout-session (commit 98e5beb1).
 */
function isServiceRoleJwt (jwt: string): boolean {
  try {
    const [, payload] = jwt.split('.');
    if (!payload) return false;
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
    const decoded = JSON.parse(atob(padded));
    return decoded.role === 'service_role';
  } catch {
    return false;
  }
}

/**
 * Verify caller. Returns 'service_role' if the service-role key was
 * presented (exact match OR a JWT whose role claim is service_role),
 * 'coach' if a JWT belonging to a coach was presented, or null if
 * neither (caller is unauthenticated).
 */
async function authenticateCaller (req: Request): Promise<'service_role' | 'coach' | null> {
  // Service-role via x-service-role-key header (the original style).
  const presentedServiceKey = req.headers.get('x-service-role-key');
  if (presentedServiceKey) {
    if (SERVICE_ROLE_KEY && presentedServiceKey === SERVICE_ROLE_KEY) return 'service_role';
    if (isServiceRoleJwt(presentedServiceKey)) return 'service_role';
  }

  // Authorization: Bearer <token> — could be service-role OR a coach JWT.
  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader.startsWith('Bearer ')) {
    const jwt = authHeader.slice('Bearer '.length).trim();
    if (!jwt) return null;
    if (SERVICE_ROLE_KEY && jwt === SERVICE_ROLE_KEY) return 'service_role';
    if (isServiceRoleJwt(jwt)) return 'service_role';
    try {
      const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth:   { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData, error: userErr } = await sb.auth.getUser();
      if (userErr || !userData?.user?.email) return null;
      const callerEmail = userData.user.email.toLowerCase();
      const { data: coachRow } = await sb
        .from('coaches')
        .select('email')
        .eq('email', callerEmail)
        .maybeSingle();
      if (coachRow) return 'coach';
    } catch (e) {
      console.warn('send-email: JWT verification threw —', e);
    }
  }
  return null;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-service-role-key, x-client-info, apikey, content-type',
      },
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  // -- auth --
  const role = await authenticateCaller(req);
  if (!role) {
    return jsonResponse(401, { error: 'unauthorized' });
  }

  // -- body --
  let body: SendEmailBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'invalid JSON body' });
  }

  const mode = (body as { mode?: string }).mode ?? 'template';

  if (mode === 'raw') {
    return await handleRawSend(body as RawModeBody, role);
  } else {
    // Template mode is now also accessible to coaches (e.g. firing
    // the plan-ready email when Mick publishes a Custom plan from
    // admin-edit). Service-role still works for cron / scripts.
    return await handleTemplateSend(body as TemplateModeBody);
  }
});

async function handleTemplateSend (body: TemplateModeBody): Promise<Response> {
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
    console.error(`send-email (template): failed for "${body.template}" to=${recipients.join(',')} — ${msg}`);
    const isClientError = msg.startsWith('renderTemplate:') || msg.startsWith('loadTemplate:');
    return jsonResponse(isClientError ? 400 : 500, { error: msg });
  }
}

async function handleRawSend (body: RawModeBody, _role: 'service_role' | 'coach'): Promise<Response> {
  if (!body.to) {
    return jsonResponse(400, { error: '`to` is required (string or string[])' });
  }
  const recipients = Array.isArray(body.to) ? body.to : [body.to];
  if (recipients.length === 0 || !recipients.every(isValidEmail)) {
    return jsonResponse(400, { error: '`to` must be a non-empty list of valid email addresses' });
  }
  if (!body.subject || typeof body.subject !== 'string') {
    return jsonResponse(400, { error: '`subject` is required (string)' });
  }
  if (!body.text || typeof body.text !== 'string') {
    return jsonResponse(400, { error: '`text` is required (string)' });
  }
  if (!body.html || typeof body.html !== 'string') {
    return jsonResponse(400, { error: '`html` is required (string)' });
  }

  try {
    const result = await sendEmail({
      to:       recipients,
      subject:  body.subject,
      text:     body.text,
      html:     body.html,
      from:     body.from,
      replyTo:  body.replyTo,
      tags:     body.tags,
    });
    return jsonResponse(200, { id: result.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`send-email (raw): failed to=${recipients.join(',')} subject="${body.subject}" — ${msg}`);
    return jsonResponse(500, { error: msg });
  }
}
