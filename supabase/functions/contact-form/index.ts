// ============================================================
// supabase/functions/contact-form/index.ts
//
// Public-callable contact form handler. The marketing site's
// contact.html POSTs the form payload here, and this function
// emails Mick via Resend with the user's message + email as the
// reply-to header (so Mick can hit Reply and respond directly).
//
// Deploy:
//   supabase functions deploy contact-form --no-verify-jwt
//
// Env (set with `supabase secrets set`):
//   RESEND_API_KEY               re_…  (already set; shared with send-email)
//   CONTACT_TO_EMAIL             default: dibetta1@gmail.com
//                                set to hello@allpaddling.online once
//                                Cloudflare Email Routing is verified.
//   CONTACT_FROM_EMAIL           default: 'All Paddling <forms@send.allpaddling.online>'
//
// CORS: allows allpaddling.online + the github.io fallback. The
// function is --no-verify-jwt because it's public; spam protection
// is via a honeypot field, basic length checks, and Resend's
// own per-key rate limit.
//
// Request body (JSON, from contact.html):
//   {
//     "name":     "Sarah",          // required
//     "email":    "sarah@x.com",    // required, used as reply-to
//     "phone":    "0400 ...",       // optional
//     "interest": "Progressive...", // optional
//     "message":  "Hi, ...",        // required
//     "_hp":      ""                // honeypot — bots fill this
//   }
//
// Response:
//   200 { "ok": true }     — accepted (honeypot trips also return 200)
//   400 { "error": "..." } — validation failure
//   500 { "error": "..." } — Resend rejected or RESEND_API_KEY missing
// ============================================================

import { sendEmail } from '../_shared/email.ts';

const TO_EMAIL   = Deno.env.get('CONTACT_TO_EMAIL')   ?? 'dibetta1@gmail.com';
const FROM_EMAIL = Deno.env.get('CONTACT_FROM_EMAIL') ?? 'All Paddling <forms@send.allpaddling.online>';

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
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  };
}

function json (status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function isValidEmail (s: unknown): s is string {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

function escapeHtml (s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[c]);
}

interface ContactFormBody {
  name?:     unknown;
  email?:    unknown;
  phone?:    unknown;
  interest?: unknown;
  message?:  unknown;
  _hp?:      unknown;     // honeypot
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');

  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' }, origin);
  }

  let body: ContactFormBody;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid JSON body' }, origin);
  }

  // Honeypot — bots fill the hidden _hp field. Return 200 so the
  // bot thinks it succeeded and goes away, but never email Mick.
  if (typeof body._hp === 'string' && body._hp.length > 0) {
    return json(200, { ok: true }, origin);
  }

  // Validation
  const name     = typeof body.name     === 'string' ? body.name.trim()     : '';
  const email    = typeof body.email    === 'string' ? body.email.trim()    : '';
  const phone    = typeof body.phone    === 'string' ? body.phone.trim()    : '';
  const interest = typeof body.interest === 'string' ? body.interest.trim() : '';
  const message  = typeof body.message  === 'string' ? body.message.trim() : '';

  if (!name)    return json(400, { error: 'name is required' },    origin);
  if (!message) return json(400, { error: 'message is required' }, origin);
  if (!isValidEmail(email)) return json(400, { error: 'a valid email is required' }, origin);

  if (name.length    > 200)   return json(400, { error: 'name is too long' },    origin);
  if (message.length > 5000)  return json(400, { error: 'message is too long' }, origin);
  if (phone.length   > 50)    return json(400, { error: 'phone is too long' },   origin);
  if (interest.length > 100)  return json(400, { error: 'interest is too long' }, origin);

  // Build the email body Mick will receive.
  const subjectSuffix = interest ? ` — ${interest}` : '';
  const subject = `New contact form: ${name}${subjectSuffix}`;

  const text = [
    `New contact form submission from allpaddling.online`,
    ``,
    `Name:     ${name}`,
    `Email:    ${email}`,
    phone    ? `Phone:    ${phone}`    : null,
    interest ? `Interest: ${interest}` : null,
    ``,
    `Message:`,
    message,
    ``,
    `--`,
    `Reply directly to this email to respond — the user's address is the reply-to.`,
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;line-height:1.5;color:#0f172a;">
      <h2 style="font-size:18px;margin:0 0 16px;color:#155e75;">New contact form submission</h2>
      <table style="border-collapse:collapse;margin-bottom:20px;font-size:14px;">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Name</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(name)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Email</td><td style="padding:4px 0;font-weight:600;"><a href="mailto:${escapeHtml(email)}" style="color:#155e75;">${escapeHtml(email)}</a></td></tr>
        ${phone    ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b;">Phone</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(phone)}</td></tr>`        : ''}
        ${interest ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b;">Interest</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(interest)}</td></tr>` : ''}
      </table>
      <div style="background:#f8fafc;border-left:3px solid #155e75;padding:12px 16px;border-radius:4px;font-size:14px;white-space:pre-wrap;">${escapeHtml(message)}</div>
      <p style="font-size:12px;color:#94a3b8;margin-top:20px;">Reply to this email to respond — the user's address is set as the reply-to.</p>
    </div>
  `;

  try {
    await sendEmail({
      to:      TO_EMAIL,
      from:    FROM_EMAIL,
      replyTo: email,           // Mick's "Reply" goes to the user
      subject,
      html,
      text,
      tags: [
        { name: 'purpose',  value: 'contact-form' },
        { name: 'interest', value: interest || 'unspecified' },
      ],
    });
  } catch (err) {
    console.error('contact-form sendEmail failed:', err);
    return json(500, { error: 'send failed' }, origin);
  }

  return json(200, { ok: true }, origin);
});
