-- Migration 010 — add family_name to member_profiles.
--
-- Background (Jake, 2026-04-29):
-- The onboarding form has a single "What should we call you?" field
-- which captures preferred_name (a first name we should call them by).
-- For invoicing, formal addressing, and avoiding ambiguity in the
-- coach Members list, we also want a last name. Stripe billing name is
-- a sometimes-fallback (we already mirror it into custom_members.name
-- and progressive_members.name) but customers don't always enter their
-- full name as cardholder — we saw "Patrick" from one customer where
-- "Patrick O'Keefe" was the actual full name.
--
-- This migration only adds the column. The form change to capture it
-- on new signups, and the display change to render
-- "${preferred_name} ${family_name}", ship in the same commit batch.
-- Existing rows are backfilled separately for the 3 currently-signed-up
-- customers (Daniel Michaluk, Pat O'Keefe, Paora Monk).

alter table public.member_profiles
  add column if not exists family_name text;

comment on column public.member_profiles.family_name is
  'Last/family name. Captured on the onboarding form alongside preferred_name. '
  'Used together as "preferred_name family_name" for member display in admin '
  'and the dashboard sidebar.';
