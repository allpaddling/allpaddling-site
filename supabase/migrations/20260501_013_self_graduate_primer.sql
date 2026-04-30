-- ============================================================
-- 20260501_013_self_graduate_primer.sql
--
-- Let a Progressive member self-graduate from the Primer block
-- into the calendar-cohort plan WITHOUT exposing UPDATE rights
-- on progressive_members generally.
--
-- Why an RPC and not an RLS policy:
--   * Column-level + value-direction restrictions ("only flip
--     primer_completed, only false -> true") aren't expressible
--     in a single Postgres UPDATE policy. We'd need an RLS
--     policy + a trigger to lock down columns. SECURITY DEFINER
--     RPC achieves the same outcome in one place.
--   * No new schema; the column already exists from migration
--     006. This migration only adds a function.
--
-- Behavior:
--   * Authenticated callers only.
--   * Matches the row by auth.uid() OR auth.jwt() ->> 'email'
--     to mirror the gate logic in app.js (legacy/manually-added
--     rows can lack auth_user_id).
--   * Idempotent: if primer_completed is already true, the
--     UPDATE simply matches no rows. Calling twice is safe.
--   * One-way: the WHERE clause requires primer_completed=false,
--     so the function CANNOT flip true back to false. Members
--     who regret the move have to ask Mick to revert it from
--     admin-progressive.html (coach UPDATE policy still grants
--     this).
-- ============================================================

create or replace function public.graduate_from_primer ()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid;
  v_email text;
begin
  v_uid   := auth.uid();
  v_email := auth.jwt() ->> 'email';

  if v_uid is null and (v_email is null or v_email = '') then
    raise exception 'graduate_from_primer: not authenticated'
      using errcode = '42501';
  end if;

  update public.progressive_members
     set primer_completed = true
   where (
           (v_uid   is not null and auth_user_id = v_uid)
        or (v_email is not null and lower(email) = lower(v_email))
         )
     and primer_completed = false;
end;
$$;

-- Only authenticated app users can call this. Anon users have
-- no business graduating anyone, and the service role talks
-- to progressive_members directly.
revoke all on function public.graduate_from_primer() from public;
grant execute on function public.graduate_from_primer() to authenticated;
