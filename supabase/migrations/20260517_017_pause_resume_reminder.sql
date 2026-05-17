-- ============================================================
-- Migration 017 — pause resume reminder
--
-- Adds pause_resume_reminder_sent_at to subscriptions so the
-- check-pause-reminders Edge Function can fire the
-- "subscription-resuming-soon" email exactly once per pause cycle.
--
-- Also enables pg_cron + pg_net and schedules the daily 8am UTC
-- check. pg_net is pre-installed on Supabase; pg_cron can be
-- enabled via Dashboard → Database → Extensions if it isn't already.
--
-- Apply: paste into Supabase Studio SQL editor and Run.
-- ============================================================

-- Add the idempotency column.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS pause_resume_reminder_sent_at timestamptz;

COMMENT ON COLUMN public.subscriptions.pause_resume_reminder_sent_at IS
  'Set when the subscription-resuming-soon email was sent for the current pause cycle. '
  'Cleared automatically when pause_resumes_at changes (new pause) so the reminder '
  'fires again on the next pause. Managed by check-pause-reminders Edge Function.';

-- Index so the daily batch query is fast even if subscriptions grows.
CREATE INDEX IF NOT EXISTS subscriptions_pause_reminder_idx
  ON public.subscriptions (pause_resumes_at, pause_resume_reminder_sent_at)
  WHERE pause_resumes_at IS NOT NULL AND pause_resume_reminder_sent_at IS NULL;

-- ---- pg_cron setup ----
-- Enable extensions if not already enabled.
-- (pg_net is pre-installed; pg_cron may need to be enabled in Dashboard →
--  Database → Extensions first if this statement errors.)
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Remove any existing schedule with this name before re-creating,
-- so this migration is safe to re-run.
SELECT cron.unschedule('check-pause-reminders')
  FROM cron.job
  WHERE jobname = 'check-pause-reminders';

-- Daily 8 am UTC. Calls the check-pause-reminders Edge Function.
-- The function itself uses service_role (deployed with verify_jwt:false)
-- and is idempotent via pause_resume_reminder_sent_at.
SELECT cron.schedule(
  'check-pause-reminders',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://crlukzkgmydyqpwndjvc.supabase.co/functions/v1/check-pause-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);
