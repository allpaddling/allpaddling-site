-- ============================================================
-- 20260427_008_migration_customers.sql
--
-- Schema for the Shopify→Stripe migration roster. One row per
-- existing Shopify subscriber that needs to move to Stripe.
--
-- Loaded once from the Appstle CSV export at the start of the
-- migration window. Coach updates `migration_status` as each
-- customer moves through the funnel (heads-up sent → signup
-- link sent → signed up → Shopify cancelled → migrated, or
-- "lapsed" if they don't return).
--
-- Read by `admin-migrate.html` to render the migration roster.
-- Customer emails are sensitive (poach risk if leaked), so the
-- table is RLS-gated to coaches only.
--
-- Seed data is NOT included in this migration — the repo is
-- public and we don't put 21 customer emails in source. Mick or
-- Jake runs the local-only `migration/seed-migration-customers.sql`
-- (generated from the audit) in Studio to populate it.
-- ============================================================

create table if not exists public.migration_customers (
  id                  uuid          primary key default gen_random_uuid(),

  -- Stable cross-reference to the Appstle subscription.
  legacy_id           text          unique,

  -- Customer identity
  email               text          not null,
  name                text          not null,
  country_code        text,                                 -- ISO 3166-1 alpha-2

  -- What plan they're on in Shopify (and what they should be on in Stripe)
  plan_type           text          not null
                        check (plan_type in ('progressive', 'custom')),
  plan_key            text          check (plan_key in ('prone', 'sup', 'oc', 'ski')),

  -- Current Shopify monthly amount (used to grandfather the rate
  -- in Stripe via inline price_data on the Checkout Session).
  amount_cents        integer       not null check (amount_cents > 0 and amount_cents <= 1000000),
  currency            text          not null check (length(currency) = 3),

  -- Timing
  shopify_created_at  timestamptz,
  next_renewal        timestamptz,

  -- Migration progress — coach updates this as customers move through.
  -- Default 'pending' = haven't touched them yet.
  migration_status    text          not null default 'pending'
                        check (migration_status in (
                          'pending',
                          'heads_up_sent',
                          'signup_link_sent',
                          'signed_up',
                          'shopify_cancelled',
                          'migrated',
                          'lapsed',
                          'on_hold'
                        )),
  status_updated_at   timestamptz   not null default now(),
  notes               text,

  -- Bookkeeping
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now(),

  -- Custom-plan rows must NOT have a plan_key; progressive rows MUST have one.
  constraint migration_customers_plan_key_xor check (
    (plan_type = 'progressive' and plan_key is not null) or
    (plan_type = 'custom'      and plan_key is null)
  )
);

create index if not exists migration_customers_status_idx
  on public.migration_customers (migration_status, next_renewal);
create index if not exists migration_customers_email_idx
  on public.migration_customers (email);

-- ============================================================
-- updated_at + status_updated_at maintenance
-- ============================================================
create or replace function public.tg_migration_customers_set_updated_at ()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.migration_status is distinct from old.migration_status then
    new.status_updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists migration_customers_set_updated_at on public.migration_customers;
create trigger migration_customers_set_updated_at
  before update on public.migration_customers
  for each row execute function public.tg_migration_customers_set_updated_at();

-- ============================================================
-- Row-level security — coach-only
-- ============================================================
alter table public.migration_customers enable row level security;

drop policy if exists migration_customers_coach_select on public.migration_customers;
create policy migration_customers_coach_select on public.migration_customers
  for select
  using (public.is_coach());

drop policy if exists migration_customers_coach_modify on public.migration_customers;
create policy migration_customers_coach_modify on public.migration_customers
  for all
  using       (public.is_coach())
  with check  (public.is_coach());

comment on table public.migration_customers is
  'Migration roster for the Shopify→Stripe transition. Coach-only RLS. One row per existing Shopify subscriber. status column tracks the migration funnel.';
