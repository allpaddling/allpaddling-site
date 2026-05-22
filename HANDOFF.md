# All Paddling — Cowork session handoff

Continuing AllPaddling project. The canonical project guide is `CLAUDE.md`; this handoff is the bridge between sessions — read the LATEST section first.

---

## ⭐⭐⭐ LATEST — 2026-05-22 (Fri) — calendar-1st billing alignment

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

## ⭐⭐ PREVIOUS — 2026-05-17 (Sun) — project complete: full day summary

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
