// ============================================================
// supabase/functions/submit-feedback/index.ts
//
// Member feedback handler. The "Send feedback" button in the
// member-area sidebar (assets/app.js) POSTs here. The function
// verifies the caller is a signed-in user, then emails the
// feedback straight to Jake via Resend, with the member's own
// address set as reply-to (so hitting Reply lands in their inbox).
//
// Self-contained on purpose (no _shared/ imports):
//   * deployable as a single file via the Supabase MCP / CLI.
//   * does its OWN Resend POST, so it does NOT inherit the global
//     EMAIL_BCC (Jake + Mick) audit trail that _shared/email.ts
//     applies — feedback goes to Jake ONLY, per the chosen routing.
//
// Deploy (verify_jwt stays ON — members are authenticated):
//   supabase functions deploy submit-feedback --project-ref crlukzkgmydyqpwndjvc
//
// Auth note: verify_jwt:true makes the gateway require *a* project
// JWT, but the anon key is itself a valid JWT — so the gateway alone
// does not prove a real user. We additionally call auth.getUser()
// with the caller's bearer and 401 if it doesn't resolve to a user
// with an email (an anonymous / anon-key caller is rejected here).
//
// Env:
//   RESEND_API_KEY        re_…  (shared with send-email / contact-form)
//   SUPABASE_URL          auto-injected
//   SUPABASE_ANON_KEY     auto-injected
//   FEEDBACK_TO_EMAIL     default: jakedibetta@gmail.com
//   FEEDBACK_FROM_EMAIL   default: All Paddling <forms@send.allpaddling.online>
//
// Request body (JSON):
//   { "message": "…", "page": "/app/dashboard.html", "_hp": "" }
//   _hp is a honeypot — a non-empty value short-circuits to 200
//   without sending.
//
// Response:
//   200 { ok: true }              — accepted (honeypot trips also 200)
//   400 { error }                 — empty / oversized message or bad JSON
//   401 { error: "unauthorized" } — no signed-in user
//   500 { error }                 — Resend rejected / RESEND_API_KEY missing
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')        ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')   ?? '';
const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY')      ?? '';
const TO_EMAIL          = Deno.env.get('FEEDBACK_TO_EMAIL')   ?? 'jakedibetta@gmail.com';
const FROM_EMAIL        = Deno.env.get('FEEDBACK_FROM_EMAIL') ?? 'All Paddling <forms@send.allpaddling.online>';

const ALLOWED_ORIGINS = [
  'https://allpaddling.online',
  'https://allpaddling.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

function corsHeaders (origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // Supabase JS clients send apikey + authorization on every request.
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age':       '86400',
  };
}

function json (status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function escapeHtml (s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[c]);
}

async function sendViaResend (payload: Record<string, unknown>): Promise<{ id: string }> {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Resend ${res.status} ${res.statusText} — ${t}`);
  }
  return await res.json() as { id: string };
}

interface FeedbackBody {
  message?: unknown;
  page?:    unknown;
  _hp?:     unknown;     // honeypot
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' }, origin);
  }

  // --- Verify a real signed-in user. The anon key passes the gateway's
  //     verify_jwt, so we must resolve an actual user ourselves. ---
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return json(401, { error: 'unauthorized' }, origin);
  }

  let userEmail = '';
  let userId    = '';
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth:   { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user?.email) {
      return json(401, { error: 'unauthorized' }, origin);
    }
    userEmail = data.user.email;
    userId    = data.user.id;
  } catch {
    return json(401, { error: 'unauthorized' }, origin);
  }

  // --- Body ---
  let body: FeedbackBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid JSON body' }, origin);
  }

  // Honeypot — bots fill _hp. Pretend success; send nothing.
  if (typeof body._hp === 'string' && body._hp.length > 0) {
    return json(200, { ok: true }, origin);
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const page    = typeof body.page    === 'string' ? body.page.slice(0, 200) : '';
  if (!message)              return json(400, { error: 'message is required' }, origin);
  if (message.length > 5000) return json(400, { error: 'message is too long' }, origin);

  // --- Best-effort display name from member_profiles (self-read via RLS).
  //     Keyed on user_id (FK to auth.users), not auth_user_id. ---
  let displayName = userEmail;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth:   { persistSession: false, autoRefreshToken: false },
    });
    const { data: prof } = await sb
      .from('member_profiles')
      .select('preferred_name, family_name')
      .eq('user_id', userId)
      .maybeSingle();
    const nm = [prof?.preferred_name, prof?.family_name].filter(Boolean).join(' ').trim();
    if (nm) displayName = nm;
  } catch { /* non-fatal — fall back to email */ }

  const when    = new Date().toISOString();
  const subject = `Member feedback: ${displayName}`;

  const text = [
    `New feedback from a member on allpaddling.online`,
    ``,
    `From:  ${displayName}`,
    `Email: ${userEmail}`,
    page ? `Page:  ${page}` : null,
    `Time:  ${when}`,
    ``,
    `Message:`,
    message,
    ``,
    `--`,
    `Reply directly to this email to respond — the member's address is the reply-to.`,
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;line-height:1.5;color:#0f172a;">
      <h2 style="font-size:18px;margin:0 0 16px;color:#155e75;">New member feedback</h2>
      <table style="border-collapse:collapse;margin-bottom:20px;font-size:14px;">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">From</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(displayName)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Email</td><td style="padding:4px 0;font-weight:600;"><a href="mailto:${escapeHtml(userEmail)}" style="color:#155e75;">${escapeHtml(userEmail)}</a></td></tr>
        ${page ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b;">Page</td><td style="padding:4px 0;">${escapeHtml(page)}</td></tr>` : ''}
      </table>
      <div style="background:#f8fafc;border-left:3px solid #155e75;padding:12px 16px;border-radius:4px;font-size:14px;white-space:pre-wrap;">${escapeHtml(message)}</div>
      <p style="font-size:12px;color:#94a3b8;margin-top:20px;">Reply to this email to respond — the member's address is set as the reply-to.</p>
    </div>
  `;

  try {
    const out = await sendViaResend({
      from:     FROM_EMAIL,
      to:       [TO_EMAIL],
      reply_to: userEmail,           // Jake's "Reply" goes to the member
      subject,
      text,
      html,
      tags: [{ name: 'purpose', value: 'member_feedback' }],
    });
    return json(200, { ok: true, id: out.id }, origin);
  } catch (err) {
    console.error('submit-feedback sendViaResend failed:', err);
    return json(500, { error: 'send failed' }, origin);
  }
});
