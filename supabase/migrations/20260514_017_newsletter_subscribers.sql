-- ============================================================
-- 20260514_017_newsletter_subscribers.sql
--
-- Storage for the public-site footer newsletter signup. Live form
-- on the marketing pages (rendered by rebuild/assets/site.js)
-- POSTs to the `newsletter-signup` Edge Function, which inserts
-- one row here per email captured.
--
-- Distinct from `shopify_customers` (historical Shopify roster)
-- and `migration_customers` (the 21-person cutover) — those are
-- inferred-consent imports. Newsletter subscribers are explicit
-- opt-ins (they typed their email and clicked Subscribe), so the
-- Spam Act bar is much lower for outreach to them.
--
-- The outreach UI may UNION these alongside shopify_customers in
-- a future iteration so Mick can include them in campaigns. For
-- now, coach can `select * from newsletter_subscribers` in Studio.
-- ============================================================

create table if not exists public.newsletter_subscribers (
  id                  uuid          primary key default gen_random_uuid(),

  -- Lowercased before insert by the Edge Function. Unique so the
  -- "Subscribe" button is idempotent — repeat submissions are no-ops.
  email               text          not null unique,

  -- Where the signup happened. 'public_footer' for now (only signup
  -- surface). If/when we add other entry points (e.g. blog post CTA,
  -- pace-calculator post-result), set source accordingly so we can
  -- attribute conversion.
  source              text          default 'public_footer',

  -- Lightweight audit: helps spot bot floods or repeat IPs.
  signup_user_agent   text,
  signup_ip           text,

  subscribed_at       timestamptz   not null default now(),

  -- Our own unsubscribe state (mirrors the shopify_customers pattern).
  -- Edge Function checks this on insert: if a previously-unsubscribed
  -- email re-subscribes, we clear the unsubscribed_at and bump
  -- subscribed_at so the row is "live" again.
  unsubscribed_at     timestamptz,
  unsubscribe_reason  text
);

create index if not exists newsletter_subscribers_subscribed_at_idx
  on public.newsletter_subscribers (subscribed_at desc);
create index if not exists newsletter_subscribers_unsub_idx
  on public.newsletter_subscribers (unsubscribed_at) where unsubscribed_at is not null;

-- ============================================================
-- Row-level security — coach SELECT only.
--
-- INSERT is NOT exposed via RLS. The Edge Function uses the
-- service-role key, which bypasses RLS, so anonymous form posts
-- never directly insert. This stops random anon clients from
-- hammering the table outside the rate-limited / honeypot-
-- protected function path.
-- ============================================================
alter table public.newsletter_subscribers enable row level security;

drop policy if exists newsletter_subscribers_coach_select on public.newsletter_subscribers;
create policy newsletter_subscribers_coach_select on public.newsletter_subscribers
  for select using (public.is_coach());

drop policy if exists newsletter_subscribers_coach_modify on public.newsletter_subscribers;
create policy newsletter_subscribers_coach_modify on public.newsletter_subscribers
  for all using (public.is_coach()) with check (public.is_coach());

comment on table public.newsletter_subscribers is
  'Explicit opt-in newsletter signups from the public-site footer form. Coach-only RLS for SELECT/UPDATE; INSERT goes through the newsletter-signup Edge Function (service-role).';
