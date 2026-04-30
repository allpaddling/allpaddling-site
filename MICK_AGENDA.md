# Daily check-in with Mick — agenda

Running agenda for Jake's daily check-ins with Mick. Add new topics
under "Up next" as they come up; check things off as you go through them
in the meeting.

The structure has three layers:

1. **Up next** — one-off topics for the next check-in.
2. **Standing topics** — recurring questions to walk through every meeting (skip if nothing relevant).
3. **Standing data** — numbers Mick should know each week (or that you should bring).

Add to "Up next" any time something comes up between meetings. After the meeting, move resolved items into the change log at the bottom (optional — only worth it if there's a decision worth remembering).

---

## Up next

> Most important / most urgent at the top. Drag stuff up/down.

- [ ] **Two new features shipped 2026-05-01 — heads-up only.**
   - *Block-freshness reminders on Coach Admin.* Each cohort tile (Prone/SUP/OC/Ski) on `/app/admin.html` now shows a colored dot — green <21d since publish, amber 21–28d, red >28d — and a top-of-page banner lists any blocks due/overdue. Primer is excluded (it doesn't roll on the calendar). Currently everything's green (last publish 2026-04-27).
   - *Members can self-graduate from the Primer block.* The settling-in banner on the dashboard now has a "Move to cohort training →" button that flips `progressive_members.primer_completed=true` for that member. **One-way for the member**: if they regret it, Mick can flip them back from `admin-progressive.html` (coach UPDATE policy still grants this). Confirm dialog warns them. No effect on Custom members.
   - Behind the scenes: new RPC `graduate_from_primer()` + migrations 013/014.

- [ ] **Inbound email fan-out from Mick to Jake.** Walk Mick through setting up a Gmail filter on `dibetta1@gmail.com` so customer replies to `hello@allpaddling.online` (which currently route only to him) auto-forward to `jakedibetta@gmail.com`. Steps for Mick:
   1. Gmail → ⚙ Settings → "See all settings" → "Forwarding and POP/IMAP" tab → "Add a forwarding address" → enter `jakedibetta@gmail.com` → confirm code (Jake will get an email to confirm).
   2. Then Settings → "Filters and Blocked Addresses" → "Create a new filter" → From: `*@allpaddling.online` → "Forward it to: jakedibetta@gmail.com" → Create.
   3. Result: anything inbound to Mick from the AllPaddling domain auto-fans-out to Jake.

- [ ] **Migration heads-up batch (T-7).** Plan: send to 1 customer first to eyeball the live email, then the remaining 19 once that looks good. Walk Mick through what to expect (replies will come in over the next ~7 days; T-3 batch fires 4 days from now).

- [ ] **Confirm Decision B pricing isn't going to surprise anyone.** All 20 customers reset to A$140 (Custom) / A$80 (Progressive). Mick agreed, but worth double-checking he's still happy if anyone pushes back when the T-3 email lands with the new rate.

## Standing topics — walk through these every check-in

### Migration progress

- New signups since last check-in? (admin-migrate page, "Migrated" tab count)
- Anyone replied with a question Mick needs to answer?
- Anyone in `lapsed` who Mick wants to do a personal nudge on?

### Plan content

- Anything Mick wants published (new block, primer update, plan change)?
- Custom plan review queue: any new custom signup who needs Mick to tailor their starter plan from the primer block?

### Member experience

- Any member feedback / questions Mick wants Jake to action (copy tweak, new feature, bug)?
- Any member that's struggling — does Mick want to reach out personally?

### Things Jake's working on

- What Jake will ship before next check-in (so Mick knows what's coming)
- Anything Jake's blocked on that needs a Mick decision

## Standing data — bring these numbers

> Walk through these in the meeting. Some require pulling from admin / Stripe.

- **Active paying members:** count from admin Members page
- **MRR:** sum of `subscriptions.amount` where `status = 'active'` (admin Overview shows this)
- **Migration funnel:**
  - Pending: not yet emailed
  - In progress: heads-up sent / link sent / signed up but not migrated
  - Migrated: fully on Stripe
  - Lapsed: customer didn't migrate, Shopify cancelled
- **Recent failed payments:** anyone in `past_due` status (Stripe → Subscriptions → filter past_due)
- **Upcoming renewals (next 7 days):** so Mick knows whose card is about to bill

---

## Future / parked — revisit after migration is complete

> Topics worth thinking about later but deliberately deprioritised right now. Promote into "Up next" when the time is right.

### Validate Google Auth flow for returning members (parked 2026-04-28)

**Context:** New self-signups come in via anon-mode (email-only modal → magic-link). Their auth.users row is created with no Google identity attached. If they sign out later and try to sign back in via "Sign in with Google" (same email), Supabase needs to resolve them to the *same* auth.users row — not create a duplicate, which would orphan their plan + member_profiles + subscription.

**Why parked:** Jake wants to test this with a friend's real Gmail rather than a `+anontestN@gmail.com` alias. Easier to give the friend a Stripe promotion code and have them go through the full UI than to fake it.

**When to revisit:** When Jake has a willing tester. Plan:

1. Create a single-use Stripe promotion code (e.g. `MATETEST` — 100% off, once, applies to all products).
2. Mate signs up via anon-mode (email modal) on a Progressive plan.
3. Mate goes through onboarding, lands on welcome → getting-started.
4. Mate signs out from the dashboard sidebar.
5. Mate clicks "Sign in with Google" using the same Gmail.
6. **Pass criteria:** lands back on their dashboard, sees their preferred_name in the sidebar, sees their plan content, no "set up your account" detour. Same `auth.users.id` as before — verify in Supabase Studio.
7. **Fail mode to look for:** new auth.users row with same email, fresh onboarding form prompted, or "no member row" error from trigger-welcome-email.

**If it fails,** the fix is in Supabase Auth settings → enable **Identity Linking** (or "Allow same email across providers"). Configure once and re-test.

### Win-back the ~50 historical Shopify customers (parked 2026-04-29)

**Context:** Mick has ~72 historical customers in Shopify; 21 are currently active and being migrated. The remaining ~50 are past-but-not-paying — a potential growth pool once active migration is done.

**Why parked:** Migration of the active 21 over the next ~month is the focus. Trying to do win-back at the same time risks splitting attention and confusing messaging.

**When to revisit:** After all 21 are migrated and stable on Stripe (probably mid-late May 2026).

**Things to think about when picking it back up:**

- **Compliance check:** AU Spam Act / NZ UEMA require prior consent for marketing emails. Many past customers may be `Email subscription: Not subscribed` in Shopify — those are legally fragile to bulk-email.
- **Strategy first, tooling second:** the highest-converting move is often Mick personally messaging the 5–10 customers he most wants back, not a bulk blast. Start with that.
- **Two implementation paths if it grows beyond personal outreach:**
  - **A.** Use Shopify's built-in Customer Segments + Email Marketing (respects opt-in automatically, zero new code, but data stays in Shopify).
  - **B.** Build a "Prospects" surface in the new admin (extend `migration_customers` or new table; full audit trail; track conversion). Only worth it if win-back becomes a recurring quarterly motion.
- **Pre-step:** pull exact numbers from Shopify (total customers / opted-in / RFM segmentation) before deciding scope.

---

## Change log (optional — only worth keeping for decisions you'll forget)

> Format: `YYYY-MM-DD · Topic · Decision`

- 2026-04-27 · Migration pricing · Mick chose Decision B: reset all customers to A$140 Custom / A$80 Progressive, no grandfathering.
- 2026-04-27 · Stripe Tax · Decision 4: skip GST registration / Stripe Tax (ABN below threshold).
