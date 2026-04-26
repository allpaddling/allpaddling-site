-- ============================================================
-- 20260426_006_single_primer_and_skip_override.sql
--
-- Two related changes:
--
-- 1. Consolidate the four per-discipline primer rows into one
--    shared "primer" plan. The same primer block applies to all
--    disciplines — discipline-specific content was overkill for
--    a settling-in baseline.
--
-- 2. Add a coach-controlled override on progressive_members so
--    Mick can graduate a specific member off the primer early
--    (e.g., an experienced paddler who reaches out asking to
--    skip). The 28-day auto-graduation still applies as a
--    floor; the new flag is an additional way to leave primer.
--
-- This migration assumes the per-discipline primers are still
-- empty — verified live before running. If any had content it
-- would be lost; the safe-guard is the assertion at the top.
-- ============================================================

-- ---- Safety: refuse to run if any per-discipline primer has been edited ----
do $$
declare
  edited_count int;
begin
  select count(*) into edited_count
  from public.progressive_plans
  where key in ('prone_primer','sup_primer','oc_primer','ski_primer')
    and (
      published_at is not null
      or last_edited is not null
      or jsonb_array_length(coalesce(programs, '[]'::jsonb))       > 0
      or jsonb_array_length(coalesce(draft_programs, '[]'::jsonb)) > 0
    );
  if edited_count > 0 then
    raise exception 'Refusing to run: % per-discipline primer row(s) have content. Manually consolidate first.', edited_count;
  end if;
end;
$$;

-- ---- 1. Widen the CHECK constraint to include 'primer' (and keep the old
--         per-discipline keys briefly so the DELETE below can run) ----
alter table public.progressive_plans
  drop constraint if exists progressive_plans_key_check;
alter table public.progressive_plans
  add constraint progressive_plans_key_check
  check (key in (
    'prone','sup','oc','ski',
    'primer',
    'prone_primer','sup_primer','oc_primer','ski_primer'
  ));

-- ---- 2. Seed the new shared primer row (idempotent) ----
insert into public.progressive_plans (key, meta, programs, draft_meta, draft_programs)
values (
  'primer',
  '{"name":"Primer","subtitle":"Settling-in plan — first 4 weeks for every new member"}'::jsonb,
  '[]'::jsonb,
  '{}'::jsonb,
  '[]'::jsonb
)
on conflict (key) do nothing;

-- ---- 3. Drop the 4 per-discipline primer rows ----
delete from public.progressive_plans
where key in ('prone_primer','sup_primer','oc_primer','ski_primer');

-- ---- 4. Tighten the CHECK constraint to drop the per-discipline primer keys
alter table public.progressive_plans
  drop constraint progressive_plans_key_check;
alter table public.progressive_plans
  add constraint progressive_plans_key_check
  check (key in ('prone','sup','oc','ski','primer'));

-- ============================================================
-- 5. Coach skip-primer override on progressive_members
-- ============================================================
-- primer_completed = true means: this member is no longer on the primer
-- regardless of how long ago they joined. Defaults to false on insert
-- (i.e., everyone starts on primer); the 28-day window auto-graduates
-- everyone else, but Mick can flip this true earlier if a member asks
-- to skip the settling-in plan.
alter table public.progressive_members
  add column if not exists primer_completed boolean not null default false;

create index if not exists progressive_members_primer_completed_idx
  on public.progressive_members (primer_completed)
  where primer_completed = false;

comment on column public.progressive_members.primer_completed is
  'Coach-set override: when true, the member exits the primer regardless of the 28-day window. Default false — every new member starts on primer.';
