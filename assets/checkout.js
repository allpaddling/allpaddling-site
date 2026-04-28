/* ============================================================
   checkout.js — public-page Subscribe button handler.
   Loaded on plans pages so that clicking "Subscribe & Start"
   triggers a real Stripe Checkout flow instead of an alert.

   Two paths:

   1. User signed in → call create-checkout-session (SELF mode),
      redirect to the returned Stripe Checkout URL. One click.

   2. User not signed in → open a small inline modal that asks
      for an email, then call create-checkout-session (ANON mode),
      redirect straight to Stripe. Auth user is created server-side
      and the magiclink success_url signs them in post-payment, so
      they land on welcome.html already authenticated. Two clicks
      + one email field, no separate magic-link round-trip.

   The old bounce-to-login flow lived here previously and required
   the user to magic-link in, then come back and click Subscribe a
   second time. Replaced 2026-04-29 (Jake) per direct feedback that
   the friction was killing the public funnel.

   Loaded AFTER assets/supabase-config.js, so `sb` is in scope.
   ============================================================ */

(function () {
  const SUPABASE_URL = 'https://crlukzkgmydyqpwndjvc.supabase.co';
  const FUNCTION_URL = SUPABASE_URL + '/functions/v1/create-checkout-session';

  // ============================================================
  // Inline email-capture modal (built lazily on first use).
  // ============================================================
  function buildModal () {
    const overlay = document.createElement('div');
    overlay.id = 'checkout-anon-modal';
    overlay.style.cssText =
      'position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); ' +
      'display: flex; align-items: center; justify-content: center; ' +
      'z-index: 9999; padding: 1rem;';

    const card = document.createElement('div');
    card.style.cssText =
      'background: #fff; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.25); ' +
      'max-width: 440px; width: 100%; padding: 2rem 2rem 1.75rem; ' +
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;';

    card.innerHTML = `
      <h3 style="font-family: 'Space Grotesk', sans-serif; font-size: 1.4rem; margin: 0 0 0.4rem; color: #0f172a;">
        Almost there.
      </h3>
      <p style="margin: 0 0 1.4rem; color: #475569; font-size: 0.95rem; line-height: 1.5;">
        Enter your email to head to secure Stripe checkout. We'll set up your account automatically.
      </p>
      <form id="checkout-anon-form" novalidate>
        <label style="display: block; font-size: 0.82rem; font-weight: 600; color: #0f172a; margin-bottom: 0.4rem;" for="checkout-anon-email">
          Email address
        </label>
        <input
          type="email"
          id="checkout-anon-email"
          required
          autocomplete="email"
          placeholder="you@example.com"
          style="width: 100%; box-sizing: border-box; padding: 0.7rem 0.85rem; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.98rem; font-family: inherit; outline: none;"
        />
        <div id="checkout-anon-error" style="color: #b91c1c; font-size: 0.85rem; margin-top: 0.5rem; min-height: 1.1em;"></div>
        <div style="display: flex; gap: 0.5rem; margin-top: 1.25rem;">
          <button
            type="button"
            id="checkout-anon-cancel"
            style="flex: 0 0 auto; padding: 0.7rem 1.1rem; border: 1px solid #cbd5e1; background: #fff; color: #475569; border-radius: 8px; font-weight: 500; cursor: pointer; font-family: inherit;"
          >Cancel</button>
          <button
            type="submit"
            id="checkout-anon-submit"
            style="flex: 1; padding: 0.7rem 1.1rem; border: 0; background: #155e75; color: #fff; border-radius: 8px; font-weight: 600; cursor: pointer; font-family: inherit; font-size: 0.95rem;"
          >Continue to checkout →</button>
        </div>
        <p style="margin: 1rem 0 0; font-size: 0.78rem; color: #94a3b8; line-height: 1.5;">
          By continuing you agree to our terms. You'll be signed into your account automatically after payment.
        </p>
      </form>
    `;

    overlay.appendChild(card);

    // Close on overlay click (but not card click) or Escape.
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    document.addEventListener('keydown', escHandler);

    return overlay;
  }

  function escHandler (e) {
    if (e.key === 'Escape') closeModal();
  }

  function closeModal () {
    const m = document.getElementById('checkout-anon-modal');
    if (m) m.remove();
    document.removeEventListener('keydown', escHandler);
  }

  function openAnonModal (planType, planKey, originalBtn) {
    // Don't double-open.
    if (document.getElementById('checkout-anon-modal')) return;
    const overlay = buildModal();
    document.body.appendChild(overlay);

    const emailInput = overlay.querySelector('#checkout-anon-email');
    const errorDiv   = overlay.querySelector('#checkout-anon-error');
    const submitBtn  = overlay.querySelector('#checkout-anon-submit');
    const cancelBtn  = overlay.querySelector('#checkout-anon-cancel');
    const form       = overlay.querySelector('#checkout-anon-form');

    // Focus the email field for instant typing.
    setTimeout(() => emailInput.focus(), 30);

    cancelBtn.addEventListener('click', () => {
      closeModal();
      restoreButton(originalBtn);
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = (emailInput.value || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errorDiv.textContent = 'Please enter a valid email address.';
        emailInput.focus();
        return;
      }
      errorDiv.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Loading checkout…';

      try {
        const res = await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan_type: planType,
            plan_key:  planKey || undefined,
            email:     email,
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.url) {
          throw new Error(payload.detail || payload.error || `${res.status} ${res.statusText}`);
        }
        // Redirect to Stripe-hosted Checkout.
        window.location.href = payload.url;
      } catch (err) {
        console.error('anon checkout — failed', err);
        errorDiv.textContent = "Couldn't start checkout: " + (err.message || 'unknown error') + '. Email mick@allpaddling.online if this keeps happening.';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Continue to checkout →';
      }
    });
  }

  function restoreButton (btn) {
    if (btn && btn.dataset.originalLabel) {
      btn.disabled = false;
      btn.style.opacity = '';
      btn.style.cursor = '';
      btn.innerHTML = btn.dataset.originalLabel;
      delete btn.dataset.originalLabel;
    }
  }

  // ============================================================
  // Subscribe handler — the public-facing entry point.
  // ============================================================
  async function startCheckout (planType, planKey, btn) {
    if (planType !== 'progressive' && planType !== 'custom') {
      alert('Invalid plan. Please refresh and try again.');
      return;
    }
    if (typeof sb === 'undefined' || !sb) {
      alert('Page is still loading — please try again in a moment.');
      return;
    }

    // Disable the clicked button + show a loading state. We restore
    // it if anon-modal is cancelled or an error occurs.
    if (btn) {
      btn.dataset.originalLabel = btn.innerHTML;
      btn.disabled = true;
      btn.style.opacity = '0.7';
      btn.style.cursor = 'wait';
      btn.innerHTML = 'Loading…';
    }

    // Check for an existing session.
    let session = null;
    try {
      const r = await sb.auth.getSession();
      session = r && r.data && r.data.session;
    } catch (e) { /* fall through to anon path */ }

    if (session && session.access_token) {
      // ---- SELF mode: signed-in user. One-click checkout. ----
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
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.url) {
          throw new Error(payload.detail || payload.error || `${res.status} ${res.statusText}`);
        }
        window.location.href = payload.url;
      } catch (err) {
        console.error('self checkout — failed', err);
        restoreButton(btn);
        alert("Couldn't start checkout: " + err.message + "\n\nIf this keeps happening, email mick@allpaddling.online and we'll sort it.");
      }
      return;
    }

    // ---- ANON mode: not signed in. Open inline email modal. ----
    openAnonModal(planType, planKey, btn);
    // Note: button is restored if user cancels the modal; we leave it
    // disabled while modal is open so the user can't double-click.
  }

  window.startCheckout = startCheckout;
})();
