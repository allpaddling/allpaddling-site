# All Paddling — Cowork session handoff

Continuing AllPaddling project. The canonical project guide is `CLAUDE.md`; this handoff is the bridge between sessions — read the LATEST section first.

---

## ⭐⭐⭐ LATEST — 2026-06-03 (Wed) — Custom-member session-completion key collision fixed (Cole Klick)

Member Cole Klick (Custom, `coleklick@gmail.com`) reported two things: (1) viewing upcoming workouts showed them as already complete, and (2) his plan title said "M2O" but he races Catalina. Both resolved.

### Root cause — completion-key collision (not a real marking action)

The "Mark complete" code only writes on a button click; sessions merely *displayed* as complete because their keys collided with Cole's earlier prone history. Two contributors:

- **Custom members had no completion-key namespace.** Every member page called `setSessionPlanKey(profile.planKey)` only inside the `type==='progressive'` branch. Custom profiles carry no `planKey` (`admin.js` returns only `{type:'custom', id, email, name, createdAt}`), so `__sessionPlanKey` stayed null and `getCurrentPlanKey()` fell back to the member's **discipline** (`prone`). Cole's Custom ticks therefore shared the `prone-*` namespace with the prone primer/progressive block he did in May.
- **The week slot of the key was positional** (1-based array index). Cole's Custom plan (weeks labelled Week 5–8) sits at positions 1–4, so its keys `prone-w1*`…`prone-w4*` collided exactly with his real May completions at those positions → future sessions rendered pre-completed.

Confirmed in `session_completions`: all of Cole's rows were `plan_key='prone'`, zero `custom-*` rows — nothing was actually lost.

### Fix (commit [`4f67de9`](https://github.com/allpaddling/allpaddling-site/commit/4f67de9f8cbb349eab30812017af1f8bddc38680), 5 files)

- **`assets/published-plans.js`** — `setSessionPlanKey` now also accepts `'custom'`. New `memberWeekToken(planKey, program, weekNum)`: returns the positional number unchanged for Progressive (so existing Progressive keys are untouched, no history orphaned), but for Custom derives a stable token from `slug(week.label + '-' + week.startDate)` so a re-published block (which reuses positions 1..N) no longer inherits the previous block's ticks.
- **`app/session.html`, `app/program.html`, `app/dashboard.html`** — added an `else if (profile.type==='custom') setSessionPlanKey('custom')` branch, and threaded `memberWeekToken(...)` into every `memberSessionKey(...)` call.
- **`app/history.html`** — same custom branch, plus the completed-list builder was rewritten to walk the current plan and recompute keys via `memberSessionKey`/`memberWeekToken` instead of regex-parsing `([a-z]+)-w(\d+)s(\d+)` (the old regex can't parse the new Custom token). Added an "in this plan yet" empty-state so a member with completions in another namespace doesn't see a blank list.
- Cache-buster on the `published-plans.js` script tag bumped to `?v=20260603-1` on all four pages.

**Design rule for next session: do NOT revert Custom keys to positional** — that reintroduces the cross-block collision. Progressive keys intentionally stay positional (their primer vs cohort split already namespaces them).

### Verification done

- `published-plans.js` passes `node --check`; all four edited pages' inline scripts parse via `new Function()`.
- GitHub `main` confirmed carrying `memberWeekToken` and the new `?v=` (Contents API).
- **Live** `allpaddling.online/assets/published-plans.js?v=20260603-1` loaded in Chrome and confirmed serving the new `setSessionPlanKey` + `memberWeekToken` (Pages published).

### M2O title

Separate, not a bug: Cole's **published** `custom_plans.meta.name` was `Custom Season Race Plan M2O` while the draft already had it removed. **Jake fixed/published this on 2026-06-03.** Whether the taper targets Catalina vs Molokai was a coaching call left to Mick.

### Not done / follow-ups

- Jake is handling the reply email to Cole.
- Cole's pre-fix `prone-w*` rows (incl. a `prone-w1s1` dated 2026-06-02 that may have been a mis-namespaced Custom tick) are left as-is — indistinguishable and low-stakes; they count toward his lifetime "completed" stat only.
- Optional hardening: stamp a persistent per-week `id` in `admin-edit.html` on save + backfill existing custom plans, then key on that instead of the label/startDate slug — fully immune to label/date edits.

---

## ⭐⭐ 2026-05-23 (Sat, pm) — active-members outreach: tab, template, attribution-ready

The Outreach page now drives campaigns to the 24 paying members alongside the Shopify pool. Email body for the campaign was drafted + previewed to Jake & Mick this morning; sending is gated on Mick's approval. All plumbing is in and verified live.

### What changed

**Schema (migration 025, applied to prod):**

- `public.outreach_sends.member_auth_user_id uuid` — new nullable FK to `auth.users(id)` on delete set null.
- `outreach_sends_recipient_xor` CHECK constraint dropped and replaced with a three-way XOR over `(shopify_customer_id, newsletter_subscriber_id, member_auth_user_id)`. Existing rows remain valid; new member-targeted sends populate exactly the third FK.
- `outreach_sends_member_auth_user_id_idx` partial index on the new column for the per-campaign attribution query the engagement dashboard will run.

**Frontend — new "Active members" tab on `app/admin-outreach.html`:**

- Loads via `get_member_insights()` (the same coach-gated RPC `admin-insights.html` uses), so each member row carries `current_threshold_sec`, `last_threshold_at`, `sessions_completed_7d/30d/total` alongside name / plan / signed-up / last-sign-in / last-contacted.
- Stats row: Active members · Threshold not set · No sessions 30d · Last contacted.
- Filter pills: All · Progressive · Custom · Dormant. **Dormant** = no threshold ever set OR zero sessions in 30d — surfaces members most in need of this campaign. Dormant rows sort to top of the table and carry a small yellow chip on the name.
- Per-row Quick send + bulk "Send to selected" — both reuse the existing `send-email` Edge Function path and the same `personalize()` + unsub footer flow. Defaults to the new `active_member_checkin_2026_05` template in both pickers.
- Truth on the 24-member roster verified at deploy time: all 24 are currently on Custom plans, zero on Progressive. The Progressive=0 filter count is genuine, not a bug.

**Template registration (`assets/outreach-templates.js`):**

- New `active_member_checkin_2026_05` template entry alongside `newsletter_launch_2026_05`. Subject: "A quick check-in — and two small things that'll sharpen your training". Two-ask format (re-check threshold, tick off sessions) framed as athlete benefit, with a brief one-paragraph platform-update lead-in (pause/resume self-serve, calendar-1st billing). Text + HTML bodies, `{{first_name}}` placeholder.

**Cache hardening (`app/admin-outreach.html`):**

- Script tags for `outreach-templates.js` and `admin-outreach.js` now carry `?v=20260523-2` query strings. Cloudflare in front of `allpaddling.online` caches `/assets/*.js` with `max-age=14400` (4h); without versioning, JS deploys took up to 4h to actually reach users. Versioned URLs hit a distinct cache key and bypass the stale entry immediately. **Bump the `?v=` suffix on every future change to either of those JS files.**

### Verification done

- Migration 025 applied via Supabase MCP; constraint def verified post-apply (`outreach_sends_recipient_xor` is now `(shopify + newsletter + member) = 1`).
- Pages build status `built` for all three commits.
- Live admin-outreach.html opened in Chrome (Jake's session): Active Members tab present, 24 rows render with correct stats (24 / 23 / 23 / —), threshold "Not set" badge displays for the 23 unset, sessions 30d column shows the 0/7d/all-time breakdown, dormant chips on 23 rows.
- Filter counts verified after the case-sensitivity fix: All 24 / Progressive 0 / Custom 24 / Dormant 23.
- Both script tags confirmed loading via the `?v=` URLs (script audit via `document.querySelectorAll('script[src]')`).
- Email preview sent via direct Resend POST to Jake + Mick this morning (HTTP 200, message id `bd708752-bdfb-43f7-88fe-2c60d89f4b3f`). Awaiting Mick sign-off.

### Schema gotchas (worth knowing for next session)

- **`get_member_insights()` returns `plan` as `'Custom'` / `'Progressive'` (capitalized).** The CTE assembles them as string literals — not the lowercase table name. First pass of the filter predicates compared to lowercase and silently counted 0; fixed via `planKey()` lowercase normalizer that's now used consistently across visibleMembers, filter-count rendering and the row planLabel ternary.
- The function is `SECURITY DEFINER` with an `is_coach()` gate, so MCP `execute_sql` 403s when calling it directly (the MCP service-role isn't in the `coaches` table). Browser-side calls from a signed-in coach work fine. For SQL-level verification, query `progressive_members` + `custom_members` directly.

### Commits

- [`786e18e`](https://github.com/allpaddling/allpaddling-site/commit/786e18e520819b5d04888fd0ac9db8f13035fd33) — migration + template + tab + JS loader/send flow
- [`e8a5099`](https://github.com/allpaddling/allpaddling-site/commit/e8a5099ac61d7413953617f3dcdbba66000208c3) — planKey() case-insensitive plan filter
- [`3bec529`](https://github.com/allpaddling/allpaddling-site/commit/3bec52980bdfe8930b9276dcabc82eed3ffef456) — cache-bust query strings on the outreach script tags

### What's NOT done

- **The campaign has not been sent.** Mick is reviewing the email body; once approved, Jake fires it from the Active Members tab → Select all → Send to selected. Each send writes an `outreach_sends` row with `member_auth_user_id` populated, and the Resend webhook mirrors opens/clicks/deliveries back to those rows in real time via the existing engagement plumbing.
- **No cross-campaign attribution view yet.** Data is in place to build "who opened the email AND then updated threshold within 7d" — it's a single SELECT joining `outreach_sends.member_auth_user_id` → `auth.users.id` → `threshold_log` + `session_completions`. Defer until the campaign sends and there's data worth aggregating.
- **EMAIL_BCC will fan out 24 copies to Jake + Mick on send.** Audit-trail by design (see `reference_allpaddling_email_bcc.md`) but worth a Gmail filter rule to bulk-archive.
- **The `outreach_sends.shopify_customer_id` / `newsletter_subscriber_id` ↔ FK semantics in `admin-outreach.js` quick-send/bulk-send still bucket sends per the old two-FK pattern.** Member sends are routed through the separate `logMemberSend()` helper that sets `member_auth_user_id` instead. Both paths log to the same table; engagement queries are unified.

---

## ⭐⭐ PREVIOUS — 2026-05-23 (Sat, am) — engagement tracking (threshold + session completions)

Coaches now have visibility into who's actually doing the training, not just who's logging in. Two new tables plus an extended `get_member_insights()` plus two new columns on `admin-insights.html`.

### What changed

**Schema (migrations 023 + 024, both applied to prod):**

- `public.threshold_log` — append-only. Every time a member saves a new threshold pace, one row inserted. Columns: `user_id`, `threshold_sec`, `unit`, `recorded_at`, `source` (`'manual'` or `'backfill'`). RLS: member can insert/read own; coach can read all. No update/delete policies — history is immutable.
- `public.session_completions` — one row per session a member has marked complete. Unique on `(user_id, session_key)` so toggles upsert idempotently; unmarking deletes. Columns: `user_id`, `session_key` (e.g. `"prone-w1s1"`), `plan_key`, `completed_at`, `rpe`, `note`. RLS: member CRUD on own; coach read all. `updated_at` trigger for RPE/note edits.
- `get_member_insights()` extended with 6 new columns: `current_threshold_sec`, `threshold_unit`, `last_threshold_at`, `sessions_completed_7d`, `sessions_completed_30d`, `sessions_completed_total`. Same SECURITY DEFINER + `is_coach()` gate as before.

**Frontend (`assets/app.js`):**

- `pushThresholdToServer(thresholdSec, unit, source)` — inserts a `threshold_log` row.
- `pushSessionCompletionToServer(planKey, sessionKey, completedNow, rpe, note)` — upserts when `completedNow`, deletes when false.
- `patchSessionCompletionOnServer(sessionKey, patch)` — partial update of RPE/note on an existing row.
- `backfillEngagementOnce()` — one-time push of pre-existing `localStorage` state to the server, gated by flag `ap.engagementBackfilled_v1`. Runs from `mountApp()` after `enforceMemberGates()`/`renderPreviewBanner()`. Idempotent re-runs (across devices) are no-ops due to the unique constraint on session_completions; threshold_log rows are tagged `source='backfill'` for traceability.
- All helpers fail silently on no-session or network error — public pages and logged-out states never break.

**Wiring:**

- `app/threshold.html` — `commitSave()` calls `pushThresholdToServer()` when the threshold value (not just the unit) actually changed and is non-zero.
- `app/session.html` — Mark Complete toggle calls `pushSessionCompletionToServer()`; RPE/note `change` events call `patchSessionCompletionOnServer()`.

**Coach UI (`app/admin-insights.html`):**

- New sortable **Threshold** column: current value (m:ss /km or /mi) + a small relative-time pill ("Today", "3 days ago", "2 months ago") in the same colour-grading scheme as Last Active. "Not set" for members who haven't saved one yet.
- New sortable **Sessions done** column: big 30d number with a 7d / all-time breakdown beneath.
- Dropped the redundant "Sign-ins 7d" column to make room — Sign-ins 30d covers the same signal.

### Commit

[`dc2a333`](https://github.com/allpaddling/allpaddling-site/commit/dc2a333e59d593a489a71ffc247f8e2c1ce88bf9) — single commit, 6 files (2 migrations, 1 helper module, 3 page edits).

### Verification done

- Migrations 023 + 024 applied via Supabase MCP, return-shape confirmed.
- Manual CTE smoke test against current data: 24 rows returned (all 24 paying members), zero threshold rows, zero completions (expected on fresh deploy).
- GitHub Pages build status `built` at commit dc2a333e.
- Live admin-insights page loaded in Chrome — columns render correctly, "Not set" / "0" placeholders show as designed, no layout breaks. Screenshot taken during verification.

### Why these table names + design

`threshold_log` is append-only because we want trend lines later (threshold over time is a meaningful training-progress signal). `session_completions` is presence-equals-complete because coaches care about current state, not toggle history — the unique constraint plus upsert/delete keeps row count = checkmarks on screen.

Foreign keys target `auth.users(id)` rather than `progressive_members`/`custom_members.id` because a single user could in theory have both plan types, and the auth row is the stable identity. Both gate semantics (RLS, get_member_insights joins) already use `auth.uid()` as the identity key.

### What's NOT done

- The member-facing `threshold.html` history list still reads from `localStorage` only. Server-side history is available but not yet rendered there — would let members see their history across devices. Defer until someone notices.
- No "haven't trained in N weeks" coach alert yet. The data is in place to build one (`sessions_completed_7d=0` for a paying, recently-active member is the trigger).
- Existing 24 paying members will appear with "Not set"/"0" until their next login pushes a backfill. The backfill flag is per-browser, so a member who uses two devices will backfill from both (harmless — dup threshold rows OK, dup completions are upserts).

---

## ⭐ EARLIER — 2026-05-22 (Fri) — calendar-1st billing alignment

Big initiative landed: every paying customer now bills on the **1st of the month** (matching Mick's content-block cadence), and the signup flow auto-aligns new customers too. One pre-existing webhook bug found and fixed in passing.

### A. Aligned 15 of 24 active subs to bill on June 1, 2026 (silent)

Walked through one customer (Jacob Walding, sub_1TRv5i — May 30 renewal) as a pilot to prove the pattern, then batched. All 15 done via `trial_end=1780272000` (June 1 00:00 UTC) + `proration_behavior=none` on the existing Stripe sub.

Stripe auto-set `billing_cycle_anchor=June 1` as a side effect of trial_end, locking **all future renewals to the 1st of the month** forever (interval=monthly + anchor=1st). Mirror in Supabase synced cleanly on every one — `current_period_end=2026-06-01` in `subscriptions` for all 15.

### B. stripe-webhook patched (v29) — skip receipts for A$0 invoices

Setting `trial_end` on an active sub causes Stripe to fire an A$0 bookkeeping invoice → `invoice.paid` webhook → `handleInvoicePaid` was sending a real "Payment received" email for $0.00. Caught it when Jacob got the receipt. Fixed by guarding the email send on `invoice.amount_paid > 0`. Same guard also covers any future 100%-coupon edge case.

Proven by side-by-side log comparison: Jacob's update (v28, pre-fix) generated 10+ resend-webhook callbacks (real email sent). Paora's update + the 13-customer batch (v29, post-fix) generated **zero** resend-webhook callbacks. Silent.

Commit: [`abb8391`](https://github.com/allpaddling/allpaddling-site/commit/abb8391d66ec7faf59f39a311920e46e2568c138).

### C. Remaining 9 customers' fates decided

| Cohort | Subs | Status |
|---|---|---|
| **2 already-aligned by accident** (sub_1TS7PU, sub_1TS6QU — natural anniversary is on June 1) | 2 | No action ever needed |
| **2 full-paying past-June-1** (sub_1TT7t6 May 3, sub_1TTjfY May 5) | 2 | Decided to **leave on anniversary** — no alignment, no revenue loss |
| **5 ELITE-TEAM coupon customers** (sub_1TSmi4, sub_1TSwLh, sub_1TUDCb, sub_1TXTu8, sub_1TXxQc) | 5 | Scheduled task fires **Aug 28, 2026** to align their first paid bill to **Sep 1, 2026** via trial_end |

ELITE-TEAM coupon (`xP1FNZr5`): 100% off, duration: repeating, `duration_in_months: 4`. Counts billing applications, not calendar months. Each customer has already used 1 of 4 (signup invoice).

### D. create-checkout-session — day-of-month signup branching

New signups now auto-align via day-of-month (Sydney time):

- **Day 1–20 ("Pay-Now"):** one-time A$140 line item at checkout + `subscription_data.trial_end = next 1st`. Customer pays A$140 immediately for "this month"; recurring sub trials until next 1st, then A$140 fires on the 1st.
- **Day 21+ ("Free-until-1st"):** `subscription_data.trial_end = next 1st` only. $0 at checkout. Sub trials until next 1st. Avoids the "I paid A$140 for 3 days" perception.

Both branches use `trial_end` (not `billing_cycle_anchor`) because Stripe Checkout rejects `proration_behavior=none` when a one-time price is in line_items, and we need 'none' to suppress partial-period proration. Two false starts caught by Stripe API errors before landing on this pattern.

Sydney timezone used for day-of-month determination (helper functions `sydneyDayOfMonth()` + `nextFirstOfMonthUtcUnix()` at the bottom of the function). Anchor target is UTC midnight on the 1st (consistent with existing aligned subs).

Both branches smoke-tested today:
- Day 21+ via natural Sydney day (May 22+).
- Day 1-20 via a `_test_day` body parameter override (kept in the function as a debug hook).

MIGRATE mode keeps existing behavior (anniversary billing).

Commit (final): [`b509022`](https://github.com/allpaddling/allpaddling-site/commit/b509022bf8218d3938415391f9cd4ffb326e7055).

### E. verify_jwt flipped to false on create-checkout-session

MCP listing showed `verify_jwt:true` on create-checkout-session before today, which I briefly assumed had broken public ANON signups — but historical Supabase data verifies two clean ANON signups (May 1 + May 17) in that window. **ANON has been working.** I don't fully understand how given the gateway behavior I saw on curl, but the empirical data is unambiguous.

Today the function is back on `verify_jwt:false` (matching the original CLAUDE.md note) as a side effect of the alignment deploys (`--no-verify-jwt`).

### F. Pending actions to be aware of

- **Aug 28, 2026:** scheduled task `align-elite-team-to-sep-1` fires to handle the 5 ELITE-TEAM customers. Self-contained instructions in `/Users/jakedibetta/Documents/Claude/Scheduled/align-elite-team-to-sep-1/SKILL.md`.
- **Eventually:** 2 paying customers (sub_1TT7t6, sub_1TTjfY) stay on anniversary cadence forever. No future action required unless preferences change.

### Function inventory after today

| Function | Version | verify_jwt | Change |
|---|---|---|---|
| stripe-webhook | v29 | false | $0-receipt skip patch |
| create-checkout-session | v25 (approx) | false | day-of-month branching + `_test_day` debug hook |
| All others | unchanged | unchanged | — |

### Stripe key file

`.claude/secrets/stripe-secret-key.txt` now holds a fresh **restricted key** (`rk_live_...sGMpHS`, 107 bytes, perms 600) with Subscriptions: Write + Customers: Read. Used by curl loops from Jake's Mac. Sandbox can't reach api.stripe.com so all Stripe mutations are run locally by Jake.

---

## 2026-05-17 (Sun) — project complete: full day summary

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

### D. Domain transfers (allpaddling.com + allpaddling.online → Cloudflare)

Both domains in transfer from Crazy Domains to Cloudflare Registrar. Transfer cost: US$10.46 (.online) + US$27.70 (.com). Mick approved both transfers; Crazy Domains confirmed no further action required — transfers complete within 7 days of 2026-05-17.

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

## GitHub push pipeline

### PAT
- **Path:** `/Users/jakedibetta/Documents/AllPaddling/.claude/secrets/github-pat.txt` (chmod 600, stored inside the persistent AllPaddling folder so it survives Cowork restarts).
- **GitHub token name:** `cowork-allpaddling-site-MAY2026`
- **Scope:** fine-grained, allpaddling-site only, Contents: Read+Write, Metadata: Read.
- **Expires:** Never (no expiration set — fine-grained single-repo token, low blast radius).

### Network
- `github.com` and `api.github.com` are on the network egress allowlist.
- `raw.githubusercontent.com` is **not** on the allowlist — use the API contents endpoint (`api.github.com/repos/.../contents/{path}?ref=main`) to read files from the repo.

### Push pattern
Edit files locally → push via the GitHub Git Data API in a single commit (multiple files OK). The pattern: get current main ref → fetch base tree → create blobs for each file → create new tree → create commit → update ref.

File paths are the same locally and in the repo — no prefix stripping needed (the `rebuild/` dual-tree was eliminated 2026-05-17).

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

## Push script template

Use this as a base for any multi-file commit. Edit `FILES` and `MSG`; the session path glob (`/sessions/*/mnt/...`) resolves automatically.

```python
import json, base64, urllib.request, pathlib, glob

# Discover the current session mount dynamically
mnt = glob.glob('/sessions/*/mnt/AllPaddling')[0]
PAT = open(f'{mnt}/.claude/secrets/github-pat.txt').read().strip()

REPO = 'allpaddling/allpaddling-site'
BRANCH = 'main'
MSG = "<commit message here>"
ROOT = pathlib.Path(mnt)

# Local path → repo path (same path, no prefix stripping needed)
FILES = {
    'app/dashboard.html': ROOT / 'app/dashboard.html',
    'assets/app.js': ROOT / 'assets/app.js',
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
