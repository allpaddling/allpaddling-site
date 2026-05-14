-- ============================================================
-- 20260514_018_outreach_sends_newsletter.sql
--
-- Extends outreach_sends so it can log emails to either a
-- shopify_customers row OR a newsletter_subscribers row. Same
-- send log, same campaign_name grouping — just two possible
-- recipient sources.
--
-- Before this migration: outreach_sends.shopify_customer_id was
-- NOT NULL, so newsletter-only signups couldn't be sent to without
-- materialising a fake shopify_customers row. After: exactly one
-- of (shopify_customer_id, newsletter_subscriber_id) is required.
--
-- Note: the existing rows (if any) all have shopify_customer_id
-- set, so dropping NOT NULL is safe — the CHECK constraint will
-- still allow them. No data backfill needed.
-- ============================================================

-- 1. Drop NOT NULL on shopify_customer_id so newsletter-only sends are allowed.
alter table public.outreach_sends
  alter column shopify_customer_id drop not null;

-- 2. Add the new FK column.
alter table public.outreach_sends
  add column if not exists newsletter_subscriber_id uuid
    references public.newsletter_subscribers(id) on delete cascade;

-- 3. Require exactly one of the two recipient FKs to be populated.
--    XOR semantics — never both, never neither.
alter table public.outreach_sends
  drop constraint if exists outreach_sends_recipient_xor;
alter table public.outreach_sends
  add constraint outreach_sends_recipient_xor check (
    (shopify_customer_id is not null)::int
    + (newsletter_subscriber_id is not null)::int
    = 1
  );

-- 4. Index the new column for the per-subscriber history drawer query.
create index if not exists outreach_sends_newsletter_idx
  on public.outreach_sends (newsletter_subscriber_id, sent_at desc)
  where newsletter_subscriber_id is not null;
