/* ============================================================
   admin-migrate.js — Customer migration roster + signup-link
   generator. Used by admin-migrate.html.

   Reads from `public.migration_customers` (RLS: coach-only). For
   each customer, the coach can click "Generate link" to call the
   `create-checkout-session` Edge Function in MIGRATE mode (using
   the coach's own JWT — the function checks is_coach() before
   allowing it). The returned Stripe Checkout URL is shown
   alongside a pre-formatted email body the coach can paste into
   their inbox.

   After successfully generating a link the row's
   migration_status is updated to 'signup_link_sent' (with a
   confirmation step) so the funnel state is preserved.

   Loads AFTER admin.js — relies on `sb`, `getCurrentSession`,
   `isCurrentUserCoach`, etc.
   ============================================================ */

(function () {
  'use strict';

  // ---------- Constants ----------
  const SUPABASE_URL          = 'https://crlukzkgmydyqpwndjvc.supabase.co';
  const FUNCTION_URL          = `${SUPABASE_URL}/functions/v1/create-checkout-session`;
  const SEND_EMAIL_URL        = `${SUPABASE_URL}/functions/v1/send-email`;

  // Email kinds the coach can trigger from this page. The order
  // here matches the chronological migration cadence; the `defaultFor`
  // map drives the dropdown's auto-selection based on status.
  const EMAIL_KINDS = [
    { id: 'heads_up_t7',     label: 'T-7 — Heads-up',           needsLink: false, statusAfterSend: 'heads_up_sent' },
    { id: 'signup_link_t3',  label: 'T-3 — Signup link',        needsLink: true,  statusAfterSend: 'signup_link_sent' },
    { id: 'renewal_day_t0',  label: 'T-0 — Renewal-day reminder', needsLink: true,  statusAfterSend: null }, // status unchanged — same day
    { id: 'followup_tplus3', label: 'T+3 — Followup',           needsLink: true,  statusAfterSend: null },
    { id: 'lapse_tplus14',   label: 'T+14 — Lapse notice',       needsLink: true,  statusAfterSend: 'lapsed' },
  ];

  // For a given current migration_status, the email kind we default to.
  const DEFAULT_KIND_BY_STATUS = {
    pending:           'heads_up_t7',
    heads_up_sent:     'signup_link_t3',
    signup_link_sent:  'renewal_day_t0',
    signed_up:         null,           // they signed up — no migration emails
    shopify_cancelled: null,           // already done
    migrated:          null,
    lapsed:            null,
    on_hold:           null,
  };

  const PLAN_LABELS = {
    progressive: { prone: 'Progressive — Prone', sup: 'Progressive — SUP', oc: 'Progressive — OC', ski: 'Progressive — Ski' },
    custom:      'Custom Season Race Plan',
  };

  // Funnel buckets — used by the filter tabs.
  // 'in_progress' = coach has touched them but they haven't fully migrated yet.
  const STATUS_BUCKETS = {
    pending:     ['pending'],
    in_progress: ['heads_up_sent', 'signup_link_sent', 'signed_up', 'shopify_cancelled'],
    migrated:    ['migrated'],
    lapsed:      ['lapsed', 'on_hold'],
  };

  const STATUS_LABELS = {
    pending:           'Pending',
    heads_up_sent:     'Heads-up sent',
    signup_link_sent:  'Link sent',
    signed_up:         'Signed up',
    shopify_cancelled: 'Shopify cancelled',
    migrated:          'Migrated',
    lapsed:            'Lapsed',
    on_hold:           'On hold',
  };

  // ---------- State ----------
  let allCustomers   = [];      // full list from Supabase
  let activeFilter   = 'all';
  let searchTerm     = '';
  let lastGenerated  = null;    // { customer, url, sessionId }

  // ---------- DOM refs (resolved on init) ----------
  const $ = (id) => document.getElementById(id);

  // ============================================================
  // Init
  // ============================================================
  async function init () {
    await loadCustomers();
    bindEvents();
    render();
  }

  async function loadCustomers () {
    const tbody = $('customersBody');
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" id="loadingState">Loading customers…</td></tr>`;

    const { data, error } = await sb
      .from('migration_customers')
      .select('id, legacy_id, email, name, country_code, plan_type, plan_key, amount_cents, currency, next_renewal, migration_status, status_updated_at, notes')
      .order('next_renewal', { ascending: true, nullsFirst: false });

    if (error) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Failed to load: ${escape(error.message)}</td></tr>`;
      console.error('migration_customers load failed', error);
      return;
    }

    allCustomers = data || [];
    if (allCustomers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">
        No customers loaded yet. Run <code>migration/seed-migration-customers.sql</code> in Supabase Studio.
      </td></tr>`;
    }
  }

  // ============================================================
  // Rendering
  // ============================================================
  function render () {
    renderStats();
    renderTabCounts();
    renderTable();
  }

  function renderStats () {
    const total      = allCustomers.length;
    const byBucket   = bucketCounts();

    $('statTotal').textContent      = total;
    $('statPending').textContent    = byBucket.pending;
    $('statInProgress').textContent = byBucket.in_progress;
    $('statMigrated').textContent   = byBucket.migrated;
  }

  function renderTabCounts () {
    const byBucket = bucketCounts();
    $('cntAll').textContent        = allCustomers.length;
    $('cntPending').textContent    = byBucket.pending;
    $('cntInProgress').textContent = byBucket.in_progress;
    $('cntMigrated').textContent   = byBucket.migrated;
    $('cntLapsed').textContent     = byBucket.lapsed;
  }

  function bucketCounts () {
    const out = { pending: 0, in_progress: 0, migrated: 0, lapsed: 0 };
    allCustomers.forEach(c => {
      for (const [bucket, statuses] of Object.entries(STATUS_BUCKETS)) {
        if (statuses.includes(c.migration_status)) {
          out[bucket]++;
          return;
        }
      }
    });
    return out;
  }

  function renderTable () {
    const tbody = $('customersBody');
    const filtered = filterCustomers();

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No customers match those filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(rowHtml).join('');

    // Wire up the per-row buttons
    tbody.querySelectorAll('button[data-action="generate"]').forEach(btn => {
      btn.addEventListener('click', () => onGenerateClick(btn));
    });
    tbody.querySelectorAll('button[data-action="cycle-status"]').forEach(btn => {
      btn.addEventListener('click', () => onCycleStatusClick(btn));
    });
    tbody.querySelectorAll('button[data-action="send-email"]').forEach(btn => {
      btn.addEventListener('click', () => onSendEmailClick(btn));
    });
  }

  function rowHtml (c) {
    const planLabel = c.plan_type === 'progressive'
      ? (PLAN_LABELS.progressive[c.plan_key] || `Progressive — ${c.plan_key}`)
      : PLAN_LABELS.custom;

    const price = formatMoney(c.amount_cents, c.currency);
    const renewal = renewalCellHtml(c.next_renewal);
    const statusLabel = STATUS_LABELS[c.migration_status] || c.migration_status;
    const isFinalState = c.migration_status === 'migrated' || c.migration_status === 'lapsed';

    return `
      <tr data-customer-id="${escape(c.id)}">
        <td>
          <div class="customer-cell">
            <div class="name">${escape(c.name)}</div>
            <div class="email">${escape(c.email)}${c.country_code ? ' · ' + escape(c.country_code) : ''}</div>
          </div>
        </td>
        <td>${escape(planLabel)}</td>
        <td class="price-cell">${escape(price)}</td>
        <td class="renewal-cell">${renewal}</td>
        <td>
          <span class="status-pill ${escape(c.migration_status)}">${escape(statusLabel)}</span>
        </td>
        <td class="actions-cell">
          <div class="actions-stack">
            <div class="send-row">
              <select class="email-kind-select" data-action="email-kind-select" ${isFinalState ? 'disabled' : ''}>
                ${EMAIL_KINDS.map(k => `<option value="${escape(k.id)}" ${k.id === (DEFAULT_KIND_BY_STATUS[c.migration_status] || EMAIL_KINDS[0].id) ? 'selected' : ''}>${escape(k.label)}</option>`).join('')}
              </select>
              <button type="button" class="btn-mini btn-mini-primary" data-action="send-email" ${isFinalState ? 'disabled' : ''}>Send via Resend</button>
            </div>
            <div class="action-row">
              <button type="button" class="btn-mini btn-mini-secondary" data-action="generate" ${isFinalState ? 'disabled' : ''}>Preview / Generate link</button>
              <button type="button" class="btn-mini btn-mini-secondary" data-action="cycle-status" title="Click to cycle status">Update status</button>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  function renewalCellHtml (iso) {
    if (!iso) return '<span style="color: var(--text-3)">—</span>';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '<span style="color: var(--text-3)">—</span>';
    const dayDiff = Math.round((d - new Date()) / (1000 * 60 * 60 * 24));
    const dateStr = d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    if (dayDiff < 0)        return `<span class="urgent">${escape(dateStr)} (overdue)</span>`;
    if (dayDiff <= 3)       return `<span class="urgent">${escape(dateStr)} (in ${dayDiff}d)</span>`;
    if (dayDiff <= 14)      return `${escape(dateStr)} (in ${dayDiff}d)`;
    return escape(dateStr);
  }

  function filterCustomers () {
    let list = allCustomers.slice();

    if (activeFilter !== 'all') {
      const allowed = STATUS_BUCKETS[activeFilter] || [];
      list = list.filter(c => allowed.includes(c.migration_status));
    }

    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      list = list.filter(c => (c.name || '').toLowerCase().includes(t) || (c.email || '').toLowerCase().includes(t));
    }

    return list;
  }

  // ============================================================
  // Event wiring
  // ============================================================
  function bindEvents () {
    document.querySelectorAll('#filterTabs .filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#filterTabs .filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeFilter = tab.dataset.filter;
        renderTable();
      });
    });

    let timer = null;
    $('searchInput').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        searchTerm = e.target.value.trim();
        renderTable();
      }, 80);
    });

    // Result panel buttons
    $('copyLinkBtn').addEventListener('click', () => copyToClipboard($('linkInput').value, $('copyLinkBtn')));
    $('copyEmailBtn').addEventListener('click', () => copyToClipboard($('emailBody').textContent, $('copyEmailBtn')));
    $('markSentBtn').addEventListener('click', onMarkSentClick);
  }

  // ============================================================
  // Actions
  // ============================================================
  async function onGenerateClick (btn) {
    const row = btn.closest('tr');
    const customerId = row?.dataset.customerId;
    const customer = allCustomers.find(c => c.id === customerId);
    if (!customer) return;

    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.textContent = 'Generating…';

    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session?.access_token) throw new Error('No active session — sign in again.');

      const res = await fetch(FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          plan_type:           customer.plan_type,
          plan_key:            customer.plan_key || undefined,
          email:               customer.email,
          legacy_amount_cents: customer.amount_cents,
          legacy_currency:     customer.currency,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.detail || payload.error || `${res.status} ${res.statusText}`);
      }

      lastGenerated = { customer, url: payload.url, sessionId: payload.session_id };
      showResult(customer, payload.url);
    } catch (err) {
      console.error('generate failed', err);
      alert(`Couldn't generate link: ${err.message}\n\nIf the error mentions Stripe price or product, run setup-stripe-products.ts first. If it mentions auth, sign out + back in.`);
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      btn.textContent = 'Generate link';
    }
  }

  async function onCycleStatusClick (btn) {
    const row = btn.closest('tr');
    const customer = allCustomers.find(c => c.id === row?.dataset.customerId);
    if (!customer) return;

    // Cycle through the funnel: pending → heads_up_sent → signup_link_sent →
    // signed_up → shopify_cancelled → migrated → lapsed → pending.
    const cycle = [
      'pending', 'heads_up_sent', 'signup_link_sent', 'signed_up',
      'shopify_cancelled', 'migrated', 'lapsed', 'on_hold',
    ];
    const currentIdx = cycle.indexOf(customer.migration_status);
    const nextStatus = cycle[(currentIdx + 1) % cycle.length];

    if (!confirm(`Set ${customer.name}: "${STATUS_LABELS[customer.migration_status]}" → "${STATUS_LABELS[nextStatus]}"?`)) {
      return;
    }

    await updateStatus(customer.id, nextStatus);
  }

  async function onMarkSentClick () {
    if (!lastGenerated) return;
    const { customer } = lastGenerated;
    if (!confirm(`Mark ${customer.name} as "Link sent"? (Use this after you've actually emailed them.)`)) {
      return;
    }
    await updateStatus(customer.id, 'signup_link_sent');
    const alertEl = $('resultAlert');
    alertEl.className = 'alert-inline info';
    alertEl.textContent = '✓ Status updated.';
  }

  async function updateStatus (customerId, newStatus) {
    const { error } = await sb
      .from('migration_customers')
      .update({ migration_status: newStatus })
      .eq('id', customerId);
    if (error) {
      alert(`Couldn't update status: ${error.message}`);
      return;
    }
    // Update local state and re-render
    const c = allCustomers.find(x => x.id === customerId);
    if (c) {
      c.migration_status = newStatus;
      c.status_updated_at = new Date().toISOString();
    }
    render();
  }

  function showResult (customer, url) {
    const panel = $('resultPanel');
    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    $('resultCustomer').textContent = `for ${customer.name}`;
    $('resultDetail').textContent = `${formatMoney(customer.amount_cents, customer.currency)} every 4 weeks. Send the link to ${customer.email}.`;

    $('linkInput').value = url;

    $('emailBody').textContent = renderMigrationEmail(customer, url);

    $('resultAlert').textContent = '';
    $('resultAlert').className = '';
  }

  // ============================================================
  // Send via Resend (the new path — calls send-email function in
  // raw mode with the rendered email body. EMAIL_BCC env var on the
  // server side adds Mick + Jake to the BCC list automatically.)
  // ============================================================
  async function onSendEmailClick (btn) {
    const row = btn.closest('tr');
    const customerId = row?.dataset.customerId;
    const customer = allCustomers.find(c => c.id === customerId);
    if (!customer) return;

    // Read selected email kind from the row's <select>.
    const selectEl = row.querySelector('select[data-action="email-kind-select"]');
    const kindId = selectEl?.value;
    const kind = EMAIL_KINDS.find(k => k.id === kindId);
    if (!kind) {
      alert('Internal error: no email kind selected.');
      return;
    }

    if (!confirm(`Send the "${kind.label}" email to ${customer.name} (${customer.email}) right now?\n\nThis will fire from mick@allpaddling.online and BCC you + Mick.`)) {
      return;
    }

    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.textContent = 'Sending…';

    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session?.access_token) throw new Error('No active session — sign in again.');

      // For email kinds that need a signup link, generate one fresh
      // right now (so it's not stale).
      let url = null;
      if (kind.needsLink) {
        url = await generateCheckoutUrl(customer, session.access_token);
      }

      const composed = composeEmailForKind(kind.id, customer, url);
      if (!composed) throw new Error(`Internal: no renderer for kind "${kind.id}"`);

      const sendRes = await fetch(SEND_EMAIL_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          mode:     'raw',
          to:       customer.email,
          subject:  composed.subject,
          text:     composed.text,
          html:     composed.html,
          tags: [
            { name: 'kind',         value: kind.id },
            { name: 'migrate_id',   value: customer.id },
          ],
        }),
      });
      const payload = await sendRes.json().catch(() => ({}));
      if (!sendRes.ok) {
        throw new Error(payload.error || `${sendRes.status} ${sendRes.statusText}`);
      }

      // Update local status if this email kind has a follow-on state.
      if (kind.statusAfterSend && kind.statusAfterSend !== customer.migration_status) {
        await updateStatus(customer.id, kind.statusAfterSend);
      } else {
        // No status change — just log a status_updated_at touch so the
        // table reflects something happened. (Skip — too noisy. Just re-render.)
        render();
      }

      flashSuccess(btn, `Sent to ${customer.email}`);
    } catch (err) {
      console.error('send email failed', err);
      alert(`Couldn't send email: ${err.message}\n\nIf the error mentions auth, sign out + back in. If it mentions Resend, check the function logs in Supabase Studio.`);
      btn.textContent = originalLabel;
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-loading');
    }
  }

  async function generateCheckoutUrl (customer, accessToken) {
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        plan_type:           customer.plan_type,
        plan_key:            customer.plan_key || undefined,
        email:               customer.email,
        legacy_amount_cents: customer.amount_cents,
        legacy_currency:     customer.currency,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(payload.detail || payload.error || `create-checkout-session ${res.status}`);
    }
    return payload.url;
  }

  function flashSuccess (btn, msg) {
    const original = btn.textContent;
    btn.textContent = '✓ ' + msg;
    btn.classList.add('flash-success');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('flash-success');
    }, 2400);
  }

  function composeEmailForKind (kindId, customer, url) {
    const ctx = emailContext(customer, url);
    switch (kindId) {
      case 'heads_up_t7':     return renderEmailHeadsUpT7(ctx);
      case 'signup_link_t3':  return renderEmailSignupLinkT3(ctx);
      case 'renewal_day_t0':  return renderEmailRenewalDayT0(ctx);
      case 'followup_tplus3': return renderEmailFollowupTplus3(ctx);
      case 'lapse_tplus14':   return renderEmailLapseTplus14(ctx);
      default:                return null;
    }
  }

  function emailContext (customer, url) {
    const firstName = (customer.name || customer.email).split(' ')[0];
    const planLabel = customer.plan_type === 'progressive'
      ? (PLAN_LABELS.progressive[customer.plan_key] || `Progressive — ${customer.plan_key}`)
      : PLAN_LABELS.custom;
    const monthly = formatMoney(customer.amount_cents, customer.currency);
    const renewalDate = customer.next_renewal
      ? new Date(customer.next_renewal).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'next renewal';
    return { firstName, planLabel, monthly, renewalDate, signupLink: url || '' };
  }

  function wrapHtml (text) {
    // Convert plain-text body to a simple HTML wrapper (preserves
    // newlines, links the URLs).
    const escaped = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const linked = escaped.replace(
      /(https?:\/\/[^\s)]+)/g,
      '<a href="$1" style="color:#155e75;">$1</a>',
    );
    return `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0f172a;white-space:pre-wrap;">${linked}</div>`;
  }

  // The 5 email renderers. Each returns { subject, text, html }.
  // Bodies are kept in sync with migration/emails/*.md.
  function renderEmailHeadsUpT7 ({ firstName, planLabel, monthly, renewalDate }) {
    const text = `Hi ${firstName},

Quick note from me — over the next couple of weeks I'm moving All Paddling onto a new platform. Same coaching, same plans, just a much better home for it all (faster, cleaner, no more clunky Shopify portal).

Here's what this means for you:

- Your ${planLabel} continues without interruption.
- Billing on the new platform: ${monthly} every 4 weeks.
- Your next renewal is ${renewalDate}.
- You don't need to do anything today — I'll send you a one-click link in a few days to move you across.

The only small ask when the time comes will be re-entering your card. The new system runs on Stripe (way more secure than what we had), and unfortunately the old Shopify card details don't transfer across — that's the one bit of friction I can't engineer away.

If you've got any questions in the meantime, just hit reply.

Thanks for being on this journey with me.

Mick
`;
    return {
      subject: `Quick heads-up: we're moving the All Paddling site`,
      text,
      html: wrapHtml(text),
    };
  }

  function renderEmailSignupLinkT3 ({ firstName, planLabel, monthly, renewalDate, signupLink }) {
    const text = `Hi ${firstName},

Here's your link to move across to the new All Paddling site:

👉 ${signupLink}

It takes about 60 seconds. Your plan and price are already filled in for you — all you need to do is enter your card details.

What's set up for you:

- Plan: ${planLabel}
- Price: ${monthly} every 4 weeks
- First charge on Stripe: ${renewalDate}
- Your old Shopify subscription: I'll cancel it before it bills, so you'll never be double-charged.

Once you sign up, you'll get instant access to the new member dashboard — your training plan, threshold pace tracking, and a much cleaner program view.

If anything looks off when you click through (price, plan name, anything), reply to this email and I'll fix it before you sign up.

See you on the other side,

Mick
`;
    return {
      subject: `Action needed: your one-click link to move to the new All Paddling`,
      text,
      html: wrapHtml(text),
    };
  }

  function renderEmailRenewalDayT0 ({ firstName, monthly, signupLink }) {
    const text = `Hi ${firstName},

Just a quick one — today is your usual All Paddling renewal day, and your Shopify subscription will bill as normal in the next few hours.

If you haven't moved across to the new site yet, your link is here:

👉 ${signupLink}

A few options for what happens today:

- Best path: click the link, sign up on Stripe in 60 seconds. I'll cancel the Shopify sub before it bills, and you start fresh on the new platform tomorrow.
- Fine path: Shopify bills you today as usual, you keep coaching for another month, and we move you across before the next renewal.
- No-rush path: if you want to take a break or have a question, just reply.

No pressure — your training keeps going either way. But the new site is much better and I'd love to have you on it.

Mick
`;
    return {
      subject: `Today's your renewal day — quick action needed`,
      text,
      html: wrapHtml(text),
    };
  }

  function renderEmailFollowupTplus3 ({ firstName, signupLink }) {
    const text = `Hey ${firstName},

Just checking in — I sent you the link to move to the new All Paddling site about a week ago and I haven't heard back. No drama, just want to make sure nothing's gone wrong on your end.

Possible explanations and how I can help with each:

- The email got lost. Here's the link again: ${signupLink}
- You're trying to take a break from training. No problem at all — reply and let me know, I'll pause the move so you don't get more reminders.
- Something's not working when you click through. Reply with what you see and I'll sort it.
- You've decided to stop coaching with me. That's OK too — just a quick reply so I know to close things off cleanly. No hard feelings.

Whatever it is, just hit reply. Two-line response is plenty.

Mick
`;
    return {
      subject: `Everything OK?`,
      text,
      html: wrapHtml(text),
    };
  }

  function renderEmailLapseTplus14 ({ firstName, signupLink }) {
    const text = `Hi ${firstName},

I haven't heard from you about moving to the new All Paddling site, so I've gone ahead and cancelled your Shopify subscription today. That means:

- No more charges to your card from the old system.
- Your training history is safe — I keep a record of everything you've done with me.
- The door is open if you want to come back. Whenever you're ready, your one-click link still works: ${signupLink}

If this was a mistake or you'd like to chat about it, just reply. I'm easy to find.

Wishing you well on the water either way.

Mick
`;
    return {
      subject: `Your All Paddling subscription has been paused`,
      text,
      html: wrapHtml(text),
    };
  }

  // ============================================================
  // Email body composition (mirrors migration/emails/02_signup-link_T-3.md)
  // — kept for the existing "Generate link / preview" flow.
  // ============================================================
  function renderMigrationEmail (customer, url) {
    const firstName = (customer.name || customer.email).split(' ')[0];
    const planLabel = customer.plan_type === 'progressive'
      ? (PLAN_LABELS.progressive[customer.plan_key] || `Progressive — ${customer.plan_key}`)
      : PLAN_LABELS.custom;
    const monthly = formatMoney(customer.amount_cents, customer.currency);
    const renewalDate = customer.next_renewal
      ? new Date(customer.next_renewal).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
      : '[next renewal date]';

    return `Subject: Action needed: your one-click link to move to the new All Paddling

Hi ${firstName},

Here's your link to move across to the new All Paddling site:

👉 ${url}

It takes about 60 seconds. Your plan and price are already filled in for you — all you need to do is enter your card details.

What's set up for you:

- Plan: ${planLabel}
- Price: ${monthly} every 4 weeks
- First charge on Stripe: ${renewalDate}
- Your old Shopify subscription: I'll cancel it before it bills, so you'll never be double-charged.

Once you sign up, you'll get instant access to the new member dashboard — your training plan, threshold pace tracking, and a much cleaner program view.

If anything looks off when you click through (price, plan name, anything), reply to this email and I'll fix it before you sign up.

See you on the other side,

Mick
`;
  }

  // ============================================================
  // Helpers
  // ============================================================
  function formatMoney (cents, currency) {
    const amount = (cents / 100).toFixed(2);
    return `${amount} ${(currency || '').toUpperCase()}`;
  }

  function escape (s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function copyToClipboard (text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      const original = btn.textContent;
      btn.classList.add('copied');
      btn.textContent = 'Copied ✓';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.textContent = original;
      }, 1400);
    }).catch(err => {
      console.error('clipboard failed', err);
      alert('Copy failed — long-press / select-all the field instead.');
    });
  }

  // ---------- Expose ----------
  window.MigratePage = { init };
})();
