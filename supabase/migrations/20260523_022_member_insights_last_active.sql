-- Migration 022 — add last_active_at to get_member_insights()
--
-- Why this matters:
--   last_sign_in_at only ticks when a member re-authenticates (magic link,
--   OAuth). Members who stay signed in and visit the site daily look stale
--   under that metric even though they're actively engaging.
--
--   auth.sessions.refreshed_at is updated every time the Supabase JS SDK
--   refreshes the JWT — which it does roughly hourly while a tab is open,
--   plus on every getSession() call when a member revisits the site. So
--   MAX(refreshed_at) per user is a much better proxy for "last visited."
--
--   The diff is large in practice — verified against live data, ~half of
--   the roster appears 10+ days more recently active than last_sign_in_at
--   suggests.
--
-- last_active_at = greatest(max(sessions.refreshed_at), last_sign_in_at)
--
--   The greatest() coalesce protects against the auth.sessions pruning
--   window: if Supabase pruned all of a user's session rows but they did
--   sign in once, we still surface last_sign_in_at rather than null.

-- Drop required: Postgres forbids changing a function's OUT parameter
-- types in-place, and we're adding last_active_at to the return shape.
drop function if exists public.get_member_insights ();

create or replace function public.get_member_insights ()
returns table (
  auth_user_id         uuid,
  email                text,
  name                 text,
  plan                 text,
  signed_up_at         timestamptz,
  last_sign_in_at      timestamptz,
  last_active_at       timestamptz,  -- NEW: max(refreshed_at) coalesced with last_sign_in_at
  sessions_last_7d     integer,
  sessions_last_30d    integer,
  active_sessions      integer,
  completed_onboarding boolean
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
  )
  select
    p.auth_user_id,
    p.email,
    p.name,
    p.plan,
    u.created_at as signed_up_at,
    u.last_sign_in_at,
    -- last_active_at: latest of (token refresh, sign-in). The refresh side
    -- ticks while a member browses; the sign-in side preserves history when
    -- session rows have been pruned.
    greatest(ss.last_refreshed_at, u.last_sign_in_at) as last_active_at,
    coalesce(ss.last_7d,    0) as sessions_last_7d,
    coalesce(ss.last_30d,   0) as sessions_last_30d,
    coalesce(ss.total_kept, 0) as active_sessions,
    (mp.completed_onboarding_at is not null) as completed_onboarding
  from paying p
  join auth.users u on u.id = p.auth_user_id
  left join session_stats ss on ss.user_id = p.auth_user_id
  left join public.member_profiles mp on mp.user_id = p.auth_user_id
  order by greatest(ss.last_refreshed_at, u.last_sign_in_at) desc nulls last;
end;
$$;

comment on function public.get_member_insights () is
  'Coach-only member activity rollup. last_active_at is the truthful "last visited" timestamp (max of auth.sessions.refreshed_at and auth.users.last_sign_in_at). sessions_last_* count fresh sign-ins in the window, distinct from continued use.';

revoke execute on function public.get_member_insights () from public;
revoke execute on function public.get_member_insights () from anon;
grant  execute on function public.get_member_insights () to authenticated;
