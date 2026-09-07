-- Migration 029 — refunds: mirror Stripe refunds into the platform
--
-- Background
-- ----------
-- Until now the platform had no idea a refund had happened. The
-- stripe-webhook handled five events (checkout.session.completed,
-- invoice.paid, invoice.payment_failed, customer.subscription.updated
-- and .deleted) and ignored everything else, so a refund issued from
-- the Stripe dashboard left no trace in Supabase and no signal in the
-- coach member list.
--
-- That surfaced on 2026-09-07: eight A$140 charges were refunded in
-- Stripe for members who had stopped paddling, and nothing in the
-- admin UI showed it. (Separately, refunding a charge does NOT stop
-- the subscription — those seven still-active subs were cancelled by
-- hand at the same time. See project memory.)
--
-- Design choices
-- --------------
-- * One row per Stripe refund object, keyed on stripe_refund_id.
--   A charge can be refunded more than once (partial refunds), so a
--   pair of columns on `subscriptions` would lose history. This is a
--   proper append-style ledger instead.
-- * user_id is nullable and ON DELETE SET NULL. A refund is a
--   financial record — it must survive the member row being removed.
--   The Stripe ids are the durable identity.
-- * stripe_customer_id is the join key the webhook actually has.
--   `charge.refunded` carries the customer, not the subscription, and
--   for Link/bank charges the refund object itself has customer=null —
--   so the handler reads it off the charge and we store it here.
-- * amount_cents is the SETTLEMENT amount in `currency` (AUD for this
--   account). Stripe's presentment amount (what the member saw in USD,
--   CAD, NZD) is deliberately not stored — Mick reconciles in AUD.
-- * RLS: member reads their own refunds; coach reads all via
--   is_coach(). Writes are webhook-only under the service-role key,
--   which bypasses RLS, so there are no INSERT/UPDATE policies.

create table if not exists public.refunds (
  id                       uuid        primary key default gen_random_uuid(),

  -- Stripe identity (durable — survives member deletion)
  stripe_refund_id         text        not null unique,
  stripe_charge_id         text,
  stripe_payment_intent_id text,
  stripe_customer_id       text        not null,

  -- Platform linkage (best-effort — a refund can predate or outlive it)
  user_id                  uuid        references auth.users(id)      on delete set null,
  subscription_id          uuid        references public.subscriptions(id) on delete set null,

  -- Money
  amount_cents             integer     not null check (amount_cents >= 0),
  currency                 text        not null default 'aud',

  -- Stripe refund state
  reason                   text,
  status                   text        not null default 'succeeded'
                             check (status in ('pending', 'succeeded', 'failed', 'canceled', 'requires_action')),
  refunded_at              timestamptz not null,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on table public.refunds is
  'Stripe refunds mirrored into Supabase. One row per Stripe refund object. Written only by the stripe-webhook (charge.refunded / charge.refund.updated) under the service-role key. Read by the coach member list to render the Refunded badge.';
comment on column public.refunds.stripe_customer_id is
  'Read off the charge, not the refund — refund.customer is null for Link and bank-debit charges. This is the reliable join key back to subscriptions.stripe_customer_id.';
comment on column public.refunds.amount_cents is
  'Settlement amount in `currency` (AUD for this account), NOT the presentment amount the member was shown in their own currency.';
comment on column public.refunds.user_id is
  'Nullable + ON DELETE SET NULL on purpose: a refund is a financial record and must outlive the member row.';

create index if not exists refunds_user_id_idx
  on public.refunds (user_id) where user_id is not null;
create index if not exists refunds_stripe_customer_id_idx
  on public.refunds (stripe_customer_id);
create index if not exists refunds_refunded_at_idx
  on public.refunds (refunded_at desc);

-- ---------------------------------------------------------------
-- updated_at maintenance (matches the subscriptions table pattern)
-- ---------------------------------------------------------------
create or replace function public.tg_refunds_set_updated_at ()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists refunds_set_updated_at on public.refunds;
create trigger refunds_set_updated_at
  before update on public.refunds
  for each row execute function public.tg_refunds_set_updated_at();

-- ---------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------
alter table public.refunds enable row level security;

-- Member: read own refunds only.
drop policy if exists refunds_own_select on public.refunds;
create policy refunds_own_select on public.refunds
  for select using (auth.uid() = user_id);

-- Coach: read everyone's.
drop policy if exists refunds_coach_select on public.refunds;
create policy refunds_coach_select on public.refunds
  for select using (public.is_coach());

-- No INSERT / UPDATE / DELETE policies — the webhook writes with the
-- service-role key, which bypasses RLS entirely.

revoke all on public.refunds from anon;
