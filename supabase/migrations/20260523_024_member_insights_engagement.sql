-- Migration 024 — extend get_member_insights() with engagement metrics
--
-- Adds six new columns sourced from threshold_log and session_completions
-- (introduced in migration 023):
--
--   current_threshold_sec      latest threshold a member has set, NULL = never
--   threshold_unit             'metric' or 'imperial' for the latest row
--   last_threshold_at          when that latest threshold was logged
--   sessions_completed_7d      session_completions rows in last 7 days
--   sessions_completed_30d     session_completions rows in last 30 days
--   sessions_completed_total   lifetime completed sessions
--
-- These are TRUE engagement signals — does this paying member actually use
-- the product? Distinct from sessions_last_*d which only show whether they
-- opened the site at all.
--
-- Drop required: Postgres forbids changing a function's OUT parameter types
-- in place, and we're adding columns to the return shape.
drop function if exists public.get_member_insights ();

create or replace function public.get_member_insights ()
returns table (
  auth_user_id              uuid,
  email                     text,
  name                      text,
  plan                      text,
  signed_up_at              timestamptz,
  last_sign_in_at           timestamptz,
  last_active_at            timestamptz,
  sessions_last_7d          integer,
  sessions_last_30d         integer,
  active_sessions           integer,
  completed_onboarding      boolean,
  current_threshold_sec     integer,
  threshold_unit            text,
  last_threshold_at         timestamptz,
  sessions_completed_7d     integer,
  sessions_completed_30d    integer,
  sessions_completed_total  integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_coach() then
    raise exception 'forbidden: coach access only' using errcode = '42501';
  end if;

  return query
  with paying as (
    select cm.auth_user_id, cm.email, cm.name, 'Custom'::text as plan
      from public.custom_members cm
      where cm.auth_user_id is not null
    union all
    select pm.auth_user_id, pm.email, pm.name, 'Progressive'::text as plan
      from public.progressive_members pm
      where pm.auth_user_id is not null
  ),
  session_stats as (
    select
      s.user_id,
      count(*) filter (where s.created_at > now() - interval '7 days')::int  as last_7d,
      count(*) filter (where s.created_at > now() - interval '30 days')::int as last_30d,
      count(*)::int as total_kept,
      max(s.refreshed_at) at time zone 'UTC' as last_refreshed_at
    from auth.sessions s
    group by s.user_id
  ),
  -- Latest threshold per user via DISTINCT ON (cheaper than a window
  -- function for this small row count, and the (user_id, recorded_at desc)
  -- index supports it directly).
  latest_threshold as (
    select distinct on (tl.user_id)
      tl.user_id,
      tl.threshold_sec,
      tl.unit,
      tl.recorded_at
    from public.threshold_log tl
    order by tl.user_id, tl.recorded_at desc
  ),
  completion_stats as (
    select
      sc.user_id,
      count(*) filter (where sc.completed_at > now() - interval '7 days')::int  as done_7d,
      count(*) filter (where sc.completed_at > now() - interval '30 days')::int as done_30d,
      count(*)::int as done_total
    from public.session_completions sc
    group by sc.user_id
  )
  select
    p.auth_user_id,
    p.email,
    p.name,
    p.plan,
    u.created_at as signed_up_at,
    u.last_sign_in_at,
    greatest(ss.last_refreshed_at, u.last_sign_in_at) as last_active_at,
    coalesce(ss.last_7d,    0) as sessions_last_7d,
    coalesce(ss.last_30d,   0) as sessions_last_30d,
    coalesce(ss.total_kept, 0) as active_sessions,
    (mp.completed_onboarding_at is not null) as completed_onboarding,
    lt.threshold_sec        as current_threshold_sec,
    lt.unit                 as threshold_unit,
    lt.recorded_at          as last_threshold_at,
    coalesce(cs.done_7d,    0) as sessions_completed_7d,
    coalesce(cs.done_30d,   0) as sessions_completed_30d,
    coalesce(cs.done_total, 0) as sessions_completed_total
  from paying p
  join auth.users u on u.id = p.auth_user_id
  left join session_stats     ss on ss.user_id = p.auth_user_id
  left join public.member_profiles mp on mp.user_id = p.auth_user_id
  left join latest_threshold  lt on lt.user_id = p.auth_user_id
  left join completion_stats  cs on cs.user_id = p.auth_user_id
  order by greatest(ss.last_refreshed_at, u.last_sign_in_at) desc nulls last;
end;
$$;

comment on function public.get_member_insights () is
  'Coach-only member activity + engagement rollup. last_active_at = last session refresh (proxy for last site visit). sessions_last_*d = fresh sign-ins. sessions_completed_*d = actual session checkmarks from session_completions. current_threshold_sec = latest threshold_log row (NULL if member never set one).';

revoke execute on function public.get_member_insights () from public;
revoke execute on function public.get_member_insights () from anon;
grant  execute on function public.get_member_insights () to authenticated;
