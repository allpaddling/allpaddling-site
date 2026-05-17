# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project shape

All Paddling is a coaching site for Mick Di Betta — a static frontend on GitHub Pages plus a Supabase backend (auth, RLS-gated tables, Edge Functions) plus Stripe (live) plus Resend (transactional email). Live at `https://allpaddling.online`.

There is **no build step, no package.json, no test runner, no linter**. Frontend is hand-written HTML/CSS/JS. The "build" pipeline is: edit a file → push to GitHub → GitHub Pages serves it.

The working directory is **not a git checkout** (`git status` will fail). The repo lives at `allpaddling/allpaddling-site` on GitHub, and changes are pushed via the GitHub Git Data API using a PAT at `.claude/secrets/github-pat.txt`. See [HANDOFF.md](HANDOFF.md) for the python push-script template (in the "Push script template" section).

Frontend files live at the **root of both the working directory and the repo** — no `rebuild/` prefix. `login.html` → repo `login.html`, `app/dashboard.html` → repo `app/dashboard.html`. GitHub Pages serves from repo root. Push paths as-is; no stripping needed.

## Canonical session-state docs (READ THESE FIRST)

- [HANDOFF.md](HANDOFF.md) — the bridge between sessions. Top of file is the latest state: paying customers, pending tasks, deployed function versions, open incidents. **Always read the top "LATEST" section before starting work.**
- [ROADMAP.md](ROADMAP.md) — the strategic plan (Track A = build, Track B = migrate the 20 Shopify customers).
- [MICK_AGENDA.md](MICK_AGENDA.md) — Mick's open decisions and the change log of decisions already made.

The state in HANDOFF.md is more current than what you can infer from the code alone — there are paying customers, in-flight migration emails, pending email cadences (Reminder/Last Call), and known data-shape limitations that are not visible in the source.

## High-level architecture

### Frontend

Two-surface layout:

- **`*.html`** — public marketing site (`index.html`, `plans.html`, `custom-plan.html`, `plan-{prone,sup,oc,ski}.html`, `about.html`, `contact.html`, `login.html`, `pace-calculator.html`, etc.)
- **`app/*.html`** — authenticated member + coach area. Member pages: `dashboard.html`, `program.html`, `session.html`, `getting-started.html`, `strength.html`, `threshold.html`, `history.html`, `settings.html`, `onboarding.html`, `welcome.html`. Coach pages share the same directory: `admin.html`, `admin-members.html`, `admin-edit.html`, `admin-overview.html`, `admin-migrate.html`, `admin-custom.html`, `admin-progressive.html`. Both roles see a sidebar with a "switch to other role" pill.

The split between member and coach is **purely runtime**, not by directory. Coach status is determined by the `coaches` allowlist table; non-coach users land on member pages. `assets/admin.js` is loaded by both member and coach pages because it owns shared helpers (`isCurrentUserCoach`, `getCurrentMemberProfile`, etc.).

### Frontend script load order

Every `app/*.html` page loads scripts in this order (relative path is `../assets/`):

1. `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2` (the SDK) — exposes the global `supabase` namespace.
2. `assets/supabase-config.js` — creates `sb`, the project-wide Supabase client.
3. `assets/admin.js` — auth + Progressive plan cache + coach helpers + preview-mode helpers. Loaded **even on member pages** because of the shared helpers.
4. `assets/published-plans.js` — read-only loader for the published Progressive plan (with primer routing). Member-side dashboards use this.
5. `assets/app.js` — sidebar/mobile-header chrome, `mountApp()`, `enforceMemberGates()`.

`mountApp()` (in `app.js`) is the single entrypoint for every `/app/*` page. It renders the sidebar, then asynchronously calls `enforceMemberGates()` (subscription + onboarding redirects) and `renderPreviewBanner()` (yellow "Previewing as X" strip when a coach has toggled preview mode via `setPreviewMode(memberId)`).

### Plan domain model

Two parallel plan systems, both in Supabase:

- **Progressive plans** (`progressive_plans` table) — one row per discipline, keyed by `plan_key ∈ {'prone','sup','oc','ski','primer'}`. Each row carries a draft and a published version (`{meta, programs}` JSON each). Publishing copies draft → published and inserts a row into `progressive_plan_snapshots` (via a `SECURITY DEFINER` trigger — see migration `007`). Members read published; coaches edit draft via `admin-edit.html`. `admin.js` keeps an in-memory cache (`__cache`).
- **Custom plans** (`custom_plans` table) — per-member plan with its own draft/publish lifecycle, currently a single document of nested `programs`. New Custom signups are seeded with the currently-published Primer block on first webhook event. `admin-edit.html` saves drafts; coach clicks Publish to flip `published_at`.

The "primer" plan is a discipline-agnostic 4-week onboarding block shown to every new Progressive member during their first 28 days. `'primer'` MUST appear in `VALID_PLAN_KEYS` in `published-plans.js` (a recurring foot-gun: if it's missing, the loader silently falls back to the prone plan and labels it as primer).

Custom-plan loader for dashboard.html / program.html: previously a known fallback gap, marked resolved 2026-04-29.

### Members and gating

Two member tables (`progressive_members`, `custom_members`) plus a shared `member_profiles` (onboarding answers + `completed_onboarding_at`). The webhook upserts the right member row when Stripe confirms first payment, and ALSO upserts `member_profiles` with `completed_onboarding_at = null` so the onboarding gate fires.

`enforceMemberGates()` in `app.js` is the gate, called from every `/app/*` page via `mountApp()`. It does, in order:
1. Skip if no session, or if the page is `onboarding.html` itself (don't redirect-loop).
2. If user is in `coaches`, bypass everything.
3. **Subscription gate:** if the user has no row in `progressive_members` OR `custom_members` (matched by `auth_user_id` OR `email`), redirect to `/plans.html`.
4. **Onboarding gate:** if `member_profiles.completed_onboarding_at` is null, redirect to `onboarding.html`.

Coaches use a separate "preview as member" mechanism (`setPreviewMode(memberId)` in `admin.js` + `renderPreviewBanner()` in `app.js`) — this is sessionStorage-based and overrides `getEffectiveMemberProfile()` / `getEffectiveAuthUserId()`. It's how Mick eyeballs what a member sees without signing out.

### Backend (`supabase/`)

- **`supabase/migrations/*.sql`** — numbered migrations, source of truth for the schema. Apply via Supabase Studio SQL editor (project ref `crlukzkgmydyqpwndjvc`). Conventions in `supabase/README.md`: idempotent where reasonable, RLS enabled on every new table, never edit a migration after it's applied — add a follow-up.
- **`supabase/functions/`** — Deno Edge Functions. Three live ones plus `_shared/`:
  - `create-checkout-session` — Stripe Checkout URL generator. Three modes (SELF / ANON / MIGRATE), keyed by auth shape. See the comment block at the top of `index.ts` for the full mode table.
  - `stripe-webhook` — Stripe → Supabase mirror. Handles `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated/deleted`. Writes `subscriptions` + member rows + `member_profiles`. Idempotent via `webhook_events` table.
  - `send-email` — coach-JWT or service-role caller; supports both templated mode (`template + vars`) and raw mode (`subject/text/html` directly, used by admin-migrate). All sends BCC the `EMAIL_BCC` env var addresses.
  - `contact-form` — public contact form handler, honeypot-protected.
  - `_shared/email.ts` — Resend wrapper used by webhook + send-email + contact-form. **All three need a redeploy when `_shared/email.ts` changes.**
  - `_shared/email-templates/` — source `subject.txt` / `html.html` / `text.txt` per template kind. Generated into `_shared/email-templates.gen.ts` via `supabase/scripts/regen-email-templates.sh` — run after editing any template.

- **`supabase/scripts/`** — operational scripts (Deno + bash). The important ones:
  - `setup-stripe-products-live.sh` — creates Stripe Products + canonical Prices in live mode. Idempotent.
  - `migration-runner-live.sh` / `migration-runner.ts` — batch generator that calls `create-checkout-session` in MIGRATE mode for each pending row in `migration_customers`, renders the email body, writes a JSON file. `--only-email <addr>` for single-row test runs, `--dry-run` to skip Stripe calls.
  - `regen-email-templates.sh` — regenerate `email-templates.gen.ts` after any template edit.

### Schema highlights

Tables (each defined in a migration under `supabase/migrations/`):

- `coaches` — allowlist; presence of an email here grants admin access.
- `progressive_members` / `custom_members` — paid members, keyed by `auth_user_id` (and `email` for legacy/manually-added rows). `custom_members.auth_user_id` is mandatory on the webhook upsert (a missing-`auth_user_id` bug cost us an incident — see HANDOFF.md history).
- `member_profiles` — onboarding answers (`preferred_name`, `family_name`, race goal, ability, training hours, `completed_onboarding_at`). Created lazily by webhook with nulls so the onboarding gate fires.
- `progressive_plans` / `custom_plans` — plans (draft + published).
- `progressive_plan_snapshots` — published-version history; populated by a `SECURITY DEFINER` trigger.
- `subscriptions` — mirror of Stripe subscription state.
- `webhook_events` — per-event idempotency log.
- `migration_customers` — the 21 Shopify customers being migrated. `migration_status` cycles through `pending → heads_up_sent → signup_link_sent → urgent_signup_sent → reminder_sent → last_call_sent → signed_up → shopify_cancelled → migrated`, plus `lapsed` and `on_hold`.

## Common operations

### Deploy an Edge Function

```bash
supabase functions deploy <name> --project-ref crlukzkgmydyqpwndjvc [--no-verify-jwt]
```

**`stripe-webhook` MUST always be deployed with `--no-verify-jwt`** — Stripe is not a Supabase user and doesn't send a JWT. If `verify_jwt` is true, every Stripe delivery 401's at the gateway before the handler runs. Same applies to `contact-form`. `send-email` is `verify_jwt: true` (correct — it accepts coach JWT or service-role).

After editing `_shared/email.ts` or any template source, redeploy ALL three functions that import it: `stripe-webhook`, `send-email`, `contact-form`.

### Apply a database migration

Until the Supabase CLI is wired up: paste the SQL from `supabase/migrations/<file>.sql` into Supabase Studio's SQL editor (project `crlukzkgmydyqpwndjvc`) and Run. Migration files are the source of truth; production is a target.

### Push code changes

There is no `git push` here — the working directory is not a git checkout. Use the GitHub Git Data API pattern documented at the bottom of [HANDOFF.md](HANDOFF.md). Single commit per logical change, multiple files OK in one tree. File paths are the same locally and in the repo — no prefix stripping needed. Confirm the PAT first:

```bash
PAT=$(cat .claude/secrets/github-pat.txt | tr -d '\n')
curl -sS -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/allpaddling/allpaddling-site \
  | head -c 300
```

`raw.githubusercontent.com` is **not** on the egress allowlist — to read a file from the repo, use the `api.github.com/repos/.../contents/{path}?ref=main` endpoint.

### Local "test"

There is no test suite. Verification is end-to-end against live Supabase + Stripe (test mode for new flows, live for migration). Smoke-test pattern:

1. Insert a fresh test row in `migration_customers` with a `+migtestN` email and A$1.
2. Run `bash supabase/scripts/migration-runner-live.sh --only-email <addr>`.
3. Click the JSON output's `signup_link`, complete A$1 checkout.
4. Verify in coach admin (`/app/admin-members.html`) and in the new member's session.
5. Cleanup: refund A$1 in Stripe, delete the test row + auth user (delete pattern in HANDOFF.md morning brief section).

For UI-only changes you can serve the frontend locally with any static server (`python3 -m http.server` from the working directory root) and exercise the flows against the live Supabase project.

## Hard-won rules (from past incidents)

- **Verify before claiming.** Every factual claim about state — function metadata, DB rows, deployed version — needs a verifying tool call (Chrome MCP into Supabase Studio, a SQL select, a `supabase functions list` call) before stating it. Past sessions have burned hours on guessed assertions.
- **`stripe-webhook` deploy without `--no-verify-jwt` is a P0 incident.** It silently 401's every Stripe delivery at the gateway, so `webhook_events` shows zero rows and members don't materialise. Always include the flag; verify `verify_jwt: false` in the function metadata after deploy.
- **No `rebuild/` prefix anywhere.** Frontend files live at root in both the working directory and the repo. `login.html` is `login.html`. The old `rebuild/` convention was eliminated 2026-05-17.
- **Don't edit a migration after it's applied to prod.** Add a follow-up migration. Migrations should be idempotent (`if not exists`, `drop ... if exists`).
- **Anon key in `supabase-config.js` is intentional and safe** — it's a public key and RLS enforces real access control on the server. Don't "fix" this.
- **Inline `price_data` in MIGRATE mode is intentional** — it lets us apply per-customer goodwill discounts without touching the price catalog. Per Mick's Decision B (2026-04-27), all migrating customers are reset to uniform pricing (A$140 Custom / A$80 Progressive), no grandfathering, but the inline mechanism stays.

## Useful URLs

- Supabase project: https://supabase.com/dashboard/project/crlukzkgmydyqpwndjvc
- Stripe webhook endpoint: https://crlukzkgmydyqpwndjvc.supabase.co/functions/v1/stripe-webhook
- Live site: https://allpaddling.online
- GitHub repo: https://github.com/allpaddling/allpaddling-site
- Old site (still serving Shopify customers until migration completes): https://allpaddling.com
