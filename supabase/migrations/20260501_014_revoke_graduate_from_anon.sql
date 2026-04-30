-- ============================================================
-- 20260501_014_revoke_graduate_from_anon.sql
--
-- Defence-in-depth follow-up to migration 013.
--
-- Supabase configures DEFAULT PRIVILEGES for the postgres role
-- such that newly-created functions in the public schema get
-- EXECUTE granted to anon/authenticated/service_role
-- automatically. Migration 013's `revoke all ... from public`
-- only strips the PUBLIC pseudo-role, not those explicit role
-- grants — so an unauthenticated client can technically call
-- graduate_from_primer().
--
-- The function body's internal auth check (auth.uid() / jwt
-- email gate) still blocks anon callers with errcode 42501,
-- so this isn't a bug — but EXECUTE on a definer function
-- shouldn't be available to anon at all. Strip it.
-- ============================================================

revoke execute on function public.graduate_from_primer() from anon;
