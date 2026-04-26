-- ============================================================
-- 20260427_007_snapshot_trigger_security_definer.sql
--
-- Fix the snapshot trigger from migration 005 so it can actually
-- write to progressive_plan_snapshots when the trigger fires.
--
-- The original definition ran as the calling user (a coach), which
-- meant the INSERT inside the trigger went through RLS on the
-- snapshots table — and that table has no INSERT policy on
-- purpose (writes are supposed to be trigger-only). Result: every
-- Publish attempt failed with code 42501.
--
-- Adding SECURITY DEFINER causes the function to run with its
-- owner's privileges (postgres, which bypasses RLS), so the
-- internal INSERT goes through. The function still fires from
-- the same UPDATE trigger on progressive_plans, so the user-
-- facing semantics don't change — just the failure mode.
-- ============================================================

create or replace function public.tg_progressive_plan_snapshot ()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

-- Lock down EXECUTE so the function can't be called directly by
-- arbitrary roles — only via the trigger it's attached to. (The
-- trigger fires regardless of EXECUTE grants.)
revoke all on function public.tg_progressive_plan_snapshot() from public;
