-- ============================================================
-- 20260504_013_subscription_pause_cancel.sql
--
-- Adds the two columns needed for member-driven pause and cancel
-- flows. Both columns are mirrored from Stripe by the webhook and
-- read by the frontend Settings page + enforceMemberGates().
--
-- Design notes:
--
-- * `cancel_at_period_end` mirrors Stripe subscription
--   `cancel_at_period_end`. True when the member has scheduled
--   cancellation; status remains 'active' until the period
--   actually ends, at which point Stripe fires
--   customer.subscription.deleted and we flip status='canceled'.
--
-- * `pause_resumes_at` mirrors Stripe subscription
--   `pause_collection.resumes_at`. NULL means either no pause OR
--   open-ended pause (member resumes manually). Non-null means
--   automatic resume scheduled for that timestamp.
--
-- * 12-week minimum commitment (`cancel_unlocks_at`) is no longer
--   enforced per Mick's decision (2026-05-01) — kept in schema for
--   audit but no longer read by code.
-- ============================================================

alter table public.subscriptions
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists pause_resumes_at     timestamptz;

create index if not exists subscriptions_pause_resumes_at_idx
  on public.subscriptions (pause_resumes_at) where pause_resumes_at is not null;

create index if not exists subscriptions_cancel_at_period_end_idx
  on public.subscriptions (cancel_at_period_end) where cancel_at_period_end = true;

comment on column public.subscriptions.cancel_at_period_end is
  'True when the member has scheduled cancellation for end of current period. Mirrored from Stripe subscription.cancel_at_period_end via stripe-webhook on customer.subscription.updated.';

comment on column public.subscriptions.pause_resumes_at is
  'When set, the subscription will auto-resume at this timestamp. Mirrored from Stripe subscription.pause_collection.resumes_at. NULL = no pause OR open-ended pause (member resumes manually).';
