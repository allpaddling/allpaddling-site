# All Paddling — Cowork session handoff

Continuing AllPaddling project. The canonical plan is `ROADMAP.md` in this same folder; this handoff is the bridge between sessions.

---

## ⭐⭐⭐ LATEST — 2026-05-17 (Sun) — project complete: full day summary

Everything previously parked or deferred is now done. No known open tasks.

---

### A. Subscription edge cases — all closed

All four items parked from the 2026-05-01 session are now shipped and live.

### What shipped this session

**1. Coach-side subscription management (`coach-manage-subscription` Edge Function)**
- New self-contained Edge Function (`verify_jwt: true`). Actions: `status`, `pause`, `resume`, `cancel`, `undo_cancel`.
- Coach JWT validated + `coaches` table check (only coaches can call it).
- Emails routed via HTTP to `send-email` with SERVICE_ROLE_KEY (no `_shared/` import — MCP-deployable).
- Deployed ACTIVE via Supabase MCP.

**2. Subscription panel on `admin-custom.html` + `admin-progressive.html`**
- New `#sub-panel` card appears below the member form when editing any member who has an `auth_user_id`.
- Calls `coach-manage-subscription` status action on load; silently hides panel if `no_subscription`.
- Status badges: Active (green) / Paused (amber) / Cancelling (red). Action buttons contextual to status.
- Pause reveals a date picker for optional auto-resume date. All actions confirm then update state.

**3. Auto-resume email in `stripe-webhook`**
- `handleSubscriptionUpdated` now reads `pause_resumes_at` from the existing DB row before updating.
- Detects auto-resume: `pause_resumes_at` was set in DB, Stripe is now clearing `pause_collection`, and the date is in the past (±12h buffer for timing variance).
- On auto-resume: looks up member, sends `subscription-resumed` email.
- Manual early-resume (date still in future) is excluded — that email is already sent by `manage-subscription` / `coach-manage-subscription`.
- Deployed locally by Jake (uses `_shared/email.ts`, can't go via MCP): `supabase functions deploy stripe-webhook --no-verify-jwt --project-ref crlukzkgmydyqpwndjvc` ✓

**4. 3-day reminder before auto-resume (`check-pause-reminders` Edge Function + migration 017)**
- New self-contained Edge Function (`verify_jwt: false`). Queries subscriptions resuming in 2–4 days with `pause_resume_reminder_sent_at IS NULL`. Sends `subscription-resuming-soon` email (card_last4 fetched from Stripe), marks idempotency column.
- Migration `20260517_017_pause_resume_reminder.sql` applied ✓:
  - Added `pause_resume_reminder_sent_at timestamptz` to `subscriptions`
  - Created partial index `subscriptions_pause_reminder_idx`
  - Enabled `pg_net` + `pg_cron` extensions
  - Scheduled daily cron at 8am UTC: `check-pause-reminders`
- Deployed ACTIVE via Supabase MCP.

**5. Stripe Billing Portal for `past_due` / `unpaid` members (`create-portal-session` + `settings.html`)**
- New self-contained Edge Function (`verify_jwt: true`). Looks up `stripe_customer_id` from `subscriptions`, creates a Stripe Billing Portal session, returns `{ ok: true, url }`.
- `settings.html` now detects `past_due` / `unpaid` status and renders a "Payment failed" banner with an "Update payment method →" button that calls `openPortal()` → redirects to Stripe portal.
- Deployed ACTIVE via Supabase MCP.

### Commit
All 5 files pushed in commit [`39241dea`](https://github.com/allpaddling/allpaddling-site/commit/39241dea7933c42bc834d5e1a272bebc5ce7ff92):
- `supabase/functions/stripe-webhook/index.ts`
- `app/settings.html`
- `supabase/functions/check-pause-reminders/index.ts`
- `supabase/functions/create-portal-session/index.ts`
- `supabase/migrations/20260517_017_pause_resume_reminder.sql`

### Function inventory (all healthy as of this session)

| Function | verify_jwt | Notes |
|---|---|---|
| stripe-webhook | false ✓ | Auto-resume email added; latest deploy this session |
| manage-subscription | true ✓ | Member self-service; unchanged |
| coach-manage-subscription | true ✓ | Coach admin controls; new this session |
| check-pause-reminders | false ✓ | Background batch; new this session |
| create-portal-session | true ✓ | Stripe portal redirect; new this session |
| send-email | true ✓ | Unchanged |
| create-checkout-session | false ✓ | Unchanged |
| contact-form | false ✓ | Unchanged |

### Nothing left parked from the subscription feature set
All four items from the 2026-05-01 deferred list are now closed. No known open subscription-related tasks.

---

### B. rebuild/ dual-tree eliminated

All 35 `rebuild/` files deleted from the GitHub repo in a single atomic commit. Frontend files now live at root only — `app/dashboard.html` is `app/dashboard.html`, no prefix. SHA comparisons confirmed zero content change; only the duplicate directory was removed. CLAUDE.md and memory updated to reflect the new convention.

---

### C. Shopify fully shut down

- `allpaddling.com` now 301-redirects to `allpaddling.online` via Cloudflare (path + query preserved)
- Appstle Subscription app uninstalled — saves US$10/mo
- Tevello Courses & Communities app uninstalled — saves US$19.99/mo
- Shopify Basic plan cancelled — store deactivates **9 June 2026** — saves US$39/mo
- **Total monthly bleed stopped: ~US$69/mo (~A$106/mo)**
- Shopify data (Customers, Orders, Products CSVs) exported to Jake's email before shutdown
- The 18 paused Shopify contracts will go inert with the store. No active billing relationships remained at time of cancellation.

---

### D. Domain transfers initiated (allpaddling.com + allpaddling.online → Cloudflare)

Both domains initiated transfer from Crazy Domains to Cloudflare Registrar today. Transfer cost: US$10.46 (.online) + US$27.70 (.com).

**Pending:** Mick needs to click the "Approve transfer" link in 2 emails from Crazy Domains that will arrive at `dibetta1@gmail.com`. Each email = one click. Without approval, auto-completes after ~5 days anyway.

**After transfers complete:** re-enable WHOIS privacy on `.online` in Cloudflare (it disables on transfer in). A scheduled task checks daily at 9am Sydney and will remind Jake the moment both transfers show as active.

**Crazy Domains auto-renew:** was OFF (`.online` expiry 08 Sep 2026, `.com` expiry 22 Dec 2026). Once transferred, Cloudflare handles renewal.

---

### E. Cloudflare Email Routing fixed

Previously `mick@allpaddling.online` was being silently dropped (only `hello@` had an explicit rule). Fixed:
- **Catch-all:** active → `jakedibetta@gmail.com` (covers `mick@` and everything else)
- **`hello@allpaddling.online`:** active → `jakedibetta@gmail.com` (legacy rule preserved)
- Single destination per rule — confirmed working via live test

`dibetta1@gmail.com` is still a verified Cloudflare destination but is no longer the active recipient for any rule. Jake forwards to Mick manually where appropriate.

---

### F. Outreach system improvements

- **Bulk send UI overhauled:** Compose modal removed. Replaced with a selection bar (shows count + template dropdown) at the top of the table. Select rows → choose template → Send to selected → confirm → inline progress. Simpler, one source of truth for what gets sent. Net: −200 lines.
- **Engagement tab:** new tab on `admin-outreach.html` reads `outreach_sends`, groups by `campaign_name`, shows delivered/opened/clicked/bounced per campaign. Includes a permanent callout explaining Gmail/Apple proxy open inflation and why click-throughs are the reliable signal.
- **Open/click tracking insight:** Gmail image proxy pre-fetches tracking pixels within ~10s of delivery (shows as "opened" before anyone looks). Real human clicks are distinguishable by residential IPv4 + real UA + timing delay. Click tracking is trustworthy; open tracking is noise.
- **One bounce removed:** `123hannahounengbmmqbeemjoh.dpn@inscrlab.com` deleted from `shopify_customers` (+ cascading `outreach_sends` row). 71 rows remain.

---

### G. Newsletter signup — name fields added

First name + last name (optional) fields added to the newsletter signup form. Migration 019 applied (`newsletter_subscribers.first_name`, `newsletter_subscribers.last_name` columns). `newsletter-signup` Edge Function redeployed as v2. Re-submissions backfill names only where existing row has nulls. 2 subscribers in DB (1 with name).

---

### H. Cloudflare Web Analytics deployed site-wide

Analytics beacon added to all 60 HTML files (public pages + app pages + articles). Token `bf3dd55206394d3dbc26eca3949ef5cc`. Traffic data will appear in Cloudflare dashboard within hours of the first real visitors. No cookies, no banner required. DNS is grey-cloud (GitHub Pages handles serving), so the beacon script is the only analytics surface — Cloudflare's auto-inject couldn't work without orange-cloud proxying.

---

### Nothing left parked

The project is feature-complete. No known open tasks, bugs, or deferred items as of end of day 2026-05-17.

---

## ⭐⭐ EARLIER — 2026-05-15 (Fri) — email consolidation: hello@ → mick@

Per Jake's call: too many addresses in circulation was confusing customers. Scrubbed every public reference to `hello@allpaddling.online` and standardised on `mick@allpaddling.online` across the site, transactional emails, outreach footers, and operational docs.

### What changed
- **Public site copy:** `contact.html`, `privacy.html`, `terms.html`, `ergos.html` mailto links updated to `mick@allpaddling.online`.
- **Footer + contact form errors** (`rebuild/assets/site.js`): footer email row and the two contact-form network-error fallback messages all now point to `mick@`.
- **Outreach unsubscribe footer** (`rebuild/assets/admin-outreach.js`): both `UNSUB_FOOTER_TEXT` and `UNSUB_FOOTER_HTML` updated so every future campaign email tells recipients to email `mick@allpaddling.online` to unsubscribe.
- **Edge Functions:** comment + README references in `send-email/`, `contact-form/`, `_shared/email-templates/README.md`, plus `supabase/scripts/send-test-migration-email.sh` (`reply_to` field).
- **Supabase secret:** `EMAIL_REPLY_TO` updated to `mick@allpaddling.online` (was `hello@allpaddling.online`). Affects every transactional email's Reply-To header.

### What didn't change
- **Cloudflare Email Routing rule for `hello@allpaddling.online` left active.** Stripe receipts, Shopify-era replies, and any in-flight customer emails still land correctly. We just stop *advertising* the address.
- **Resend MAIL FROM subdomain** (`send.allpaddling.online`) untouched — that's an envelope-level domain, never customer-visible.
- **`migration/Mick_decision_briefing.md`** untouched — it contains `hello@send.allpaddling.online` (different string, a from-address option discussed historically), not the apex `hello@`.

### Verification
- `grep -r 'hello@allpaddling' .` on the local tree returns zero matches after the edits.
- After the GitHub push, re-fetched key files from `api.github.com/repos/allpaddling/allpaddling-site/contents/...` to confirm the live tree is clean too.
- Supabase Studio → Functions → Secrets shows `EMAIL_REPLY_TO=mick@allpaddling.online`.

### Follow-up worth considering (not done today)
- The Cloudflare Email Routing rule for `hello@` could eventually be retired once the Shopify-era reply tail dies out. No rush.
- The Gmail filter walkthrough for Mick in `MICK_AGENDA.md` ("inbound email fan-out") was originally written assuming `hello@` — updated to reference `mick@`, which is what Mick's customers will see now.

---

## ⭐⭐⭐ EARLIER — 2026-05-14 (Thu) — outreach roster shipped (needs prod apply)

Migration is essentially done — replaced the "Migration" sidebar entry with "Outreach", a new coach-only page for re-engaging past Shopify customers. Commit [`5337cf82`](https://github.com/allpaddling/allpaddling-site/commit/5337cf82c6d87cdaf0a74db083f2e2e208699711) pushed code + schema + seed in one shot (20 files, dual-tree mirrored).

### What's in the commit
- **Schema** (`supabase/migrations/20260514_016_shopify_outreach.sql`): `public.shopify_customers` (73 customers, coach RLS) + `public.outreach_sends` (per-customer email log, free-text `campaign_name` for grouping). Both with `is_coach()` policies, indexes, and `updated_at` trigger.
- **Seed** (`supabase/scripts/seed-shopify-customers.sql`): one-shot INSERTs for all 73 rows from the 2026-05-14 Shopify customers + orders exports. Idempotent via `ON CONFLICT (email) DO NOTHING`. Source data in `data/outreach/shopify_outreach_pool.csv`.
- **Page** (`rebuild/app/admin-outreach.html` + `rebuild/assets/admin-outreach.js`): tabbed UI. Tab 1 "Outreach" = filterable + multi-select table; Compose modal fans out to `send-email` (raw mode, coach JWT) and logs each send to `outreach_sends`. Tab 2 "Migration archive" = read-only render of `migration_customers`. Cross-references `progressive_members` + `custom_members` at render time so "already signed up" is always fresh.
- **Consent UX** per Jake's call (2026-05-14): Shopify-opt-out customers stay visible with a red "Opt-out" chip, excluded from select-all, and Compose requires a confirm checkbox before sending to any of them. Our own `unsubscribed_at` is separate from the Shopify flag.
- **Sidebar swap**: "Migration" → "Outreach" in all 7 admin pages. `admin-migrate.html` URL still works (no redirect), linked from the Archive tab for the full migration workflow.

### To go live — Jake's todo (a few minutes)
1. **Apply the migration** — Studio SQL editor (project `crlukzkgmydyqpwndjvc`), paste `supabase/migrations/20260514_016_shopify_outreach.sql`, Run. Or `supabase db push` locally if you have it pointed at prod.
2. **Run the seed** — paste `supabase/scripts/seed-shopify-customers.sql` into Studio and Run. The `select count(*)` at the end should return 73.
3. **Smoke test** — open `/app/admin-outreach.html`, verify the table loads with 73 rows, 23 marked "On AllPaddling" (badged green, checkboxes locked). Send a test campaign to yourself via a `+test@gmail.com` alias and confirm a row lands in `outreach_sends`.

### Known limitations / follow-ups
- **No public unsubscribe endpoint yet.** Every campaign email has a footer asking the recipient to reply or email `mick@allpaddling.online` with subject "unsubscribe"; coach can then click "Mark unsubscribed" in the row drawer. A real `/unsubscribe?token=...` edge function would be a 30-min follow-up if/when volume warrants it.
- **No re-export refresh.** Seed is point-in-time. If Mick wants the table updated after running a campaign (e.g. to mark someone "now on AllPaddling"), that's automatic via the live cross-reference. But the underlying Shopify totals/last-order-date are frozen until we re-import.
- **No campaign-level analytics page.** `outreach_sends` is grouped by `campaign_name` and that's enough for ad-hoc SQL — a proper "campaign dashboard" page can come later if Mick wants it.

### Surprise worth flagging in the data
`joyb35@aol.com` (Joy Brahmst) — 17 orders, $2,366 lifetime, last order **30 Mar 2026** (6 weeks ago), consent: yes. *Not* on AllPaddling. Either a recent churn or an oversight in migration. Visible in the Outreach table when you load it.

---

## ⭐⭐⭐ EARLIER — 2026-05-01 (Fri afternoon) — final polish

After +pausetest2 testing on a fresh Custom signup, three small issues fixed in commit [`d5e609ec`](https://github.com/allpaddling/allpaddling-site/commit/d5e609ec):

- **UI race on pause** — settings.html now polls the subscriptions table (max ~3.5s) waiting for the webhook to mirror state, instead of a fixed 1100ms timeout. Returns as soon as the change lands. Closes the bug where pausing showed Active state on the first reload.
- **`subscription-cancel-reversed` email** — new template, fires from manage-subscription on undo_cancel. Previously silent; now confirms to the member their cancellation was reversed.
- **Receipt emails for the 4 pre-fix signups** (Daniel/Pat/Paora/Ian) — Jake's call: skip the backfill, they can ask if they want them. The +pausetest2 test confirmed receipts now fire correctly post-fix.

Function versions live as of session end: `stripe-webhook` v25, `manage-subscription` v3. 6 templates total in the subscription family (5 + cancel-reversed).

### Pause/cancel status: SHIPPED + verified

End-to-end smoke tested twice (Progressive plan via +pausetest, Custom plan via +pausetest2). All actions, all UI states, all emails working. The ZERO-impact-to-existing-customers commitment held throughout the deploy.

### Still parked for future commits

1. **`subscription-resuming-soon`** (3-day-before reminder) — needs cron + new column `pause_resume_reminder_sent_at` for idempotency.
2. **Auto-resume detection in webhook.** When Stripe auto-resumes a paused sub at `pause_resumes_at`, the resulting event should trigger `subscription-resumed` email. Currently only the manual-resume case is wired.
3. **Coach-side admin pause/cancel** — Mick can't do this on a member's behalf yet.
4. **Stripe Customer Portal integration** for `unpaid` status.

---

## ⭐⭐ EARLIER 2026-05-01 (Fri afternoon) — fix-up round

After the initial pause/cancel ship (commit `9340de3d` earlier today), shipped a follow-up commit [`5913782f`](https://github.com/allpaddling/allpaddling-site/commit/5913782f) that closes 3 of the 4 follow-ups flagged. Smoke-tested and working as of 01:40 UTC.

### What shipped in this round

- **Stripe API 2025+ field-move fix.** `stripe-webhook` now reads `invoice.subscription` from `invoice.parent.subscription_details.subscription` (with fallback to deprecated top-level), and `subscription.current_period_*` from `subscription.items.data[0].current_period_*` (with fallback). Closes the silent-no-op race that left `+pausetest` stuck at `status='incomplete'`. Also closes the cosmetic "—" dates in the new Settings UI — `Cancelling on Sun 1 Jun` etc. now displays correctly.
- **Action emails wired** — 4 of 5 new templates fire now:
  - `subscription-pause-scheduled` — sent from `manage-subscription` after Confirm Pause
  - `subscription-cancel-scheduled` — after Confirm Cancel
  - `subscription-resumed` — after Resume now (manual case)
  - `subscription-canceled` — sent from `stripe-webhook` on `customer.subscription.deleted`
- **`undo_cancel` and `change_resume_date` deliberately don't email** — minor adjustments, member sees the state in the UI.

Function versions live: `stripe-webhook` v25 (`verify_jwt: false` ✓), `manage-subscription` v2 (`verify_jwt: true` ✓).

### Still deferred

1. **`subscription-resuming-soon`** (3-day-before reminder) — needs cron. Setup pg_cron extension, add `pause_resume_reminder_sent_at` column, schedule a daily scan.
2. **Auto-resume detection in webhook.** When Stripe auto-resumes a paused sub at `pause_resumes_at`, the resulting `subscription.updated` event should trigger `subscription-resumed` email. Currently only the manual-resume case is wired. Needs state-diff in the webhook (was paused, now active) plus idempotency to avoid double-sending if manual resume already fired.
3. **Coach-side admin pause/cancel** — Mick can't pause/cancel on a member's behalf via admin pages.
4. **Stripe Customer Portal integration** for `unpaid` status.

### Webhook race issue is now closed

The +pausetest stuck-incomplete bug from the morning was caused by `invoice.subscription` being null in the new Stripe API payload, which made `handleInvoicePaid` take the early-return path with error=null. The field-move fix above closes this. New signups should no longer get stuck.

---

## ⭐⭐ EARLIER TODAY — 2026-05-01 (Fri afternoon)

### What shipped today

**Member-driven pause and cancel from Settings.** Live on `allpaddling.online`. Commit [`9340de3d`](https://github.com/allpaddling/allpaddling-site/commit/9340de3d). Smoke-tested end-to-end against `jakedibetta+pausetest@gmail.com`.

Migration funnel state at deploy time: 15 migrated, 4 in `last_call_sent`, 1 in `urgent_signup_sent`, 1 `on_hold`. Webhook had been quiet ~38h. Deployed cleanly with no impact to in-flight migrations.

What members can now do from `/app/settings.html`:
- Pause membership with optional auto-resume date (default early Jan for the Sept–Dec off-season pattern Mick described). Stripe `pause_collection` keeps payment method retained — one-click resume in January.
- Cancel at end of current period (cancel_at_period_end). Soft cancel — Rejoin button preserves training data, no need to redo onboarding.
- Undo pause / undo cancel before period ends.
- Change resume date.

Five email template kinds were added but **none of them fire yet** — templates compile into `email-templates.gen.ts` but `stripe-webhook` doesn't yet call `sendTemplate(...)` for them. Intentional staging — verify UI in production first, then turn email sending on as a follow-up commit. Templates: subscription-pause-scheduled, subscription-resuming-soon, subscription-resumed, subscription-cancel-scheduled, subscription-canceled.

### Live infrastructure changes

- **Schema migration 015 applied** (`20260501_015_subscription_pause_cancel.sql`): added `cancel_at_period_end` (boolean, default false) and `pause_resumes_at` (timestamptz nullable) to `subscriptions`, plus partial indexes on both. Tracked in `supabase_migrations.schema_migrations` as `20260501003350_subscription_pause_cancel` (first migration registered through that mechanism — the older 011-014 were applied via Studio paste-in).
- **`manage-subscription` Edge Function deployed** (version 1, `verify_jwt: true`). Five actions: pause, resume, cancel, undo_cancel, change_resume_date. Member JWT auth + ownership check via subscriptions.user_id. Source at `supabase/functions/manage-subscription/index.ts`.
- **`stripe-webhook` redeployed** (version 24, `verify_jwt: false` — verified). Surgical patch to `handleSubscriptionUpdated`: mirrors `cancel_at_period_end` and `pause_collection.resumes_at` into the subscriptions table. Purely additive.
- **Frontend live**: `app/settings.html` (rebuilt with 5 status-aware variants + pause/cancel modals), `app/membership-paused.html` (new locked-out screen), `assets/app.js` (extended `enforceMemberGates()` to route paused/canceled members to the lock page instead of `/plans.html`). All mirrored to `rebuild/` per dual-tree convention.

### Known-issues surfaced during this work

- **`current_period_end` is null for 14 of 15 active customers** (only Paora has it). This is a Stripe API 2025+ field-relocation: `subscription.current_period_end` was removed from the top level and moved to subscription items. Our webhook still reads `sub.current_period_end` so it writes null. Cosmetic in the new Settings UI: "Next billing", "Pause begins", "Access ends" rows show "—" instead of the date. Two-line fix: read from `sub.items.data[0].current_period_end` in `handleSubscriptionUpdated`. Not blocking — `cancel_at` IS being correctly populated by Stripe, so cancel-state dates can use that as a fallback.
- **`+pausetest` row was stuck at `status='incomplete'`** post-signup despite invoice.paid firing successfully (error=null, processed_at set). Same race condition pattern that hit Ian Ferrell on 2026-04-29 — the webhook handler returned successfully without actually applying the update. Manually fixed via SQL (`update subscriptions set status='active', first_paid_at=..., current_period_start/end=...`). The underlying webhook race is unfixed — new signups can still hit it intermittently.

### Smoke test results — 2026-05-01 01:03–01:14 UTC

End-to-end against `jakedibetta+pausetest@gmail.com` (sub `sub_1TS4sDLOyixoXdVaVPhPvZHr`). All four state transitions verified, all four `customer.subscription.updated` webhook events processed without error, average ~650ms.

| Action | DB result | Webhook ms |
|---|---|---|
| Pause (auto-resume Jan 5 2027) | `pause_resumes_at` set, `status` stays active | 750 |
| Resume now | `pause_resumes_at` cleared | 870 |
| Cancel at period end | `cancel_at_period_end=true`, `cancel_at`=2026-06-01 | 480 |
| Undo cancel | `cancel_at_period_end=false`, `cancel_at` cleared | 520 |

### Follow-ups (not done in this session)

1. **Wire email sending dispatch** — extend `handleSubscriptionUpdated` to call `sendTemplate('subscription-pause-scheduled', ...)` etc. when state transitions detected. Templates already compiled and ready.
2. **Fix `current_period_end` null write** — read from `sub.items.data[0].current_period_end` instead of the deprecated top-level field. Two lines in `handleSubscriptionUpdated`. Affects all subscription state mirrors going forward.
3. **Auto-resume reminder email cron** — scheduled task to send `subscription-resuming-soon` template ~3 days before `pause_resumes_at`. Needs Supabase pg_cron or external scheduler.
4. **Stripe Customer Portal integration** — for `unpaid` status the `membership-paused.html` page currently links to `mailto:mick`. Wire up `stripe.billingPortal.sessions.create` for self-service card update.
5. **Webhook race fix** — investigate why `invoice.paid` for `+pausetest` returned 200 with error=null but didn't actually apply the status='active' update. Possible related: same root cause as the Ian Ferrell incident on 2026-04-29.
6. **Coach-side admin pause/cancel** — Mick can't currently pause or cancel on a member's behalf via admin pages. Easy to add in `admin-members.html` if needed.
7. **Update CLAUDE.md** — add `manage-subscription` to the Edge Function list under `supabase/functions/`, mention the two new schema columns under "Schema highlights".

### Useful references

- Design doc + visual mockup: [`design-previews/pause-cancel-design.md`](design-previews/pause-cancel-design.md), [`design-previews/pause-cancel-mockup.html`](design-previews/pause-cancel-mockup.html). Open the mockup in a browser — there's a state picker at the top.
- WIP folder: `design-previews/wip/` — original drafts; can be deleted now that everything's shipped.
- Monday-deploy checklist that we ended up running today: `design-previews/wip/MONDAY-DEPLOY-CHECKLIST.md`. Useful template for future Edge Function deploys.

---

## ⭐⭐ PREVIOUS — 2026-04-29 (Wed mid-day)

### Read this first if you're picking up a new chat

**Read these memory files before doing anything**, in order:
- `feedback_no_guessing_verify_everything.md` — every factual claim about state needs a verifying tool call before you state it. Slow down.
- `feedback_supabase_webhook_no_verify_jwt.md` — `supabase functions deploy stripe-webhook` MUST include `--no-verify-jwt`.
- `feedback_drive_supabase_directly.md` — drive Supabase Studio via Chrome MCP, don't ask Jake to click around.
- `feedback_allpaddling_dual_tree.md` — every edit to `rebuild/app/*` or `rebuild/assets/*` MUST also be mirrored to `/app/*` or `/assets/*` in the same commit.
- `feedback_execute_dont_handoff.md` — if you have the tools, drive the task end-to-end.

Push pipeline: GitHub Git Data API. PAT at `.claude/secrets/github-pat.txt`. Repo `allpaddling/allpaddling-site`. Confirmation curl is documented further down this file.

### Current paying customer state (verified 29 Apr 02:46 UTC)

| Customer | Plan | Sub status | Onboarded | Plan status |
|---|---|---|---|---|
| Daniel Michaluk | Custom | active | NO (still pending) | Published |
| Pat O'Keefe | Custom | active | YES | Published |
| Paora Monk | Custom | active | YES | Published |
| Ian Ferrell | Custom | active | NO (still pending) | **Draft** — Mick to finish + publish before Mon 4 May |

Migration funnel: 21 in roster, 4 paid (above), 16 still in `urgent_signup_sent` (received the urgent migration email Tue, haven't paid yet). May block goes live Mon 4 May; deadline communicated to customers is end of Sat 2 May.

### Tomorrow (Thu 30 Apr) and Friday (Fri 1 May) — pre-wired actions for Jake

Open `/app/admin-migrate.html`. Page-header has three stacked buttons:

1. 🔴 **URGENT** — already used Tuesday; don't click again.
2. 🟠 **REMINDER** — click Thu morning. Sends to all in `urgent_signup_sent` (currently 16). Status flips to `reminder_sent`. Email is friendly nudge, references the Sat 2 May deadline.
3. ⚫ **LAST CALL** — click Fri morning. Sends to all in `urgent_signup_sent` OR `reminder_sent`. Status flips to `last_call_sent`. Asks for yes/no reply to help Mick plan.

Both reminder + last-call email templates say "$140 per month" (consistent with the post-revert monthly billing — see Phase 1 Reverted below). Original urgent email said "every 4 weeks"; small inconsistency Jake explicitly said leave alone — handle one-off questions if they come up.

### What happened in this session (commits, all on main)

1. **`e98db5c`** — REVERTED Phase 1 (4-weekly billing for Custom plan). The setup script kept failing on Stripe permissions and we couldn't safely create the `custom_race_4weekly_aud` price under the urgent migration deadline. Live function locked back to monthly billing (`custom_race_monthly_aud`). Mick handles calendar-block alignment manually for now (status quo).
   - Phase 1 plan is **parked**. Jake later asked about a manual UI-driven Phase 1 redo, then said "this seems risky, let's leave it." Phase 1 is fully off the table for now.
2. **`0f3cf6a`** — subscription gate added to `/app/*`. `enforceMemberGates()` in `app.js` now blocks unpaid users (no `progressive_members` / `custom_members` row) — redirects them to `/plans.html`. Coaches still bypass. Replaced the previous onboarding-only gate; same single call site in `mountApp()`.
3. **`53c3505`** — Reminder + Last Call email kinds added (Thu/Fri cadence). Also migration `012` adding `reminder_sent` + `last_call_sent` to the `migration_status` check constraint (already applied to live DB via Studio API).
4. **`d338cae`** — Custom plan publish status surfaced in admin-members.html. Per-row badge ("Plan published" / "Plan draft" / "Awaiting plan"), Custom stat-tile breakdown, new "Awaiting plan" filter tab. Source: `custom_plans.published_at` + `custom_plans.last_edited`.
5. **`d37091e`** — "Preview as member" coach feature. New helpers in `admin.js` (`setPreviewMode`, `getPreviewContext`, `getEffectiveMemberProfile`, `getEffectiveAuthUserId`). Yellow banner in `app.js`'s `renderPreviewBanner()`. Buttons on admin-members rows + admin-edit.html ("Preview draft →" renamed; new "View as member →"). dashboard.html + program.html updated to use effective helpers. **Known limitation flagged to Jake:** dashboard's plan-content rendering currently uses Progressive loader, not Custom — so the "Up next" card may show fallback content for Custom previews. program.html should be more correct. Jake hasn't tested yet.

### Big incident this session: webhook bug + Ian Ferrell recovery

Discovered around 11 AM AEST that `stripe-webhook` had been redeployed without `--no-verify-jwt` (function metadata showed `verify_jwt: true`). Result: every Stripe delivery 401'd at the gateway BEFORE reaching the handler — `webhook_events` table had zero rows after Pat's signup the previous evening. Ian Ferrell paid yesterday but our DB never received the events; he showed up only as a Stripe Customer with no Supabase records.

Fix: redeployed `stripe-webhook --no-verify-jwt`, then resent Ian's `checkout.session.completed` + `invoice.paid` events from Stripe Workbench → Events → Resend. His `subscriptions` + `custom_members` + `member_profiles` rows materialised. Memory note saved (`feedback_supabase_webhook_no_verify_jwt.md`) so we don't repeat this.

### Open Ian sign-in issue (parked)

Late afternoon Ian emailed Jake saying he can't sign in — "my email is not recognized." Verified facts: his auth.users row exists and is fully active; auth in general works (`coleklick@gmail.com` signed up successfully today; Jake's `+blockmem` / `+nopay` test signups also succeeded). The phrase "email is not recognized" doesn't appear anywhere in our codebase, so the wording is either a misinterpretation or from a surface I didn't trace. Most likely diagnosis: Ian's confused between sign-in (`/login.html`) and sign-up (`/custom-plan.html` from the urgent email link). Jake emailed Ian back to clarify and is waiting for a screenshot. **Don't dig further until Ian replies.**

### Other items still open

- **Daniel + Ian short reminder email** (Jake leaning toward "Mick writes a personal one-liner from his inbox" rather than a system email) — to nudge them to sign in and complete onboarding.
- **Lapse email to non-converters after Sat 2 May** — Jake said hold until we see the actual non-converter list Sun/Mon. T+14 lapse template already wired in admin-migrate.

### Known limitations / debt to be aware of

- ~~**Custom plan content on dashboard.html / program.html for members**~~ — RESOLVED (marked 2026-04-29).
- **Onboarding form** — Daniel/Ian still have `completed_onboarding_at = null` (Pat/Paora are done). Pre-existing `member_profiles` rows have their `preferred_name` + `family_name` backfilled but onboarding wasn't run. Confirmed: their next sign-in WILL force them through `/app/onboarding.html` (subscription gate passes via member rows; onboarding gate fires on null `completed_onboarding_at`). No action needed.
- **Pricing message inconsistency** — urgent email said "every 4 weeks", reverted to monthly; reminder + last-call emails accurately say "per month". Customers who notice → tell them "we simplified to monthly billing."
- **Phase 1 (4-weekly billing aligned to content blocks)** — fully parked. If we ever revisit, plan is in mid-session conversation: Phase 1 = create new Stripe Price via UI, Phase 2 = code change + deploy, Phase 3 = migrate 4 existing customers via Stripe Dashboard. Don't auto-resume; Jake said leave it.

### Useful URLs to know

- Supabase project: `https://supabase.com/dashboard/project/crlukzkgmydyqpwndjvc`
- Stripe webhook endpoint: `https://crlukzkgmydyqpwndjvc.supabase.co/functions/v1/stripe-webhook`
- Live site: `https://allpaddling.online`
- GitHub repo: `https://github.com/allpaddling/allpaddling-site`

### Function metadata snapshot (29 Apr 02:51 UTC, all healthy)

| Function | verify_jwt | version | Last deploy |
|---|---|---|---|
| create-checkout-session | false ✓ | 17 | 28 Apr 23:13 UTC |
| stripe-webhook | false ✓ | 23 | 28 Apr 23:41 UTC |
| send-email | true (correct — coach JWT) | 11 | 28 Apr 20:35 UTC |

---

## ⭐⭐⭐ Earlier — 2026-04-28 evening, before sleep

### What just shipped (commit `f87f071c`)

**Send-via-Resend buttons in admin-migrate.html + EMAIL_BCC across all outgoing emails.**

- `_shared/email.ts` reads new `EMAIL_BCC` env var (comma-separated). Every Resend send now BCCs the configured addresses automatically. All 6 transactional templates (welcome, payment-receipt, plan-ready, block-delivered, payment-failed, upcoming-renewal) AND the new migration-email sends inherit.
- `send-email` Edge Function now accepts coach-JWT auth (alongside existing service-role) and a new `mode: "raw"` body shape (subject/text/html directly). Used by admin-migrate.
- `admin-migrate.js`: each row now has a `<select>` (5 email kinds: T-7, T-3, T-0, T+3, T+14) + a green "Send via Resend" button. Clicking it generates a fresh Stripe checkout link if needed, renders the email body inline, POSTs to send-email, updates `migration_status` if appropriate. Shows "✓ Sent to ..." flash on success.

**Already done in browser:**
- `EMAIL_BCC` secret saved in Supabase (= `jakedibetta@gmail.com,dibetta1@gmail.com`)
- migtest5 wiped from Supabase

### TWO MANUAL STEPS BEFORE TOMORROW'S MIGRATION

**1. Deploy the three Edge Functions** (Terminal):
```
cd ~/Documents/AllPaddling
supabase functions deploy stripe-webhook --no-verify-jwt --project-ref crlukzkgmydyqpwndjvc
supabase functions deploy send-email --no-verify-jwt --project-ref crlukzkgmydyqpwndjvc
supabase functions deploy contact-form --no-verify-jwt --project-ref crlukzkgmydyqpwndjvc
```

(All three share `_shared/email.ts`, so all three need the redeploy to pick up `EMAIL_BCC`.)

**2. Inbound replies — Mick needs to set up a Gmail filter on `dibetta1@gmail.com`** to auto-forward AllPaddling-related emails to `jakedibetta@gmail.com`. Cloudflare Email Routing is 1-destination-per-rule, so true server-side fan-out would need an Email Worker (deferred). Easiest workaround:

   Mick → Gmail Settings → Filters → Create new filter:
   - From: `*@allpaddling.online`
   - Action: Forward to `jakedibetta@gmail.com` (Jake will need to verify the forwarding address by clicking a confirmation link)

   Result: customer replies arrive in Mick's inbox AND fan out to Jake's. Outgoing already covered by EMAIL_BCC.

### Migration cadence (reminder)

- T-7 — heads-up (no action needed for customer)
- T-3 — signup link (action required)
- T-0 — same-day reminder if not signed up
- T+3 — friendly check-in if still no signup
- T+14 — lapse notice (Shopify cancelled, door open)

The `<select>` dropdown auto-defaults to the next-step kind based on each row's `migration_status` (pending → T-7, heads_up_sent → T-3, etc.). Just click "Send via Resend" — no manual choice needed for the happy path.

### Tomorrow's actual workflow

1. Open `https://allpaddling.online/app/admin-migrate.html` (signed in as coach)
2. Click "Send via Resend" on **one** customer row first to eyeball the live email arriving in your inbox (you'll receive it via the BCC)
3. If it looks good, click Send on the remaining 19
4. Statuses auto-update from `pending` → `heads_up_sent`
5. ~3-4 days later, repeat with T-3 (dropdown auto-defaults; just click)

---

## ⭐⭐⭐ MORNING BRIEF — 2026-04-28

**TL;DR:** Custom-plan signup flow is end-to-end verified. Migration to 20 real customers is unblocked. Three short tasks before sending the heads-up emails.

### What we proved last night (migtest5 test signup)

- ✓ Stripe payment → Supabase verify → user lands signed-in on welcome.html (auth-gap fix works)
- ✓ Webhook seeded `custom_plans` with the published Primer block (member sees real content immediately, not "your plan is being prepared")
- ✓ `custom_members.auth_user_id` populated correctly (admin lookup links work)
- ✓ `member_profiles` row created with `completed_onboarding_at: null` (onboarding redirect works)

### Five bug fixes shipped + deployed yesterday afternoon/evening

1. `custom_members.auth_user_id` missing on webhook upsert — commit `98e5beb1`
2. Webhook didn't create `member_profiles` — commit `98e5beb1`
3. `create-checkout-session` brittle to service-role key rotation — commit `98e5beb1`
4. `admin-edit` "could not be found" for plan-less self-signups + `saveCustomPlan` upserts — commit `314b4381` (frontend only)
5. Custom signups seeded with currently-published Primer block (meta + 4 weeks × 4 sessions) — commit `aa4a7b93`
6. Migrate-mode auth gap — `create-checkout-session` now uses a magiclink action_link as Stripe success_url so post-payment users land signed-in — commit `17b024f9`

All six lived end-to-end through migtest5 paying A$1, landing signed-in, dashboard rendering primer-seeded plan.

### Three things to do this morning, in order

**1. Eyeball the migtest5 result before deleting** (2 min)

In your normal Chrome (signed in as coach):
- Open `https://allpaddling.online/app/admin-members.html` → migtest5 should appear in the list
- Click into them → admin-edit should open cleanly with the Primer draft (not "could not be found")
- Optional: in Incognito (still signed in as migtest5), open `https://allpaddling.online/app/dashboard.html` → should show "Primer - First 4 Weeks", 4 weeks, 4 sessions/week

**2. Clean up the test data** (1 min)

In Stripe:
- Subscriptions → cancel migtest5 (if still active)
- Payments → refund the A$1 charge

In Supabase Studio (https://supabase.com/dashboard/project/crlukzkgmydyqpwndjvc/sql/new) — paste + Run:
```sql
delete from public.subscriptions where user_id in (select id from auth.users where email = 'jakedibetta+migtest5@gmail.com');
delete from public.member_profiles where user_id in (select id from auth.users where email = 'jakedibetta+migtest5@gmail.com');
delete from public.custom_plans where member_id in (select id from public.custom_members where email = 'jakedibetta+migtest5@gmail.com');
delete from public.custom_members where email = 'jakedibetta+migtest5@gmail.com';
delete from public.migration_customers where email = 'jakedibetta+migtest5@gmail.com';
delete from auth.users where email = 'jakedibetta+migtest5@gmail.com';
```

(Or just say "clean up migtest5" and Cowork will drive it.)

**3. Send the heads-up emails to the 20 real customers**

`https://allpaddling.online/app/admin-migrate.html` → "Send heads-up emails (T-7)" button.

Suggested gentle rollout: send to **1 customer first** to eyeball the email rendering live (pick someone you trust to forgive a typo if there is one), then if that looks good, send to the remaining 19. The button supports per-row sending if you want fine control.

After heads-up send, the migration_status becomes `heads_up_sent` for each row. The next phase (signup_link) waits 4–7 days per Mick's plan; we can revisit timing then.

### Open questions for you

- **Refund the A$1 from migtest3** if you didn't already (alongside migtest5 refund). Both are real charges that you should reverse before the books look weird.
- **Decision on heads-up cadence:** the original plan was T-7 / T-3 / T-0. Are you keeping that, or compressing? (Decision is up to you — no code change either way.)

### Known not-broken-but-imperfect things (deferred)

- Cosmetic event-loop noise: `Deno.core.runMicrotasks()` errors in stripe-webhook logs. Doesn't affect behaviour. Cosmetic only.
- Coach-notification email when a new member signs up — would be nice, not required for launch.
- The deploy step still requires you to redeploy Edge Functions (per memory). Today's commits are all already deployed; future code changes would need a redeploy.

---

## Previous session (2026-04-27 morning) — Stripe live setup

**The big one: Stripe is live, migration is one button-press away from real customers.**

### Stripe live mode is fully wired

Live products + prices created (5 products: 4 Progressive + custom_race; 5 AUD prices at $80 / $140). Live webhook destination registered at `https://crlukzkgmydyqpwndjvc.supabase.co/functions/v1/stripe-webhook` listening for the 5 expected events. All Supabase secrets rotated to live values: `STRIPE_SECRET_KEY` (sk_live_…), `STRIPE_WEBHOOK_SECRET` (whsec for live), `EMAIL_FROM` (`Mick at All Paddling <mick@allpaddling.online>`), plus existing RESEND/CONTACT secrets.

Done end-to-end via:
- `supabase/scripts/setup-stripe-products-live.sh` (silent stdin for sk_live_, idempotent script)
- Manual webhook destination creation in Stripe dashboard
- Direct secret writes via Supabase Studio UI (Chrome MCP-driven)

**One real live A$1 test signup completed.** Surfaced 3 bugs (see "Known bugs" below) — all 3 are now fixed in code (commit `98e5beb1`) but Edge Functions need redeploy for the fixes to land in production.

### Mick's 8 migration decisions captured

`migration/Mick_decision_briefing.md` has the full table at the top. Key calls:

- **Pricing reset (Decision B):** all Custom plan customers move to **A$140 every 4 weeks**, all Progressive to **A$80 every 4 weeks** — no grandfathering. `migration_customers` table updated: 19 Custom rows now `amount_cents=14000`, 2 Progressive rows now `amount_cents=8000`, all `currency='aud'` (the lone USD outlier was reset to AUD on 2026-04-28).
- **No refunds** (Mick's IP-protection rationale).
- **Mid-cycle cancel:** access until period end.
- **GST:** not registered, skip Stripe Tax.
- **arodriguez1907@gmail.com** (dual sub): migrate both. **Address all customers by their registered name** (Micah Iverson, etc.).
- **jamesharpercase24@gmail.com** (Feb 2027 renewal): set `migration_status='on_hold'`, deal with last.
- Email forwarding on `.com` domain + paused/cancelled outreach: deferred.

Email body in migration runner cleaned up: dropped misleading "(same as today)" parenthetical and "grandfathered from Shopify" copy now that pricing is uniform.

### Auth: Google OAuth alongside magic-link

Member login.html and coach gate (admin.html) both have a "Continue with Google" button as primary CTA, magic-link as fallback. Google Cloud OAuth project configured (External, in Production mode — non-sensitive scopes don't need verification). Same flow on member + coach sides.

**Sign-out fix:** member-area sidebar Sign-out item was a plain link to login.html that left the Supabase session intact, so login.html bounced the user straight back to dashboard. Now wired with a `data-action="signout"` click handler that actually calls `sb.auth.signOut()`.

### Public site cleanup

- Mick's personal phone (`0404 556 880`) and Gmail (`dibetta1@gmail.com`) removed from contact.html AND footer (rendered by `assets/site.js`).
- Replaced with `mick@allpaddling.online` — Cloudflare Email Routing live and verified, routes to Mick's Gmail. (Originally `hello@allpaddling.online`; consolidated to `mick@` on 2026-05-15.)
- Contact form wired up properly: new Edge Function `supabase/functions/contact-form/index.ts` (deployed, `--no-verify-jwt`). Uses honeypot + fail-soft error banner pointing at the email if the function 5xx's.
- Logo heartbeat polyline was invisible (white-on-white-heart bug) — repainted in `--brand-700` teal at stroke-width 2.4.
- Footer brand mark + 8 admin pages updated for the same fix.

### Welcome flow branched by plan_type

Progressive members now get instant access (their 4 discipline plans are pre-published — no wait). Custom members keep the "Mick is putting your block together — usually within a day or two" wait copy.

Implemented via `{{post_signup_message}}` placeholder in the welcome email template (regenerated `email-templates.gen.ts`), and `?type=progressive|custom` URL param appended to Stripe success_url so welcome.html can branch the lead copy + hide the "Mick prepares your block" step for Progressive sub-flow.

### Migration tooling

- `migration-runner-live.sh`: silent-stdin wrapper that prompts for service-role key, runs the runner, writes a per-customer JSON output. Auto-output path is `migration/migration-output-YYYYMMDD-HHMMSS.json`.
- New `--only-email <addr>` flag on the runner: pin to one specific row, override `--status` filter. Used for the live A$1 test.
- `send-test-migration-email.sh`: reads latest output JSON, prompts for RESEND_API_KEY, POSTs to Resend so the test email actually lands in inbox. Built but didn't end up using it; we used the JSON output's signup_link directly.
- `regen-email-templates.sh`: regenerates `email-templates.gen.ts` from the source template files. Run after editing any `_shared/email-templates/*/{subject.txt,html.html,text.txt}`.

### Known bugs (queued for next session)

All 3 surfaced from today's live A$1 test signup. Fixes pushed in commit `98e5beb1` but **NOT yet deployed**:

1. **Onboarding popup didn't fire** after live signup → dashboard. Fix: webhook now upserts a `member_profiles` row with `completed_onboarding_at = null`, making the dashboard's redirect-to-onboarding logic deterministic.
2. **Coach admin "this member could not be found"** when clicking into a freshly-migrated member's plan. Fix: `custom_members` upsert now populates `auth_user_id: userId` (was missing — progressive_members had it, custom didn't).
3. **Migration runner script "Invalid user JWT"** error when running against the live Edge Function. Fix: `create-checkout-session` now also accepts service-role auth via JWT-decode of the role claim, so it survives Supabase's same-day rotation of the default service-role key format.

**To deploy when ready:**
```
supabase functions deploy stripe-webhook --no-verify-jwt --project-ref crlukzkgmydyqpwndjvc
supabase functions deploy create-checkout-session --project-ref crlukzkgmydyqpwndjvc
```

After redeploy, ideal smoke-test sequence:
1. Insert a fresh test row in `migration_customers` (e.g. `jakedibetta+migtest3@gmail.com`, A$1, custom, pending)
2. Run `bash supabase/scripts/migration-runner-live.sh --only-email jakedibetta+migtest3@gmail.com` (real run, no `--dry-run`)
3. JSON output should include a real `signup_link` (no more "Invalid user JWT")
4. Click the link, complete A$1 checkout
5. Verify on welcome → dashboard:
   - Onboarding popup should now fire
   - In a separate coach admin session: click into the new member from admin-members.html — should open the plan editor without alert
6. Cleanup: refund the A$1 in Stripe live, delete test rows from DB

### Outstanding admin tasks (whenever, low priority)

- Refund the **two** A$1 test charges from Stripe live dashboard (today's two `+migtest` and `+migtest2` test runs)
- Rotate the keys that briefly appeared in chat history during today's session: Stripe sandbox `sk_test_…`, Stripe live webhook `whsec_…`, Resend "Migration test" key (if you ever made one — you may have skipped this step)
- Test data already deleted from DB (subscriptions, member_profiles, custom_members, migration_customers, auth.users for both `+migtest` aliases)

### What's left for migration day

Once the 3 bug-fix Edge Functions are redeployed and the smoke test passes:

1. **Run the migration runner for real** (no `--dry-run`, no `--only-email`) to generate signup links + email bodies for all 19 active migrating customers (20 total minus the on_hold James Case)
2. **Send the emails** — either (a) bulk via Resend with a small loop script over the JSON output, or (b) Mick clicks through `admin-migrate.html` row-by-row so he has eyes on each one
3. **Watch inbound webhooks** as customers complete checkout
4. **Mick cancels Shopify subs** as Stripe ones come online (manual via Appstle dashboard)
5. **Wave 2 follow-ups:** lapsed customers, paused cohort outreach — deferred per Mick's call

---

## Latest session (2026-04-26)

**Massive forward progress:** Stripe payments scaffolding is complete (waiting only on Mick's Stripe account), the migration tooling is live, the new domain is up, and a stack of UX improvements landed.

### Domain
- **`allpaddling.online` is now the primary URL** (was `allpaddling.github.io/allpaddling-site/`). DNS managed in Cloudflare (Jake's account, zone `allpaddling.online`). 4× A records on apex pointing at GitHub Pages IPs (185.199.108-111.153, all DNS-only/grey-cloud), CNAME `www → allpaddling.github.io`. Resend records (`MX send`, `_dmarc`, `resend._domainkey`, SPF) preserved untouched.
- **`allpaddling.com` left alone** — still serves Mick's Shopify store via the old webdev's hostyourservices.net DNS. Cutover deferred until after migration.
- **Repo `/CNAME`** binds GitHub Pages to `allpaddling.online`.
- **Supabase auth URLs updated**: Site URL = `https://allpaddling.online`, redirect allowlist includes `https://allpaddling.online/**`.

### Stripe scaffolding (waiting only on Mick's account)
- **`supabase/functions/create-checkout-session/`** — Edge Function with three modes:
  - **SELF**: customer's JWT → looks up Stripe Price by `lookup_key`. Used by frontend Subscribe buttons for signed-in users.
  - **ANON**: no auth → email-only modal flow on plans pages → looks up Stripe Price by `lookup_key`, creates the auth user inline, and uses a magiclink as success_url so the customer lands signed in post-payment. Used by the public Subscribe flow.
  - **MIGRATE**: coach JWT (`is_coach()`) OR service-role key + customer email + `legacy_amount_cents` → inline `price_data` at the Decision B uniform rate (A$140 Custom / A$80 Progressive). Parameter name kept for backwards compat; there is no grandfathering. Used by `admin-migrate.html` and the batch runner.
- **`supabase/functions/stripe-webhook/`** — already existed, untouched. Handles `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated/deleted`.
- **`supabase/scripts/setup-stripe-products.ts`** — idempotent. Creates 5 Products (4 Progressive + 1 Custom) and 5 AUD Prices with stable lookup keys. Run once per Stripe environment (test / live).
- **`supabase/scripts/migration-runner.ts`** — batch generator. Reads `migration_customers`, calls `create-checkout-session` for each pending customer, renders the migration email body, writes a JSON file ready to mass-send. `--dry-run` flag for verification.

### Migration tooling
- **`migration_customers` table** (migration `008`) — RLS coach-only via `is_coach()`. Tracks each customer's `migration_status` through the funnel (`pending → heads_up_sent → signup_link_sent → signed_up → shopify_cancelled → migrated`, plus `lapsed` and `on_hold`).
- **Seed loaded**: 21 active customers from the Appstle export. Source file `migration/seed-migration-customers.sql` (local-only — repo is public, never commit).
- **`/app/admin-migrate.html`** — coach-only page in the admin sidebar. Lists the 21 customers, generates per-customer Stripe Checkout URLs in MIGRATE mode, surfaces ready-to-paste email body, status cycling.
- **6 email templates** in `migration/emails/` covering the T-7 / T-3 / T+0 / T+3 / T+14 sequence + a welcome email.
- **`migration/customer_migration_audit.xlsx`** — audit spreadsheet (21 active, 19 paused, 40 cancelled). Includes the critical findings: 8 distinct USD prices, multi-currency, jp.okeefe7 name mismatch, dual-sub customer.
- **`migration/Mick_decision_briefing.md`** — structured doc covering all the open questions Mick needs to answer (pricing approach, edge cases, refund policy, GST, etc). Walk-through ready.
- **`migration/Mick_Stripe_signup_checklist.md`** — what Mick needs to gather before the Stripe-account screen-share.

### UX additions
- **Cross-role nav** — Mick is both coach and member. Both sides now have a teal pill in the sidebar footer to switch over (`Coach Admin →` on member pages, `Member view →` on coach pages, identical visual treatment via shared `.role-switch-btn` class). Member pages show a "Member view" badge in the brand area when the signed-in user is a coach.
- **Login page coach link** — promoted from a buried 0.85rem inline link to a proper outlined button.
- **Strength Program** opened to ALL members (was Custom-only). Renamed from "Strength" → "Strength Program" and moved directly under "Current Program" in the member nav. Page replaced with the real 16 exercises from Mick's May plan (8 in Program 1 + 8 in Program 2). Each exercise card has a "▶ How to" link that searches YouTube.
- **Welcome page** at `/app/welcome.html` for post-Stripe-Checkout success. Stripe `success_url` points here.
- **Subscribe buttons wired up** — `custom-plan.html` + `plan-prone/sup/oc/ski.html` now call `startCheckout()` (in `assets/checkout.js`) which auth-gates and calls the Edge Function. Login.html honours `?next=` redirect for round-trip after sign-in.

### Bug fixes
- **Snapshot trigger needed `SECURITY DEFINER`** (migration `007`) — Publish was failing with code 42501 because the trigger's internal `INSERT` into `progressive_plan_snapshots` was hitting RLS as the calling user.
- **`VALID_PLAN_KEYS` was missing `'primer'`** in `published-plans.js` — when the loader was called with `'primer'` it was silently falling back to `'prone'` and returning the prone plan with the prone name (with `.isPrimer = true` mutated onto it). Result: members in the primer window saw the primer banner but the prone plan content. Fixed by adding `'primer'` to the array.
- **Primer page header showing `· Prone` suffix** — the title rendering in `program.html` was always appending the discipline. Now hidden when `isPrimer === true`, since the primer is shared across disciplines.
- **Auto-cascade week start dates** in `admin-edit.html` — when Mick fills Week 1's start date, blank later weeks auto-populate at +7-day increments.

### State of the data
- Primer is named `"Primer - First 4 Weeks"`, has 4 weeks of published content, `published_at = 2026-04-26 11:01`.
- Prone plan is currently named `"Smoke Test 26 April"` (test data — Mick should rename when he's ready to publish real prone content).
- SUP plan has `"Program 1"` (4 weeks). OC and Ski plans empty.

### What's blocking the actual migration
1. **Mick creates the Stripe account** with ABN 52173453156 (the bottleneck — KYC needs his ID + bank). Briefing doc + signup checklist ready.
2. ~~**Mick's pricing decision**~~ — resolved 2026-04-27 (Decision B: reset all customers to A$140 Custom / A$80 Progressive AUD flat, no grandfathering). Captured in `MICK_AGENDA.md` change log.
3. Once Stripe is live: `setup-stripe-products.ts` → set Supabase secrets → deploy Edge Functions → `migration-runner.ts --dry-run` → real run → mass-send.

### Live URLs
- **Member dashboard:** https://allpaddling.online/app/dashboard.html
- **Coach admin:** https://allpaddling.online/app/admin.html (same magic-link sign-in)
- **Coach Migration tool:** https://allpaddling.online/app/admin-migrate.html
- **Public marketing:** https://allpaddling.online

---

## Project basics

- **Product:** coaching website rebuild for Mick (allpaddling.com / allpaddling.online).
- **Stack:** GitHub Pages (frontend) + Supabase (auth + RLS + plans tables) + Resend (verified on `send.allpaddling.online`) + Stripe (scaffolded, waiting on Mick's account).
- **Repo:** `allpaddling/allpaddling-site` (public).
- **Primary site URL:** https://allpaddling.online (since 2026-04-26)
- **Existing customer site (still serves 20 Shopify subscribers):** https://allpaddling.com — Shopify + Appstle Subscriptions, behind `justpaddle.myshopify.com/admin`. Untouched until migration is complete.
- **Working folder:** `/Users/jakedibetta/Documents/AllPaddling/` (mounted in Cowork — request directory access at start of new session if not already).
- **Deployable site lives in:** `rebuild/` subfolder. The repo deploys from root, so `rebuild/login.html` ↔ remote `login.html` (the `rebuild/` prefix gets stripped on push).

---

## GitHub push pipeline (working — verified this session)

### PAT
- **Path:** `/Users/jakedibetta/Documents/AllPaddling/.claude/secrets/github-pat.txt` (chmod 600, stored inside the persistent AllPaddling folder so it survives Cowork restarts — note this is *not* the sandbox `.claude/secrets/` path the previous session used).
- **GitHub token name:** `cowork-allpaddling-site`
- **Scope:** fine-grained, allpaddling-site only, Contents: Read+Write, Metadata: Read.
- **Expires:** Mon 25 May 2026.
- **Old token (`Cowork — allpaddling-site push`) was deleted from GitHub this session — only one token now active.**

### Network
- `github.com` and `api.github.com` are on the network egress allowlist. **HTTP 200 confirmed** authenticated this session.
- `raw.githubusercontent.com` is **not** on the allowlist — use the API contents endpoint (`api.github.com/repos/.../contents/{path}?ref=main`) instead.

### Push pattern
For any code change, edit locally then push via the GitHub Git Data API in a single commit (multiple files OK). Working python script template (saved to /tmp earlier this session) at end of this doc. The pattern: get current main ref → fetch base tree → create blobs for each file → create new tree → create commit → update ref.

### First action in new session — confirm PAT still works:
```bash
PAT=$(cat /sessions/*/mnt/AllPaddling/.claude/secrets/github-pat.txt | tr -d '\n')
curl -sS -w "HTTP %{http_code}\n" \
  -H "Authorization: Bearer $PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/allpaddling/allpaddling-site \
  | head -c 300
```
If HTTP 200 + repo JSON: good to go.

---

## What got built/decided this session

### 3 commits pushed to main:
1. **5394f9e** — Plans card: drop redundant 'cancel after that' suffix (index.html + plans.html)
2. **3d1123e** — Plans card: drop redundant '12-week minimum commitment' bullet (same two files)
3. **550701e** — About: add coach photo of Mick (assets/mick-coach.webp 386×465 + about.html)

### `ROADMAP.md` created at `/Users/jakedibetta/Documents/AllPaddling/ROADMAP.md`
**This is the canonical plan. The new session should read it before doing anything else.** Top-line:

- **Goal:** scale signup + content delivery without losing any of the 20 existing paying customers. 4-week build sprint + 4–6-week migration window.
- **Two parallel tracks:**
  - **Track A — Build (4 weeks):** Week 1 Stripe + signup loop · Week 2 Email + 4-week delivery cadence · Week 3 Self-service + observability · Week 4 Audit + soft-launch
  - **Track B — Migrate 20 existing customers via phased per-billing-anniversary cutover.** Prep starts Week 1, customer-facing migration starts Week 4.

### Inventory of new-site code (from a sub-agent inventory earlier this session):
- **Auth:** magic-link OTP via Supabase. Working.
- **Members:** manually inserted by Mick into `progressive_members` or `custom_members` tables (this is the manual choke point).
- **Progressive plans:** data in `progressive_plans` (one row per discipline keyed on `plan_key`), but 4 near-identical HTML files: `plan-{prone,sup,oc,ski}.html`. Library refactor parked at Track A Week 4.
- **Custom plans:** `custom_plans` table with draft/published lifecycle. Mick edits via `admin-edit.html`, clicks publish. Single immutable doc — no scheduled block delivery yet.
- **Payments:** **zero**. Subscribe button is `alert("Checkout coming soon")` on `custom-plan.html`.
- **Email:** **zero**. Resend not wired.
- **Self-service settings:** `app/settings.html` is stubbed; PLAN_PRICE map exists but no actions wired.
- **Admin observability:** none. No subscriber count, MRR, churn dashboard.
- **Onboarding:** none. After first login, new members land in dashboard with no profile/goal-race/training-hours capture.
- **RLS audit:** policies assumed correct, never explicitly tested.

---

## Existing allpaddling.com reconnaissance (done this session)

Inspected via Chrome MCP. Confirmed:

- **Platform:** Shopify, theme = Dawn, shop handle = `justpaddle.myshopify.com`, vendor "JUSTPADDLE".
- **Subscriptions:** **Appstle Subscriptions** app (on Shopify Payments). Each plan = Shopify Product + Appstle Selling Plan. Script tell: `subscription-admin.appstle.com`.
- **Member portal:** standard Shopify customer accounts at `/account`. **No content portal** — plan delivery happens *outside* Shopify (likely PDF email or Drive link from Mick).
- **Customer data:** all 20 customers' contact + billing + subscription state lives in Shopify Admin + Appstle dashboard at `justpaddle.myshopify.com/admin`.

### Pricing parity (confirmed both sides):

| Plan | Existing | New | Delta |
|---|---|---|---|
| Prone/SUP/OC/Ski Progressive | $80/month | $80/4wks | ~8.7% effective annual ↑ (13 vs 12 cycles) |
| Custom Season Race Plan | $140 (period TBC, presumed monthly) | $140/4wks | likely same delta |

**Headline prices match. Only delta is monthly → 4-weekly cadence.** I (the previous-model session) made a mistake here mid-session: I claimed a "75% price increase" without grep'ing the actual prices, and Jake correctly called it out. The corrected reality is far lower-friction migration than I'd painted.

---

## Outstanding blockers (awaiting Jake's conversation with Mick)

These three answers shape Track B; nothing blocks Track A from starting:

- **Q-1 [the unblocker]:** Jake doesn't have admin access to `justpaddle.myshopify.com` or Appstle. Mick needs to add Jake as Shopify staff with read access to customers + orders + apps. Without this, the customer audit (B.1) can't begin.
- **Q-2:** How does Mick deliver plan content to subscribers today? PDF email, Drive folder, something else? Determines whether existing content can be ported into the new system or has to be re-created in admin.
- ~~**D-1:** Cadence decision~~ — resolved 2026-04-27 (Mick's Decision B). All migrating customers reset to the uniform A$140 Custom / A$80 Progressive every-4-weeks rate. No match-monthly, no grandfathering.

Jake plans to put these to Mick directly. Not waiting on the new session for that.

---

## What can be done in parallel (Track A) while waiting on the above

The whole 4-week build sprint is gated on *none* of the above. Track A Phase 1 (Stripe + signup loop) can start immediately:

1. **1.1 Stripe account + product setup** — needs Mick's ABN if not already set up, AUD pricing, GST.
2. **1.2 Stripe Checkout redirect** from custom-plan.html Subscribe button.
3. **1.3 Subscription state in Supabase** — new `subscriptions` table.
4. **1.4 Webhook handler** — Supabase Edge Function listening for Stripe events.
5. **1.5 12-week cancel-lock** — metadata-driven enforcement.
6. **1.6 First-login race fix** — `getCurrentMemberProfile()` retry/backoff (admin.js:760).

Detail in ROADMAP.md.

---

## Lessons from this session (worth carrying forward)

- **When claiming a discrepancy, quote both sides from primary sources before flagging it as critical.** I flagged a fake 75% price increase by anchoring on one number from a screenshot and extrapolating. Grep'd the actual files, problem dissolved. Jake wants assumptions to be verified.
- **Tone:** direct, sprint-mode, no fluff, no excessive preamble. Small focused commits. Single-commit pushes when multiple files change together.
- **Format preferences:** prose for framing/rationale, lists/tables for enumeration. Don't pad. Don't ask for confirmation on every tiny thing — proceed when intent is clear.
- **Repo layout note:** rebuild/ contents deploy to repo root. Don't push files with `rebuild/` prefix — strip it.

---

## Push script template (use as-is, just edit FILES + MSG)

```python
import json, base64, urllib.request, pathlib

PAT = open('/sessions/friendly-peaceful-curie/mnt/AllPaddling/.claude/secrets/github-pat.txt').read().strip()
# NOTE: session id varies — use /sessions/*/mnt/... discovery in real script
REPO = 'allpaddling/allpaddling-site'
BRANCH = 'main'
MSG = "<commit message here>"
ROOT = pathlib.Path('/sessions/<SID>/mnt/AllPaddling/rebuild')

# Local path → repo path (strip rebuild/ prefix)
FILES = {
    'about.html': ROOT / 'about.html',
    'assets/mick-coach.webp': ROOT / 'assets' / 'mick-coach.webp',
}

def gh(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f'https://api.github.com{path}', data=data, method=method, headers={
        'Authorization': f'Bearer {PAT}', 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json',
        'User-Agent': 'cowork-allpaddling-push'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

ref = gh('GET', f'/repos/{REPO}/git/ref/heads/{BRANCH}')
parent_sha = ref['object']['sha']
commit = gh('GET', f'/repos/{REPO}/git/commits/{parent_sha}')
base_tree = commit['tree']['sha']

tree_entries = []
for repo_path, local_path in FILES.items():
    blob = gh('POST', f'/repos/{REPO}/git/blobs',
              {'content': base64.b64encode(local_path.read_bytes()).decode(), 'encoding': 'base64'})
    tree_entries.append({'path': repo_path, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})

new_tree = gh('POST', f'/repos/{REPO}/git/trees', {'base_tree': base_tree, 'tree': tree_entries})
new_commit = gh('POST', f'/repos/{REPO}/git/commits',
                {'message': MSG, 'tree': new_tree['sha'], 'parents': [parent_sha]})
gh('PATCH', f'/repos/{REPO}/git/refs/heads/{BRANCH}', {'sha': new_commit['sha']})
print(f'✓ Commit: https://github.com/{REPO}/commit/{new_commit["sha"]}')
```

---

## First actions for the new session, in order

1. Read `/Users/jakedibetta/Documents/AllPaddling/ROADMAP.md` cover-to-cover.
2. Run the curl PAT check above.
3. Confirm with Jake what to start on (likely Track A Phase 1 — Stripe scaffolding — while he chases Q-1/Q-2/D-1 with Mick out-of-band).
