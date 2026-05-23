/* ============================================================
   admin-outreach.js — Customer outreach roster + template-driven
   campaign send. Used by admin-outreach.html.

   Reads from `public.shopify_customers` and `newsletter_subscribers`
   (RLS: coach-only). For each customer, computes a segment
   client-side (based on recency + product mix), cross-references
   against `progressive_members` + `custom_members` to mark
   "already on AllPaddling" rows, and renders a filterable table.

   Sending uses pre-built templates from outreach-templates.js
   (`OUTREACH_TEMPLATES`). Two paths:
     - per-row Quick send: click Send next to one customer
     - bulk Send to selected: tick multiple rows, pick a template
       from the selection bar, hit Send → fires sequentially
   Both paths call the send-email Edge Function (raw mode, coach
   JWT) once per recipient and log each to `outreach_sends`.

   Loads AFTER admin.js + outreach-templates.js — relies on `sb`,
   `getCurrentSession`, `isCurrentUserCoach`, and the global
   `OUTREACH_TEMPLATES`.
   ============================================================ */

(function () {
  'use strict';

  // ---------- Constants ----------
  const SUPABASE_URL    = 'https://crlukzkgmydyqpwndjvc.supabase.co';
  const SEND_EMAIL_URL  = `${SUPABASE_URL}/functions/v1/send-email`;

  // Unsubscribe footer appended to every outgoing campaign body.
  // TODO: replace with a real /unsubscribe?token=... link when we
  // wire up a public unsubscribe edge function. For now, the mailto
  // is a safe fallback that lets the recipient escape, and Mick can
  // mark them unsubscribed_at manually from the row drawer.
  const UNSUB_FOOTER_TEXT = (
    '\n\n—\n' +
    'You\'re receiving this because you were a customer of All Paddling. ' +
    'To stop receiving these emails, reply with "unsubscribe" or email ' +
    'mick@allpaddling.online with the subject "unsubscribe".'
  );
  const UNSUB_FOOTER_HTML = (
    '<hr style="margin-top:24px;border:0;border-top:1px solid #ddd"/>' +
    '<p style="font-size:12px;color:#888;margin-top:12px;line-height:1.5">' +
    'You\'re receiving this because you were a customer of All Paddling. ' +
    'To stop receiving these emails, reply with "unsubscribe" or email ' +
    '<a href="mailto:mick@allpaddling.online?subject=unsubscribe" style="color:#888">' +
    'mick@allpaddling.online</a> with the subject "unsubscribe".' +
    '</p>'
  );

  const SEGMENT_LABELS = {
    custom_warm_lapsed:        'Custom — warm',
    custom_recent_lapsed:      'Custom — warm',  // collapsed for display
    custom_cold_lapsed:        'Custom — cold',
    progressive_lapsed:        'Progressive — recent',
    progressive_cold_lapsed:   'Progressive — cold',
    newsletter_no_purchase:    'Newsletter only',     // legacy Shopify newsletter tag, never bought
    newsletter_signup:         'Newsletter signup',   // explicit opt-in via the public footer form
    no_purchase_other:         'No purchase',
    other:                     'Other',
    unknown_recency:           'Unknown',
  };

  // Migration_customers statuses that mean "still in our funnel" — these
  // emails are excluded from outreach the same way active members are.
  const IN_FLIGHT_MIGRATION_STATUSES = new Set([
    'pending', 'heads_up_sent', 'signup_link_sent',
    'urgent_signup_sent', 'reminder_sent', 'last_call_sent',
    'signed_up', 'shopify_cancelled', 'on_hold',
  ]);

  // ---------- State ----------
  const state = {
    customers:            [],   // shopify_customers + computed fields
    allpaddlingEmails:    new Set(),
    inFlightEmails:       new Map(), // email → status string
    sendsByCustomerId:    new Map(), // customer_id → array of outreach_sends rows
    activeSegment:        'all',
    searchTerm:           '',
    selection:            new Set(), // customer ids
    showAllPaddling:      false,
    showUnsub:            false,
    expandedCustomerId:   null,
    adminEmail:           '',
    archiveLoaded:        false,
    engagementLoaded:     false,

    // Active-members tab state (separate selection/filter from Shopify pool
    // so the two surfaces don't interfere with each other).
    members:              [],   // get_member_insights() rows + computed fields
    memSendsByUserId:     new Map(),
    memSelection:         new Set(),   // auth_user_id set
    memActiveSegment:     'all',
    memSearchTerm:        '',
    membersLoaded:        false,
    memEventsBound:       false,
  };

  // ---------- DOM helpers ----------
  const $ = (id) => document.getElementById(id);
  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

  // ---------- Date formatting ----------
  // Accepts ISO date ("2025-07-20") or ISO timestamp ("2025-07-20T10:30:00Z").
  // Returns DD-MM-YYYY (Mick's Australian convention). null/empty → '—'.
  function fmtDate (s) {
    if (!s) return '—';
    const ymd = String(s).slice(0, 10);  // "YYYY-MM-DD"
    const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return ymd;
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  // ============================================================
  // Init
  // ============================================================
  async function init (adminEmail) {
    state.adminEmail = adminEmail;
    bindEvents();
    await loadAll();
    render();
  }

  // ============================================================
  // Loading
  // ============================================================
  async function loadAll () {
    const [
      customersRes,
      newsletterRes,
      progressiveRes,
      customRes,
      migrationRes,
      sendsRes,
    ] = await Promise.all([
      sb.from('shopify_customers').select('*').order('email'),
      sb.from('newsletter_subscribers').select('*').order('subscribed_at', { ascending: false }),
      sb.from('progressive_members').select('email'),
      sb.from('custom_members').select('email'),
      sb.from('migration_customers').select('email, migration_status'),
      sb.from('outreach_sends').select('*').order('sent_at', { ascending: false }),
    ]);

    if (customersRes.error) {
      console.error('Failed to load shopify_customers', customersRes.error);
      $('customersBody').innerHTML = `<tr><td colspan="8" class="empty-state">
        Couldn't load customers — ${escHtml(customersRes.error.message)}
      </td></tr>`;
      return;
    }

    // Build the AllPaddling-or-in-flight email sets.
    const allpaddling = new Set();
    (progressiveRes.data || []).forEach(r => r.email && allpaddling.add(r.email.toLowerCase()));
    (customRes.data      || []).forEach(r => r.email && allpaddling.add(r.email.toLowerCase()));
    state.allpaddlingEmails = allpaddling;

    const inFlight = new Map();
    (migrationRes.data || []).forEach(r => {
      if (!r.email) return;
      if (!IN_FLIGHT_MIGRATION_STATUSES.has(r.migration_status)) return;
      const existing = inFlight.get(r.email.toLowerCase());
      if (!existing) inFlight.set(r.email.toLowerCase(), r.migration_status);
    });
    state.inFlightEmails = inFlight;

    // Per-customer sends history. outreach_sends rows reference EITHER
    // shopify_customer_id OR newsletter_subscriber_id (XOR — see migration
    // 018). Bucket them by whichever FK is set so the history drawer can
    // look up sends with a single Map lookup keyed on the row's own id.
    const byRecipient = new Map();
    (sendsRes.data || []).forEach(s => {
      const key = s.shopify_customer_id || s.newsletter_subscriber_id;
      if (!key) return;
      const arr = byRecipient.get(key) || [];
      arr.push(s);
      byRecipient.set(key, arr);
    });
    state.sendsByCustomerId = byRecipient;

    // Newsletter subscribers indexed by email so we can mark dual-source
    // (Shopify customer who ALSO opted in via the newsletter form). For
    // those, we keep the Shopify row (richer data) and set _also_newsletter.
    const newsletterByEmail = new Map();
    (newsletterRes.data || []).forEach(n => {
      if (n.email) newsletterByEmail.set(n.email.toLowerCase(), n);
    });

    // Enrich Shopify customer rows.
    const today = new Date();
    const usedNewsletterIds = new Set();
    const enrichedShopify = (customersRes.data || []).map(c => {
      const email = (c.email || '').toLowerCase();
      const onAP = allpaddling.has(email);
      const inF  = inFlight.get(email) || null;
      const daysSince = c.last_order_date
        ? Math.floor((today - new Date(c.last_order_date)) / 86400000)
        : null;
      const sends = byRecipient.get(c.id) || [];
      const ns = newsletterByEmail.get(email);
      if (ns) usedNewsletterIds.add(ns.id);
      return {
        ...c,
        // Backfill name from the newsletter signup if Shopify didn't have it
        // (e.g. customer who never gave a name to Shopify but typed it on
        // the newsletter form).
        first_name:        c.first_name || (ns && ns.first_name) || null,
        last_name:         c.last_name  || (ns && ns.last_name)  || null,
        _source_table:     'shopify_customers',
        _email_lc:         email,
        _on_allpaddling:   onAP,
        _in_flight_status: inF,
        _days_since_last:  daysSince,
        _segment:          computeSegment(c, daysSince),
        _last_contact:     sends.length > 0 ? sends[0].sent_at : null,
        _send_count:       sends.length,
        _also_newsletter:  !!ns,
        _newsletter_id:    ns ? ns.id : null,
      };
    });

    // Newsletter-only rows (those without a Shopify match).
    const enrichedNewsletter = (newsletterRes.data || [])
      .filter(n => !usedNewsletterIds.has(n.id))
      .map(n => {
        const email = (n.email || '').toLowerCase();
        const onAP = allpaddling.has(email);
        const inF  = inFlight.get(email) || null;
        const sends = byRecipient.get(n.id) || [];
        return {
          // shopify_customers-shaped fields (most empty for newsletter-only):
          id:                       n.id,
          email:                    n.email,
          first_name:               n.first_name || null,
          last_name:                n.last_name  || null,
          country_code:             null,
          shopify_marketing_consent: null,
          shopify_total_spent:      null,
          shopify_total_orders:     null,
          shopify_tags:             null,
          first_order_date:         null,
          last_order_date:          null,
          orders_count:             0,
          orders_total_paid:        0,
          products:                 null,
          notes:                    null,
          unsubscribed_at:          n.unsubscribed_at,
          unsubscribe_reason:       n.unsubscribe_reason,
          // computed:
          _source_table:     'newsletter_subscribers',
          _email_lc:         email,
          _on_allpaddling:   onAP,
          _in_flight_status: inF,
          _days_since_last:  null,
          _segment:          'newsletter_signup',
          _last_contact:     sends.length > 0 ? sends[0].sent_at : null,
          _send_count:       sends.length,
          _also_newsletter:  true,    // they ARE the newsletter signup
          _newsletter_id:    n.id,
          _signup_source:    n.source,
          _subscribed_at:    n.subscribed_at,
        };
      });

    state.customers = enrichedShopify.concat(enrichedNewsletter)
      .sort((a, b) => (a.email || '').localeCompare(b.email || ''));
  }

  function computeSegment (c, daysSince) {
    const orders = c.orders_count || 0;
    const products = c.products || [];
    const tags = (c.shopify_tags || []).map(t => t.toLowerCase());
    const boughtCustom      = products.some(p => /custom season race plan/i.test(p));
    const boughtProgressive = products.some(p => /progressive monthly plan/i.test(p));

    if (orders === 0 && tags.includes('newsletter')) return 'newsletter_no_purchase';
    if (orders === 0) return 'no_purchase_other';
    if (daysSince == null) return 'unknown_recency';
    if (boughtCustom && daysSince <= 180)  return 'custom_warm_lapsed';
    if (boughtCustom && daysSince <= 365)  return 'custom_recent_lapsed';
    if (boughtCustom)                      return 'custom_cold_lapsed';
    if (boughtProgressive && daysSince <= 365) return 'progressive_lapsed';
    if (boughtProgressive)                     return 'progressive_cold_lapsed';
    return 'other';
  }

  // ============================================================
  // Rendering
  // ============================================================
  function visibleCustomers () {
    const q = state.searchTerm.trim().toLowerCase();
    return state.customers.filter(c => {
      if (state.activeSegment !== 'all') {
        // Treat warm + recent as one bucket for the filter
        if (state.activeSegment === 'custom_recent_lapsed') {
          if (!['custom_warm_lapsed','custom_recent_lapsed'].includes(c._segment)) return false;
        } else if (c._segment !== state.activeSegment) {
          return false;
        }
      }
      if (!state.showAllPaddling && (c._on_allpaddling || c._in_flight_status)) return false;
      if (!state.showUnsub && c.unsubscribed_at) return false;
      if (q) {
        const hay = `${c.first_name||''} ${c.last_name||''} ${c.email||''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function render () {
    renderStats();
    renderFilterCounts();
    renderTable();
    renderSelection();
  }

  function renderStats () {
    const all = state.customers;
    $('statTotal').textContent    = all.length;
    $('statOnAP').textContent     = all.filter(c => c._on_allpaddling || c._in_flight_status).length;
    $('statUnsub').textContent    = all.filter(c => c.unsubscribed_at).length;
    $('statSendable').textContent = all.filter(c => !c._on_allpaddling && !c._in_flight_status && !c.unsubscribed_at).length;
  }

  function renderFilterCounts () {
    // For each filter tab, count rows in the *sendable* pool that match its segment.
    const sendable = state.customers.filter(c => !c._on_allpaddling && !c._in_flight_status && !c.unsubscribed_at);
    const counts = {
      all: sendable.length,
      custom_recent_lapsed: sendable.filter(c => ['custom_warm_lapsed','custom_recent_lapsed'].includes(c._segment)).length,
      custom_cold_lapsed: sendable.filter(c => c._segment === 'custom_cold_lapsed').length,
      progressive_lapsed: sendable.filter(c => c._segment === 'progressive_lapsed').length,
      progressive_cold_lapsed: sendable.filter(c => c._segment === 'progressive_cold_lapsed').length,
      newsletter_no_purchase: sendable.filter(c => c._segment === 'newsletter_no_purchase').length,
      newsletter_signup:      sendable.filter(c => c._segment === 'newsletter_signup').length,
    };
    document.querySelectorAll('#filterTabs .filter-tab').forEach(btn => {
      const seg = btn.dataset.seg;
      const span = btn.querySelector('.count');
      if (span) span.textContent = counts[seg] != null ? counts[seg] : '0';
    });
  }

  function renderTable () {
    const tbody = $('customersBody');
    const rows = visibleCustomers();
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No customers match the current filters.</td></tr>`;
      return;
    }
    const html = rows.map(c => renderRow(c)).join('');
    tbody.innerHTML = html;

    // Wire row checkboxes
    tbody.querySelectorAll('input.row-check').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) state.selection.add(cb.dataset.id);
        else            state.selection.delete(cb.dataset.id);
        renderSelection();
      });
    });

    // Wire row clicks (open history drawer) — but ignore clicks on the checkbox
    tbody.querySelectorAll('tr.row').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('input,button,a,select')) return;
        const cid = tr.dataset.id;
        state.expandedCustomerId = (state.expandedCustomerId === cid) ? null : cid;
        renderTable();
      });
    });

    // Wire per-row quick-send Send buttons. Stop propagation so the row-click
    // history-drawer toggle above doesn't also fire.
    tbody.querySelectorAll('button[data-action="ot-quicksend"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onQuickSendClick(btn);
      });
    });
  }

  // ============================================================
  // Per-row quick-send (template-driven, one customer at a time)
  // ============================================================
  async function onQuickSendClick (btn) {
    const customerId = btn.dataset.id;
    const customer = state.customers.find(c => c.id === customerId);
    if (!customer) { alert('Internal error: customer not found.'); return; }

    // Read selected template from the row's <select>.
    const row = btn.closest('tr');
    const selectEl = row?.querySelector('select[data-action="ot-template-select"]');
    const templateId = selectEl?.value;
    if (typeof OUTREACH_TEMPLATES === 'undefined' || !Array.isArray(OUTREACH_TEMPLATES)) {
      alert('No outreach templates loaded — outreach-templates.js may have failed to load.');
      return;
    }
    const template = OUTREACH_TEMPLATES.find(t => t.id === templateId);
    if (!template) { alert('Pick a template first.'); return; }

    const recipientName = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || customer.email;
    if (!confirm(
      `Send "${template.label}" to ${recipientName} (${customer.email}) right now?\n\n` +
      `Subject: ${template.subject}\n\n` +
      `This sends one email immediately and logs it under the campaign "${template.campaign_name}".`
    )) return;

    // Capture original look so we can restore on failure.
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.textContent = 'Sending…';

    const { data: { session } } = await sb.auth.getSession();
    const jwt = session?.access_token;
    if (!jwt) { alert('Not signed in — refresh and try again.'); btn.disabled = false; btn.textContent = originalText; return; }

    try {
      const personalText = personalize(template.text, customer) + UNSUB_FOOTER_TEXT;
      const personalHtml = personalize(template.html, customer, /*escapeForHtml*/ true) + UNSUB_FOOTER_HTML;

      const res = await fetch(SEND_EMAIL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          mode: 'raw',
          to: customer.email,
          subject: template.subject,
          text: personalText,
          html: personalHtml,
          tags: [
            { name: 'campaign', value: template.campaign_name.slice(0, 60).replace(/[^A-Za-z0-9_-]/g, '_') },
            { name: 'kind',     value: 'outreach' },
            { name: 'template', value: template.id },
          ],
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        await logSend(customer, template.campaign_name, template.subject, personalText, personalHtml, 'failed', null, payload.error || `HTTP ${res.status}`);
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      await logSend(customer, template.campaign_name, template.subject, personalText, personalHtml, 'sent', payload.id, null);

      // Flash green + reload sends history so the "Last contact" column updates.
      btn.classList.remove('is-loading');
      btn.classList.add('flash-success');
      btn.textContent = 'Sent ✓';
      await refreshSends();
      setTimeout(() => {
        btn.classList.remove('flash-success');
        btn.textContent = originalText;
        btn.disabled = false;
      }, 2200);
    } catch (err) {
      console.error('quick-send failed', err);
      alert(`Send failed: ${err.message}`);
      btn.classList.remove('is-loading');
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }

  function renderRow (c) {
    const isLocked = c._on_allpaddling || c._in_flight_status;
    const checked  = state.selection.has(c.id);
    const checkboxAttrs = isLocked
      ? `disabled title="Already on AllPaddling — excluded from outreach"`
      : (checked ? 'checked' : '');

    const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || '—';
    const spend = (c.shopify_total_spent != null)
      ? `$${Number(c.shopify_total_spent).toFixed(0)}`
      : '—';
    const orders = c.orders_count != null ? `${c.orders_count}o` : '';
    const lastOrder = c.last_order_date
      ? `${fmtDate(c.last_order_date)} <span class="ago">(${formatAgo(c._days_since_last)})</span>`
      : '<span class="ago">no orders</span>';

    const segLabel = SEGMENT_LABELS[c._segment] || c._segment;
    // Consent chip logic:
    //  - newsletter signups are explicit opt-ins → green "opted in" badge
    //  - shopify_marketing_consent === false (and NOT also a newsletter signup) → red "opt-out"
    //  - everything else: no chip
    let consentChip = '';
    if (c._also_newsletter) {
      consentChip = '<span class="pill consent-yes" title="Subscribed via the public-site footer form">Opted in</span>';
    } else if (c.shopify_marketing_consent === false) {
      consentChip = '<span class="pill consent-no" title="Shopify: Accepts Email Marketing = no">Opt-out</span>';
    }
    const apChip = c._on_allpaddling
      ? '<span class="pill ap-on">On AllPaddling</span>'
      : (c._in_flight_status
        ? `<span class="pill ap-flight" title="${escHtml(c._in_flight_status)}">Migration: ${escHtml(c._in_flight_status)}</span>`
        : '');
    const unsubChip = c.unsubscribed_at
      ? '<span class="pill unsub">Unsubscribed</span>'
      : '';

    const lastContactCell = c._last_contact
      ? `<span class="date-cell">${fmtDate(c._last_contact)} <span class="ago">(${c._send_count})</span></span>`
      : '<span class="ago">never</span>';

    // Per-row quick-send: dropdown of pre-built templates + Send button.
    // Locked rows (already on AllPaddling / mid-migration / unsubscribed)
    // get disabled controls — bulk-send also skips unsubscribed rows, so
    // these recipients are unreachable through the UI (intentionally).
    const sendDisabled = isLocked || !!c.unsubscribed_at;
    const sendDisabledAttr = sendDisabled ? 'disabled' : '';
    const sendTitle = sendDisabled
      ? (c.unsubscribed_at ? 'Recipient unsubscribed — sending is blocked.' : 'Already on AllPaddling / in migration — outreach blocked.')
      : 'Send the selected template to this recipient.';
    const templates = (typeof OUTREACH_TEMPLATES !== 'undefined' && Array.isArray(OUTREACH_TEMPLATES))
      ? OUTREACH_TEMPLATES
      : [];
    const templateOpts = templates.length === 0
      ? '<option value="">(no templates loaded)</option>'
      : templates.map(t => `<option value="${escHtml(t.id)}">${escHtml(t.label)}</option>`).join('');
    const sendCell = `
      <td class="col-send">
        <div class="send-row">
          <select class="email-kind-select" data-action="ot-template-select" ${sendDisabledAttr}>
            ${templateOpts}
          </select>
          <button class="btn-mini btn-mini-primary" data-action="ot-quicksend" data-id="${c.id}" ${sendDisabledAttr} title="${escHtml(sendTitle)}">Send</button>
        </div>
      </td>`;

    let html = `
      <tr class="row ${isLocked ? 'is-locked' : ''}" data-id="${c.id}">
        <td class="col-check"><input type="checkbox" class="row-check" data-id="${c.id}" ${checkboxAttrs}/></td>
        <td>
          <div class="customer-cell">
            <div class="name">${escHtml(name)}</div>
            <div class="email" title="${escHtml(c.email)}">${escHtml(c.email)}</div>
          </div>
        </td>
        <td class="num-cell">${spend}<br/><span class="ago" style="font-weight:400">${orders}</span></td>
        <td class="date-cell">${lastOrder}</td>
        <td><span class="pill seg-${c._segment}">${escHtml(segLabel)}</span></td>
        <td>${apChip} ${consentChip} ${unsubChip}</td>
        <td>${lastContactCell}</td>
        ${sendCell}
      </tr>
    `;

    // Expanded history drawer
    if (state.expandedCustomerId === c.id) {
      html += renderHistoryDrawer(c);
    }

    return html;
  }

  function renderHistoryDrawer (c) {
    const sends = state.sendsByCustomerId.get(c.id) || [];
    let body;
    if (sends.length === 0) {
      body = '<div class="history-empty">No outreach emails sent yet.</div>';
    } else {
      body = sends.map(s => `
        <div class="history-entry">
          <span class="when">${fmtDate(s.sent_at)}</span>
          <span class="camp">${escHtml(s.campaign_name)}</span>
          <span class="sub">${escHtml(s.subject)}</span>
        </div>
      `).join('');
    }
    const productLine = (c.products && c.products.length)
      ? `<div style="font-size:0.82rem; color:var(--text-3); margin-bottom:0.5rem;">Products: ${escHtml(c.products.join(', '))}</div>`
      : '';
    const tagLine = (c.shopify_tags && c.shopify_tags.length)
      ? `<div style="font-size:0.82rem; color:var(--text-3); margin-bottom:0.5rem;">Tags: ${escHtml(c.shopify_tags.join(', '))}</div>`
      : '';
    const noteLine = c.notes
      ? `<div style="font-size:0.82rem; color:var(--text-2); margin-bottom:0.5rem;">Note: ${escHtml(c.notes)}</div>`
      : '';
    const unsubBtn = c.unsubscribed_at
      ? `<button class="btn btn-text" data-act="unsub-clear" data-id="${c.id}">Re-subscribe</button>`
      : `<button class="btn btn-text" data-act="unsub-set" data-id="${c.id}">Mark unsubscribed</button>`;
    return `
      <tr class="history-drawer">
        <td colspan="8">
          ${productLine}${tagLine}${noteLine}
          <div style="margin:0.5rem 0;">${body}</div>
          <div style="text-align:right;">${unsubBtn}</div>
        </td>
      </tr>
    `;
  }

  function renderSelection () {
    const ids = Array.from(state.selection);
    const recipients = state.customers.filter(c => ids.includes(c.id));
    // Opt-out only applies to Shopify customers who explicitly said no.
    // Newsletter signups (or dual-source rows) are explicit opt-ins, even
    // if their Shopify row also has consent=false.
    const optOuts = recipients.filter(c => c.shopify_marketing_consent === false && !c._also_newsletter);

    if (recipients.length === 0) {
      $('selectionBar').hidden = true;
      return;
    }
    $('selectionBar').hidden = false;
    $('selCount').textContent = recipients.length;
    $('selWarn').textContent = optOuts.length > 0
      ? ` — includes ${optOuts.length} Shopify opt-out${optOuts.length === 1 ? '' : 's'}`
      : '';
  }

  function formatAgo (days) {
    if (days == null) return '—';
    if (days < 30)  return `${days}d ago`;
    if (days < 365) return `${Math.round(days/30)}mo ago`;
    const y = (days / 365).toFixed(1);
    return `${y}y ago`;
  }

  // ============================================================
  // Bulk send (selection bar)
  // ------------------------------------------------------------
  // Coach checks rows, picks a template from the selection-bar dropdown,
  // and clicks "Send to selected →". We loop the selected recipients,
  // fire send-email once per recipient (Resend doesn't take a recipient
  // list for personalised content), and log each row to outreach_sends.
  // The bulk-progress text inline-shows "Sending 3 of 12…" while it runs.
  // ============================================================
  function populateBulkTemplates () {
    const sel = $('bulkTemplateSelect');
    if (!sel) return;
    const templates = (typeof OUTREACH_TEMPLATES !== 'undefined' && Array.isArray(OUTREACH_TEMPLATES))
      ? OUTREACH_TEMPLATES
      : [];
    sel.innerHTML = templates.length === 0
      ? '<option value="">(no templates loaded)</option>'
      : templates.map(t => `<option value="${escHtml(t.id)}">${escHtml(t.label)}</option>`).join('');
    sel.disabled = templates.length === 0;
  }

  async function onBulkSendClick () {
    const ids = Array.from(state.selection);
    const recipients = state.customers
      .filter(c => ids.includes(c.id))
      // Exclude unsubscribed recipients — they shouldn't be sendable at all.
      // (The per-row Send button also blocks these; this is a defence-in-depth.)
      .filter(c => !c.unsubscribed_at);
    if (recipients.length === 0) {
      alert('No sendable recipients selected.');
      return;
    }

    if (typeof OUTREACH_TEMPLATES === 'undefined' || !Array.isArray(OUTREACH_TEMPLATES)) {
      alert('No outreach templates loaded — outreach-templates.js may have failed to load.');
      return;
    }
    const templateId = $('bulkTemplateSelect')?.value;
    const template = OUTREACH_TEMPLATES.find(t => t.id === templateId);
    if (!template) { alert('Pick a template first.'); return; }

    // Opt-out only applies to Shopify customers who explicitly said no.
    // Newsletter signups (or dual-source rows) are explicit opt-ins, even
    // if their Shopify row also has consent=false.
    const optOuts = recipients.filter(c => c.shopify_marketing_consent === false && !c._also_newsletter);
    let optOutNote = '';
    if (optOuts.length > 0) {
      optOutNote = `\n\n⚠  ${optOuts.length} of these declined email marketing in Shopify. They'll still be sent unless you cancel.`;
    }

    if (!confirm(
      `Send "${template.label}" to ${recipients.length} selected recipient${recipients.length === 1 ? '' : 's'} right now?\n\n` +
      `Subject: ${template.subject}\n\n` +
      `Logged under campaign "${template.campaign_name}".` +
      optOutNote
    )) return;

    const sendBtn = $('bulkSendBtn');
    const progressEl = $('bulkProgress');
    const templateSel = $('bulkTemplateSelect');
    const clearBtn = $('clearSelBtn');
    sendBtn.disabled = true;
    templateSel.disabled = true;
    clearBtn.disabled = true;
    progressEl.className = 'bulk-progress';
    sendBtn.textContent = 'Sending…';

    const { data: { session } } = await sb.auth.getSession();
    const jwt = session?.access_token;
    if (!jwt) {
      alert('Not signed in — refresh and try again.');
      sendBtn.disabled = false;
      templateSel.disabled = false;
      clearBtn.disabled = false;
      sendBtn.textContent = 'Send to selected →';
      return;
    }

    let okCount = 0, failCount = 0;
    const failures = [];

    for (let i = 0; i < recipients.length; i++) {
      const c = recipients[i];
      progressEl.textContent = `Sending ${i + 1} of ${recipients.length}…`;
      try {
        const personalText = personalize(template.text, c) + UNSUB_FOOTER_TEXT;
        const personalHtml = personalize(template.html, c, /*escapeForHtml*/ true) + UNSUB_FOOTER_HTML;
        const res = await fetch(SEND_EMAIL_URL, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${jwt}`,
          },
          body: JSON.stringify({
            mode: 'raw',
            to: c.email,
            subject: template.subject,
            text: personalText,
            html: personalHtml,
            tags: [
              { name: 'campaign', value: template.campaign_name.slice(0, 60).replace(/[^A-Za-z0-9_-]/g, '_') },
              { name: 'kind',     value: 'outreach' },
              { name: 'template', value: template.id },
            ],
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          failCount++;
          failures.push(`${c.email}: ${payload.error || res.status}`);
          await logSend(c, template.campaign_name, template.subject, personalText, personalHtml, 'failed', null, payload.error || `HTTP ${res.status}`);
        } else {
          okCount++;
          await logSend(c, template.campaign_name, template.subject, personalText, personalHtml, 'sent', payload.id, null);
        }
      } catch (err) {
        failCount++;
        failures.push(`${c.email}: ${err.message}`);
        try {
          await logSend(c, template.campaign_name, template.subject, template.text, template.html, 'failed', null, err.message);
        } catch (_) { /* ignore */ }
      }
    }

    // Final progress message; class drives the colour.
    if (failCount === 0) {
      progressEl.className = 'bulk-progress ok';
      progressEl.textContent = `Sent ${okCount} of ${recipients.length} ✓`;
      sendBtn.textContent = 'Sent ✓';
    } else {
      progressEl.className = 'bulk-progress error';
      progressEl.textContent = `${okCount} sent, ${failCount} failed`;
      sendBtn.textContent = 'Done (with errors)';
      console.error('Bulk send failures:', failures);
      alert(`${failCount} send${failCount === 1 ? '' : 's'} failed — see console for details.\n\n${failures.slice(0, 5).join('\n')}${failures.length > 5 ? '\n…' : ''}`);
    }

    // Refresh sends so the per-customer history + last-contact column update,
    // then clear selection and re-render so the row's "last contact" updates.
    await refreshSends();
    state.selection.clear();
    render();

    // Restore the bar after a moment so the next batch can be sent.
    setTimeout(() => {
      progressEl.className = 'bulk-progress';
      progressEl.textContent = '';
      sendBtn.textContent = 'Send to selected →';
      sendBtn.disabled = false;
      templateSel.disabled = false;
      clearBtn.disabled = false;
    }, 3000);
  }

  // When substituting into an HTML body, callers pass escapeForHtml=true so a
  // first_name containing `<` or `&` can't break the document or inject markup.
  // Plain-text bodies pass false (the default) — they're never wrapped in HTML.
  function personalize (body, c, escapeForHtml = false) {
    const v = s => (escapeForHtml ? escHtml(s) : s);
    return body
      .replace(/\{\{first_name\}\}/g, v(c.first_name || 'there'))
      .replace(/\{\{last_name\}\}/g,  v(c.last_name  || ''))
      .replace(/\{\{email\}\}/g,      v(c.email      || ''));
  }

  async function logSend (customer, campaignName, subject, bodyText, bodyHtml, status, resendId, error) {
    // Pick the right FK based on which table this row originated from.
    // outreach_sends has a CHECK constraint requiring exactly one set
    // (migration 018), so we never populate both even for dual-source rows.
    const isNewsletter = customer._source_table === 'newsletter_subscribers';
    const row = {
      shopify_customer_id:      isNewsletter ? null : customer.id,
      newsletter_subscriber_id: isNewsletter ? customer.id : null,
      recipient_email:          customer.email,
      campaign_name:            campaignName,
      subject,
      body_text:                bodyText,
      body_html:                bodyHtml,
      status,
      resend_id:                resendId,
      error,
      sent_by:                  state.adminEmail,
    };
    const { error: insErr } = await sb.from('outreach_sends').insert(row);
    if (insErr) console.error('Failed to log outreach_send', insErr);
  }

  async function refreshSends () {
    const { data, error } = await sb.from('outreach_sends').select('*').order('sent_at', { ascending: false });
    if (error) { console.error(error); return; }
    const byRecipient = new Map();
    (data || []).forEach(s => {
      const key = s.shopify_customer_id || s.newsletter_subscriber_id;
      if (!key) return;
      const arr = byRecipient.get(key) || [];
      arr.push(s);
      byRecipient.set(key, arr);
    });
    state.sendsByCustomerId = byRecipient;
    state.customers.forEach(c => {
      const sends = byRecipient.get(c.id) || [];
      c._last_contact = sends.length > 0 ? sends[0].sent_at : null;
      c._send_count = sends.length;
    });
  }

  // ============================================================
  // Unsubscribe toggle (from history drawer)
  // ============================================================
  async function setUnsubscribed (customerId, unsubscribed) {
    const c = state.customers.find(x => x.id === customerId);
    if (!c) return;
    const update = unsubscribed
      ? { unsubscribed_at: new Date().toISOString(), unsubscribe_reason: 'manual (coach)' }
      : { unsubscribed_at: null, unsubscribe_reason: null };
    // Write to whichever table this row originated from.
    const table = c._source_table === 'newsletter_subscribers'
      ? 'newsletter_subscribers'
      : 'shopify_customers';
    const { error } = await sb.from(table).update(update).eq('id', customerId);
    if (error) {
      alert('Failed: ' + error.message);
      return;
    }
    c.unsubscribed_at = update.unsubscribed_at;
    c.unsubscribe_reason = update.unsubscribe_reason;
    render();
  }

  // ============================================================
  // Engagement tab
  //
  // Reads every row in outreach_sends, groups by campaign_name, and
  // renders per-campaign engagement summary cards. Engagement columns
  // (delivered_at / opened_at / clicked_at / bounced_at / complained_at,
  // plus open_count / click_count and the raw events jsonb) are
  // populated by the resend-webhook Edge Function. Campaigns sent
  // BEFORE webhook tracking was wired up (15 May 2026) will show no
  // engagement events at all — we surface that as a "no tracking
  // available" badge rather than misleading 0% open/click rates.
  // ============================================================
  const ENGAGEMENT_TRACKING_LIVE = new Date('2026-05-16T00:00:00Z');

  async function loadEngagement () {
    if (state.engagementLoaded) return;
    const container = $('engCards');
    const { data, error } = await sb
      .from('outreach_sends')
      .select('id, campaign_name, template_kind, sent_at, status, delivered_at, opened_at, clicked_at, bounced_at, complained_at, open_count, click_count, events')
      .order('sent_at', { ascending: false });
    if (error) {
      container.innerHTML = `<div class="eng-empty">Couldn't load engagement — ${escHtml(error.message)}</div>`;
      return;
    }
    state.engagementLoaded = true;
    const rows = data || [];

    // Group by campaign_name. Within each group, derive engagement
    // counts. A campaign is "tracked" if at least one of its sends has
    // events (non-empty events jsonb) — that tells us the webhook was
    // active at send time.
    const groups = new Map();
    for (const r of rows) {
      const key = r.campaign_name || '(unnamed)';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }

    // Cross-campaign headline stats
    let totalDelivered = 0, totalClicked = 0, totalBounced = 0, totalComplained = 0;
    for (const r of rows) {
      const wasDelivered = !!r.delivered_at || (r.status !== 'failed' && !r.bounced_at);
      if (wasDelivered) totalDelivered++;
      if (r.clicked_at)   totalClicked++;
      if (r.bounced_at)   totalBounced++;
      if (r.complained_at) totalComplained++;
    }
    $('engCampaigns').textContent = groups.size || '0';
    $('engDelivered').textContent = totalDelivered.toString();
    // Click rate computed only over tracked sends (where the webhook
    // could record a click in the first place). Untracked sends bias
    // the denominator downward, so we exclude them.
    const trackedSends = rows.filter(r => Array.isArray(r.events) && r.events.length > 0).length;
    if (trackedSends > 0) {
      const pct = Math.round((totalClicked / trackedSends) * 1000) / 10;
      $('engClickRate').textContent = pct + '%';
    } else {
      $('engClickRate').textContent = '—';
    }
    $('engBounces').textContent = totalBounced + ' · ' + totalComplained;

    if (groups.size === 0) {
      container.innerHTML = `<div class="eng-empty">No campaigns sent yet. Engagement will populate once you send your first campaign from the Outreach tab.</div>`;
      return;
    }

    // Render one card per campaign, newest first (groups iterate in
    // insertion order, which is sent_at desc from the SQL above).
    const cardsHtml = Array.from(groups.entries()).map(([campaignName, sends]) => {
      const delivered = sends.filter(r => !!r.delivered_at || (r.status !== 'failed' && !r.bounced_at)).length;
      const opened    = sends.filter(r => !!r.opened_at).length;
      const clicked   = sends.filter(r => !!r.clicked_at).length;
      const bounced   = sends.filter(r => !!r.bounced_at).length;
      const complained = sends.filter(r => !!r.complained_at).length;
      const tracked   = sends.some(r => Array.isArray(r.events) && r.events.length > 0);
      const lastSentAt = sends.reduce((max, r) => {
        if (!r.sent_at) return max;
        return (!max || r.sent_at > max) ? r.sent_at : max;
      }, null);
      const firstSentAt = sends.reduce((min, r) => {
        if (!r.sent_at) return min;
        return (!min || r.sent_at < min) ? r.sent_at : min;
      }, null);

      const sentBefore = lastSentAt && new Date(lastSentAt) < ENGAGEMENT_TRACKING_LIVE && !tracked;
      const openPct  = delivered > 0 ? Math.round((opened  / delivered) * 1000) / 10 : 0;
      const clickPct = delivered > 0 ? Math.round((clicked / delivered) * 1000) / 10 : 0;

      // Pills for this campaign
      const pills = [];
      pills.push(`<span class="eng-pill info">${escHtml(String(sends.length))} sent</span>`);
      if (delivered !== sends.length) pills.push(`<span class="eng-pill muted">${escHtml(String(delivered))} delivered</span>`);
      if (bounced > 0)    pills.push(`<span class="eng-pill warn">${escHtml(String(bounced))} bounced</span>`);
      if (complained > 0) pills.push(`<span class="eng-pill danger">${escHtml(String(complained))} complained</span>`);
      if (sentBefore)     pills.push(`<span class="eng-pill muted">No engagement tracking</span>`);

      // Bars — if no tracking was active at send time, render hatched
      // "no data" bars and a different caveat. If tracking IS active
      // but we have zero opens/clicks (genuine), render zero-width bars.
      const noTracking = sentBefore;
      const openBar  = noTracking
        ? `<div class="eng-bar"><div class="eng-bar-fill none"></div></div>`
        : `<div class="eng-bar"><div class="eng-bar-fill opened" style="width:${Math.min(100, openPct)}%;"></div></div>`;
      const clickBar = noTracking
        ? `<div class="eng-bar"><div class="eng-bar-fill none"></div></div>`
        : `<div class="eng-bar"><div class="eng-bar-fill clicked" style="width:${Math.min(100, clickPct)}%;"></div></div>`;
      const openVal  = noTracking
        ? `<span class="nodata">no data</span>`
        : `<span class="pct">${openPct}%</span><span class="raw">${opened}/${delivered}</span>`;
      const clickVal = noTracking
        ? `<span class="nodata">no data</span>`
        : `<span class="pct">${clickPct}%</span><span class="raw">${clicked}/${delivered}</span>`;

      // Date meta line
      const dateMeta = firstSentAt === lastSentAt || !firstSentAt
        ? fmtDate(lastSentAt)
        : `${fmtDate(firstSentAt)} → ${fmtDate(lastSentAt)}`;

      const caveatHtml = noTracking
        ? `<div class="eng-caveat">This campaign was sent before the Resend webhook was wired up, so per-recipient open and click events were not captured. Future campaigns will populate fully.</div>`
        : '';

      return `
        <div class="eng-card">
          <div class="eng-card-head">
            <div>
              <h3 class="eng-card-title">${escHtml(campaignName)}</h3>
              <div class="eng-card-meta">${escHtml(dateMeta)}${sends[0].template_kind ? `<span class="dot">·</span>${escHtml(sends[0].template_kind)}` : ''}</div>
            </div>
            <div class="eng-pills">${pills.join('')}</div>
          </div>
          <div class="eng-bars">
            <div class="eng-bar-row">
              <span class="eng-bar-label">Opened</span>
              ${openBar}
              <span class="eng-bar-val">${openVal}</span>
            </div>
            <div class="eng-bar-row">
              <span class="eng-bar-label">Clicked</span>
              ${clickBar}
              <span class="eng-bar-val">${clickVal}</span>
            </div>
          </div>
          ${caveatHtml}
        </div>
      `;
    }).join('');

    container.innerHTML = cardsHtml;
  }

  // ============================================================
  // Migration archive tab
  // ============================================================
  async function loadArchive () {
    if (state.archiveLoaded) return;
    const { data, error } = await sb.from('migration_customers').select('*').order('email');
    const tbody = $('archiveBody');
    if (error) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Couldn't load — ${escHtml(error.message)}</td></tr>`;
      return;
    }
    const rows = data || [];
    state.archiveLoaded = true;

    // Stats
    $('archTotal').textContent    = rows.length;
    $('archMigrated').textContent = rows.filter(r => r.migration_status === 'migrated').length;
    $('archInFlight').textContent = rows.filter(r =>
      ['heads_up_sent','signup_link_sent','urgent_signup_sent','reminder_sent','last_call_sent','signed_up','shopify_cancelled'].includes(r.migration_status)
    ).length;
    $('archLapsed').textContent   = rows.filter(r => ['lapsed','on_hold'].includes(r.migration_status)).length;

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No migration roster.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>
          <div class="customer-cell">
            <div class="name">${escHtml(r.name)}</div>
            <div class="email">${escHtml(r.email)}</div>
          </div>
        </td>
        <td>${escHtml(r.plan_type)}${r.plan_key ? ' / ' + escHtml(r.plan_key) : ''}</td>
        <td><span class="pill seg-${r.migration_status}">${escHtml(r.migration_status)}</span></td>
        <td class="date-cell">${fmtDate(r.next_renewal)}</td>
        <td class="date-cell">${fmtDate(r.status_updated_at)}</td>
      </tr>
    `).join('');
  }

  // ============================================================
  // Events
  // ============================================================
  function bindEvents () {
    // Tabs
    document.querySelectorAll('.surface-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const pane = btn.dataset.pane;
        document.querySelectorAll('.surface-tab').forEach(b => b.classList.toggle('active', b === btn));
        $('pane-outreach').hidden   = (pane !== 'outreach');
        $('pane-members').hidden    = (pane !== 'members');
        $('pane-engagement').hidden = (pane !== 'engagement');
        $('pane-archive').hidden    = (pane !== 'archive');
        if (pane === 'members') {
          bindMemberEvents();        // idempotent — no-op after first call
          loadActiveMembers();       // idempotent — no-op once cached
        }
        if (pane === 'archive')    loadArchive();
        if (pane === 'engagement') loadEngagement();
      });
    });

    // Filter pills
    document.querySelectorAll('#filterTabs .filter-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeSegment = btn.dataset.seg;
        document.querySelectorAll('#filterTabs .filter-tab').forEach(b => b.classList.toggle('active', b === btn));
        renderTable();
      });
    });

    $('searchInput').addEventListener('input', (e) => {
      state.searchTerm = e.target.value;
      renderTable();
    });

    $('filterShowAllPaddling').addEventListener('change', (e) => {
      state.showAllPaddling = e.target.checked;
      renderTable();
    });
    $('filterShowUnsub').addEventListener('change', (e) => {
      state.showUnsub = e.target.checked;
      renderTable();
    });

    // Select-all checkbox in header
    $('selectAll').addEventListener('change', (e) => {
      const rows = visibleCustomers().filter(c => !c._on_allpaddling && !c._in_flight_status && !c.unsubscribed_at);
      if (e.target.checked) rows.forEach(c => state.selection.add(c.id));
      else                  rows.forEach(c => state.selection.delete(c.id));
      renderTable();
      renderSelection();
    });

    // Selection bar
    $('clearSelBtn').addEventListener('click', () => {
      state.selection.clear();
      const sa = $('selectAll');
      if (sa) sa.checked = false;  // header checkbox doesn't auto-track state
      renderTable();
      renderSelection();
    });

    // Bulk-send template picker lives in the selection bar; populate the
    // <select> once at init and wire the Send-to-selected button.
    populateBulkTemplates();
    $('bulkSendBtn').addEventListener('click', onBulkSendClick);

    // Drawer actions (event-delegation on tbody for unsubscribe buttons)
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.act === 'unsub-set')   setUnsubscribed(id, true);
      if (btn.dataset.act === 'unsub-clear') setUnsubscribed(id, false);
    });
  }

  // ============================================================
  // Active members pane
  // ------------------------------------------------------------
  // Loads via get_member_insights() — the same coach-gated RPC
  // admin-insights.html uses. Returns one row per paying member with
  // threshold + session-completion data already aggregated, so the
  // Outreach page can show who's dormant at a glance.
  //
  // Sends reuse the send-email Edge Function and template registry
  // from above. The only difference is logMemberSend(), which sets
  // outreach_sends.member_auth_user_id instead of shopify_customer_id
  // / newsletter_subscriber_id (the third XOR slot added in
  // migration 025).
  // ============================================================
  async function loadActiveMembers (force = false) {
    if (state.membersLoaded && !force) return;

    const [insightsRes, sendsRes] = await Promise.all([
      sb.rpc('get_member_insights'),
      sb.from('outreach_sends')
        .select('id, member_auth_user_id, sent_at, campaign_name, subject, status, opened_at, clicked_at')
        .not('member_auth_user_id', 'is', null)
        .order('sent_at', { ascending: false }),
    ]);

    if (insightsRes.error) {
      console.error('Failed to load get_member_insights', insightsRes.error);
      $('membersBody').innerHTML = `<tr><td colspan="9" class="empty-state">
        Couldn't load active members — ${escHtml(insightsRes.error.message)}
      </td></tr>`;
      return;
    }

    const byMember = new Map();
    (sendsRes.data || []).forEach(s => {
      if (!s.member_auth_user_id) return;
      const arr = byMember.get(s.member_auth_user_id) || [];
      arr.push(s);
      byMember.set(s.member_auth_user_id, arr);
    });
    state.memSendsByUserId = byMember;

    state.members = (insightsRes.data || []).map(m => {
      const sends = byMember.get(m.auth_user_id) || [];
      return {
        ...m,
        _sends:        sends,
        _last_contact: sends.length > 0 ? sends[0].sent_at : null,
        // "Dormant" surfaces members most in need of this campaign:
        // no threshold ever set, OR zero session completions in 30 days.
        _is_dormant:   !m.last_threshold_at || (m.sessions_completed_30d || 0) === 0,
      };
    }).sort((a, b) => {
      if (a._is_dormant !== b._is_dormant) return a._is_dormant ? -1 : 1;
      return (a.name || a.email || '').localeCompare(b.name || b.email || '');
    });

    state.membersLoaded = true;
    renderMembers();
  }

  // get_member_insights() returns plan as 'Custom' or 'Progressive' (capitalized
  // — set explicitly in the function's CTE). All plan comparisons in this module
  // normalise via planKey() so we don't get bitten if the casing ever changes.
  function planKey (p) { return (p || '').toLowerCase(); }

  function visibleMembers () {
    const q = state.memSearchTerm.trim().toLowerCase();
    return state.members.filter(m => {
      const pk = planKey(m.plan);
      if (state.memActiveSegment === 'progressive' && pk !== 'progressive') return false;
      if (state.memActiveSegment === 'custom'      && pk !== 'custom')      return false;
      if (state.memActiveSegment === 'dormant'     && !m._is_dormant)       return false;
      if (q) {
        const hay = `${m.name||''} ${m.email||''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderMembers () {
    renderMembersStats();
    renderMembersFilterCounts();
    renderMembersTable();
    renderMembersSelection();
  }

  function renderMembersStats () {
    const all = state.members;
    $('memStatTotal').textContent       = all.length;
    $('memStatNoThreshold').textContent = all.filter(m => !m.last_threshold_at).length;
    $('memStatNoSessions').textContent  = all.filter(m => (m.sessions_completed_30d || 0) === 0).length;
    const latest = all
      .map(m => m._last_contact)
      .filter(Boolean)
      .sort()
      .pop();
    $('memStatLastContact').textContent = latest ? fmtDate(latest) : '—';
  }

  function renderMembersFilterCounts () {
    const c = (pred) => state.members.filter(pred).length;
    const setCount = (seg, n) => {
      const el = document.querySelector(`#memFilterTabs [data-mseg="${seg}"] .count`);
      if (el) el.textContent = n;
    };
    setCount('all',         c(() => true));
    setCount('progressive', c(m => planKey(m.plan) === 'progressive'));
    setCount('custom',      c(m => planKey(m.plan) === 'custom'));
    setCount('dormant',     c(m => m._is_dormant));
  }

  function renderMembersTable () {
    const tbody = $('membersBody');
    if (!tbody) return;
    const rows = visibleMembers();
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No members match.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(renderMemberRow).join('');
  }

  function renderMemberRow (m) {
    const checked = state.memSelection.has(m.auth_user_id) ? 'checked' : '';
    const name = m.name || '(no name)';

    const pk = planKey(m.plan);
    const planLabel = pk === 'progressive' ? 'Progressive' :
                      pk === 'custom'      ? 'Custom'      : (m.plan || '—');
    const planPill  = `<span class="pill seg-${pk || 'unknown'}">${escHtml(planLabel)}</span>`;

    const signedUp = m.signed_up_at ? fmtDate(m.signed_up_at) : '—';

    const lastSignIn = m.last_sign_in_at
      ? `<span title="${escHtml(m.last_sign_in_at)}">${fmtDate(m.last_sign_in_at)}</span>`
      : '<span class="ago">never</span>';

    // Threshold: current pace + when last set, or "Not set" if absent
    let thresholdCell = '<span class="ago" style="color:#b45309;">Not set</span>';
    if (m.current_threshold_sec && m.last_threshold_at) {
      const secs = m.current_threshold_sec;
      const mm = Math.floor(secs / 60);
      const ss = String(secs % 60).padStart(2, '0');
      const unit = m.threshold_unit || '/km';
      thresholdCell = `<div style="font-weight:600;">${mm}:${ss} ${escHtml(unit)}</div>` +
                      `<div class="ago" style="font-size:0.78rem;">${fmtDate(m.last_threshold_at)}</div>`;
    }

    // Sessions: big 30d number, breakdown beneath
    const s30  = m.sessions_completed_30d   || 0;
    const s7   = m.sessions_completed_7d    || 0;
    const sAll = m.sessions_completed_total || 0;
    const sessionsCell =
      `<div style="font-weight:700; font-size:1.05rem;">${s30}</div>` +
      `<div class="ago" style="font-size:0.78rem;">${s7} in 7d &middot; ${sAll} all-time</div>`;

    const lastContact = m._last_contact
      ? fmtDate(m._last_contact)
      : '<span class="ago">never</span>';

    const templates = (typeof OUTREACH_TEMPLATES !== 'undefined' && Array.isArray(OUTREACH_TEMPLATES))
      ? OUTREACH_TEMPLATES : [];
    const templateOpts = templates.length === 0
      ? '<option value="">(no templates loaded)</option>'
      : templates.map(t => `<option value="${escHtml(t.id)}" ${t.id === 'active_member_checkin_2026_05' ? 'selected' : ''}>${escHtml(t.label)}</option>`).join('');

    const dormantTag = m._is_dormant
      ? ' <span class="pill" style="background:#fef3c7; color:#92400e; font-size:0.7rem; margin-left:4px;">dormant</span>'
      : '';

    return `
      <tr class="row" data-mid="${m.auth_user_id}">
        <td class="col-check"><input type="checkbox" class="mem-row-check" data-mid="${m.auth_user_id}" ${checked}/></td>
        <td>
          <div class="customer-cell">
            <div class="name">${escHtml(name)}${dormantTag}</div>
            <div class="email" title="${escHtml(m.email)}">${escHtml(m.email)}</div>
          </div>
        </td>
        <td>${planPill}</td>
        <td class="date-cell">${signedUp}</td>
        <td class="date-cell">${lastSignIn}</td>
        <td>${thresholdCell}</td>
        <td>${sessionsCell}</td>
        <td class="date-cell">${lastContact}</td>
        <td class="col-send">
          <div class="send-row">
            <select class="email-kind-select" data-action="mem-template-select">${templateOpts}</select>
            <button class="btn-mini btn-mini-primary" data-action="mem-quicksend" data-mid="${m.auth_user_id}" title="Send the selected template to this member.">Send</button>
          </div>
        </td>
      </tr>
    `;
  }

  function renderMembersSelection () {
    const ids = Array.from(state.memSelection);
    const recipients = state.members.filter(m => ids.includes(m.auth_user_id));
    if (recipients.length === 0) {
      $('memSelectionBar').hidden = true;
      return;
    }
    $('memSelectionBar').hidden = false;
    $('memSelCount').textContent = recipients.length;
  }

  function populateMemberBulkTemplates () {
    const sel = $('memBulkTemplateSelect');
    if (!sel) return;
    const templates = (typeof OUTREACH_TEMPLATES !== 'undefined' && Array.isArray(OUTREACH_TEMPLATES))
      ? OUTREACH_TEMPLATES : [];
    sel.innerHTML = templates.length === 0
      ? '<option value="">(no templates loaded)</option>'
      : templates.map(t => `<option value="${escHtml(t.id)}">${escHtml(t.label)}</option>`).join('');
    // Default to the active-member check-in if present — that's the campaign
    // this whole tab is built for.
    const preferred = templates.find(t => t.id === 'active_member_checkin_2026_05');
    if (preferred) sel.value = preferred.id;
    sel.disabled = templates.length === 0;
  }

  async function sendToMember (member, template) {
    const { data: { session } } = await sb.auth.getSession();
    const jwt = session?.access_token;
    if (!jwt) throw new Error('Not signed in');

    // get_member_insights returns `name` (full name) but personalize() expects
    // first_name. Split on whitespace to derive a sensible greeting.
    const firstName = (member.name || '').trim().split(/\s+/)[0] || 'there';
    const personalText = personalize(template.text, { first_name: firstName, last_name: '', email: member.email }) + UNSUB_FOOTER_TEXT;
    const personalHtml = personalize(template.html, { first_name: firstName, last_name: '', email: member.email }, true) + UNSUB_FOOTER_HTML;

    const res = await fetch(SEND_EMAIL_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        mode: 'raw',
        to: member.email,
        subject: template.subject,
        text: personalText,
        html: personalHtml,
        tags: [
          { name: 'campaign', value: template.campaign_name.slice(0, 60).replace(/[^A-Za-z0-9_-]/g, '_') },
          { name: 'kind',     value: 'outreach' },
          { name: 'template', value: template.id },
        ],
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      await logMemberSend(member, template.campaign_name, template.subject, personalText, personalHtml, 'failed', null, payload.error || `HTTP ${res.status}`);
      throw new Error(payload.error || `HTTP ${res.status}`);
    }
    await logMemberSend(member, template.campaign_name, template.subject, personalText, personalHtml, 'sent', payload.id, null);
  }

  async function logMemberSend (member, campaignName, subject, bodyText, bodyHtml, status, resendId, error) {
    const row = {
      shopify_customer_id:      null,
      newsletter_subscriber_id: null,
      member_auth_user_id:      member.auth_user_id,
      recipient_email:          member.email,
      campaign_name:            campaignName,
      subject,
      body_text:                bodyText,
      body_html:                bodyHtml,
      status,
      resend_id:                resendId,
      error,
      sent_by:                  state.adminEmail,
    };
    const { error: insErr } = await sb.from('outreach_sends').insert(row);
    if (insErr) console.error('Failed to log member outreach_send', insErr);
  }

  async function onMemberBulkSend () {
    const ids = Array.from(state.memSelection);
    const recipients = state.members.filter(m => ids.includes(m.auth_user_id));
    if (recipients.length === 0) { alert('No recipients selected.'); return; }

    const templateId = $('memBulkTemplateSelect')?.value;
    const template = OUTREACH_TEMPLATES.find(t => t.id === templateId);
    if (!template) { alert('Pick a template first.'); return; }

    if (!confirm(
      `Send "${template.label}" to ${recipients.length} active member${recipients.length === 1 ? '' : 's'} right now?\n\n` +
      `Subject: ${template.subject}\n\n` +
      `Logged under campaign "${template.campaign_name}".`
    )) return;

    const sendBtn     = $('memBulkSendBtn');
    const progressEl  = $('memBulkProgress');
    const templateSel = $('memBulkTemplateSelect');
    const clearBtn    = $('memClearSelBtn');
    sendBtn.disabled = true; templateSel.disabled = true; clearBtn.disabled = true;
    progressEl.className = 'bulk-progress';
    sendBtn.textContent = 'Sending…';

    let okCount = 0, failCount = 0;
    const failures = [];

    for (let i = 0; i < recipients.length; i++) {
      const m = recipients[i];
      progressEl.textContent = `Sending ${i + 1} of ${recipients.length}…`;
      try { await sendToMember(m, template); okCount++; }
      catch (err) { failCount++; failures.push(`${m.email}: ${err.message}`); }
    }

    if (failCount === 0) {
      progressEl.className = 'bulk-progress ok';
      progressEl.textContent = `Sent ${okCount} of ${recipients.length} ✓`;
      sendBtn.textContent = 'Sent ✓';
    } else {
      progressEl.className = 'bulk-progress error';
      progressEl.textContent = `${okCount} sent, ${failCount} failed`;
      sendBtn.textContent = 'Done (with errors)';
      console.error('Member bulk-send failures:', failures);
      alert(`${failCount} send${failCount === 1 ? '' : 's'} failed — see console:\n\n${failures.slice(0, 5).join('\n')}${failures.length > 5 ? '\n…' : ''}`);
    }

    await loadActiveMembers(/*force*/ true);
    state.memSelection.clear();

    setTimeout(() => {
      progressEl.className = 'bulk-progress';
      progressEl.textContent = '';
      sendBtn.textContent = 'Send to selected →';
      sendBtn.disabled = false; templateSel.disabled = false; clearBtn.disabled = false;
    }, 3000);
  }

  async function onMemberQuickSend (userId, templateId) {
    const m = state.members.find(x => x.auth_user_id === userId);
    if (!m) return;
    const template = OUTREACH_TEMPLATES.find(t => t.id === templateId);
    if (!template) { alert('Pick a template first.'); return; }
    if (!confirm(`Send "${template.label}" to ${m.email}?`)) return;
    try {
      await sendToMember(m, template);
      await loadActiveMembers(/*force*/ true);
      alert(`Sent to ${m.email} ✓`);
    } catch (err) {
      alert(`Send failed: ${err.message}`);
    }
  }

  function bindMemberEvents () {
    if (state.memEventsBound) return;
    state.memEventsBound = true;

    document.querySelectorAll('#memFilterTabs .filter-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.memActiveSegment = btn.dataset.mseg;
        document.querySelectorAll('#memFilterTabs .filter-tab').forEach(b => b.classList.toggle('active', b === btn));
        renderMembersTable();
      });
    });

    $('memSearchInput')?.addEventListener('input', (e) => {
      state.memSearchTerm = e.target.value;
      renderMembersTable();
    });

    $('memSelectAll')?.addEventListener('change', (e) => {
      const rows = visibleMembers();
      if (e.target.checked) rows.forEach(m => state.memSelection.add(m.auth_user_id));
      else                  rows.forEach(m => state.memSelection.delete(m.auth_user_id));
      renderMembersTable();
      renderMembersSelection();
    });

    $('memClearSelBtn')?.addEventListener('click', () => {
      state.memSelection.clear();
      const sa = $('memSelectAll');
      if (sa) sa.checked = false;
      renderMembersTable();
      renderMembersSelection();
    });

    populateMemberBulkTemplates();
    $('memBulkSendBtn')?.addEventListener('click', onMemberBulkSend);

    // Per-row: quick-send button + checkbox toggle, via event delegation
    $('membersBody')?.addEventListener('click', (e) => {
      const sendBtn = e.target.closest('[data-action="mem-quicksend"]');
      if (sendBtn) {
        const userId = sendBtn.dataset.mid;
        const tr = sendBtn.closest('tr');
        const sel = tr?.querySelector('[data-action="mem-template-select"]');
        onMemberQuickSend(userId, sel?.value);
        return;
      }
    });
    $('membersBody')?.addEventListener('change', (e) => {
      const check = e.target.closest('.mem-row-check');
      if (!check) return;
      const userId = check.dataset.mid;
      if (check.checked) state.memSelection.add(userId);
      else               state.memSelection.delete(userId);
      renderMembersSelection();
    });
  }

  // ---------- Public API ----------
  window.OutreachPage = { init };
})();
