# RLS audit — subscriptions, webhook_events, member_profiles

ROADMAP §4.1. This document captures the explicit test cases that confirm row-level security is correctly enforced on the three tables added during the Track A build sprint. The test runner is below; paste it into Supabase SQL Editor any time the policies change.

## What's being verified

| Table | Member can read own row | Member can read others | Member can write to others | Admin can read all | Anon sees nothing |
|---|---|---|---|---|---|
| `member_profiles` | ✓ T1 | ✗ T2 | ✗ T3 | ✓ T7 | ✓ T10 |
| `subscriptions` | ✓ T4 | ✗ T5 | n/a (writes are service-role only) | ✓ T8 | ✓ T11 |
| `webhook_events` | ✗ T6 | ✗ T6 | n/a (writes are service-role only) | ✗ T9 (deliberate — no SELECT policies) | ✓ implicit |

`webhook_events` deliberately has no SELECT policies — even admins can't read it through the PostgREST API. The webhook handler reads/writes it under the service-role key, which bypasses RLS entirely.

## Last run

Executed 2026-04-26 against the production project `crlukzkgmydyqpwndjvc`. All 11 tests passed.

```
T1   PASS  user_a sees own member_profiles
T2   PASS  user_a CANNOT see user_b member_profiles
T3   PASS  user_a UPDATE on user_b blocked
T4   PASS  user_a sees own subscriptions
T5   PASS  user_a CANNOT see user_b subscriptions
T6   PASS  user_a CANNOT see webhook_events
T7   PASS  admin sees both member_profiles
T8   PASS  admin sees both subscriptions
T9   PASS  admin CANNOT see webhook_events (no SELECT policies)
T10  PASS  anon CANNOT see member_profiles
T11  PASS  anon CANNOT see subscriptions
```

## How the runner works

The runner creates three synthetic users in `auth.users` (`user_a`, `user_b`, `user_admin`), seeds related rows in each public table, then runs SELECT/UPDATE statements under three different simulated auth contexts:

- **`authenticated` role + JWT claim `sub = user_a`, `is_admin = false`** — a regular member
- **`authenticated` role + JWT claim `sub = user_admin`, `is_admin = true`** — an admin
- **`anon` role with no JWT** — a logged-out visitor

Auth context is simulated with `set_config('role', …, true)` and `set_config('request.jwt.claims', …, true)`. These are local-to-transaction so the changes don't leak. The `auth.uid()` and `auth.jwt()` helpers used by the policies read from these settings.

The runner is wrapped in a temp-scoped function (`pg_temp.run_rls_audit`) so it returns a result table the SQL editor can display — `RAISE NOTICE` output is swallowed by Supabase Studio. Cleanup runs at the end of the function, deleting all synthetic rows.

## Re-running

Paste the SQL block below into Supabase SQL Editor and click Run. It will overwrite the previous `pg_temp.run_rls_audit` definition and execute it. Approve the destructive-operations warning (it fires because of the cleanup `delete` statements).

```sql
create or replace function pg_temp.run_rls_audit ()
returns table (test_id text, result text) language plpgsql as $fn$
declare
  user_a       uuid := '11111111-1111-1111-1111-111111111111';
  user_b       uuid := '22222222-2222-2222-2222-222222222222';
  user_admin   uuid := '33333333-3333-3333-3333-333333333333';
  member_a_id  uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  member_b_id  uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  visible      int;
begin
  -- Seed
  insert into auth.users (id, is_sso_user, is_anonymous, email)
    values (user_a,     false, false, 'rls-test-a@example.invalid'),
           (user_b,     false, false, 'rls-test-b@example.invalid'),
           (user_admin, false, false, 'rls-test-admin@example.invalid')
    on conflict (id) do nothing;
  insert into public.member_profiles (user_id, preferred_name, completed_onboarding_at)
    values (user_a, 'Alice (test)', now()), (user_b, 'Bob (test)', now())
    on conflict (user_id) do nothing;
  insert into public.custom_members (id, email, name)
    values (member_a_id, 'alice-rls-test@example.com', 'Alice'),
           (member_b_id, 'bob-rls-test@example.com',   'Bob')
    on conflict (id) do nothing;
  insert into public.subscriptions (user_id, custom_member_id, stripe_customer_id, stripe_subscription_id, status)
    values (user_a, member_a_id, 'cus_test_a', 'sub_test_a', 'active'),
           (user_b, member_b_id, 'cus_test_b', 'sub_test_b', 'active')
    on conflict (stripe_subscription_id) do nothing;
  insert into public.webhook_events (source, event_id, event_type, livemode)
    values ('stripe', 'evt_rls_test_001', 'invoice.paid', false)
    on conflict (source, event_id) do nothing;

  -- AS USER A (regular member)
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', user_a::text, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('is_admin', false))::text, true);

  select count(*) into visible from public.member_profiles where user_id = user_a;
  return query select 'T1'::text, case when visible = 1 then 'PASS user_a sees own member_profiles' else 'FAIL got ' || visible end;

  select count(*) into visible from public.member_profiles where user_id = user_b;
  return query select 'T2'::text, case when visible = 0 then 'PASS user_a CANNOT see user_b member_profiles' else 'FAIL got ' || visible end;

  update public.member_profiles set preferred_name = 'HACKED' where user_id = user_b;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  select count(*) into visible from public.member_profiles where user_id = user_b and preferred_name = 'HACKED';
  return query select 'T3'::text, case when visible = 0 then 'PASS user_a UPDATE on user_b blocked' else 'FAIL user_a wrote to user_b' end;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', user_a::text, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('is_admin', false))::text, true);

  select count(*) into visible from public.subscriptions where user_id = user_a;
  return query select 'T4'::text, case when visible = 1 then 'PASS user_a sees own subscriptions' else 'FAIL got ' || visible end;

  select count(*) into visible from public.subscriptions where user_id = user_b;
  return query select 'T5'::text, case when visible = 0 then 'PASS user_a CANNOT see user_b subscriptions' else 'FAIL got ' || visible end;

  select count(*) into visible from public.webhook_events where event_id = 'evt_rls_test_001';
  return query select 'T6'::text, case when visible = 0 then 'PASS user_a CANNOT see webhook_events' else 'FAIL got ' || visible end;

  -- AS ADMIN (is_admin=true in app_metadata)
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', user_admin::text, 'role', 'authenticated',
                       'app_metadata', jsonb_build_object('is_admin', true))::text, true);

  select count(*) into visible from public.member_profiles where user_id in (user_a, user_b);
  return query select 'T7'::text, case when visible = 2 then 'PASS admin sees both member_profiles' else 'FAIL got ' || visible end;

  select count(*) into visible from public.subscriptions where user_id in (user_a, user_b);
  return query select 'T8'::text, case when visible = 2 then 'PASS admin sees both subscriptions' else 'FAIL got ' || visible end;

  select count(*) into visible from public.webhook_events where event_id = 'evt_rls_test_001';
  return query select 'T9'::text, case when visible = 0 then 'PASS admin CANNOT see webhook_events (no SELECT policies)' else 'FAIL got ' || visible end;

  -- AS ANON (no JWT)
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);

  select count(*) into visible from public.member_profiles where user_id in (user_a, user_b);
  return query select 'T10'::text, case when visible = 0 then 'PASS anon CANNOT see member_profiles' else 'FAIL got ' || visible end;

  select count(*) into visible from public.subscriptions where user_id in (user_a, user_b);
  return query select 'T11'::text, case when visible = 0 then 'PASS anon CANNOT see subscriptions' else 'FAIL got ' || visible end;

  -- Cleanup
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  delete from public.subscriptions   where user_id in (user_a, user_b);
  delete from public.custom_members  where id in (member_a_id, member_b_id);
  delete from public.member_profiles where user_id in (user_a, user_b);
  delete from public.webhook_events  where event_id = 'evt_rls_test_001';
  delete from auth.users where id in (user_a, user_b, user_admin);
end;
$fn$;

select * from pg_temp.run_rls_audit() order by test_id;
```

## What this audit doesn't cover

Audit it pre-emptively rather than be surprised later. The known gaps:

- **Pre-existing tables** (`progressive_members`, `custom_members`, `progressive_plans`, `custom_plans`) are out of scope here. They were assumed correct in the handoff — re-confirming them is a separate task.
- **JWT-based admin** assumes `app_metadata.is_admin = true` is the canonical admin signal. If Mick uses a different convention (e.g. a `coaches` table with email match), the policies and this test need updating in lockstep.
- **Service-role bypass** is a feature, not a hole — the webhook handler relies on it. But it does mean a leaked service-role key would bypass every check above. Treat the key the way you'd treat a database superuser password.
- **Edge cases in policy SQL itself** (e.g. NULL-handling in `auth.uid()`, malformed JWT claims, type-coercion bugs) aren't directly tested. The current test exercises the happy-path predicates only.
