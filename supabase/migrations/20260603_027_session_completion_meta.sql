-- 027: per-completion display snapshot for Custom history persistence
--
-- Custom plans rotate block-by-block: the coach publishes the next block and
-- then deletes the prior weeks from the live plan so members stay focused
-- forward. History previously rebuilt its list by walking the *live* plan and
-- matching keys, so a member's completed sessions vanished the moment their
-- week was deleted (the session_completions rows survived, but had nothing to
-- render against).
--
-- This column lets each completion carry the display context captured at
-- "Mark complete" time — { week_label, session_title, session_index, focus } —
-- so the Custom History page can render straight from session_completions and
-- survive week deletion. Progressive history is unchanged (it still walks the
-- plan, whose weeks aren't deleted block-by-block).
--
-- Additive and nullable: existing rows (pre-2026-06-03) stay null and fall back
-- to a label parsed from session_key on the History page.

alter table public.session_completions
  add column if not exists meta jsonb;
