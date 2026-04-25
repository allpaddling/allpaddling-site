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
// 1. Load a template from disk
// ------------------------------------------------------------
// Templates live next to this file in _shared/email-templates/.
// import.meta.url resolves to the deployed location of email.ts,
// so the URL math is correct in both local `supabase functions
// serve` and remote `supabase functions deploy`.
//
// Throws if the template name isn't whitelisted, or if any of the
// three files can't be read.
export async function loadTemplate (name: string): Promise<Template> {
  if (!(TEMPLATE_NAMES as readonly string[]).includes(name)) {
    throw new Error(`loadTemplate: unknown template "${name}". Whitelist: ${TEMPLATE_NAMES.join(', ')}`);
  }

  const baseUrl = new URL(`./email-templates/${name}/`, import.meta.url);

  const [subject, html, text] = await Promise.all([
    Deno.readTextFile(new URL('subject.txt', baseUrl)),
    Deno.readTextFile(new URL('html.html', baseUrl)),
    Deno.readTextFile(new URL('text.txt', baseUrl)),
  ]);

  // subject.txt is one line — trim trailing newline / whitespace.
  return { name, subject: subject.trim(), html, text };
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

  const body = {
    from:     req.from    ?? FROM_ADDRESS,
    to:       Array.isArray(req.to) ? req.to : [req.to],
    subject:  req.subject,
    html:     req.html,
    text:     req.text,
    reply_to: req.replyTo ?? REPLY_TO,
    headers:  req.headers,
    tags:     req.tags,
  };

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
  console.log(`sendEmail: sent to ${body.to.join(', ')} via Resend (id=${data.id}, subject="${body.subject}")`);
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
  const template = await loadTemplate(templateName);
  const rendered = renderTemplate(template, vars);

  return sendEmail({
    to,
    subject: rendered.subject,
    html:    rendered.html,
    text:    rendered.text,
    ...(options ?? {}),
  });
}
