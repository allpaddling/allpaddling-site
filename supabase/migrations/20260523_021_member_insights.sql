-- Migration 021 — member activity insights for coach admin
--
-- Adds public.get_member_insights(): a SECURITY DEFINER function the coach
-- admin calls from the new admin-insights.html page. Returns one row per
-- paying member with login activity pulled from auth.users + auth.sessions.
--
-- Why SECURITY DEFINER:
--   The auth schema (auth.users, auth.sessions) is not exposed to the anon
--   key by default — the JS SDK can't query it directly. Wrapping the join
--   in a definer function lets us aggregate the data server-side and gate
--   access through public.is_coach() so only signed-in coaches see it.
--
-- Login-count semantics (important to get right in the UI):
--   * last_sign_in_at on auth.users is the authoritative "most recent login"
--     and is preserved indefinitely.
--   * auth.sessions rows are pruned aggressively by Supabase — only ~30 days
--     of session history is retained. So counts here are honest windowed
--     metrics (sessions_last_7d, sessions_last_30d), NOT a lifetime login
--     total. The UI must label them accordingly.
--   * Each fresh sign-in creates a new auth.sessions row, so a count of
--     rows in a window ≈ number of sign-ins in that window.
--
-- Coach-only via the is_coach() check at the top; revoke from anon at the
-- end so a leaked anon key can't enumerate the member roster.

create or replace function public.get_member_insights ()
returns table (
  auth_user_id         uuid,
  email                text,
  name                 text,
  plan                 text,        -- 'Progressive' | 'Custom'
  signed_up_at         timestamptz, -- auth.users.created_at
  last_sign_in_at      timestamptz, -- auth.users.last_sign_in_at (null = never)
  sessions_last_7d     integer,     -- auth.sessions created in last 7 days
  sessions_last_30d    integer,     -- auth.sessions created in last 30 days
  active_sessions      integer,     -- auth.sessions rows currently retained
  completed_onboarding boolean      -- member_profiles.completed_onboarding_at is not null
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Coach gate: same predicate used by RLS on subscriptions / member_profiles.
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
      count(*)::int as total_kept
    from auth.sessions s
    group by s.user_id
  )
  select
    p.auth_user_id,
    p.email,
    p.name,
    p.plan,
    u.created_at        as signed_up_at,
    u.last_sign_in_at,
    coalesce(ss.last_7d,    0) as sessions_last_7d,
    coalesce(ss.last_30d,   0) as sessions_last_30d,
    coalesce(ss.total_kept, 0) as active_sessions,
    (mp.completed_onboarding_at is not null) as completed_onboarding
  from paying p
  join auth.users u on u.id = p.auth_user_id
  left join session_stats   ss on ss.user_id = p.auth_user_id
  left join public.member_profiles mp on mp.user_id = p.auth_user_id
  order by u.last_sign_in_at desc nulls last;
end;
$$;

comment on function public.get_member_insights () is
  'Coach-only member activity rollup. Joins auth.users + auth.sessions + member_profiles, returns one row per paying member. last_sign_in_at is authoritative; sessions_last_* are honest windowed counts (auth.sessions is pruned by Supabase after ~30 days, so this is not a lifetime login total).';

-- Default grants on a new public function include anon + authenticated.
-- Per memory feedback_supabase_function_default_privs, revoking from public
-- is a no-op against the explicit role grants — must revoke from anon
-- explicitly. Authenticated keeps execute; the is_coach() check inside the
-- body enforces the actual access rule.
revoke execute on function public.get_member_insights () from public;
revoke execute on function public.get_member_insights () from anon;
grant  execute on function public.get_member_insights () to authenticated;
