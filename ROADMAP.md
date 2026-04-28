# All Paddling — Launch Sprint Roadmap

**Goal:** scale signup + content delivery so Mick stops being the manual bottleneck **without losing any of the ~20 customers paying on the existing allpaddling.com setup**. Ship in 4 weeks; migration completes 4–6 weeks after.
**Stack:** GitHub Pages + Supabase (auth, RLS, plans tables) + Resend (verified on `allpaddling.online`) + Stripe (live, fully wired as of 2026-04-27).
**Live site:** https://allpaddling.online (since 2026-04-26)

---

## Current state (2026-04-27 — Stripe live, one redeploy from migration day)

### What works end-to-end
- **Auth:** magic-link OTP + Google OAuth, both gates (member login + coach admin). OAuth in Production mode.
- **Stripe live mode:** products + prices, webhook destination, all secrets. One real A$1 test signup completed end-to-end.
- **Migration data:** 20 active customers loaded with reset pricing (A$140 Custom / A$80 Progressive AUD per Mick's Decision B). 1 customer (James Case) on_hold for the first wave.
- **Mick's 8 decisions captured** in `migration/Mick_decision_briefing.md` (top of doc).
- **Public site cleanup:** phone + personal Gmail removed, replaced with `hello@allpaddling.online` (Cloudflare Email Routing live).
- **Welcome flow** branched by plan_type: Progressive members get instant-access copy, Custom members keep wait language.

### Migration runner is one command away
- `setup-stripe-products-live.sh` — Stripe products in live mode (DONE)
- `migration-runner-live.sh --only-email <addr>` — single-row real run for testing
- `migration-runner-live.sh` (no flags) — full real run for all 19 active customers
- After redeploying the bug-fix Edge Functions (commit `98e5beb1`), the next test signup should land cleanly: onboarding popup fires, coach admin can open the new member's plan, runner script no longer "Invalid user JWT"-errors.

### Known bugs — fixed in code, awaiting redeploy

1. ~~Onboarding popup didn't fire after live signup.~~ Webhook now upserts `member_profiles` row with `completed_onboarding_at = null`.
2. ~~Coach admin "this member could not be found".~~ `custom_members` upsert now populates `auth_user_id`.
3. ~~Migration runner "Invalid user JWT" against live function.~~ `create-checkout-session` now accepts JWT-decoded service_role role claim.

To deploy:
```
supabase functions deploy stripe-webhook --no-verify-jwt --project-ref crlukzkgmydyqpwndjvc
supabase functions deploy create-checkout-session --project-ref crlukzkgmydyqpwndjvc
```

### What's still missing / future-roadmap

- **Coach notification email** when a new member signs up — Mick currently only sees new members via admin-members.html refresh. Easy add: second `sendTransactional` call in webhook with new `new-member-signup` template addressed to Mick.
- **Cancel / pause / payment-method update** member-side UI — coach can do these via Stripe Dashboard for now.
- **Block-delivered email** when Mick publishes a new 4-week block — template exists, scheduler doesn't.
- **Refactor migration runner** to use `custom_race_monthly_aud` lookup_key instead of inline price_data (cleaner Stripe records now that pricing is uniform). Functional, just stylistic.
- **Refund the two A$1 test charges** from Stripe live dashboard.

---

## Historical: state as of 2026-04-26

> **NOTE:** the Decision-1/2/3 options below and the churn mitigations were the pre-call options framing. **Final decisions are captured in `MICK_AGENDA.md`.** Most relevantly: Mick's Decision B (2026-04-27) overrides the cadence options (D-1) — every migrating customer is reset to the uniform new rate (A$140 Custom / A$80 Progressive every 4 weeks) with **no grandfathering**. Any reference below to grandfathering or "match-monthly" is historical context only.


### What works end-to-end
- Magic-link OTP auth via Supabase (URL-allowlisted for `allpaddling.online/**`)
- Custom + Progressive plan delivery to authenticated members (RLS-gated)
- **Calendar-cohort + primer routing** — new joiners see the shared primer for first 28 days, then merge to the discipline-specific cohort
- Admin pages for plan editing + publish, with snapshot history
- Static marketing pages (home, plans, custom-plan, about, ergos, blog)
- **Cross-role nav** — coach can switch between Member view and Coach Admin via sidebar pills
- **Strength Program** — 16 exercises across two functional strength routines, available to all member tiers
- **Customer migration tool** — coach-only admin page for generating per-customer Stripe Checkout signup links

### What's scaffolded and waiting on Mick
- **Stripe Checkout** — `create-checkout-session` Edge Function built (SELF + MIGRATE modes); `setup-stripe-products.ts` ready to run; `stripe-webhook` handler complete. Subscribe buttons on `custom-plan.html` and the 4 Progressive plan pages call `startCheckout()`. **Blocked only on Mick creating his Stripe account with ABN 52173453156.**
- **Resend transactional email** — domain verified (`send.allpaddling.online` has MX + DKIM + SPF in Cloudflare DNS); 6 templates ready; `send-email` Edge Function ready. Blocked on the from-address decision (default: `mick@send.allpaddling.online`).
- **21 active Shopify customers seeded** in `migration_customers` table. `migration-runner.ts` + `admin-migrate.html` ready to generate per-customer migration emails the moment Stripe is live.

### What's still missing or future-roadmap
- **4-week delivery cadence scheduler** — referenced in copy but the calendar-cohort model now means Mick simply publishes the next block when he wants; no auto-rollover. Block-delivered email when he publishes is still TBD.
- **Self-service settings** — no cancel, no pause, no payment-method update UI for members. Coach can do all of these via Stripe Dashboard for now.
- **Admin observability dashboard** — sub count, MRR, churn metrics. Some of this was built earlier in `admin-overview.html`.
- **RLS audit** — done in migration `004` for the new tables.

---

## What we're optimising for

The roadmap is ordered around three questions:
1. Can a new paddler sign up, pay, and start training without Mick touching anything?
2. Can Mick monitor and intervene from one place once they're in?
3. **Can every one of the existing 20 paying customers be migrated across with zero service gap and zero double-charging?**

Everything that doesn't move one of those three needles is parked. The build (Track A) and the migration (Track B) are run as parallel workstreams — Track B's prep begins Week 1, but customer-facing migration only starts once Track A's Week 4 exit criteria are met.

---

## Week 1 — Payment + signup loop *(unblocks everything else)*

The single biggest leverage item. Until this is live, manual member-add caps growth at ~10–20 users.

- **1.1 Stripe account + product setup** *(Mick / Jake)* — AUD subscription product at $140 / 4 weeks for Custom Season Race Plan; same shape for Progressive ($/4 weeks tbd). Tax/GST settings. Test mode keys.
- **1.2 Stripe Checkout redirect from `custom-plan.html` Subscribe button** — collect email, create Stripe Customer + Subscription, redirect to thank-you page.
- **1.3 Subscription state in Supabase** — new table `subscriptions(user_id, stripe_customer_id, stripe_subscription_id, status, current_period_start, current_period_end, cancel_at, billing_anchor_date)` plus columns linking it to `custom_members` / `progressive_members`.
- **1.4 Webhook handler (Supabase Edge Function)** — listen for `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated/deleted`. On first paid invoice, auto-create the matching `*_members` row. Idempotent.
- **1.5 12-week cancel-lock** — store `cancel_unlocks_at = first_paid_at + 12 weeks` in subscription metadata. Self-service cancel UI checks this before allowing.
- **1.6 First-login race fix** — `getCurrentMemberProfile()` (`admin.js:760`) currently fails if read replicas haven't caught up. Add 3× retry with backoff, or have webhook write member row before redirecting from Stripe.
- **1.7 Test card matrix** — successful sub, declined card, 3DS, cancel mid-period, reactivate.

**Exit criteria:** From a clean browser, paddler can hit `/custom-plan.html`, click Subscribe, pay with a test card, get redirected to dashboard, and see "your plan is being prepared" — with a row in `subscriptions` and `custom_members`, all without Mick.

---

## Week 2 — Email + 4-week delivery cadence

With paying members coming in, we need automated delivery so Mick isn't manually re-publishing every 4 weeks.

- **2.1 Resend domain auth** — DKIM/SPF on `allpaddling.com` (or `.online` — pick one as the from-domain). Verify deliverability to Gmail/Outlook/iCloud.
- **2.2 Transactional email templates** — welcome, payment-receipt, plan-ready, block-N-delivered, payment-failed (dunning), upcoming-renewal-reminder. HTML + plain-text.
- **2.3 Edge function: send transactional email** — single function `sendEmail(template, to, vars)` callable from webhook + scheduled jobs.
- **2.4 Custom plan: multi-block staging** — refactor `custom_plans` so a member's plan is a sequence of blocks (block_1, block_2, …) instead of one document. Admin UI in `admin-edit.html` gains tabs for each block, with `publish_at` dates.
- **2.5 Scheduled job (Supabase `pg_cron` or daily Edge Function)** — runs daily; for each active sub, checks if today is a block boundary, promotes next block to "current," fires `block-N-delivered` email.
- **2.6 Dashboard "next block" indicator** — show "Block 2 unlocks in 7 days" so members know what's coming.

**Exit criteria:** A test member with a 12-week plan auto-receives an email on day 28 and day 56 with the next block live in their dashboard. Mick uploads block 2/3 in admin once and doesn't touch the system again until block 4 needs writing.

---

## Week 3 — Self-service + observability

At 50+ users, every avoidable support ticket compounds. Mick needs visibility; members need to handle their own basics.

- **3.1 Member settings page (`app/settings.html` is already stubbed)** — cancel subscription (with 12-week-minimum check), update payment method (Stripe Customer Portal redirect), view billing history.
- **3.2 Admin dashboard** — top-level view: active subs count, MRR, last-7-day signups, payment failures, members about to roll into next block this week, churn last 30 days. Backed by SQL views over `subscriptions`.
- **3.3 First-login onboarding** — collect goal race + date, weekly training hours, ability/experience, discipline preference. Stored in `member_profiles`. Pre-fills Mick's view when he writes their first custom block.
- **3.4 "Plan is being prepared" empty state** — between Stripe payment and Mick publishing block 1, members should see a holding screen with expected delivery time, not an empty dashboard.

**Exit criteria:** Member can cancel/pause without contacting Mick. Mick opens admin dashboard and within 30 seconds knows: who paid this week, who churned, who needs block 2 written.

---

## Week 4 — Audit, polish, soft launch

- **4.1 RLS policy audit** — explicit test cases: member A cannot read member B's plan; member cannot read draft columns; admin role has expected privileges; logged-out user gets nothing.
- **4.2 Error handling + partial-failure recovery** — `addCustomMember` partial failure (member created, plan failed) must log to a recovery queue Mick can replay.
- **4.3 Progressive plan HTML consolidation** *(parked thread #1)* — fold `plan-{prone,sup,oc,ski}.html` into a single template + discipline param. ~75% code reduction, no UX change.
- **4.4 Load smoke test** — simulate 50 concurrent signups against staging. Verify Stripe webhook latency, email delivery, RLS query times.
- **4.5 Pre-launch checklist** — analytics tagging (Plausible or GA), Sentry-style error logging, support email auto-responder, ToS + Privacy + Refund policy pages, Stripe live keys, monitoring alerts on payment failures.
- **4.6 Soft launch + start migration cohort** — system is production-ready. The first wave of existing customers (those whose billing anniversary falls in Weeks 4–5) begins the migration flow per Track B.6. Optionally invite 1–2 net-new paddlers in parallel to confirm signup-from-cold path.

**Exit criteria:** First migrated customer is live on new system with no service gap. System ready for the rest of Track B to roll through.

---

---

## Track B — Migrating the existing ~20 paying customers

**Non-negotiable constraint:** zero customer lost, zero service gap, zero double-charge.

**Approach: phased per-customer cutover at natural billing anniversaries.** For 20 customers Mick already has a relationship with, a personalised migration is faster, safer, and lower-friction than a hard cutover. Each customer migrates on the day their next renewal would have hit the old system — they cancel old + charge new in the same window, no overlap, no gap. Mick handles outreach personally.

### Existing site reconnaissance (Apr 2026)

Inspected `allpaddling.com` directly. Confirmed:

- **Platform:** Shopify, theme "Dawn", shop handle `justpaddle.myshopify.com`, vendor "JUSTPADDLE", AUD currency.
- **Subscription billing:** **Appstle Subscriptions** app on Shopify Payments. Each plan = Shopify Product + Appstle Selling Plan.
- **Product catalogue + pricing (existing vs new site):**

  | Plan | Existing (Shopify/Appstle) | New site | Delta |
  |---|---|---|---|
  | Prone Progressive | $80/month | $80 / 4 wks | ~8.7% effective annual ↑ (13 vs 12 cycles) |
  | SUP Progressive | $80/month | $80 / 4 wks | same |
  | OC Progressive | $80/month | $80 / 4 wks | same |
  | Ski Progressive | $80/month | $80 / 4 wks | same |
  | Custom Season Race Plan | $140 (period TBC) | $140 / 4 wks | likely same; confirm Custom period via Appstle |
- **Member portal:** standard Shopify customer accounts at `/account`. No content portal on Shopify itself — actual plan delivery happens outside the platform (assumed: Mick emails PDF or shares Drive link).
- **Customer data:** all 20 customers' contact + billing + subscription state is in Shopify Admin + Appstle dashboard, both behind `justpaddle.myshopify.com/admin`.

### Decisions arising from reconnaissance

**D-1. Cadence change (monthly → 4-weekly).** Both sites price Progressive at $80 and Custom at $140 — *but* old is monthly (12 cycles/yr) and new is 4-weekly (13 cycles/yr). That's an ~8.7% effective annual increase. Options:
- (A) **Don't draw attention to it** — migrate customers as-is; most won't notice that "Aug 1, Sep 1, Oct 1" became "every 28 days." Low risk if Mick's outreach is warm.
- (B) **Match cadence** — change the new site's billing from 4-weekly to monthly, accept the small revenue dip.
- (C) **Be transparent + grandfather monthly** — keep migrated customers on monthly, only new signups go to 4-weekly.

Recommendation: A — silent absorb. The cadence framing is a Stripe configuration choice; either schedule works equally well in our delivery model. Revisit only if customer complaints surface.

**D-2. Domain decision.** `allpaddling.com` is the established Shopify-hosted domain. New site is on `allpaddling.github.io/allpaddling-site/`. Plan: at Track A exit, point `allpaddling.com` DNS at the new site. Old Shopify storefront either redirects fully or stays as a read-only archive for the duration of Track B. This *must* be sequenced so existing customers' /account links continue to work — likely means a cutover only after the last customer migrates, not at launch.

**D-3. Custom plan period parity.** $140 on existing site is presumed monthly; new site is $140/4wk. Confirm via Appstle admin once access is granted. Likely the same minor-cadence delta as D-1.

### Outstanding diagnostic questions (still need answers)

- **Q-1 [BLOCKER]:** Jake doesn't yet have admin access to `justpaddle.myshopify.com` or Appstle. Mick (or the private dev) needs to add Jake as a Shopify staff member with Customers + Orders + Apps read permissions. Until this lands, B.1 (audit) cannot start.
- **Q-2:** How does Mick currently deliver plan content to subscribers — PDF email, Google Drive link, something else? Determines what we need to port for B.5 (plan content port).
- **Q-3:** Does Mick have a customer training-history record outside Shopify (Excel? notes app? coaching CRM?) — relevant for whether B.5 can preserve continuity.
- **Q-4:** Confirm Custom Race Plan billing period via Appstle admin once access lands.

### Workstream tasks

**B.1 Customer audit (Week 1)** — single source-of-truth spreadsheet with: name, email, current plan, payment platform, last paid date, next renewal date, billing amount, current plan content, training history reference. Mick + Jake co-own.

**B.2 Communications plan (Week 1–2)** — drafts of:
- Migration announcement email (sent to all 20 at start of Week 3)
- FAQ page covering: what's changing, what's not, pricing, timeline, what they need to do, what happens if they don't act
- Per-customer outreach script for Mick (personal, warm, addresses each by name)
- Two-week-pre-renewal reminder email template

**B.3 Domain + email continuity (Week 1)** — decision and DNS work for the canonical domain. If `.com` is moving, plan the DNS cut so existing customer logins to `allpaddling.com` continue to work during migration. Email from-domain follows the same decision.

**B.4 Pre-create member rows (Week 3)** — for each known customer, pre-insert into `progressive_members` or `custom_members` keyed on their existing email, with a `migration_pending: true` flag. When they sign up on the new site with that email, they're recognised instantly — no Stripe-creates-a-second-account collision, no manual reconciliation.

**B.5 Plan content port (Week 3)** — for each Custom-plan customer, port their current block content into the new schema as their starting block. For Progressive customers, set their `plan_key` to the right discipline. Don't lose their training history.

**B.6 Personal outreach + per-customer cutover (Week 4 → Week 8–10)** — phased by billing anniversary:
- 2 weeks before renewal: Mick personally messages the customer. Briefly explains the move, links the FAQ, asks them to sign up on the new site with their existing email.
- Customer signs up → Stripe Checkout → first paid invoice → recognised against their pre-created member row → Mick verifies and clicks "complete migration" in admin.
- Old billing is cancelled in the same admin action.
- Customer's first 4-week block on the new system is the same content they were already getting (continuity, no surprises).

**B.7 Fallback for hesitant customers** — keep a manual arrangement available indefinitely (Mick emails plans, manual invoice) for anyone uncomfortable with the new flow. No customer is forced. Track this in the audit sheet.

**B.8 Migration completion review** — when all 20 are over, sunset the old payment infrastructure. Old site can either redirect or stay up read-only.

### Migration-specific risks

- **Service gap** — old plan delivery stops before new system delivers block 1. Mitigation: Mick uploads each migrated customer's block 1 to admin *before* their migration day. Day 1 on new system, content is already there.
- **Double-charge** — old + new both bill in the same period. Mitigation: explicit "cancel old → wait for confirmation → start new" sequence in B.6 with a buffer day. Document this; don't rely on memory.
- **Email mismatch** — customer signs up with a different email than the old system has on file. Mitigation: pre-created member rows in B.4 + outreach script explicitly says "use the same email you have with us today."
- **Training history loss** — customer's progress on the old system isn't on the new. Mitigation: B.1 audit captures everything; B.5 ports it. If history can't be ported (different schema, no export), surface a "Previous plans" link to the old site for read-only access for some grace period.
- **Migration-induced churn** — some will treat the friction as a reason to leave. Mitigation: Mick's personal outreach (not bulk email), grandfathered pricing if they're paying less than $140/4wk, possibly a goodwill block (e.g. "your first 4 weeks on the new system are on us") for the early-anniversary cohort.
- **DNS / domain transition breakage** — moving the canonical domain mid-migration could break existing logins. Mitigation: B.3 happens before customer-facing migration begins; test that old URLs redirect cleanly.

### Track B exit criteria

All 20 customers either: (a) on the new system with active Stripe subs and their next-block content uploaded, or (b) explicitly opted into the manual fallback per B.7. Old billing fully sunset. Customer-loss count: 0.

---

## Parked / post-launch backlog

- Pause / skip-week feature
- Discipline switch (member changes from Prone to SUP mid-subscription)
- Annual pricing tier (12-month upfront)
- Coach-to-member messaging inside the app
- Mobile PWA polish
- SEO pass on landing pages
- Blog content engine

---

## Open questions for Jake + Mick

**Build (Track A):**
1. **Stripe entity** — Australian-registered, AUD pricing, GST handling. Mick has an ABN already?
2. **From-domain** — emails sent from `team@allpaddling.com` or `.online`? Tied to the canonical-domain decision below.
3. **Block production cadence** — can Mick produce a member's blocks 2/3/4 ahead of time, or is each block written 1–2 weeks before delivery? Affects admin UI design (batch upfront vs. just-in-time).
4. **Progressive plan pricing** — same $140/4wk as Custom, or cheaper given less personalisation?
5. **Refund policy** — full refund inside 12-week minimum if they cancel? None? Pro-rated?

**Migration (Track B) — answered by reconnaissance, see Track B section:**
- ~~Existing platform?~~ Shopify + Appstle Subscriptions
- ~~Existing payment processor?~~ Shopify Payments via Appstle
- ~~Plan-type breakdown of the 20?~~ Need admin access to confirm exact split
- ~~Current billing cadence?~~ Monthly (Progressive confirmed; Custom presumed)
- ~~Customer data exportable now?~~ Yes, once Shopify staff access is granted
- ~~Canonical domain decision?~~ Plan: `allpaddling.com` repointed to new site at end of Track B
- ~~Pricing parity?~~ **Yes** — $80/$140 same headline price. Only delta is monthly → 4-weekly cadence (~8.7% effective ↑). See D-1.

**Live blockers:**
- **Q-1** Shopify admin access for Jake (escalate to Mick)
- **Q-2** How is plan content currently delivered to customers?
- **D-1** Cadence: silent absorb, match-monthly, or grandfather monthly

---

## Risk register (build)

- **Stripe + 12-week cancel-lock** is a custom enforcement (Stripe doesn't natively block cancel for X periods). If a member calls Stripe directly to cancel, our metadata can't stop it. Mitigation: clear ToS, refund policy, and gracious exception handling.
- **Email deliverability** to Gmail/Outlook can take days to warm up. Start Resend setup early in Week 1, not Week 2.
- **Mick's content production** is the unspoken bottleneck — the system can deliver plans on a 4-week rhythm, but only if he's writing them at that rhythm. Validate his bandwidth before launch.
- **Magic-link delivery latency** — if Resend is slow on the first login attempt, conversion drops. Monitor median delivery time.

(Migration-specific risks live inside Track B above.)
