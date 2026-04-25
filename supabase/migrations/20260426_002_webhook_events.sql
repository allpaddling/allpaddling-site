-- ============================================================
-- 20260426_002_webhook_events.sql
--
-- Idempotency log for Stripe webhook events. Stripe may deliver
-- the same event multiple times (retries, parallel deliveries).
-- The webhook handler inserts the event ID into this table inside
-- the same transaction as the state mutation; if the insert fails
-- with a unique-violation, we know the event has already been
-- processed and we can safely return 200 without re-applying it.
--
-- The table is service-role-only (no RLS policies) — no member
-- ever needs to read it. We still enable RLS so that a misuse of
-- the anon key cannot accidentally read it.
-- ============================================================

create table if not exists public.webhook_events (
  id              uuid          primary key default gen_random_uuid(),

  source          text          not null
                    check (source in ('stripe')),
  event_id        text          not null,
  event_type      text          not null,

  received_at     timestamptz   not null default now(),
  processed_at    timestamptz,
  error           text,

  -- Useful for debugging without dumping the full payload
  livemode        boolean,

  unique (source, event_id)
);

create index if not exists webhook_events_event_type_idx
  on public.webhook_events (event_type);
create index if not exists webhook_events_received_at_idx
  on public.webhook_events (received_at desc);

alter table public.webhook_events enable row level security;
-- No policies: this table is service-role-only.

comment on table public.webhook_events is
  'Idempotency log for incoming webhook events (Stripe today, more later). Insert before processing; unique (source, event_id) blocks duplicate work.';
