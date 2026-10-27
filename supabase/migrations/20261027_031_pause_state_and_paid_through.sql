-- ============================================================
-- 20261027_031_pause_state_and_paid_through.sql
--
-- Incident 2026-10-27: members paused with NO resume date (Stripe
-- pause_collection.resumes_at = null) were invisible to the platform.
--
-- Migration 015 mirrored only pause_collection.resumes_at, so
-- "paused open-ended" and "not paused" were both stored as NULL. Stripe
-- keeps such subscriptions at status='active' and keeps rolling
-- current_period_end forward each month (the invoice is created as a
-- draft and never charged). Net effect in the coach UI:
--   * Members list showed "Paid -> <next month>" for paused members.
--   * Overview "Paused" tile counted status='paused', which Stripe never
--     sets for pause_collection -> always 0.
--   * enforceMemberGates() / current_member_plan_blocked() never locked
--     a paused member, despite Settings telling them it would.
-- Ben Schlesier, Brad Morales-McGibben and Matt Hounsome were affected;
-- Mick kept publishing their programs while nothing was billed.
--
-- Fix:
--   * is_paused     — true whenever Stripe pause_collection is set,
--                     regardless of resumes_at. Mirrored by the webhook.
--   * paid_through  — end of the latest period covered by a PAID
--                     invoice. Set by the webhook on invoice.paid. This
--                     is the only honest "Paid -> date"; current_period_end
--                     advances even when nothing was collected.
--   * (Access lock for paused members is in migration 032, applied
--     together with the frontend gate change.)
--   * Backfill from live Stripe data pulled 2026-10-27.
-- ============================================================

alter table public.subscriptions
  add column if not exists is_paused    boolean not null default false,
  add column if not exists paid_through timestamptz;

comment on column public.subscriptions.is_paused is
  'True when Stripe pause_collection is set (with OR without a resume date). Mirrored by stripe-webhook on customer.subscription.updated. Use this — not pause_resumes_at — to decide whether a member is paused.';
comment on column public.subscriptions.paid_through is
  'End of the latest billing period covered by a paid invoice. Set by stripe-webhook on invoice.paid (never moves backwards). Unlike current_period_end, it does not advance while collection is paused.';

create index if not exists subscriptions_is_paused_idx
  on public.subscriptions (is_paused) where is_paused = true;

-- Backfill from Stripe (live, 2026-10-27). Canceled subs are left alone.
update public.subscriptions s
set is_paused        = v.is_paused,
    pause_resumes_at = v.pause_resumes_at,
    paid_through     = v.paid_through
from (values
  ('sub_1UUqXxLOyixoXdVaWuO90P0V', false, null, timestamptz '2026-11-01T00:00:00Z'),
  ('sub_1US7JOLOyixoXdVavVbVoCv2', false, null, timestamptz '2026-11-19T03:32:34Z'),
  ('sub_1UDhuNLOyixoXdVaGj65Cgzh', false, null, timestamptz '2026-11-09T09:35:11Z'),
  ('sub_1UCoAzLOyixoXdVanFHzmDKI', false, null, timestamptz '2026-11-06T22:04:37Z'),
  ('sub_1UCZ9rLOyixoXdVaSvVmrCF9', false, null, timestamptz '2026-11-06T06:02:27Z'),
  ('sub_1TzOtsLOyixoXdVadK3Q3PhK', true, null, timestamptz '2026-10-31T22:27:31Z'),
  ('sub_1TyEOVLOyixoXdVazAvPOmOx', false, null, timestamptz '2026-11-01T00:00:00Z'),
  ('sub_1Tcd1ZLOyixoXdVabWUy5wfZ', false, null, timestamptz '2026-10-30T02:53:20Z'),
  ('sub_1TbptdLOyixoXdVawrntCzq8', false, null, timestamptz '2026-11-01T00:00:00Z'),
  ('sub_1TUDCbLOyixoXdVa4CnzUO4P', false, null, timestamptz '2026-11-01T00:00:00Z'),
  ('sub_1TTjfYLOyixoXdVaB3czLZUj', true, null, timestamptz '2026-09-05T14:09:52Z'),
  ('sub_1TT7t6LOyixoXdVadsIAjSJi', false, null, timestamptz '2026-11-03T21:49:20Z'),
  ('sub_1TS6QULOyixoXdVaf1tpd6ZL', true, timestamptz '2027-01-03T00:00:00Z', timestamptz '2026-10-01T02:03:34Z'),
  ('sub_1TS0gALOyixoXdVafVJtW4Zi', false, null, timestamptz '2026-11-01T00:00:00Z'),
  ('sub_1TS00nLOyixoXdVa1cpwUAlD', true, null, timestamptz '2026-09-01T00:00:00Z'),
  ('sub_1TRimkLOyixoXdVa3vegVqaw', true, timestamptz '2027-02-01T00:00:00Z', timestamptz '2026-10-01T00:00:00Z'),
  ('sub_1TRhY2LOyixoXdVa9CbQxiqm', false, null, timestamptz '2026-11-01T00:00:00Z'),
  ('sub_1TROQMLOyixoXdVaMI3kYTM7', true, timestamptz '2027-01-05T00:00:00Z', timestamptz '2026-10-01T00:00:00Z'),
  ('sub_1TRK6HLOyixoXdVaRxfmjlyp', true, timestamptz '2027-01-01T00:00:00Z', timestamptz '2026-08-01T00:00:00Z'),
  ('sub_1TQzNOLOyixoXdVatx8lRRyd', false, null, timestamptz '2026-11-01T00:00:00Z')
) as v(stripe_subscription_id, is_paused, pause_resumes_at, paid_through)
where s.stripe_subscription_id = v.stripe_subscription_id;
