-- ============================================================
-- 20260523_025_outreach_sends_active_members.sql
--
-- Lets outreach_sends log campaigns sent to active paying members
-- (rows in progressive_members / custom_members) alongside the
-- existing Shopify-customer + newsletter-subscriber sources.
--
-- Active members are identified by auth.users.id (stable across
-- plan switches and email changes — the same identity a member
-- carries through the rest of the app). Picking that key over
-- email_lc keeps the join story consistent with the rest of the
-- schema: get_member_insights(), threshold_log, session_completions,
-- and member_profiles are all keyed on auth_user_id.
--
-- Schema change:
--   1. Add nullable `member_auth_user_id uuid` referencing auth.users.
--   2. Drop the existing XOR(shopify, newsletter) CHECK constraint and
--      replace with XOR3(shopify, newsletter, member) so existing
--      rows remain valid and new ones can populate exactly one of
--      the three FKs.
--   3. Index for join performance on the per-campaign attribution
--      query the engagement dashboard will run.
-- ============================================================

alter table public.outreach_sends
  add column if not exists member_auth_user_id uuid
    references auth.users(id) on delete set null;

-- Replace the two-way XOR with a three-way XOR.
alter table public.outreach_sends
  drop constraint if exists outreach_sends_recipient_xor;

alter table public.outreach_sends
  add constraint outreach_sends_recipient_xor
  check (
    ((shopify_customer_id      is not null)::int +
     (newsletter_subscriber_id is not null)::int +
     (member_auth_user_id      is not null)::int) = 1
  );

create index if not exists outreach_sends_member_auth_user_id_idx
  on public.outreach_sends (member_auth_user_id)
  where member_auth_user_id is not null;

comment on column public.outreach_sends.member_auth_user_id is
  'For campaigns sent to active members (progressive_members / custom_members), the auth.users.id of the recipient. Exactly one of shopify_customer_id / newsletter_subscriber_id / member_auth_user_id is set (enforced by outreach_sends_recipient_xor).';
