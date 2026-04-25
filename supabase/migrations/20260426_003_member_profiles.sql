-- ============================================================
-- 20260426_003_member_profiles.sql
--
-- First-login onboarding capture (ROADMAP §3.3). One row per
-- authenticated user, keyed on auth.users(id). Mick's admin
-- view will read these fields when he writes a member's first
-- custom block, so the rebuild reduces "what's your goal race
-- and how many hours can you train?" back-and-forth.
--
-- Optional fields: every column except user_id is nullable.
-- The onboarding form requires the user to fill most fields,
-- but the schema doesn't enforce that — partial profiles are
-- valid (e.g. Mick can manually pre-fill a row when migrating
-- a Track-B customer who hasn't logged in yet).
--
-- `completed_onboarding_at` is the dashboard's redirect signal:
-- null = send the user through /app/onboarding.html before
-- showing them the dashboard. Set on form submit.
-- ============================================================

create table if not exists public.member_profiles (
  id                       uuid          primary key default gen_random_uuid(),

  user_id                  uuid          not null unique
                             references auth.users(id) on delete cascade,

  preferred_name           text,
  goal_race_name           text,
  goal_race_date           date,

  weekly_training_hours    smallint
                             check (weekly_training_hours is null
                                    or (weekly_training_hours >= 0 and weekly_training_hours <= 40)),

  ability_level            text
                             check (ability_level is null
                                    or ability_level in ('new', 'recreational', 'competitive', 'elite')),

  discipline               text
                             check (discipline is null
                                    or discipline in ('prone', 'sup', 'oc', 'ski')),

  notes                    text,

  -- The dashboard's redirect signal: null → push to onboarding.
  completed_onboarding_at  timestamptz,

  created_at               timestamptz   not null default now(),
  updated_at               timestamptz   not null default now()
);

create index if not exists member_profiles_user_id_idx
  on public.member_profiles (user_id);
create index if not exists member_profiles_completed_idx
  on public.member_profiles (completed_onboarding_at)
  where completed_onboarding_at is null;

-- ============================================================
-- updated_at trigger (reusing the same pattern as subscriptions)
-- ============================================================
create or replace function public.tg_member_profiles_set_updated_at ()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists member_profiles_set_updated_at on public.member_profiles;
create trigger member_profiles_set_updated_at
  before update on public.member_profiles
  for each row execute function public.tg_member_profiles_set_updated_at();

-- ============================================================
-- RLS
--
-- Members read/insert/update only their own row. Admins read all.
-- Members CANNOT delete (auth.users cascades on user deletion).
-- ============================================================
alter table public.member_profiles enable row level security;

drop policy if exists member_profiles_select_own on public.member_profiles;
create policy member_profiles_select_own on public.member_profiles
  for select
  using (auth.uid() = user_id);

drop policy if exists member_profiles_select_admin on public.member_profiles;
create policy member_profiles_select_admin on public.member_profiles
  for select
  using (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false)
  );

drop policy if exists member_profiles_insert_own on public.member_profiles;
create policy member_profiles_insert_own on public.member_profiles
  for insert
  with check (auth.uid() = user_id);

drop policy if exists member_profiles_update_own on public.member_profiles;
create policy member_profiles_update_own on public.member_profiles
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Admin can update too (e.g. coach pre-filling for a migrated customer).
drop policy if exists member_profiles_update_admin on public.member_profiles;
create policy member_profiles_update_admin on public.member_profiles
  for update
  using (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false)
  );

comment on table public.member_profiles is
  'First-login onboarding capture (§3.3). One row per auth.users entry. Members own their row; admins read all and can update. completed_onboarding_at = null is the dashboard''s redirect signal.';
