-- ============================================================
-- 20260515_019_newsletter_subscriber_names.sql
--
-- Adds first_name + last_name columns to newsletter_subscribers
-- so personalized outreach (e.g. "Hi Sarah,") works for newsletter
-- signups, not just for past Shopify customers (which carry these
-- already on shopify_customers).
--
-- Both columns are nullable — the public signup form requests them
-- but doesn't require them, since requiring more fields tanks
-- conversion. Existing rows from before this migration will have
-- nulls, which the admin-outreach UI already handles ("—").
-- ============================================================

alter table public.newsletter_subscribers
  add column if not exists first_name text,
  add column if not exists last_name  text;
