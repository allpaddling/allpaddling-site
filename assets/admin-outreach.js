/* ============================================================
   admin-outreach.js — Customer outreach roster + manual campaign
   composer. Used by admin-outreach.html.

   Reads from `public.shopify_customers` (RLS: coach-only). For
   each customer, computes a segment client-side (based on
   recency + product mix), cross-references against
   `progressive_members` + `custom_members` to mark "already on
   AllPaddling" rows, and renders a filterable table.

   The coach multi-selects rows, types a campaign name + subject
   + body, and the page fans out one HTTP call to the send-email
   Edge Function per recipient (raw mode, coach JWT). Each
   successful send writes a row to `outreach_sends` for the
   per-customer history log.

   Loads AFTER admin.js — relies on `sb`, `getCurrentSession`,
   `isCurrentUserCoach`, etc.
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
    'hello@allpaddling.online with the subject "unsubscribe".'
  );
  const UNSUB_FOOTER_HTML = (
    '<hr style="margin-top:24px;border:0;border-top:1px solid #ddd"/>' +
    '<p style="font-size:12px;color:#888;margin-top:12px;line-height:1.5">' +
    'You\'re receiving this because you were a customer of All Paddling. ' +
    'To stop receiving these emails, reply with "unsubscribe" or email ' +
    '<a href="mailto:hello@allpaddling.online?subject=unsubscribe" style="color:#888">' +
    'hello@allpaddling.online</a> with the subject "unsubscribe".' +
    '</p>'
  );

  const SEGMENT_LABELS = {
    custom_warm_lapsed:        'Custom — warm',
    custom_recent_lapsed:      'Custom — warm',  // collapsed for display
    custom_cold_lapsed:        'Custom — cold',
    progressive_lapsed:        'Progressive — recent',
    progressive_cold_lapsed:   'Progressive — cold',
    newsletter_no_purchase:    'Newsletter only',
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
  };

  // ---------- DOM helpers ----------
  const $ = (id) => document.getElementById(id);
  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

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
      progressiveRes,
      customRes,
      migrationRes,
      sendsRes,
    ] = await Promise.all([
      sb.from('shopify_customers').select('*').order('email'),
      sb.from('progressive_members').select('email'),
      sb.from('custom_members').select('email'),
      sb.from('migration_customers').select('email, migration_status'),
      sb.from('outreach_sends').select('*').order('sent_at', { ascending: false }),
    ]);

    if (customersRes.error) {
      console.error('Failed to load shopify_customers', customersRes.error);
      $('customersBody').innerHTML = `<tr><td colspan="7" class="empty-state">
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
      // If a customer has multiple migration rows (e.g. Custom + Progressive),
      // keep the most "active" one. The migrated/signed_up statuses already
      // count as on AllPaddling via the members tables, so we only land here
      // for genuinely-pending statuses.
      const existing = inFlight.get(r.email.toLowerCase());
      if (!existing) inFlight.set(r.email.toLowerCase(), r.migration_status);
    });
    state.inFlightEmails = inFlight;

    // Per-customer sends history.
    const byCust = new Map();
    (sendsRes.data || []).forEach(s => {
      const arr = byCust.get(s.shopify_customer_id) || [];
      arr.push(s);
      byCust.set(s.shopify_customer_id, arr);
    });
    state.sendsByCustomerId = byCust;

    // Enrich customer rows with computed fields.
    const today = new Date();
    state.customers = (customersRes.data || []).map(c => {
      const email = (c.email || '').toLowerCase();
      const onAP = allpaddling.has(email);
      const inF  = inFlight.get(email) || null;
      const daysSince = c.last_order_date
        ? Math.floor((today - new Date(c.last_order_date)) / 86400000)
        : null;
      const sends = byCust.get(c.id) || [];
      const lastContact = sends.length > 0 ? sends[0].sent_at : null;
      return {
        ...c,
        _email_lc:         email,
        _on_allpaddling:   onAP,
        _in_flight_status: inF,
        _days_since_last:  daysSince,
        _segment:          computeSegment(c, daysSince),
        _last_contact:     lastContact,
        _send_count:       sends.length,
      };
    });
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
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No customers match the current filters.</td></tr>`;
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
        if (e.target.closest('input,button,a')) return;
        const cid = tr.dataset.id;
        state.expandedCustomerId = (state.expandedCustomerId === cid) ? null : cid;
        renderTable();
      });
    });
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
      ? `${c.last_order_date} <span class="ago">(${formatAgo(c._days_since_last)})</span>`
      : '<span class="ago">no orders</span>';

    const segLabel = SEGMENT_LABELS[c._segment] || c._segment;
    const consentChip = (c.shopify_marketing_consent === false)
      ? '<span class="pill consent-no" title="Shopify: Accepts Email Marketing = no">Opt-out</span>'
      : '';
    const apChip = c._on_allpaddling
      ? '<span class="pill ap-on">On AllPaddling</span>'
      : (c._in_flight_status
        ? `<span class="pill ap-flight" title="${escHtml(c._in_flight_status)}">Migration: ${escHtml(c._in_flight_status)}</span>`
        : '');
    const unsubChip = c.unsubscribed_at
      ? '<span class="pill unsub">Unsubscribed</span>'
      : '';

    const lastContactCell = c._last_contact
      ? `<span class="date-cell">${c._last_contact.slice(0,10)} <span class="ago">(${c._send_count})</span></span>`
      : '<span class="ago">never</span>';

    let html = `
      <tr class="row ${isLocked ? 'is-locked' : ''}" data-id="${c.id}">
        <td class="col-check"><input type="checkbox" class="row-check" data-id="${c.id}" ${checkboxAttrs}/></td>
        <td>
          <div class="customer-cell">
            <div class="name">${escHtml(name)}</div>
            <div class="email">${escHtml(c.email)}</div>
          </div>
        </td>
        <td class="num-cell">${spend}<br/><span class="ago" style="font-weight:400">${orders}</span></td>
        <td class="date-cell">${lastOrder}</td>
        <td><span class="pill seg-${c._segment}">${escHtml(segLabel)}</span></td>
        <td>${apChip} ${consentChip} ${unsubChip}</td>
        <td>${lastContactCell}</td>
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
          <span class="when">${s.sent_at.slice(0,10)}</span>
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
        <td colspan="7">
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
    const optOuts = recipients.filter(c => c.shopify_marketing_consent === false);

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
  // Compose modal
  // ============================================================
  function openCompose () {
    const ids = Array.from(state.selection);
    const recipients = state.customers.filter(c => ids.includes(c.id));
    if (recipients.length === 0) return;

    const optOuts = recipients.filter(c => c.shopify_marketing_consent === false);
    const alerts = $('composeAlerts');
    alerts.innerHTML = '';
    if (optOuts.length > 0) {
      alerts.innerHTML = `
        <div class="alert alert-warn">
          <strong>${optOuts.length} recipient${optOuts.length === 1 ? '' : 's'} declined email marketing in Shopify.</strong>
          You can still send, but check the box below to confirm.
          <div style="margin-top:0.5rem;">
            <label><input type="checkbox" id="confirmOptOut"/> I've confirmed I want to email these recipients anyway.</label>
          </div>
        </div>
      `;
    }

    $('recipientCount').textContent = recipients.length;
    $('recipientList').innerHTML = recipients.map(c => `
      <div class="recipient-row ${c.shopify_marketing_consent === false ? 'warn' : ''}">
        <span>${escHtml(c.first_name || '')} ${escHtml(c.last_name || '')} &lt;${escHtml(c.email)}&gt;</span>
        ${c.shopify_marketing_consent === false ? '<span>opt-out</span>' : ''}
      </div>
    `).join('');

    $('sendProgress').textContent = '';
    $('composeSendBtn').disabled = false;
    $('composeSendBtn').textContent = 'Send →';
    $('composeModal').style.display = 'flex';
    $('campaignName').focus();
  }

  function closeCompose () {
    $('composeModal').style.display = 'none';
  }

  async function onSend () {
    const campaignName = $('campaignName').value.trim();
    const subject      = $('emailSubject').value.trim();
    const body         = $('emailBody').value;

    if (!campaignName) { alert('Campaign name is required.'); $('campaignName').focus(); return; }
    if (!subject)      { alert('Subject is required.');      $('emailSubject').focus(); return; }
    if (!body.trim())  { alert('Body is required.');         $('emailBody').focus();    return; }

    const ids = Array.from(state.selection);
    const recipients = state.customers.filter(c => ids.includes(c.id));
    const optOuts = recipients.filter(c => c.shopify_marketing_consent === false);
    if (optOuts.length > 0) {
      const cb = $('confirmOptOut');
      if (!cb || !cb.checked) {
        alert('Confirm the opt-out checkbox before sending.');
        return;
      }
    }

    const sendBtn = $('composeSendBtn');
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending…';

    // Get coach JWT for the send-email call.
    const { data: { session } } = await sb.auth.getSession();
    const jwt = session?.access_token;
    if (!jwt) { alert('Not signed in — refresh and try again.'); return; }

    let okCount = 0, failCount = 0;
    const failures = [];

    for (let i = 0; i < recipients.length; i++) {
      const c = recipients[i];
      $('sendProgress').textContent = `Sending ${i + 1} of ${recipients.length}…`;
      try {
        const personalText = personalize(body, c) + UNSUB_FOOTER_TEXT;
        const personalHtml = textToHtml(personalize(body, c)) + UNSUB_FOOTER_HTML;
        const res = await fetch(SEND_EMAIL_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwt}`,
          },
          body: JSON.stringify({
            mode: 'raw',
            to: c.email,
            subject,
            text: personalText,
            html: personalHtml,
            tags: [
              { name: 'campaign',    value: campaignName.slice(0, 60).replace(/[^A-Za-z0-9_-]/g, '_') },
              { name: 'kind',        value: 'outreach' },
            ],
          }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          failCount++;
          failures.push(`${c.email}: ${payload.error || res.status}`);
          await logSend(c, campaignName, subject, personalText, personalHtml, 'failed', null, payload.error || `HTTP ${res.status}`);
        } else {
          okCount++;
          await logSend(c, campaignName, subject, personalText, personalHtml, 'sent', payload.id, null);
        }
      } catch (err) {
        failCount++;
        failures.push(`${c.email}: ${err.message}`);
        try {
          await logSend(c, campaignName, subject, body, body, 'failed', null, err.message);
        } catch (_) { /* ignore */ }
      }
    }

    $('sendProgress').textContent = `Done — ${okCount} sent, ${failCount} failed.`;
    sendBtn.textContent = (failCount === 0) ? 'Sent ✓' : 'Done (with errors)';

    if (failures.length > 0) {
      const al = document.createElement('div');
      al.className = 'alert alert-warn';
      al.innerHTML = `<strong>Failures:</strong><br/>${failures.map(escHtml).join('<br/>')}`;
      $('composeAlerts').appendChild(al);
    } else {
      const al = document.createElement('div');
      al.className = 'alert alert-ok';
      al.textContent = `All ${okCount} emails accepted by Resend.`;
      $('composeAlerts').appendChild(al);
    }

    // Refresh sends so the per-customer history + last-contact column update.
    await refreshSends();
    state.selection.clear();
    render();
  }

  function personalize (body, c) {
    return body
      .replace(/\{\{first_name\}\}/g, c.first_name || 'there')
      .replace(/\{\{last_name\}\}/g,  c.last_name  || '')
      .replace(/\{\{email\}\}/g,      c.email      || '');
  }

  function textToHtml (text) {
    // Minimal: escape HTML, convert newlines to <br/>.
    return escHtml(text).replace(/\n/g, '<br/>');
  }

  async function logSend (customer, campaignName, subject, bodyText, bodyHtml, status, resendId, error) {
    const row = {
      shopify_customer_id: customer.id,
      recipient_email:     customer.email,
      campaign_name:       campaignName,
      subject,
      body_text:           bodyText,
      body_html:           bodyHtml,
      status,
      resend_id:           resendId,
      error,
      sent_by:             state.adminEmail,
    };
    const { error: insErr } = await sb.from('outreach_sends').insert(row);
    if (insErr) console.error('Failed to log outreach_send', insErr);
  }

  async function refreshSends () {
    const { data, error } = await sb.from('outreach_sends').select('*').order('sent_at', { ascending: false });
    if (error) { console.error(error); return; }
    const byCust = new Map();
    (data || []).forEach(s => {
      const arr = byCust.get(s.shopify_customer_id) || [];
      arr.push(s);
      byCust.set(s.shopify_customer_id, arr);
    });
    state.sendsByCustomerId = byCust;
    state.customers.forEach(c => {
      const sends = byCust.get(c.id) || [];
      c._last_contact = sends.length > 0 ? sends[0].sent_at : null;
      c._send_count = sends.length;
    });
  }

  // ============================================================
  // Unsubscribe toggle (from history drawer)
  // ============================================================
  async function setUnsubscribed (customerId, unsubscribed) {
    const update = unsubscribed
      ? { unsubscribed_at: new Date().toISOString(), unsubscribe_reason: 'manual (coach)' }
      : { unsubscribed_at: null, unsubscribe_reason: null };
    const { error } = await sb.from('shopify_customers').update(update).eq('id', customerId);
    if (error) {
      alert('Failed: ' + error.message);
      return;
    }
    const c = state.customers.find(x => x.id === customerId);
    if (c) {
      c.unsubscribed_at = update.unsubscribed_at;
      c.unsubscribe_reason = update.unsubscribe_reason;
    }
    render();
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
        <td class="date-cell">${r.next_renewal ? r.next_renewal.slice(0,10) : '—'}</td>
        <td class="date-cell">${r.status_updated_at ? r.status_updated_at.slice(0,10) : '—'}</td>
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
        $('pane-outreach').hidden = (pane !== 'outreach');
        $('pane-archive').hidden  = (pane !== 'archive');
        if (pane === 'archive') loadArchive();
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
      renderTable();
      renderSelection();
    });
    $('composeBtn').addEventListener('click', openCompose);

    // Compose modal
    $('composeCloseBtn').addEventListener('click', closeCompose);
    $('composeCancelBtn').addEventListener('click', closeCompose);
    $('composeSendBtn').addEventListener('click', onSend);

    // Drawer actions (event-delegation on tbody for unsubscribe buttons)
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.act === 'unsub-set')   setUnsubscribed(id, true);
      if (btn.dataset.act === 'unsub-clear') setUnsubscribed(id, false);
    });
  }

  // ---------- Public API ----------
  window.OutreachPage = { init };
})();
