-- Migration 012 — add 'reminder_sent' and 'last_call_sent' to migration_status.
--
-- Background (Jake, 2026-04-29):
-- After the URGENT email blast on 2026-04-28 we have 17 customers in
-- 'urgent_signup_sent' who haven't paid yet (deadline Saturday 2 May,
-- May content block starts Monday 4 May). Jake wants two follow-up
-- touches to lift conversion before the cutoff:
--
--   * REMINDER — sent Thursday 30 April (3 days before cutoff). Tone:
--     friendly nudge, reminds about the deadline.
--   * LAST CALL — sent Friday 1 May (last full day before cutoff).
--     Tone: final reminder, asks for a "yes/no" reply if undecided.
--
-- Tracking these as distinct statuses (rather than overloading
-- 'urgent_signup_sent') so admin-migrate funnel reporting can show
-- who's been touched at each level.

alter table public.migration_customers
  drop constraint migration_customers_migration_status_check;

alter table public.migration_customers
  add constraint migration_customers_migration_status_check
  check (migration_status in (
    'pending',
    'heads_up_sent',
    'signup_link_sent',
    'urgent_signup_sent',
    'reminder_sent',
    'last_call_sent',
    'signed_up',
    'shopify_cancelled',
    'migrated',
    'lapsed',
    'on_hold'
  ));
