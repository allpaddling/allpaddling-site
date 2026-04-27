# Decision briefing — what we need from Mick

Everything below is gating the migration emails. Once these are answered we can press send.

This doc is structured so Jake can walk Mick through it line by line. Each section has the question, the context, and a recommended default if Mick wants to defer the call.

---

## DECISIONS — captured 2026-04-27 (call with Mick)

| # | Decision | Choice |
|---|---|---|
| 1 | Pricing approach | **B. Reset everyone to A$140/month.** Migrating Custom customers don't keep their old USD/AUD/CAD/NZD rates — they all move to a single AUD price. Most current Custom customers will see a price decrease ($140 AUD ≈ $93 USD; existing rates ranged $93–$173 USD). Stripe products/prices already set up at this price. |
| 2 | arodriguez1907 (dual-sub) | **Migrate both** subscriptions (Custom + SUP Progressive). |
| 2 | jp.okeefe7 (Micah Iverson) | **Address by name (Micah)**, not email handle. **General rule: always use the customer's registered name in emails, not the email-derived handle.** |
| 2 | jamesharpercase24 (Feb 2027 renewal) | **Skip on first wave.** Deal with last, after the Feb 2027 renewal date approaches. |
| 3 | Failed-card retries | **4 retries over 14 days** (Stripe Smart Retries default). |
| 3 | Refunds | **No refunds.** Reasoning: once a customer has paid and accessed the program content, they could refund-and-keep — refusing refunds protects the IP. |
| 3 | Mid-cycle cancel | **Access continues until period end.** No pro-rata refund (consistent with no-refund policy). |
| 4 | GST registration | **Not registered.** Skip Stripe Tax. Revisit if revenue approaches the $75k AUD threshold. |
| 5 | Member email from-address | **`Mick at All Paddling <mick@allpaddling.online>`** |
| 6 | Email forwarding on the .com domain | Defer — revisit before the .com nameserver flip. |
| 7 | Paused / cancelled customer outreach | Defer — revisit after active-cohort migration completes. |
| 8 | Stripe live-mode go-ahead | Mick is doing identity verification + bank setup with Jake; Jake will trigger live-mode product setup once done. |

### Implications captured into code

- `setup-stripe-products.ts` already creates `custom_race` at A$140 — no change needed.
- Migration runner / `admin-migrate.js` should use the standard `custom_race_monthly_aud` lookup_key (not inline `price_data` per customer) since everyone resets to A$140.
- `migration_customers.status` for jamesharpercase24 should be set to `'deferred'` so the runner skips them.
- All migration emails should use the `name` field from `migration_customers` directly, not derive a name from the email address.
- `EMAIL_FROM` Supabase secret: `Mick at All Paddling <mick@allpaddling.online>`.
- Stripe refund window: not configured (Stripe defaults still allow manual refunds; the policy is documented externally).

---

## 1. Pricing approach for existing customers

**Decision needed:** when migrating the 21 active Shopify subscribers to Stripe, do we **grandfather each customer's exact current rate**, or **reset everyone to a new common price**?

**Why it matters:** the audit revealed Custom Season Race Plan has been priced bespoke per customer:

- 8 distinct USD price points: $93, $94, $96, $97, $101, $102, $103, $173
- Plus AUD ($140), CAD ($136), NZD ($173, $166)

**Three options:**

| Option | What it means | Trade-off |
|---|---|---|
| **A. Grandfather** | Each customer keeps the exact rate they pay now | Most customer-friendly. No hard conversation. The migration emails just say "same as today." Best for retention. |
| **B. Reset to one new price** | Everyone moves to one new common price (e.g. $140 AUD across the board) | Cleaner ongoing pricing. But up to 8 customers see a price change — some up, some down. Risk of churn. |
| **C. Hybrid** | Grandfather existing customers; new customers pay a single new rate | Complex to communicate but minimises churn while cleaning up future pricing. Already what the build supports. |

**Default if deferred:** Option A (grandfather). That's what the build is currently set up to do — `create-checkout-session` in MIGRATE mode uses inline `price_data` with each customer's exact `amount_cents` from the Appstle export.

---

## 2. Edge-case customers

Three rows in the audit need explicit calls.

### 2.1 arodriguez1907@gmail.com — duplicate active subs

This email appears **twice** in the active subscriptions:

- **Custom Season Race Plan** · USD 96 · next renewal 11 May
- **Stand Up Paddleboard Progressive Plan** · AUD 80 · next renewal 21 May

**Question:** Are both intentional (he's running both programs), or is one a leftover that should be cancelled?

**Default if deferred:** Migrate both. He keeps paying both rates until he tells us otherwise.

### 2.2 jp.okeefe7@gmail.com — name/email mismatch

The Shopify customer name on this subscription is **"Micah Iverson"** but the email is **jp.okeefe7@gmail.com**. Country is US but currency is AUD. Renews 1 May.

**Possibilities:**
- Micah uses jp.okeefe7's email (family member, coach paying for him, etc.)
- Data entry error in Shopify

**Question:** Who do we address the migration email to — "Micah" or "JP"? And which email is the right one to send to?

**Default if deferred:** Email goes to `jp.okeefe7@gmail.com` addressed to "JP" (since that's what the email implies). Mick can correct in Stripe after signup.

### 2.3 jamesharpercase24@gmail.com — Feb 2027 renewal

Status is "active" but next renewal is **2027-02-12** (10 months away — has clearly skipped multiple cycles via Appstle's pause feature, but Appstle still shows him as active).

**Question:** Treat him as active and migrate him with the others, or skip?

**Default if deferred:** Skip on the first wave. He's not renewing soon, so there's no time pressure. Add a note to revisit in early 2027.

---

## 3. Email forwarding at hostyourservices.net

When we eventually flip allpaddling.com nameservers off the old webdev's hosting (after migration is done), any email forwarding configured there will silently break.

**Question:** Does Mick have any email forwarding set up — e.g. `mick@allpaddling.com` → `dibetta1@gmail.com`, or `info@allpaddling.com` → `mick`?

**If yes:** we'll need to recreate the forwards on Cloudflare or Resend before the cutover.

**If no:** safe to switch nameservers without preserving anything.

**Default if deferred:** Don't switch nameservers on `.com` until Mick confirms. The migration uses `allpaddling.online` (already in our control), so this isn't blocking.

---

## 4. From-address for transactional emails

Resend is already verified on `send.allpaddling.online` (DKIM + SPF live in Cloudflare DNS). So transactional emails *can* send from anything `@send.allpaddling.online`.

**Question:** What from-name + from-address does Mick want?

**Options:**

- **`Mick at All Paddling <mick@send.allpaddling.online>`** — most personal
- **`All Paddling <hello@send.allpaddling.online>`** — most generic
- **`Mick at All Paddling <noreply@send.allpaddling.online>`** — discourages replies (worse UX)

**Default if deferred:** Option 1 (`mick@send.allpaddling.online`). Customers can reply, replies route back to Mick's inbox. Most aligned with the coaching brand.

---

## 5. Refund / dunning policy

When a Stripe Checkout fails (card declined), what's Mick's preference?

**Question (a):** How many retry attempts before treating the subscription as past-due?

**Question (b):** If a customer asks for a refund (within X days, full or partial?), what's the policy?

**Question (c):** When someone cancels mid-cycle, do they keep access until the period ends, or get pro-rata refunded?

**Default if deferred:**

- 4 retry attempts over 14 days (Stripe Smart Retries default)
- No refunds after first 7 days; refund within 7 days is full
- No pro-rata; access continues until period end (cleaner for the coach)

---

## 6. GST registration status

The ABN we have (52173453156) is for a sole trader. Australian GST registration is mandatory once turnover exceeds $75k AUD/year.

**Current annual revenue from the audit:** ~$30k AUD. Below the threshold.

**Question:** Is Mick **already** GST-registered (e.g. registered voluntarily)?

- **If yes:** We need to enable Stripe Tax with his GST registration date so prices include GST for AU customers.
- **If no:** Skip Stripe Tax for now. Watch the revenue counter; flip it on when we approach $75k.

**Default if deferred:** Skip Stripe Tax until Mick confirms. Worst case we re-enable later.

---

## 7. Stripe account ownership + access

Before any of this works, Mick needs to:

1. Create a Stripe account at stripe.com using **his** email (recommended `dibetta1@gmail.com` for consistency with his admin login)
2. Complete identity verification (driver's licence photo)
3. Add bank account for payouts
4. Add Jake as a Team Member with Admin access (so Jake can configure technical bits without sharing Mick's password)

**The setup checklist** is at `migration/Mick_Stripe_signup_checklist.md` — that doc is ready to send him as a heads-up before the call.

**Default:** schedule a 15-min call with Mick to do this on a screen share. Without his account, nothing else moves.

---

## 8. Communication strategy with paused / cancelled customers

The audit also contains **19 paused** and **40 cancelled** historical customers.

**Question:** Are we communicating with these groups too?

**Recommended approach:**

- **Paused (19):** Send a short "we're moving — when you come back, here's where to sign up" email. Lower urgency. Could go in a second wave after the active migration is done.
- **Cancelled (40):** No outreach. Migration only concerns active billing relationships. Win-back campaign is a future project, separate from this migration.

**Default if deferred:** Active wave first. Paused wave 2 weeks later. Cancelled — leave alone.

---

## Quick checklist for the call

| Topic | Decision needed |
|---|---|
| Pricing approach | Grandfather / reset / hybrid? |
| arodriguez1907 dual-sub | Migrate both? |
| jp.okeefe7 / Micah Iverson | Email to JP or Micah? |
| jamesharpercase24 (Feb 2027) | Migrate or skip? |
| Email forwarding at hostyourservices.net | Any to preserve? |
| Resend from-address | mick@send.allpaddling.online? |
| Refund / dunning policy | 4 retries, 7-day refund window OK? |
| GST registration | Already registered? |
| Stripe account creation | Schedule 15-min call |
| Paused customer wave | Wave 2 in 2 weeks? |

---

## Once we have these answers

1. Run `setup-stripe-products.ts` against the live Stripe key
2. Set Supabase secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`)
3. Deploy the Edge Functions
4. Run `migration-runner.ts --dry-run` to verify
5. Run `migration-runner.ts` for real
6. Mass-send the emails (or click through admin-migrate.html one by one)
7. Update statuses as customers sign up

Total elapsed time once Mick's Stripe account is verified: ~1 hour to get the first migration email out the door.
