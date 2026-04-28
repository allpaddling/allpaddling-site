-- ============================================================
-- Migration 009 — welcome_email_sent_at on member_profiles
--
-- Reason: the welcome email was previously fired from the Stripe
-- webhook at signup time, when the only name we had was the Stripe
-- billing name (cardholder name). That meant customers got "Hi Jake"
-- when they later told us via onboarding to call them "JakeAnonTest".
--
-- Refactor: fire the welcome email AFTER onboarding completes so it
-- uses member_profiles.preferred_name. This column tracks whether
-- a member has already received their welcome email so the trigger
-- is idempotent (the onboarding form might be re-submitted, the
-- trigger function might be retried, etc.).
--
-- NULL = not yet sent. Timestamp = when sent.
-- ============================================================

alter table public.member_profiles
  add column if not exists welcome_email_sent_at timestamptz;

comment on column public.member_profiles.welcome_email_sent_at is
  'When the welcome email was sent to this member. NULL = not yet sent. Used as the idempotency key by the trigger-welcome-email function.';
