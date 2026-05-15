-- ============================================================
-- 20260516_020_outreach_engagement.sql
--
-- Adds Resend engagement tracking to outreach_sends. The existing
-- `status` column captures the send-time outcome ('sent', 'failed',
-- 'bounced', 'complained') and is set once when the row is inserted.
-- These new columns capture what happens AFTER the send — opens,
-- clicks, deliveries, bounces, complaints — reported by Resend
-- via webhook (and backfilled from the Resend API for past sends).
--
-- We deliberately do NOT mutate `status`. Engagement is its own
-- dimension; a row with status='sent' may have last_event='opened'
-- or 'clicked'. Querying for "did this recipient engage" is
-- `last_event in ('opened','clicked')` or `opened_at is not null`.
--
-- `events` jsonb is an append-only log of every Resend event for
-- the row, so we can reconstruct timelines and not lose data if
-- Resend ever ships a new event type we haven't modeled.
--
-- The webhook function (supabase/functions/resend-webhook) writes
-- these columns by matching outreach_sends.resend_id to the event's
-- data.email_id. Idempotency is enforced by checking events[]
-- before appending (each Resend event has a unique created_at).
-- ============================================================

alter table public.outreach_sends
  add column if not exists last_event     text,
  add column if not exists last_event_at  timestamptz,
  add column if not exists delivered_at   timestamptz,
  add column if not exists opened_at      timestamptz,            -- first open
  add column if not exists clicked_at     timestamptz,            -- first click
  add column if not exists bounced_at     timestamptz,
  add column if not exists complained_at  timestamptz,
  add column if not exists open_count     integer not null default 0,
  add column if not exists click_count    integer not null default 0,
  add column if not exists events         jsonb   not null default '[]'::jsonb;

-- Drop the old status CHECK constraint so the resend-webhook can
-- mirror Resend's 'delivered_delayed', etc., into status if it
-- chooses to. Replace with a more permissive guard.
alter table public.outreach_sends
  drop constraint if exists outreach_sends_status_check;

alter table public.outreach_sends
  add constraint outreach_sends_status_check
  check (status in (
    'sent',
    'failed',
    'delivered',
    'delivered_delayed',
    'opened',
    'clicked',
    'bounced',
    'complained',
    'unsubscribed'
  ));

-- Indexes that match the dashboard queries:
--   "show me opens for campaign X"
--   "show me everyone who clicked yesterday"
--   "find the row for this incoming Resend event"
create index if not exists outreach_sends_last_event_idx
  on public.outreach_sends (last_event, last_event_at desc)
  where last_event is not null;

create index if not exists outreach_sends_opened_idx
  on public.outreach_sends (campaign_name, opened_at desc)
  where opened_at is not null;

create index if not exists outreach_sends_clicked_idx
  on public.outreach_sends (campaign_name, clicked_at desc)
  where clicked_at is not null;

create index if not exists outreach_sends_resend_id_idx
  on public.outreach_sends (resend_id)
  where resend_id is not null;

comment on column public.outreach_sends.last_event is
  'Most recent Resend event type for this send (delivered, opened, clicked, bounced, complained, delivery_delayed). Distinct from status, which captures the send-time outcome.';
comment on column public.outreach_sends.events is
  'Append-only log of Resend events for this send. Each element is { type, created_at, data } from the Resend webhook payload. Used for timeline rendering and idempotency.';
