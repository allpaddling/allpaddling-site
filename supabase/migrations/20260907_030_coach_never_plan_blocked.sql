-- Migration 030 — coaches are never blocked by the plan-read entitlement gate
--
-- Background
-- ----------
-- Migration 026 moved the subscription-status entitlement check into RLS via
-- current_member_plan_blocked(). It exempted "a member with NO subscriptions
-- row (legacy, or a coach)" — but a coach who is ALSO a real paying member
-- does have a subscriptions row, and so was never actually exempt.
--
-- That bit on 2026-09-07. Mick (dibetta1@gmail.com) had signed up on a real
-- Custom plan to use the platform for his own training. His charge was
-- refunded and the subscription cancelled, which flipped this function to
-- "blocked" for him. His plan stayed readable only because custom_plans also
-- carries a coach ALL-policy that ORs in ahead of the member policy — a
-- coincidence, not a guarantee. If that policy is ever narrowed, the coach
-- loses access to his own member area with no obvious cause.
--
-- Coach access is complimentary and permanent and must not depend on Stripe.
-- State that here instead of relying on policy ordering elsewhere.
--
-- Note the client-side twin, enforceMemberGates() in assets/app.js, already
-- had the coach bypass. This closes the server-side half.

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
  'True when the calling user''s most-recent subscription is in a non-entitled status (past_due/paused/canceled/unpaid/incomplete_expired). Coaches are always exempt (complimentary, permanent access). No subscription row => false. Mirrors enforceMemberGates() in app.js. SECURITY DEFINER so it does not depend on subscriptions RLS.';
