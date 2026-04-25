-- ============================================================
-- 20260426_001_subscriptions.sql
--
-- Adds the `subscriptions` table that mirrors Stripe subscription
-- state into Supabase. Created as part of Track A Phase 1 (Stripe
-- + signup loop) — see ROADMAP.md §Week 1.
--
-- Design notes:
--
-- * `user_id` references `auth.users(id)` — the Supabase auth
--   user the subscription belongs to. This is the primary join
--   key for member-side reads.
--
-- * `progressive_member_id` and `custom_member_id` are nullable
--   FKs to the existing membership tables. Exactly one must be
--   set (CHECK constraint below). This gives us full FK
--   integrity without a polymorphic-association hack.
--
-- * `status` mirrors Stripe's subscription status enum
--   (https://docs.stripe.com/api/subscriptions/object#subscription_object-status).
--   Stored as TEXT + CHECK so we can extend without an enum migration.
--
-- * `cancel_unlocks_at` enforces the 12-week minimum commitment
--   (ROADMAP §1.5). It is set to `first_paid_at + interval '12 weeks'`
--   when the first invoice is paid. The self-service cancel UI
--   reads this value to decide whether to allow cancellation.
--
-- * `billing_anchor_date` is the day-of-month/anchor used by the
--   4-weekly cycle. Captured for migration parity with Appstle
--   (Track B) and for the block-delivery scheduler (ROADMAP §2.5).
--
-- * RLS: members read only their own row; admins read all.
--   Writes are server-side only (webhook uses the service-role
--   key, which bypasses RLS).
-- ============================================================

create extension if not exists "pgcrypto";

create table if not exists public.subscriptions (
  id                       uuid          primary key default gen_random_uuid(),

  -- Owner of the subscription (Supabase auth user)
  user_id                  uuid          not null
                             references auth.users(id) on delete cascade,

  -- Exactly one of these two is set
  progressive_member_id    uuid          references public.progressive_members(id) on delete set null,
  custom_member_id         uuid          references public.custom_members(id)      on delete set null,

  -- Stripe identifiers
  stripe_customer_id       text          not null,
  stripe_subscription_id   text          not null unique,
  stripe_price_id          text,

  -- Subscription state
  status                   text          not null
                             check (status in (
                               'incomplete', 'incomplete_expired', 'trialing',
                               'active', 'past_due', 'canceled', 'unpaid', 'paused'
                             )),

  -- Billing window
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at                timestamptz,            -- set when cancellation is scheduled
  canceled_at              timestamptz,            -- set when actually canceled
  first_paid_at            timestamptz,            -- set on first invoice.paid event
  cancel_unlocks_at        timestamptz,            -- first_paid_at + 12 weeks (12-week lock)
  billing_anchor_date      date,                   -- 4-weekly cycle anchor

  -- Bookkeeping
  created_at               timestamptz   not null default now(),
  updated_at               timestamptz   not null default now(),

  -- Membership-link constraint: exactly one of the two FKs must be non-null.
  constraint subscriptions_member_xor check (
    (progressive_member_id is not null)::int +
    (custom_member_id      is not null)::int = 1
  )
);

-- Lookup indexes for the common query paths.
create index if not exists subscriptions_user_id_idx
  on public.subscriptions (user_id);
create index if not exists subscriptions_stripe_customer_id_idx
  on public.subscriptions (stripe_customer_id);
create index if not exists subscriptions_status_idx
  on public.subscriptions (status);
create index if not exists subscriptions_progressive_member_id_idx
  on public.subscriptions (progressive_member_id) where progressive_member_id is not null;
create index if not exists subscriptions_custom_member_id_idx
  on public.subscriptions (custom_member_id)      where custom_member_id      is not null;

-- ============================================================
-- updated_at maintenance
-- ============================================================
create or replace function public.tg_subscriptions_set_updated_at ()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.tg_subscriptions_set_updated_at();

-- ============================================================
-- Row-level security
--
-- The webhook handler authenticates with the service-role key,
-- which bypasses RLS — so we do NOT need any INSERT / UPDATE
-- policies for application code. Member-side reads go through
-- the anon key + user JWT and must be explicitly allowed.
-- ============================================================
alter table public.subscriptions enable row level security;

-- Members read only their own subscription.
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select
  using (auth.uid() = user_id);

-- Admin reads everything. The admin role is identified by an
-- `is_admin` flag on the JWT (`auth.jwt() -> 'app_metadata' ->> 'is_admin'`).
-- If you use a different admin convention, swap the predicate.
drop policy if exists subscriptions_select_admin on public.subscriptions;
create policy subscriptions_select_admin on public.subscriptions
  for select
  using (
    coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false)
  );

-- No INSERT / UPDATE / DELETE policies: those operations only
-- happen from the webhook handler under the service-role key,
-- which bypasses RLS.

comment on table public.subscriptions is
  'Stripe subscription state mirrored into Supabase. One row per Stripe subscription. Writes are webhook-only (service-role key); reads are RLS-gated to the owning member or admin.';
