-- ============================================================
-- 20260426_005_primer_blocks_and_snapshots.sql
--
-- Two related changes that support the calendar-cohort Progressive
-- model:
--
-- 1. Primer blocks. Each discipline gets a separate "primer" plan
--    (key = '<discipline>_primer') that new members see for their
--    first 4 weeks before merging into the calendar cohort. The
--    progressive_plans CHECK constraint on `key` is widened to
--    allow these new keys, and four empty rows are seeded so they
--    show up in the admin Programs picker ready to be filled in.
--
-- 2. Snapshot history. Every time a Progressive block is published
--    (i.e., published_at changes), the previous published version
--    is captured into progressive_plan_snapshots. This preserves
--    history for the "Past blocks" view late joiners can use to
--    catch up on what they missed, without changing the live
--    member-side data path (which still reads the current row).
-- ============================================================

-- ---- 1. Widen the key CHECK constraint to allow primer variants ----
-- Postgres auto-names this constraint progressive_plans_key_check;
-- using `if exists` so we can re-run safely.
alter table public.progressive_plans
  drop constraint if exists progressive_plans_key_check;

alter table public.progressive_plans
  add constraint progressive_plans_key_check
  check (key in (
    'prone', 'sup', 'oc', 'ski',
    'prone_primer', 'sup_primer', 'oc_primer', 'ski_primer'
  ));

-- ---- 2. Seed empty primer rows ----
-- ON CONFLICT keeps this idempotent — if Mick has already started
-- editing a primer (and the row exists), we leave it alone.
insert into public.progressive_plans (key, meta, programs, draft_meta, draft_programs)
values
  ('prone_primer', '{"name":"Prone Primer","subtitle":"Settling-in plan — your first 4 weeks"}'::jsonb,
                   '[]'::jsonb, '{}'::jsonb, '[]'::jsonb),
  ('sup_primer',   '{"name":"SUP Primer","subtitle":"Settling-in plan — your first 4 weeks"}'::jsonb,
                   '[]'::jsonb, '{}'::jsonb, '[]'::jsonb),
  ('oc_primer',    '{"name":"OC Primer","subtitle":"Settling-in plan — your first 4 weeks"}'::jsonb,
                   '[]'::jsonb, '{}'::jsonb, '[]'::jsonb),
  ('ski_primer',   '{"name":"Surf Ski Primer","subtitle":"Settling-in plan — your first 4 weeks"}'::jsonb,
                   '[]'::jsonb, '{}'::jsonb, '[]'::jsonb)
on conflict (key) do nothing;

-- ============================================================
-- 3. Snapshot table + trigger
-- ============================================================
create table if not exists public.progressive_plan_snapshots (
  id              uuid          primary key default gen_random_uuid(),
  plan_key        text          not null,
  meta            jsonb         not null default '{}'::jsonb,
  programs        jsonb         not null default '[]'::jsonb,
  published_at    timestamptz   not null,
  captured_at     timestamptz   not null default now()
);

create index if not exists progressive_plan_snapshots_plan_key_idx
  on public.progressive_plan_snapshots (plan_key, published_at desc);

-- RLS: any authenticated member of that discipline should be able
-- to read past blocks (they're paying for the content, including
-- the historical context). Coaches read everything.
alter table public.progressive_plan_snapshots enable row level security;

drop policy if exists progressive_plan_snapshots_select_authed
  on public.progressive_plan_snapshots;
create policy progressive_plan_snapshots_select_authed
  on public.progressive_plan_snapshots
  for select
  using (auth.role() = 'authenticated');

-- No INSERT / UPDATE / DELETE policies — writes only happen via
-- the trigger function below, which runs as the table owner
-- (security definer not required because triggers inherit elevated
-- access by virtue of being attached to the table).

-- ---- Trigger function: snapshot on publish ----
-- Fires only when published_at actually changes (i.e. on Publish,
-- not on every draft auto-save). Captures the *previous* published
-- snapshot before it gets overwritten — the new published_at is
-- already on NEW, so we read the freshly-overwritten row's content
-- and stamp it with the previous published_at. Wait — that's not
-- right. The right semantic is: when Publish fires, the new content
-- in NEW.meta/NEW.programs is what just went live. We snapshot THAT
-- so the historical record contains exactly what members saw at
-- that publish. Future publishes overwrite, but the snapshot row
-- is preserved.
create or replace function public.tg_progressive_plan_snapshot ()
returns trigger language plpgsql as $$
begin
  if NEW.published_at is distinct from OLD.published_at
     and NEW.published_at is not null then
    insert into public.progressive_plan_snapshots
      (plan_key, meta, programs, published_at)
    values
      (NEW.key, NEW.meta, NEW.programs, NEW.published_at);
  end if;
  return NEW;
end;
$$;

drop trigger if exists progressive_plans_snapshot_on_publish
  on public.progressive_plans;
create trigger progressive_plans_snapshot_on_publish
  after update on public.progressive_plans
  for each row execute function public.tg_progressive_plan_snapshot();

comment on table public.progressive_plan_snapshots is
  'Append-only history of published Progressive blocks. Trigger captures one row per publish. Members can read all rows (paid-for content); writes go only via the trigger.';
