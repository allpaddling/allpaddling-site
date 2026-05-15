// ============================================================
// supabase/functions/resend-webhook/index.ts
//
// Two responsibilities in one function:
//
//   1. WEBHOOK MODE  — receive Resend webhook events (email.sent,
//      email.delivered, email.delivery_delayed, email.opened,
//      email.clicked, email.bounced, email.complained) and mirror
//      them into outreach_sends. Matches by data.email_id ⇄
//      outreach_sends.resend_id. Idempotent: an event whose
//      svix-id already appears in the events[] log is a no-op.
//
//   2. BACKFILL MODE — POST { "action": "backfill" } with a
//      service-role JWT to populate last_event for past sends that
//      don't have webhook data yet. Iterates outreach_sends rows
//      where resend_id is not null AND last_event is null, calls
//      Resend's GET /emails/{id}, writes back last_event.
//      Used once after enabling engagement tracking; afterwards
//      the webhook keeps everything fresh.
//
// Deploy:
//   supabase functions deploy resend-webhook --no-verify-jwt
//
// `--no-verify-jwt` is mandatory: Resend webhooks aren't Supabase
// users and don't send a JWT. Backfill mode does its OWN check on
// the Authorization header, requiring a service-role JWT.
//
// Env (set via `supabase secrets set`):
//   RESEND_API_KEY            re_…   (shared with send-email)
//   RESEND_WEBHOOK_SECRET     whsec_…   issued when you create the
//                                       webhook in Resend's dashboard.
//                                       Verified with Svix-style HMAC.
//   SUPABASE_URL              https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY service-role JWT (bypasses RLS)
//
// Request shapes:
//   Webhook event (POST, no auth):
//     {
//       "type": "email.opened",
//       "created_at": "2026-05-15T22:30:00.000Z",
//       "data": { "email_id": "...", "to": [...], "from": "...", ... }
//     }
//   Backfill (POST, Authorization: Bearer <service-role JWT>):
//     { "action": "backfill", "campaign_name": "Newsletter launch — May 2026" }
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const RESEND_API_KEY        = Deno.env.get('RESEND_API_KEY')        ?? '';
const RESEND_WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? '';
const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')          ?? '';
const SERVICE_ROLE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('resend-webhook: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------
interface ResendEvent {
  type:       string;                    // 'email.opened', 'email.clicked', ...
  created_at: string;                    // ISO-8601 timestamp from Resend
  data: {
    email_id?:   string;
    created_at?: string;
    from?:       string;
    to?:         string[];
    subject?:    string;
    [k: string]: unknown;
  };
}

interface OutreachUpdates {
  last_event:    string;
  last_event_at: string;
  status?:       string;
  delivered_at?: string;
  opened_at?:    string;
  clicked_at?:   string;
  bounced_at?:   string;
  complained_at?: string;
  open_count?:   number;
  click_count?:  number;
}

// ------------------------------------------------------------
// Entry point
// ------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // We need to peek at the body to dispatch (webhook vs backfill).
  // Read raw text first so we can use it for signature verification
  // if it turns out to be a webhook.
  const rawBody = await req.text();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return json(400, { error: 'invalid JSON body' });
  }

  // ---- Backfill mode -------------------------------------------------
  if (parsed.action === 'backfill') {
    return await handleBackfill(req, parsed);
  }

  // ---- Webhook mode --------------------------------------------------
  return await handleWebhook(req, rawBody, parsed as unknown as ResendEvent);
});

// ============================================================
// WEBHOOK MODE
// ============================================================
async function handleWebhook (req: Request, rawBody: string, event: ResendEvent): Promise<Response> {
  // Verify the Svix signature unless the secret is intentionally unset
  // (useful for local development).
  const svixId        = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');

  if (RESEND_WEBHOOK_SECRET) {
    if (!svixId || !svixTimestamp || !svixSignature) {
      console.warn('resend-webhook: missing svix-* headers');
      return json(401, { error: 'missing signature headers' });
    }
    const ok = await verifySvixSignature({
      secret:    RESEND_WEBHOOK_SECRET,
      id:        svixId,
      timestamp: svixTimestamp,
      payload:   rawBody,
      signature: svixSignature,
    });
    if (!ok) {
      console.warn('resend-webhook: invalid signature');
      return json(401, { error: 'invalid signature' });
    }
  } else {
    console.warn('resend-webhook: RESEND_WEBHOOK_SECRET not set; accepting unverified event');
  }

  const emailId = event?.data?.email_id;
  if (!emailId) {
    console.warn(`resend-webhook: event ${event.type} has no data.email_id; nothing to update`);
    return json(200, { ok: true, ignored: true });
  }

  // Find the matching row.
  const { data: rows, error: selErr } = await sb
    .from('outreach_sends')
    .select('id, events, open_count, click_count')
    .eq('resend_id', emailId)
    .limit(1);

  if (selErr) {
    console.error('resend-webhook: select failed', selErr);
    return json(500, { error: 'select failed' });
  }
  if (!rows || rows.length === 0) {
    // Resend can fire events for ANY email we send via that API key,
    // including transactional sends that don't have an outreach_sends
    // row. Return 200 so Resend doesn't retry forever.
    console.log(`resend-webhook: no outreach_sends row for resend_id=${emailId}, event=${event.type} (ignored)`);
    return json(200, { ok: true, matched: false });
  }
  const row = rows[0] as { id: string; events: unknown[]; open_count: number; click_count: number };

  // Idempotency: skip if this svix-id has already been recorded.
  const existing = Array.isArray(row.events) ? row.events as Array<Record<string, unknown>> : [];
  if (svixId && existing.some(e => e.svix_id === svixId)) {
    return json(200, { ok: true, duplicate: true });
  }

  const updates = projectEvent(event, row.open_count, row.click_count);

  const { error: updErr } = await sb
    .from('outreach_sends')
    .update({
      ...updates,
      events: [
        ...existing,
        {
          type:       event.type,
          created_at: event.created_at,
          svix_id:    svixId,
          data:       event.data,
        },
      ],
    })
    .eq('id', row.id);

  if (updErr) {
    console.error('resend-webhook: update failed', updErr);
    return json(500, { error: 'update failed' });
  }

  return json(200, { ok: true, updated: true, last_event: updates.last_event });
}

// Map a Resend event to the column-level updates we want to apply.
function projectEvent (event: ResendEvent, openCount: number, clickCount: number): OutreachUpdates {
  const at = event.created_at;
  const u: OutreachUpdates = {
    last_event:    event.type,           // keep the dotted form, e.g. 'email.opened'
    last_event_at: at,
  };

  switch (event.type) {
    case 'email.sent':
      // We already wrote status='sent' at send time; nothing to add.
      break;
    case 'email.delivered':
      u.status       = 'delivered';
      u.delivered_at = at;
      break;
    case 'email.delivery_delayed':
      u.status = 'delivered_delayed';
      break;
    case 'email.opened':
      u.opened_at  = at;                 // first-open semantics on column
      u.open_count = openCount + 1;
      // Don't downgrade status if we've already recorded a click.
      u.status     = 'opened';
      break;
    case 'email.clicked':
      u.clicked_at  = at;
      u.click_count = clickCount + 1;
      u.status      = 'clicked';
      // A click implies an open; backfill opened_at if Resend never
      // sent the open event (some clients block the tracking pixel
      // but the click redirect still fires).
      u.opened_at   = at;
      break;
    case 'email.bounced':
      u.status     = 'bounced';
      u.bounced_at = at;
      break;
    case 'email.complained':
      u.status       = 'complained';
      u.complained_at = at;
      break;
    default:
      // Unknown event type — keep last_event but don't touch status.
      break;
  }

  return u;
}

// ============================================================
// BACKFILL MODE
// ============================================================
async function handleBackfill (req: Request, body: Record<string, unknown>): Promise<Response> {
  // Authenticate: require service-role JWT in Authorization header.
  if (!isServiceRoleAuth(req)) {
    return json(401, { error: 'service-role authorization required for backfill' });
  }
  if (!RESEND_API_KEY) {
    return json(500, { error: 'RESEND_API_KEY not set' });
  }

  // Pick the rows we'll backfill.
  let q = sb
    .from('outreach_sends')
    .select('id, resend_id, recipient_email, last_event')
    .not('resend_id', 'is', null)
    .is('last_event', null);

  const campaignName = typeof body.campaign_name === 'string' ? body.campaign_name : null;
  if (campaignName) {
    q = q.eq('campaign_name', campaignName);
  }

  const { data: rows, error: selErr } = await q;
  if (selErr) {
    console.error('backfill: select failed', selErr);
    return json(500, { error: 'select failed' });
  }
  if (!rows || rows.length === 0) {
    return json(200, { ok: true, scanned: 0, updated: 0 });
  }

  let updated = 0;
  const errors: string[] = [];

  for (const row of rows as Array<{ id: string; resend_id: string; recipient_email: string }>) {
    try {
      const res = await fetch(`https://api.resend.com/emails/${encodeURIComponent(row.resend_id)}`, {
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` },
      });
      if (!res.ok) {
        errors.push(`${row.recipient_email}: HTTP ${res.status} ${await res.text().catch(() => '')}`);
        continue;
      }
      const data = await res.json() as { last_event?: string };
      const lastEvent = data.last_event ?? null;
      if (!lastEvent) continue;

      // Map Resend's bare event names to our dotted form so it
      // matches what the webhook will write going forward.
      const normalised = lastEvent.startsWith('email.') ? lastEvent : `email.${lastEvent}`;
      const at = new Date().toISOString();   // we don't get per-event timestamps from this endpoint

      const update: OutreachUpdates & Record<string, unknown> = {
        last_event:    normalised,
        last_event_at: at,
      };

      switch (lastEvent) {
        case 'delivered':
          update.status       = 'delivered';
          update.delivered_at = at;
          break;
        case 'opened':
          update.status     = 'opened';
          update.opened_at  = at;
          update.open_count = 1;        // best estimate; webhook will correct
          break;
        case 'clicked':
          update.status      = 'clicked';
          update.clicked_at  = at;
          update.opened_at   = at;
          update.click_count = 1;
          update.open_count  = 1;
          break;
        case 'bounced':
          update.status     = 'bounced';
          update.bounced_at = at;
          break;
        case 'complained':
          update.status        = 'complained';
          update.complained_at = at;
          break;
        case 'delivery_delayed':
          update.status = 'delivered_delayed';
          break;
      }

      const { error: updErr } = await sb
        .from('outreach_sends')
        .update(update)
        .eq('id', row.id);
      if (updErr) {
        errors.push(`${row.recipient_email}: ${updErr.message}`);
      } else {
        updated++;
      }
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      errors.push(`${row.recipient_email}: ${msg}`);
    }
  }

  return json(200, {
    ok:       true,
    scanned:  rows.length,
    updated,
    errors:   errors.length > 0 ? errors : undefined,
  });
}

// ------------------------------------------------------------
// Service-role JWT check — accepts the env-var exact-match OR a
// JWT-decode of role='service_role' (per Jake's note: Supabase
// rotates key formats, so exact-match alone is brittle).
// ------------------------------------------------------------
function isServiceRoleAuth (req: Request): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return false;
  if (SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY) return true;
  // JWT decode fallback.
  try {
    const [, payloadB64] = token.split('.');
    if (!payloadB64) return false;
    const padded = payloadB64.padEnd(payloadB64.length + (4 - payloadB64.length % 4) % 4, '=')
                              .replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(padded)) as { role?: string };
    return json.role === 'service_role';
  } catch {
    return false;
  }
}

// ============================================================
// Svix signature verification
// ============================================================
// Resend webhooks use Svix's signing scheme:
//   signed = HMAC-SHA256(secret_bytes, `${id}.${timestamp}.${body}`)
//   header = 'v1,<base64(signed)>' (space-separated if multiple signatures)
//
// The secret comes prefixed with 'whsec_'; the bytes-to-HMAC are the
// base64-decoded payload after that prefix.
async function verifySvixSignature (opts: {
  secret:    string;
  id:        string;
  timestamp: string;
  payload:   string;
  signature: string;
}): Promise<boolean> {
  const secretB64 = opts.secret.startsWith('whsec_') ? opts.secret.slice(6) : opts.secret;
  const keyBytes = base64Decode(secretB64);
  if (!keyBytes) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const toSign = new TextEncoder().encode(`${opts.id}.${opts.timestamp}.${opts.payload}`);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, toSign));
  const expected = base64Encode(sig);

  // Header is a space-separated list of `<version>,<sig>` pairs.
  // Any matching v1 signature counts.
  return opts.signature.split(' ').some(pair => {
    const [version, value] = pair.split(',');
    return version === 'v1' && value === expected;
  });
}

function base64Decode (s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function base64Encode (bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ------------------------------------------------------------
// JSON response helper
// ------------------------------------------------------------
function json (status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
