/* ============================================================
   checkout.js — public-page Subscribe button handler.
   Loaded on plans pages so that clicking "Subscribe & Start"
   triggers a real Stripe Checkout flow instead of an alert.

   Two paths:
   1. User signed in → call create-checkout-session, redirect to
      the returned Stripe Checkout URL.
   2. User not signed in → bounce to login.html with a `next=`
      param that brings them back to the same plan page after
      they've magic-linked in. They click Subscribe again from
      there (one extra click is the trade-off for not having to
      collect their email in two different forms).

   Loaded AFTER assets/supabase-config.js, so `sb` is in scope.
   ============================================================ */

(function () {
  const SUPABASE_URL = 'https://crlukzkgmydyqpwndjvc.supabase.co';
  const FUNCTION_URL = SUPABASE_URL + '/functions/v1/create-checkout-session';

  async function startCheckout (planType, planKey, btn) {
    if (planType !== 'progressive' && planType !== 'custom') {
      alert('Invalid plan. Please refresh and try again.');
      return;
    }
    if (typeof sb === 'undefined' || !sb) {
      alert('Sign-in is still loading — please try again in a moment.');
      return;
    }

    // Auth gate.
    let session = null;
    try {
      const r = await sb.auth.getSession();
      session = r && r.data && r.data.session;
    } catch (e) { /* fall through to redirect */ }

    if (!session || !session.access_token) {
      // Not signed in. Bounce to login with a return path so we
      // can come back here after sign-in.
      const next = window.location.pathname + window.location.search;
      const loginUrl = 'login.html?next=' + encodeURIComponent(next);
      // Some plan pages live one level deeper (e.g. /app/...) — for
      // the public marketing pages, login.html is a sibling.
      window.location.href = loginUrl;
      return;
    }

    // Disable the clicked button + show a loading state.
    let originalLabel = null;
    if (btn) {
      originalLabel = btn.innerHTML;
      btn.disabled = true;
      btn.style.opacity = '0.7';
      btn.style.cursor = 'wait';
      btn.innerHTML = 'Loading checkout…';
    }

    try {
      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({
          plan_type: planType,
          plan_key:  planKey || undefined,
        }),
      });
      const payload = await res.json().catch(function () { return {}; });
      if (!res.ok || !payload.url) {
        throw new Error(payload.detail || payload.error || (res.status + ' ' + res.statusText));
      }
      // Redirect to Stripe-hosted Checkout.
      window.location.href = payload.url;
    } catch (err) {
      console.error('startCheckout — failed', err);
      if (btn && originalLabel !== null) {
        btn.disabled = false;
        btn.style.opacity = '';
        btn.style.cursor = '';
        btn.innerHTML = originalLabel;
      }
      alert("Couldn't start checkout: " + err.message + "\n\nIf this keeps happening, email mick@allpaddling.online and we'll sort it.");
    }
  }

  window.startCheckout = startCheckout;
})();
