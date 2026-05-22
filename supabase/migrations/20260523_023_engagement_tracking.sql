-- Migration 023 — engagement tracking: threshold updates + session completions
--
-- Background
-- ----------
-- Until now, both signals lived in browser localStorage only:
--   * threshold pace + history were under ap.memberState.thresholdHistory
--   * session-completion checkmarks were under ap.memberState.completedSessions
--
-- That meant: zero coach visibility into who is actually doing the training,
-- plus the data was wiped if a member switched devices or cleared storage.
-- This migration moves both signals server-side so the coach admin can see
-- engagement and so a member's state follows them across devices.
--
-- Design choices
-- --------------
-- * threshold_log is APPEND-ONLY. Every save inserts a row. Lets us build
--   a real history page and trend lines later.
-- * session_completions is one-row-per-completion (unique on user+session_key).
--   Marking a session complete inserts; unmarking deletes. Coach cares about
--   the current state, not how many times the user toggled.
-- * Foreign key to auth.users(id), not progressive_members/custom_members.
--   A member could theoretically have both plan types; auth.users is the
--   stable identity.
-- * RLS: member owns their own rows; coaches read all via is_coach().
--   Writes from the frontend use the authenticated user's JWT so the
--   user_id is always the caller's own.

-- =============================================================================
-- threshold_log
-- =============================================================================
create table if not exists public.threshold_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  threshold_sec integer not null check (threshold_sec > 0 and threshold_sec < 3600),
  unit          text    not null check (unit in ('metric', 'imperial')),
  recorded_at   timestamptz not null default now(),
  source        text    not null default 'manual' check (source in ('manual', 'backfill')),
  created_at    timestamptz not null default now()
);

comment on table public.threshold_log is
  'Append-only log of every threshold-pace save by a member. Latest row = current threshold. source=backfill marks rows pushed up from a prior localStorage state during the one-time client migration.';
comment on column public.threshold_log.threshold_sec is
  'Threshold pace in seconds per unit. Z3 / lactate threshold. Sub-3600 sanity bound (>1 hour/km would be a clear data error).';

create index if not exists threshold_log_user_recorded_idx
  on public.threshold_log (user_id, recorded_at desc);

alter table public.threshold_log enable row level security;

-- Member: read + insert own rows. No update/delete — history is immutable.
create policy threshold_log_own_select on public.threshold_log
  for select using (auth.uid() = user_id);

create policy threshold_log_own_insert on public.threshold_log
  for insert with check (auth.uid() = user_id);

-- Coach: read everyone.
create policy threshold_log_coach_select on public.threshold_log
  for select using (public.is_coach());

-- =============================================================================
-- session_completions
-- =============================================================================
create table if not exists public.session_completions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  session_key  text not null,
  plan_key     text check (plan_key is null or plan_key in ('prone', 'sup', 'oc', 'ski', 'primer', 'custom')),
  completed_at timestamptz not null default now(),
  rpe          smallint check (rpe is null or (rpe >= 1 and rpe <= 10)),
  note         text,
  updated_at   timestamptz not null default now(),
  unique (user_id, session_key)
);

comment on table public.session_completions is
  'One row per session a member has marked complete. session_key matches the format from assets/app.js (e.g. "prone-w1s1"). Unmarking deletes the row; the unique constraint lets us upsert idempotently.';
comment on column public.session_completions.session_key is
  'Plan-prefixed session identifier. Format from assets/app.js: "{plan_key}-w{week}s{session}", e.g. "prone-w1s1" or "primer-w2s3".';
comment on column public.session_completions.rpe is
  'Rate of perceived exertion 1-10, optional per-session note from the member.';

create index if not exists session_completions_user_completed_idx
  on public.session_completions (user_id, completed_at desc);
create index if not exists session_completions_user_plan_idx
  on public.session_completions (user_id, plan_key);

alter table public.session_completions enable row level security;

-- Member: full CRUD on their own rows (need update for RPE/note edits,
-- delete for unmarking).
create policy session_completions_own_select on public.session_completions
  for select using (auth.uid() = user_id);

create policy session_completions_own_insert on public.session_completions
  for insert with check (auth.uid() = user_id);

create policy session_completions_own_update on public.session_completions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy session_completions_own_delete on public.session_completions
  for delete using (auth.uid() = user_id);

-- Coach: read everyone.
create policy session_completions_coach_select on public.session_completions
  for select using (public.is_coach());

-- updated_at trigger so RPE/note edits bump the timestamp.
create or replace function public.touch_session_completions_updated_at ()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists session_completions_touch_updated_at on public.session_completions;
create trigger session_completions_touch_updated_at
  before update on public.session_completions
  for each row execute function public.touch_session_completions_updated_at();
