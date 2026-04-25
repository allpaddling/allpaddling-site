-- ============================================================
-- 20260426_004_align_admin_rls_and_link_custom_members.sql
--
-- Two related fixes:
--
-- 1. The admin RLS policies on subscriptions + member_profiles
--    used `auth.jwt() -> 'app_metadata' ->> 'is_admin'` as the
--    "is admin" predicate. The rest of this codebase uses a
--    `coaches` allowlist table and a SECURITY DEFINER function
--    `public.is_coach()` (used by RLS on progressive_members,
--    custom_members, custom_plans, etc). Realigning so the new
--    tables follow the same pattern — otherwise the admin policies
--    don't fire for the actual coaches.
--
-- 2. `progressive_members.auth_user_id` already exists; adding
--    the same column to `custom_members` so cross-table joins
--    (members ↔ member_profiles ↔ subscriptions) can resolve via
--    auth.users(id) instead of having to round-trip through email.
--    This unblocks surfacing onboarding state + subscription state
--    on the unified Members admin page.
-- ============================================================

-- ---- 1. Schema: link custom_members to auth.users ----
alter table public.custom_members
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create index if not exists custom_members_auth_user_id_idx
  on public.custom_members (auth_user_id)
  where auth_user_id is not null;

-- ---- 2. RLS realignment ----
-- subscriptions: admin SELECT
drop policy if exists subscriptions_select_admin on public.subscriptions;
create policy subscriptions_select_admin on public.subscriptions
  for select
  using (public.is_coach());

-- member_profiles: admin SELECT
drop policy if exists member_profiles_select_admin on public.member_profiles;
create policy member_profiles_select_admin on public.member_profiles
  for select
  using (public.is_coach());

-- member_profiles: admin UPDATE
drop policy if exists member_profiles_update_admin on public.member_profiles;
create policy member_profiles_update_admin on public.member_profiles
  for update
  using (public.is_coach())
  with check (public.is_coach());

comment on column public.custom_members.auth_user_id is
  'Link to auth.users(id). Set by the stripe-webhook handler on first invoice.paid; can be backfilled for existing members during Track B migration. Used by the admin Members page to join member_profiles + subscriptions data per-row.';
