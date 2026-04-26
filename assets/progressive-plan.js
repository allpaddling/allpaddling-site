/* ============================================================
   progressive-plan.js — shared template + per-discipline copy
   for the four Progressive plan pages.

   Replaces the duplicated markup that previously lived in each of:
     plan-prone.html, plan-sup.html, plan-oc.html, plan-ski.html

   Each of those pages is now a thin shell that:
     1. Sets its own <title> and <meta description> (preserved
        for SEO so crawlers see the right metadata even before JS
        runs).
     2. Loads this script.
     3. Calls renderProgressivePlanPage('<key>').

   To change copy for a discipline: edit DISCIPLINE_COPY below.
   To change page structure: edit progressivePlanPageHTML().
   ============================================================ */

const DISCIPLINE_COPY = {
  prone: {
    title:           'Prone Paddle Board Plan — All Paddling',
    metaDescription: 'Progressive 4-week training plan for prone paddlers. Up to 4 paddle-specific sessions a week, 5-zone pace targets, cancel anytime — $80 AUD / 4 weeks.',
    h1:              'Prone Paddle Board Plan',
    lead:            'A self-guided 4-week training block built for the prone stroke. Up to 4 paddle-specific sessions a week — 3 intervals plus 1 longer steady — with 5-zone pace targets and week-over-week progression. No race required.',
    subscribeHeading: 'Start your Prone block',
    week1Desc:       'Establish aerobic rhythm on the prone board. Introduce threshold-zone intervals at controlled volume.',
    week2Desc:       'More reps at threshold, longer distance session. Teach your prone stroke to hold form under load.',
    sessionTitle:    'Sessions built around the prone stroke.',
    session1Desc:    'Structured reps in TZ3–TZ4 with measured recovery. Every interval has a prescribed pace range calculated from your threshold pace — no guesswork on the board.',
    session2Desc:    'A longer TZ2 session to build aerobic capacity and groove your prone stroke under fatigue. The work that makes everything else stick.',
    fitH3:           'Progressive Prone Plan fits if…',
    fitFirstItem:    'You paddle prone and can go 60+ minutes comfortably',
  },
  sup: {
    title:           'Stand Up Paddle Board Plan — All Paddling',
    metaDescription: 'Progressive 4-week training plan for stand up paddlers. Up to 4 paddle-specific sessions a week, 5-zone pace targets, cancel anytime — $80 AUD / 4 weeks.',
    h1:              'Stand Up Paddle Board Plan',
    lead:            'A self-guided 4-week training block built for SUP. Up to 4 paddle-specific sessions a week — 3 intervals plus 1 longer steady — with 5-zone pace targets and week-over-week progression. Balance, stroke efficiency, and aerobic engine — all sharpened.',
    subscribeHeading: 'Start your SUP block',
    week1Desc:       'Establish aerobic rhythm on the board. Introduce threshold-zone intervals at controlled volume.',
    week2Desc:       'More reps at threshold, longer distance session. Teach your SUP stroke to hold form under load.',
    sessionTitle:    'Sessions built around the SUP stroke.',
    session1Desc:    'Structured reps in TZ3–TZ4 with measured recovery. Every interval has a prescribed pace range calculated from your threshold pace — stay stable, drive the blade.',
    session2Desc:    'A longer TZ2 session to build aerobic capacity and groove your SUP stroke under fatigue. The work that makes everything else stick.',
    fitH3:           'Progressive SUP Plan fits if…',
    fitFirstItem:    'You paddle SUP and can go 60+ minutes comfortably',
  },
  oc: {
    title:           'Outrigger Canoe Plan — All Paddling',
    metaDescription: 'Progressive 4-week training plan for outrigger canoe paddlers. Up to 4 paddle-specific sessions a week, 5-zone pace targets, cancel anytime — $80 AUD / 4 weeks.',
    h1:              'Outrigger Canoe Plan',
    lead:            'A self-guided 4-week training block built for the outrigger canoe stroke. Up to 4 paddle-specific sessions a week — 3 intervals plus 1 longer steady — with 5-zone pace targets and week-over-week progression. Rhythm, change sides, power through the catch.',
    subscribeHeading: 'Start your OC block',
    week1Desc:       'Establish aerobic rhythm in the canoe. Introduce threshold-zone intervals at controlled volume, even on both sides.',
    week2Desc:       'More reps at threshold, longer distance session. Teach your OC stroke to hold form under load — both sides.',
    sessionTitle:    'Sessions built around the OC stroke.',
    session1Desc:    'Structured reps in TZ3–TZ4 with measured recovery. Every interval has a prescribed pace range calculated from your threshold pace — drive the catch, rotate, change evenly.',
    session2Desc:    'A longer TZ2 session to build aerobic capacity and groove your OC stroke under fatigue. The work that makes everything else stick.',
    fitH3:           'Progressive OC Plan fits if…',
    fitFirstItem:    'You paddle OC1 or OC6 and can go 60+ minutes comfortably',
  },
  ski: {
    title:           'Surf Ski Plan — All Paddling',
    metaDescription: 'Progressive 4-week training plan for surf ski paddlers. Up to 4 paddle-specific sessions a week, 5-zone pace targets, cancel anytime — $80 AUD / 4 weeks.',
    h1:              'Surf Ski Plan',
    lead:            'A self-guided 4-week training block built for surf ski. Up to 4 paddle-specific sessions a week — 3 intervals plus 1 longer steady — with 5-zone pace targets and week-over-week progression. Rotation, catch power, and the aerobic engine that lets you chase runners.',
    subscribeHeading: 'Start your Surf Ski block',
    week1Desc:       'Establish aerobic rhythm in the ski. Introduce threshold-zone intervals at controlled volume.',
    week2Desc:       'More reps at threshold, longer distance session. Teach your ski stroke to hold rotation and catch under load.',
    sessionTitle:    'Sessions built around the ski stroke.',
    session1Desc:    'Structured reps in TZ3–TZ4 with measured recovery. Every interval has a prescribed pace range calculated from your threshold pace — rotate hard, hold the catch, drive through.',
    session2Desc:    'A longer TZ2 session to build aerobic capacity and groove your ski stroke under fatigue. Ideal flat-water work if you’re not chasing runners that day.',
    fitH3:           'Progressive Surf Ski Plan fits if…',
    fitFirstItem:    'You paddle surf ski and can go 60+ minutes comfortably',
  },
};

/* Escape user-controlled text before injecting into HTML.
   The DISCIPLINE_COPY object is author-controlled (lives in
   this file), so escaping is mostly a defence-in-depth measure
   in case copy fields ever come from a less trusted source. */
function escapeHTML (s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function progressivePlanPageHTML (copy) {
  const e = escapeHTML;
  return `
<section class="page-hero">
  <div class="container">
    <div class="plan-hero">
      <div>
        <span class="eyebrow-pill">Progressive 4-Week Plan</span>
        <h1>${e(copy.h1)}</h1>
        <p class="lead">${e(copy.lead)}</p>

        <div class="plan-stats">
          <div class="plan-stat">
            <div class="plan-stat-label">Sessions / week</div>
            <div class="plan-stat-value">Up to 4</div>
          </div>
          <div class="plan-stat">
            <div class="plan-stat-label">Block length</div>
            <div class="plan-stat-value">4 weeks</div>
          </div>
          <div class="plan-stat">
            <div class="plan-stat-label">Commitment</div>
            <div class="plan-stat-value">None — cancel anytime</div>
          </div>
        </div>

        <p style="color: var(--text-3); font-size: 0.92rem; margin-bottom: 0;">
          Already know your threshold? Run our <a href="pace-calculator.html">free pace calculator</a> to see what your first week will look like.
        </p>
      </div>

      <aside class="subscribe-card">
        <div class="price-row">
          <span class="amount">$80</span>
          <span class="period">AUD / 4 weeks</span>
        </div>
        <span class="cancel-tag">Cancel anytime — no lock-in</span>
        <h3>${e(copy.subscribeHeading)}</h3>
        <p style="font-size: 0.88rem; color: var(--text-2); margin-bottom: 1rem;">Billed every 4 weeks at $80 AUD. Pause, skip, or cancel at the end of any cycle.</p>
        <button class="btn btn-primary btn-full" onclick="alert('Checkout coming soon — this will connect to the new member signup flow.');">
          Subscribe &amp; Start
        </button>
        <p class="sub-note">By subscribing, you authorise recurring 4-weekly charges until cancelled.</p>
      </aside>
    </div>
  </div>
</section>

<section class="panel alt">
  <div class="container">
    <div class="section-eyebrow">Inside the 4-week block</div>
    <h2 class="section-title">A progression, not a pile of sessions.</h2>
    <p class="section-sub">Each week builds on the last. Volume and intensity step up, then pull back in week 4 so you can retest and see the work pay off.</p>

    <div class="week-strip">
      <div class="week-block">
        <div class="week-num">Week 1</div>
        <h4>Build your base</h4>
        <p>${e(copy.week1Desc)}</p>
        <div class="focus-line">
          <span class="focus-mini f-z2">AEROBIC</span>
          <span class="focus-mini f-z3">THRESHOLD</span>
        </div>
      </div>
      <div class="week-block">
        <div class="week-num">Week 2</div>
        <h4>Add volume</h4>
        <p>${e(copy.week2Desc)}</p>
        <div class="focus-line">
          <span class="focus-mini f-z2">AEROBIC</span>
          <span class="focus-mini f-z3">THRESHOLD</span>
        </div>
      </div>
      <div class="week-block">
        <div class="week-num">Week 3</div>
        <h4>Sharpen</h4>
        <p>Shift intensity toward TZ4. Shorter rest, faster efforts — build the top end of your aerobic engine.</p>
        <div class="focus-line">
          <span class="focus-mini f-z3">THRESHOLD</span>
          <span class="focus-mini f-z4">VO₂MAX</span>
        </div>
      </div>
      <div class="week-block">
        <div class="week-num">Week 4</div>
        <h4>Recover &amp; retest</h4>
        <p>Volume drops. A 3-minute threshold test tells you exactly how much faster you got.</p>
        <div class="focus-line">
          <span class="focus-mini f-z2">AEROBIC</span>
          <span class="focus-mini f-z5">TEST</span>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="panel">
  <div class="container">
    <div class="section-eyebrow">A typical week</div>
    <h2 class="section-title">${e(copy.sessionTitle)}</h2>
    <p class="section-sub">Up to 4 sessions a week — 3 interval sessions tuned to different energy systems, plus 1 longer steady-distance paddle to build capacity. All prescribed in your own pace zones.</p>

    <div class="snapshot-grid">
      <div class="snapshot-card">
        <div class="session-label">Intervals · 3 sessions</div>
        <h4>Threshold + capacity work</h4>
        <p>${e(copy.session1Desc)}</p>
      </div>
      <div class="snapshot-card">
        <div class="session-label">Long steady · 1 session</div>
        <h4>Aerobic distance paddle</h4>
        <p>${e(copy.session2Desc)}</p>
      </div>
    </div>
  </div>
</section>

<section class="panel alt">
  <div class="container">
    <div class="section-eyebrow">Is this the right plan?</div>
    <h2 class="section-title">Self-guided progression vs. a full season build.</h2>
    <p class="section-sub">The Progressive Plan is a solid 4-week block on its own. For race-specific periodisation, taper, peaking, and one-on-one consultation, move up to the Custom Season Race Plan.</p>

    <div class="fit-grid">
      <div class="fit-card positive">
        <h3>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20,6 9,17 4,12"/></svg>
          ${e(copy.fitH3)}
        </h3>
        <ul>
          <li>${e(copy.fitFirstItem)}</li>
          <li>You want structure without a specific goal race</li>
          <li>You'd like up to 4 prescribed sessions a week and the freedom to cancel anytime</li>
          <li>You'd rather start self-guided and see how you go</li>
        </ul>
      </div>
      <div class="fit-card neutral">
        <h3>Move up to Custom if…</h3>
        <ul>
          <li>You have a specific goal race on the calendar</li>
          <li>You want taper and peaking weeks programmed in</li>
          <li>You'd like a dryland strength program alongside the water work</li>
          <li>You want a one-on-one consultation shaping your season</li>
        </ul>
        <a href="custom-plan.html" class="fit-cta">See the Custom Plan →</a>
      </div>
    </div>
  </div>
</section>

<section class="panel">
  <div class="container" style="max-width: 860px;">
    <div class="section-eyebrow">Common questions</div>
    <h2 class="section-title">Good to know.</h2>

    <details class="faq-item" open>
      <summary>Do I need to know my threshold pace to start?</summary>
      <p>It helps. The fastest way to find it is a 3-minute test — paddle as hard as you can sustain for three continuous minutes, and use the resulting pace as your threshold. Our <a href="pace-calculator.html">pace calculator</a> then gives you every zone target.</p>
    </details>
    <details class="faq-item">
      <summary>How many sessions per week?</summary>
      <p>Up to 4 structured sessions a week — typically 3 interval sessions targeting different energy systems plus 1 longer steady-distance paddle. You can paddle as few or as many of them as your schedule allows, and add your own easy paddling around the prescribed work.</p>
    </details>
    <details class="faq-item">
      <summary>What happens after the 4 weeks?</summary>
      <p>Your subscription renews for another 4-week block at the next progression level. You retest your threshold, your zones update, and the sessions adjust accordingly. Or cancel — no questions asked.</p>
    </details>
    <details class="faq-item">
      <summary>Can I switch disciplines later?</summary>
      <p>Yes. You can switch between Prone, SUP, Outrigger Canoe, and Surf Ski from your member settings. The 4-week cycle stays the same.</p>
    </details>
    <details class="faq-item">
      <summary>Why pick Progressive over Custom?</summary>
      <p>If you don't have a goal race you're building toward, a Progressive block gives you real structure without the commitment. You can always move up to the Custom Plan later when a race is on the calendar.</p>
    </details>
  </div>
</section>`;
}

/* Public entrypoint. Call from each plan-<key>.html with the
   discipline key. Looks up copy, sets document title (the HTML
   <title> is the SEO source-of-truth — this is just to keep the
   tab title aligned if anything ever changes the body content
   dynamically), and injects the rendered template.

   If `key` is unknown, falls back to 'prone' and warns to console
   so the page still renders something rather than blanking. */
function renderProgressivePlanPage (key) {
  let copy = DISCIPLINE_COPY[key];
  if (!copy) {
    console.warn(`progressive-plan.js: unknown discipline key "${key}", falling back to "prone"`);
    copy = DISCIPLINE_COPY.prone;
  }

  // Keep document.title aligned (HTML <title> already set by the page).
  if (typeof document !== 'undefined') {
    document.title = copy.title;
    const target = document.getElementById('plan-page');
    if (target) {
      target.innerHTML = progressivePlanPageHTML(copy);
    } else {
      console.error('progressive-plan.js: <main id="plan-page"> placeholder not found');
    }
  }
}
