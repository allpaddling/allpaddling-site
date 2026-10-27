-- ============================================================
-- 20261027_032_paused_members_lose_access_after_paid_through.sql
--
-- Server-side half of the paused-member access lock. Depends on
-- migration 031 (is_paused, paid_through). Apply TOGETHER WITH the
-- frontend change to enforceMemberGates() in assets/app.js — otherwise
-- paused members get empty program pages instead of being redirected to
-- /app/membership-paused.html.
--
-- A paused member (Stripe pause_collection, with or without a resume
-- date) keeps access until the end of the last period they paid for,
-- then is locked until they resume. Matches the Settings page copy.
-- ============================================================

-- Entitlement: paused members are locked once their paid period ends.
create or replace function public.current_member_plan_blocked()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_coach() then false
    else coalesce(
      (
        select s.status = any (array['past_due','paused','canceled','unpaid','incomplete_expired'])
            or (s.is_paused and coalesce(s.paid_through, s.current_period_end, now()) <= now())
        from public.subscriptions s
        where s.user_id = auth.uid()
        order by s.created_at desc
        limit 1
      ),
      false  -- no subscription row => legacy member => not blocked
    )
  end;
$$;

comment on function public.current_member_plan_blocked() is
  'True when the calling user''s most-recent subscription is in a non-entitled status (past_due/paused/canceled/unpaid/incomplete_expired), OR is paused (is_paused) and past its paid_through date. Coaches are always exempt. No subscription row => false. Mirrors enforceMemberGates() in app.js. SECURITY DEFINER so it does not depend on subscriptions RLS.';
