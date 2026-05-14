-- ============================================================
-- 20260514_016_shopify_outreach.sql
--
-- Schema for the post-migration "winback" outreach tool. Holds the
-- full Shopify customers export (73 customers) plus a send log so
-- the coach can track which customer received which campaign.
--
-- Distinct from `migration_customers`:
--   - migration_customers = the 21-person forced cutover roster
--     (now mostly closed out). Source of truth for THAT funnel.
--   - shopify_customers   = the broader population of past Shopify
--     customers, many of whom were never going to be force-migrated.
--     Source of truth for winback / re-engagement campaigns.
--
-- An email can appear in BOTH tables (migrate-eligible + winback-
-- eligible). The shopify_customers page cross-references active
-- `progressive_members` + `custom_members` at render time to mark
-- "already on AllPaddling" rows, so it stays correct as new signups
-- come in without needing a backfill.
--
-- Seed data is in supabase/scripts/seed-shopify-customers.sql
-- (run once in Studio after applying this migration).
--
-- Read by `admin-outreach.html` to render the outreach table.
-- Coach-only RLS — customer emails are sensitive.
-- ============================================================

-- ============================================================
-- shopify_customers
-- ============================================================
create table if not exists public.shopify_customers (
  id                          uuid          primary key default gen_random_uuid(),

  -- Customer identity. Email is the natural key — it's what we cross-
  -- reference against progressive_members + custom_members.
  shopify_customer_id         text          unique,                  -- e.g. '6329925238863' (string, has leading apostrophe in CSV)
  email                       text          not null unique,         -- always lowercased before insert
  first_name                  text,
  last_name                   text,
  country_code                text,                                  -- ISO 3166-1 alpha-2

  -- Marketing consent as recorded in Shopify at export time. NOT the
  -- same thing as our own unsubscribed_at — this reflects what the
  -- customer told Shopify, our column reflects what they tell us.
  -- Per Jake (2026-05-14): no-consent customers stay visible in the
  -- table with a warning chip; the UI requires explicit override to
  -- include them in a send.
  shopify_marketing_consent   boolean,                               -- null = unknown, true = yes, false = no

  -- Aggregates from the Shopify customers export
  shopify_total_spent         numeric(10,2),                         -- AUD
  shopify_total_orders        integer,
  shopify_tags                text[],

  -- Aggregates computed from the Shopify orders export at seed time.
  -- Refreshed only if Jake re-imports — these are point-in-time.
  first_order_date            date,
  last_order_date             date,
  orders_count                integer       default 0,
  orders_total_paid           numeric(10,2) default 0,
  products                    text[],                                -- deduped product line names

  -- Free-form notes the coach can attach. The Shopify "Note" field is
  -- imported into this column at seed time but the coach can overwrite.
  notes                       text,

  -- Our own unsubscribe state. Separate from shopify_marketing_consent
  -- so that a click on an unsubscribe link in our own campaign emails
  -- writes here, leaving the Shopify-derived flag untouched.
  unsubscribed_at             timestamptz,
  unsubscribe_reason          text,

  -- Bookkeeping
  imported_from               text          default 'shopify_export_2026_05_14',
  created_at                  timestamptz   not null default now(),
  updated_at                  timestamptz   not null default now()
);

create index if not exists shopify_customers_email_idx        on public.shopify_customers (email);
create index if not exists shopify_customers_unsub_idx        on public.shopify_customers (unsubscribed_at) where unsubscribed_at is not null;
create index if not exists shopify_customers_last_order_idx   on public.shopify_customers (last_order_date desc nulls last);

-- ============================================================
-- outreach_sends
--
-- One row per (customer, campaign) email send. campaign_name is a
-- free-text label the coach types when composing — sends with the
-- same campaign_name belong to the same logical campaign and can be
-- GROUP BY-ed for "who got the May 2026 winback?" queries. No
-- separate campaigns table — keeps the schema light for the scale
-- (~50 customers, occasional campaigns).
-- ============================================================
create table if not exists public.outreach_sends (
  id                  uuid          primary key default gen_random_uuid(),

  -- Who got the email. fk → shopify_customers, but we also denormalize
  -- the email at send time so the log survives a customer delete.
  shopify_customer_id uuid          not null references public.shopify_customers(id) on delete cascade,
  recipient_email     text          not null,

  -- Campaign-level grouping. e.g. "May 2026 winback — Custom cold".
  -- Optional template_kind for future automation; for v1 the coach
  -- types subject + body inline so we always record what was sent.
  campaign_name       text          not null,
  template_kind       text,

  -- Snapshot of the actual content sent. Lets us see the historical
  -- record even if the coach reuses the same campaign_name later.
  subject             text          not null,
  body_text           text,
  body_html           text,

  -- Delivery state. send-email returns a Resend message id on success.
  status              text          not null default 'sent'
                        check (status in ('sent','failed','bounced','complained')),
  resend_id           text,
  error               text,

  -- Who triggered the send (coach email from the JWT).
  sent_by             text,
  sent_at             timestamptz   not null default now()
);

create index if not exists outreach_sends_customer_idx        on public.outreach_sends (shopify_customer_id, sent_at desc);
create index if not exists outreach_sends_campaign_idx        on public.outreach_sends (campaign_name, sent_at desc);
create index if not exists outreach_sends_sent_at_idx         on public.outreach_sends (sent_at desc);

-- ============================================================
-- updated_at maintenance for shopify_customers
-- ============================================================
create or replace function public.tg_shopify_customers_set_updated_at ()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists shopify_customers_set_updated_at on public.shopify_customers;
create trigger shopify_customers_set_updated_at
  before update on public.shopify_customers
  for each row execute function public.tg_shopify_customers_set_updated_at();

-- ============================================================
-- Row-level security — coach-only
-- ============================================================
alter table public.shopify_customers enable row level security;
alter table public.outreach_sends    enable row level security;

drop policy if exists shopify_customers_coach_select on public.shopify_customers;
create policy shopify_customers_coach_select on public.shopify_customers
  for select using (public.is_coach());

drop policy if exists shopify_customers_coach_modify on public.shopify_customers;
create policy shopify_customers_coach_modify on public.shopify_customers
  for all using (public.is_coach()) with check (public.is_coach());

drop policy if exists outreach_sends_coach_select on public.outreach_sends;
create policy outreach_sends_coach_select on public.outreach_sends
  for select using (public.is_coach());

drop policy if exists outreach_sends_coach_modify on public.outreach_sends;
create policy outreach_sends_coach_modify on public.outreach_sends
  for all using (public.is_coach()) with check (public.is_coach());

comment on table public.shopify_customers is
  'Post-migration outreach roster — full historical Shopify customers. Coach-only RLS. Cross-reference against progressive_members + custom_members at render time to mark already-signed-up rows.';
comment on table public.outreach_sends is
  'Per-customer email send log for outreach campaigns. One row per email sent. Group by campaign_name for campaign-level analytics.';
