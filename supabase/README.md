# Supabase migrations

This folder is the source-of-truth for the All Paddling Supabase schema. Every schema change starts as a numbered SQL file in `migrations/` and is then applied to the project (Studio → SQL editor, or Supabase CLI).

## Naming

`migrations/YYYYMMDD_NNN_short_description.sql` — date prefix sorts files chronologically, `NNN` disambiguates multiple migrations on the same day, `short_description` is a human label.

## Conventions

- Migrations are idempotent where reasonable (`if not exists`, `drop ... if exists` before `create`). Re-running a migration on an up-to-date database should be a no-op.
- Every new table has RLS enabled and an explicit set of policies. No table is left open.
- Member-side code uses the anon key and is bound by RLS. Webhook / server-side code uses the service-role key, which bypasses RLS — so DML policies are usually unnecessary.
- Don't edit a migration after it's been applied to production. Add a follow-up migration instead.

## Applying

For now, paste the SQL into Supabase Studio's SQL editor (project: `crlukzkgmydyqpwndjvc`). When the Supabase CLI is wired up, switch to `supabase db push`.
