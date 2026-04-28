-- Migration 011 — add 'urgent_signup_sent' to migration_status check.
--
-- Background (Jake, 2026-04-29):
-- Mick confirmed that for Custom Plan customers, content delivery is
-- calendar-aligned (May block drops Monday May 4, regardless of each
-- customer's individual Shopify renewal anniversary). The original
-- rolling-renewal migration plan would have left customers with content
-- gaps between their Shopify cutoff and Stripe signup. Solution is a
-- synchronized cutover: cancel all active Shopify subs and send everyone
-- a single urgent "sign up by Saturday May 2 to keep your training on
-- track" email pointing to the standard custom-plan.html signup page
-- (with email pre-filled via ?email= URL param).
--
-- The new urgent-cancellation-and-resignup email belongs to a different
-- track than the original heads_up_sent / signup_link_sent / day-of
-- lifecycle. Adding 'urgent_signup_sent' so admin-migrate can track who
-- received the urgent email separately from the original sequence.

alter table public.migration_customers
  drop constraint migration_customers_migration_status_check;

alter table public.migration_customers
  add constraint migration_customers_migration_status_check
  check (migration_status in (
    'pending',
    'heads_up_sent',
    'signup_link_sent',
    'urgent_signup_sent',
    'signed_up',
    'shopify_cancelled',
    'migrated',
    'lapsed',
    'on_hold'
  ));
