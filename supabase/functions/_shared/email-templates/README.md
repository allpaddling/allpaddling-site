# Transactional email templates

These are the email bodies sent by the All Paddling backend in response to subscription lifecycle events (Stripe webhooks, scheduled jobs). They land in `supabase/functions/_shared/email-templates/` so the future `send-email` Edge Function can read and render them.

Status: live. The `welcome` template has been delivered end-to-end via Resend (verified domain `allpaddling.online`, EMAIL_FROM = `Mick at All Paddling <mick@allpaddling.online>`). All other templates are wired to their webhook events but haven't fired in production yet (no `invoice.paid`, `invoice.payment_failed`, or scheduled block-delivered events have happened with a real subscription).

**Important:** at deploy time, `supabase functions deploy` does NOT bundle non-`.ts` files. The HTML/text/subject files are inlined into `email-templates.gen.ts` by `supabase/scripts/regen-email-templates.sh` — that generated file is the runtime source of truth. After editing any file in this folder, regenerate before deploying:

```bash
./supabase/scripts/regen-email-templates.sh
supabase functions deploy send-email --no-verify-jwt --project-ref crlukzkgmydyqpwndjvc
```

## Folder layout

Each template lives in its own folder and ships three files:

```
<template-name>/
  subject.txt   — single line, may contain placeholders
  html.html     — full HTML email (mobile-responsive, inline-styled)
  text.txt      — plain-text fallback for clients that prefer it
```

Templates included:

| Folder | When it fires | Triggered by |
|---|---|---|
| `welcome` | Account created (first checkout completed) | webhook: `checkout.session.completed` |
| `payment-receipt` | Invoice paid (every 4-week cycle) | webhook: `invoice.paid` |
| `plan-ready` | Mick publishes the member's first block | manual trigger or admin action |
| `block-delivered` | Next block boundary reached, content unlocked | scheduled job (§2.5) |
| `payment-failed` | Card declined | webhook: `invoice.payment_failed` |
| `upcoming-renewal` | 3 days before next 4-week renewal | scheduled job |

## Placeholder syntax

Resend's Mustache-style `{{variable}}` substitution. The send-email function passes a `vars` object whose keys match the placeholders in the template.

Common placeholders used across templates:

```
{{member_name}}            preferred name (falls back to first part of email)
{{member_email}}           the recipient's email address
{{plan_name}}              "Custom Season Race Plan" or "Progressive SUP Plan", etc.
{{plan_url}}               https://allpaddling.online/app/program.html (dashboard for paid members)
{{settings_url}}           https://allpaddling.online/app/settings.html (billing/cancel)
{{login_url}}              https://allpaddling.online/login.html
{{coach_name}}             "Mick"
{{support_email}}          "hello@allpaddling.online" (Cloudflare-routed → dibetta1@gmail.com)
```

Template-specific placeholders are listed at the top of each `html.html` as an HTML comment.

## Brand & design conventions

- **Width:** 600px max, fluid on mobile.
- **Colors:** brand teal `#155e75` for accent + CTA. Body text `#0f172a`. Muted `#475569`/`#64748b`. Surface `#ffffff` on `#f1f5f9` backdrop.
- **Fonts:** system-ui stack — no web fonts (most clients block them anyway).
- **Layout:** HTML tables (the only layout primitive that survives Outlook).
- **Styling:** inline only. The `<head><style>` block is reserved for `@media` queries (mobile + dark-mode), which the major modern clients honour and old clients ignore harmlessly.
- **CTAs:** rendered as a styled `<a>`-as-button. No `<button>` elements (Outlook breaks them).
- **Preheader:** every template starts with a hidden preheader div — that's the gray preview text shown next to the subject line in the inbox list. Keep it under ~90 characters.
- **Footer:** every template ends with the same brand footer + a "reply to reach Mick" line. Members appreciate that emails come from a real person.

## Known unknowns / future polish

- **Brand mark.** The header currently uses a small colored square placeholder. Replace with the actual brand mark — either inline SVG, or a hosted PNG (more compatible: Outlook renders inline SVG inconsistently).
- **Unsubscribe.** Transactional emails are technically exempt from CAN-SPAM/GDPR unsubscribe requirements, but adding "manage your preferences" linking to `{{settings_url}}` is good practice and most providers expect a `List-Unsubscribe` header.
- **Localisation.** Single language (English/AU spelling) for now.
