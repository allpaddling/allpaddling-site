# create-checkout-session

Companion to `stripe-webhook`. The webhook ingests events from Stripe; this function *creates* the Checkout Session that triggers them.

## Two modes

| Mode      | Auth                                                                | Caller                                  | Pricing                          |
|-----------|---------------------------------------------------------------------|-----------------------------------------|----------------------------------|
| **self**     | `Authorization: Bearer <user JWT>`                                  | Frontend (`getting-started.html` flow)  | Canonical Price (lookup_key)     |
| **migrate**  | `Authorization: Bearer <service-role>` *or* `x-migration: 1` header | Coach admin migration page              | Inline `price_data` (grandfathered) |

Both modes attach the same metadata contract the webhook expects (`user_id`, `plan_type`, `plan_key`, `source`).

## Self mode

Customer signs in to the new site via Supabase magic-link, picks a plan, frontend calls:

```js
const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
  method:  'POST',
  headers: {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${supabaseSession.access_token}`,
  },
  body: JSON.stringify({
    plan_type: 'progressive',
    plan_key:  'prone',
  }),
});
const { url } = await res.json();
window.location.href = url;
```

Self-mode prices come from Stripe Prices created by `supabase/scripts/setup-stripe-products.ts`. The function looks them up by `lookup_key` so it keeps working when you swap test mode for live mode (re-run the setup script in live mode and the lookup keys point at the live prices).

## Migrate mode

Coach admin generates a one-time signup link for an existing Shopify customer. The price is set inline so it grandfathers the customer's exact Shopify rate.

```bash
curl -X POST https://<project>.supabase.co/functions/v1/create-checkout-session \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "plan_type":           "custom",
    "email":               "courtney.sutherland@gmail.com",
    "legacy_amount_cents": 14000,
    "legacy_currency":     "aud"
  }'
```

Returns `{ url, session_id, mode: 'migrate' }`. Send the URL to the customer in the migration email — clicking it takes them straight to a Stripe Checkout pre-filled with their email and exact monthly rate.

The function looks up or creates the customer's Supabase auth user automatically (no magic-link step needed — the link itself is the auth).

## Environment variables

| Var                          | Used for                                  |
|------------------------------|-------------------------------------------|
| `STRIPE_SECRET_KEY`          | Creating Checkout Sessions                |
| `SUPABASE_URL`               | Both self + migrate                       |
| `SUPABASE_ANON_KEY`          | Verifying user JWT in self mode           |
| `SUPABASE_SERVICE_ROLE_KEY`  | User lookup/create in migrate mode        |
| `APP_BASE_URL`               | Default success/cancel URL bases          |

## Deploy

```bash
supabase functions deploy create-checkout-session
```

JWT verification is left ON for this function — self mode requires a valid user JWT. Migrate mode bypasses this by sending the service-role key in the bearer header (the function explicitly checks for service-role-key equality and switches modes).

## Local testing

```bash
supabase functions serve create-checkout-session --env-file ./supabase/.env.local

# Self mode (need a real user JWT — get one from `supabase auth login` or
# from the browser after a magic-link sign-in)
curl http://localhost:54321/functions/v1/create-checkout-session \
  -H "Authorization: Bearer $USER_JWT" \
  -H "Content-Type: application/json" \
  -d '{ "plan_type": "progressive", "plan_key": "prone" }'

# Migrate mode (use the local service-role key from supabase/.env.local)
curl http://localhost:54321/functions/v1/create-checkout-session \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "plan_type": "custom",
    "email": "test@example.com",
    "legacy_amount_cents": 14000,
    "legacy_currency": "aud"
  }'
```

The response contains a `url` you can open in a browser to test the full flow end-to-end. Stripe test card: `4242 4242 4242 4242`, any future expiry, any CVC.
