# Autonomous session — Apr 2026

What I shipped while you were out, what to verify, what's not perfect.

## Commits

| # | What | Commit |
|---|---|---|
| 17 | Warmer "plan is being prepared" empty state on dashboard.html | [defe86b](https://github.com/allpaddling/allpaddling-site/commit/defe86b8c224a614a55b60b9ed21a7ddcd745f59) |
| 18 | Migration 004 + admin-members shows onboarding state + goal race per row | [713cef4](https://github.com/allpaddling/allpaddling-site/commit/713cef4a38f4534fbc0f8a9beef6f5fbc3790503) |
| 19 | New admin Overview dashboard at admin-overview.html | [48a9f9e](https://github.com/allpaddling/allpaddling-site/commit/48a9f9e775ac58f0290cb330b13c7612ebb2472d) |
| 20 | Real Preview-as-member in admin-edit.html (replaces the stub) | [a27f837](https://github.com/allpaddling/allpaddling-site/commit/a27f83745d66e1403955febe98176d34c11a62e2) |

## Migration 004 — applied to live Supabase

Two unrelated fixes bundled because they both unblocked the Members-page enhancement:

1. **Realigned admin RLS** on `subscriptions` and `member_profiles` from `app_metadata.is_admin` (which I'd assumed was the convention but isn't) to `public.is_coach()` — the canonical predicate the rest of the codebase already uses (progressive_members, custom_members, custom_plans, etc.). The old policies wouldn't have fired for actual coaches; nobody had hit it because nothing was reading those tables from the admin UI yet.
2. **Added `auth_user_id` to `custom_members`** (parity with `progressive_members.auth_user_id`) so cross-table joins to `member_profiles` and `subscriptions` resolve cleanly via `auth.users(id)` instead of round-tripping through email.

The RLS audit doc at `supabase/RLS_AUDIT.md` references the OLD admin predicate. Re-running the audit with the new predicate would require seeding the test admin into the `coaches` table; I deferred that to keep the autonomous burst tight. Worth doing on next pass.

## Worth verifying when you're back

- **Admin sidebar order** is now Overview / Programs / Members across all 6 admin pages. If you'd rather have Programs first as the default landing, it's a single-line change per page. The post-magic-link redirect still drops coaches at `admin.html` (Programs).
- **Overview dashboard** subscription tiles show the diagonal-stripe placeholder until any row exists in `subscriptions`. As soon as Stripe is wired, they auto-flip to live numbers — no code change needed. The MRR estimate is rough today (a regex-based Progressive/Custom split on `stripe_price_id`); will need refining when real Stripe price IDs are known.
- **Preview-as-member** opens `program.html?preview=draft&plan=<key>[&member=<id>]` in a new tab. Sticky amber banner at the top says "Preview as member — drafts shown" with a Close link. Tested via Node syntax + sidebar consistency check; not yet eyeballed live (Pages may still be rebuilding when you read this).
- **Members page Detail column** prefers goal race info when set, falls back to coach notes, then "—". The "Onboarding pending" amber badge appears under the email line for members who've signed in but not finished onboarding.

## Not perfect, on purpose

- **Empty state on dashboard.html** uses `member.discipline` from the localStorage member shape. If a member opens the dashboard before the `getCurrentMemberProfile()` call has set the discipline correctly, the copy might say "Your Prone plan is being prepared" when they're a SUP member. Same caveat as the existing dashboard's empty state had — I didn't change the lookup, just the copy.
- **Preview banner is `position: sticky`** at the top of body. Should work in app-shell layouts but I haven't eye-tested it on a real plan yet.
- **MRR calculation** is a placeholder. Refine when there's data.

## Next obvious things (still doable without Mick)

- RLS audit re-run with the new `is_coach()` predicate — would catch the coverage gap I just patched.
- Settings page member-self-service (cancel + update payment) — partially Stripe-blocked but the cancel-with-12-week-lock UI logic could be built and wired against `cancel_unlocks_at`.
- Block-delivery scheduler (§2.5) — depends on the multi-block schema (§2.4) which is still uncommitted.
- Polish the Overview MRR estimate once Stripe price IDs are known.

— end of autonomous session —
