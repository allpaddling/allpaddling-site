// ============================================================
// supabase/functions/_shared/email.ts
//
// Shared email helpers used by:
//   * supabase/functions/send-email/index.ts (HTTP endpoint)
//   * supabase/functions/stripe-webhook/index.ts (in-process)
//   * any future scheduled job that needs to send a transactional email
//
// Three concerns, kept separate so they can be unit-tested:
//   1. loadTemplate(name)  — read a template's three files from disk
//                            (subject.txt, html.html, text.txt).
//   2. renderTemplate(...) — Mustache-style {{var}} substitution.
//   3. sendEmail({...})    — POST to Resend's /emails endpoint.
//
// And one convenience composition:
//   sendTransactional(name, to, vars) — load + render + send.
// ============================================================

const RESEND_API     = 'https://api.resend.com/emails';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')   ?? '';
const FROM_ADDRESS   = Deno.env.get('EMAIL_FROM')       ?? 'All Paddling <team@allpaddling.com>';
const REPLY_TO       = Deno.env.get('EMAIL_REPLY_TO')   ?? 'mick@allpaddling.com';

// EMAIL_BCC: comma-separated list of addresses to BCC on every outgoing
// email through this helper. Used to give Jake + Mick a permanent paper
// trail of every transactional and migration email sent through Resend.
// Empty / unset = no BCC (older behaviour).
const EMAIL_BCC = (Deno.env.get('EMAIL_BCC') ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ------------------------------------------------------------
// Type definitions
// ------------------------------------------------------------
export interface Template {
  name:    string;
  subject: string;
  html:    string;
  text:    string;
}

export interface SendEmailRequest {
  to:        string | string[];
  subject:   string;
  html:      string;
  text:      string;
  from?:     string;          // override FROM_ADDRESS
  replyTo?:  string;          // override REPLY_TO
  bcc?:      string[];        // override EMAIL_BCC env list
  headers?:  Record<string, string>;
  tags?:     Array<{ name: string; value: string }>;
}

// Whitelisted set of template directory names. Adding one means
// (a) creating the directory under _shared/email-templates/ with
// subject.txt, html.html, text.txt; and (b) adding the name here.
// The whitelist exists so untrusted callers can't read arbitrary
// files via path traversal.
export const TEMPLATE_NAMES = [
  'welcome',
  'payment-receipt',
  'plan-ready',
  'block-delivered',
  'payment-failed',
  'upcoming-renewal',
] as const;
export type TemplateName = typeof TEMPLATE_NAMES[number];

// ------------------------------------------------------------
// 1. Load a template (inlined at deploy time)
// ------------------------------------------------------------
// Templates were originally read from disk via Deno.readTextFile,
// but `supabase functions deploy` only bundles files reachable
// from index.ts via import statements — the .txt and .html assets
// in email-templates/ never made it into the deployed function,
// causing every send to fail with NotFound at runtime.
//
// Now they live as TS string constants in email-templates.gen.ts
// (auto-generated from the source files), so they ship with the
// function automatically.
//
// To edit a template:
//   1. Edit the source file under _shared/email-templates/<name>/
//   2. Regenerate _shared/email-templates.gen.ts
//      (use the python script in outputs/regen_email_templates.sh)
//   3. Redeploy.
import { TEMPLATES } from './email-templates.gen.ts';

export function loadTemplate (name: string): Template {
  if (!(TEMPLATE_NAMES as readonly string[]).includes(name)) {
    throw new Error(`loadTemplate: unknown template "${name}". Whitelist: ${TEMPLATE_NAMES.join(', ')}`);
  }

  const t = TEMPLATES[name];
  if (!t) {
    throw new Error(`loadTemplate: template "${name}" is in whitelist but missing from email-templates.gen.ts (regenerate?)`);
  }

  return { name, subject: t.subject.trim(), html: t.html, text: t.text };
}

// ------------------------------------------------------------
// 2. Render Mustache-style placeholders
// ------------------------------------------------------------
// Replaces every {{var_name}} in the input with vars[var_name].
// If a placeholder has no matching var, the function throws —
// failing loud is better than silently shipping a broken email
// that says "Hi {{member_name}}".
export function renderTemplate (template: Template, vars: Record<string, string | number>): {
  subject: string;
  html: string;
  text: string;
} {
  const apply = (src: string): string => src.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (vars[key] === undefined || vars[key] === null) {
      throw new Error(`renderTemplate: missing variable "${key}" for template "${template.name}"`);
    }
    return String(vars[key]);
  });

  return {
    subject: apply(template.subject),
    html:    apply(template.html),
    text:    apply(template.text),
  };
}

// ------------------------------------------------------------
// 3. Send via Resend
// ------------------------------------------------------------
// Returns the Resend response object on success (which contains
// the message id) or throws on any non-2xx response. The message
// id is logged so it can be cross-referenced in Resend's dashboard.
export async function sendEmail (req: SendEmailRequest): Promise<{ id: string }> {
  if (!RESEND_API_KEY) {
    throw new Error('sendEmail: RESEND_API_KEY env var not set');
  }

  const bccList = req.bcc ?? EMAIL_BCC;
  const body: Record<string, unknown> = {
    from:     req.from    ?? FROM_ADDRESS,
    to:       Array.isArray(req.to) ? req.to : [req.to],
    subject:  req.subject,
    html:     req.html,
    text:     req.text,
    reply_to: req.replyTo ?? REPLY_TO,
    headers:  req.headers,
    tags:     req.tags,
  };
  if (bccList.length > 0) {
    body.bcc = bccList;
  }

  const res = await fetch(RESEND_API, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`sendEmail: Resend returned ${res.status} ${res.statusText} — ${text}`);
  }

  const data = await res.json() as { id: string };
  const toList = (body.to as string[]).join(', ');
  const bccDesc = bccList.length > 0 ? ` (bcc: ${bccList.join(', ')})` : '';
  console.log(`sendEmail: sent to ${toList}${bccDesc} via Resend (id=${data.id}, subject="${body.subject}")`);
  return data;
}

// ------------------------------------------------------------
// Convenience: load + render + send in one call
// ------------------------------------------------------------
export async function sendTransactional (
  templateName: string,
  to:           string | string[],
  vars:         Record<string, string | number>,
  options?:     Pick<SendEmailRequest, 'from' | 'replyTo' | 'headers' | 'tags'>,
): Promise<{ id: string }> {
  const template = loadTemplate(templateName);
  const rendered = renderTemplate(template, vars);

  return sendEmail({
    to,
    subject: rendered.subject,
    html:    rendered.html,
    text:    rendered.text,
    ...(options ?? {}),
  });
}
