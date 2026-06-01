-- 026: enforce subscription status on plan reads (server-side entitlement)
--
-- Problem this closes:
--   Until now, custom_plans' read policy checked OWNERSHIP only, and
--   progressive_plans was world-readable (USING true). The subscription-status
--   lock lived solely in enforceMemberGates() in app.js, which is a client-side
--   location.href redirect. A past_due / canceled member whose browser session
--   was still valid could therefore fetch their plan JSON directly from the
--   Supabase REST API (devtools, saved link, etc.) and the database would hand
--   it over, redirect or not. This migration moves the entitlement check into
--   RLS so the lock is enforced at the data layer.
--
-- Behaviour mirrors enforceMemberGates(): blocked statuses are
--   past_due / paused / canceled / unpaid / incomplete_expired.
--   active / trialing are allowed. A member with NO subscriptions row
--   (legacy / manually added by Mick, or a coach) is allowed (fall-through),
--   matching the client gate.

-- Helper: true when the CALLER's most-recent subscription is non-entitled.
-- SECURITY DEFINER so the check does not depend on RLS on `subscriptions`
-- (a missing self-read policy there would otherwise make this silently
-- return "not blocked" and defeat the whole fix). Keyed on auth.uid() only,
-- so it can never leak another user's status.
create or replace function public.current_member_plan_blocked()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select s.status = any (array['past_due','paused','canceled','unpaid','incomplete_expired'])
      from public.subscriptions s
      where s.user_id = auth.uid()
      order by s.created_at desc
      limit 1
    ),
    false  -- no subscription row => legacy member or coach => not blocked
  );
$$;

comment on function public.current_member_plan_blocked() is
  'True when the calling user''s most-recent subscription is in a non-entitled status (past_due/paused/canceled/unpaid/incomplete_expired). No subscription row => false. Mirrors enforceMemberGates() in app.js. SECURITY DEFINER so it does not depend on subscriptions RLS.';

-- custom_plans: keep the ownership clause, AND require entitlement.
drop policy if exists "Members read their own published plan" on public.custom_plans;
create policy "Members read their own published plan"
  on public.custom_plans
  for select
  using (
    member_id in (
      select id from public.custom_members
      where email = (auth.jwt() ->> 'email')
    )
    and not public.current_member_plan_blocked()
  );

-- progressive_plans: replace the world-readable SELECT policy.
--   - Coaches always read (admin + preview-as-member).
--   - A logged-in member reads only when entitled.
--   - Anonymous / logged-out callers (auth.uid() is null) still read, matching
--     the prior `true` behaviour for shared published content. No public page
--     reads this table, so this is conservative; tighten with
--     `auth.uid() is not null and ...` later if anon reads should be closed too.
drop policy if exists "Anyone can read progressive plans" on public.progressive_plans;
create policy "Read progressive plans when entitled"
  on public.progressive_plans
  for select
  using (
    is_coach() or not public.current_member_plan_blocked()
  );
