// ============================================================
// supabase/functions/newsletter-signup/index.ts
//
// Public-callable newsletter signup handler. The marketing site's
// footer form (rendered by rebuild/assets/site.js) POSTs an email
// here, and this function inserts a row into newsletter_subscribers
// for future outreach campaigns.
//
// Deploy:
//   supabase functions deploy newsletter-signup --no-verify-jwt
//
// Env (already set on the project):
//   SUPABASE_URL                auto-injected
//   SUPABASE_SERVICE_ROLE_KEY   auto-injected — used to bypass RLS
//                               on the insert (RLS only allows
//                               coach SELECT; INSERT goes via
//                               service role through this function).
//
// CORS: allows allpaddling.online + the github.io fallback
// (mirrors contact-form). The function is --no-verify-jwt because
// it's public; spam protection is via a honeypot field, basic
// validation, and the unique-email constraint making repeat
// floods cheap.
//
// Request body (JSON, from site.js):
//   {
//     "email":      "sarah@x.com",   // required, lowercased before insert
//     "first_name": "Sarah",         // optional, used for personalisation
//     "last_name":  "Smith",         // optional
//     "source":     "public_footer", // optional, defaults server-side
//     "_hp":        ""               // honeypot — bots fill this
//   }
//
// Response:
//   200 { "ok": true }     — accepted (honeypot trips also return 200)
//   400 { "error": "..." } — validation failure
//   500 { "error": "..." } — DB insert failed
//
// Notes:
// - Idempotent: same email re-submitting is a no-op (unique constraint
//   + ON CONFLICT DO NOTHING). The user always sees success.
// - If the email was previously unsubscribed (unsubscribed_at set), we
//   clear that flag — re-subscribing should re-enable them.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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

function isValidEmail (s: unknown): s is string {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

interface Body {
  email?:      unknown;
  first_name?: unknown;
  last_name?:  unknown;
  source?:     unknown;
  _hp?:        unknown;
}

// Trim, cap to a reasonable length, return null if empty.
function cleanName (s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim().slice(0, 80);
  return t.length > 0 ? t : null;
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' }, origin);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid JSON body' }, origin);
  }

  // Honeypot — bots fill the hidden _hp field. Return 200 so the
  // bot thinks it succeeded; never insert.
  if (typeof body._hp === 'string' && body._hp.length > 0) {
    return json(200, { ok: true }, origin);
  }

  const emailRaw = typeof body.email === 'string' ? body.email.trim() : '';
  if (!isValidEmail(emailRaw)) {
    return json(400, { error: 'a valid email is required' }, origin);
  }
  const email = emailRaw.toLowerCase();

  const firstName = cleanName(body.first_name);
  const lastName  = cleanName(body.last_name);

  const source = (typeof body.source === 'string' && body.source.trim())
    ? body.source.trim().slice(0, 50)
    : 'public_footer';

  // Lightweight audit fields. x-forwarded-for is comma-separated when
  // multiple proxies are in the chain; we keep the first (origin client).
  const ua  = (req.headers.get('user-agent') ?? '').slice(0, 500);
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const ip  = (xff.split(',')[0] || '').trim().slice(0, 64);

  // First, try a clean insert. If the email already exists (unique
  // violation), we treat that as success — but if the existing row
  // was previously unsubscribed, clear the unsubscribed_at so they
  // start receiving emails again.
  const { error: insertErr } = await sb
    .from('newsletter_subscribers')
    .insert({
      email,
      first_name:        firstName,
      last_name:         lastName,
      source,
      signup_user_agent: ua || null,
      signup_ip:         ip || null,
    });

  if (insertErr && insertErr.code !== '23505') {
    // Real error — not a duplicate.
    console.error('newsletter-signup insert failed:', insertErr);
    return json(500, { error: 'insert failed' }, origin);
  }

  if (insertErr && insertErr.code === '23505') {
    // Duplicate — re-subscribe path. Two things to do:
    //  (1) if the row was unsubscribed, clear that
    //  (2) backfill names if the existing row has nulls and this submit
    //      provided them. Don't overwrite existing names — the original
    //      name is more trustworthy than a re-submission.
    const update: Record<string, unknown> = { unsubscribed_at: null, unsubscribe_reason: null };
    if (firstName) update.first_name = firstName;
    if (lastName)  update.last_name  = lastName;

    // Apply name backfill ONLY where the column is currently null —
    // run a separate update so we don't trample non-null existing names.
    if (firstName) {
      await sb.from('newsletter_subscribers').update({ first_name: firstName })
        .eq('email', email).is('first_name', null);
    }
    if (lastName) {
      await sb.from('newsletter_subscribers').update({ last_name: lastName })
        .eq('email', email).is('last_name', null);
    }

    // Resubscribe — only touch rows that are actually unsubscribed.
    const { error: updateErr } = await sb
      .from('newsletter_subscribers')
      .update({ unsubscribed_at: null, unsubscribe_reason: null })
      .eq('email', email)
      .not('unsubscribed_at', 'is', null);
    if (updateErr) {
      console.error('newsletter-signup re-subscribe update failed:', updateErr);
      // Still return ok — the insert "succeeded" from user POV.
    }
  }

  return json(200, { ok: true }, origin);
});
