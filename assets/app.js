/* ============================================================
   ALL PADDLING — member area chrome
   Renders the sidebar + mobile header into every /app/ page.
   Each app page has <div id="app-sidebar"></div> and
   <div id="app-mobile-header"></div> placeholders.
   Also exposes MOCK_MEMBER and a tiny localStorage state stub
   that will later be swapped for Memberstack custom fields.
   ============================================================ */

/* ---- Mock member (stand-in until Memberstack is wired up) ---- */
const MOCK_MEMBER = {
  name: 'Jake Di Betta',
  email: 'jakedibetta@gmail.com',
  plan: 'Progressive',        // 'Progressive' | 'Custom'
  discipline: 'Prone',        // 'Prone' | 'SUP' | 'Ski' | 'Outrigger'
  currentProgram: 1,          // 1..3 for the 12-week block
  currentWeek: 1,             // 1..4 within the current program
  joinedAt: '2026-03-30',
};

/* ---- Nav links ---- */
const APP_NAV_LINKS = [
  {
    href: 'dashboard.html',
    label: 'Dashboard',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  },
  {
    href: 'getting-started.html',
    label: 'Getting started',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  },
  {
    href: 'program.html',
    label: 'Current Program',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  },
  {
    href: 'strength.html',
    label: 'Strength Program',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5 17.5 17.5"/><path d="m21 21-1-1"/><path d="m3 3 1 1"/><path d="m18 22 4-4"/><path d="m2 6 4-4"/><path d="m3 10 7-7"/><path d="m14 21 7-7"/></svg>`,
  },
  {
    href: 'threshold.html',
    label: 'Threshold pace',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/><path d="M12 5V2"/></svg>`,
  },
  {
    href: 'history.html',
    label: 'History',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>`,
  },
];

const APP_FOOTER_NAV = [
  {
    href: '#',
    label: 'Send feedback',
    action: 'feedback',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  },
  {
    href: 'settings.html',
    label: 'Settings',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  },
  {
    href: '../index.html',
    label: 'View public site',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  },
  {
    href: '../login.html',
    label: 'Sign out',
    action: 'signout',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  },
];

const APP_BRAND_MARK = `
  <span class="brand-mark-sm" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" fill="currentColor" stroke="none"/>
      <polyline points="3,13 8,13 10,9 14,17 16,13 21,13" stroke="#155e75" stroke-width="2.4" fill="none"/>
    </svg>
  </span>`;

/* ---- Helpers ---- */
function initials(name) {
  return (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

function currentAppPage() {
  let p = window.location.pathname;
  if (p === '' || p.endsWith('/')) p = p + 'dashboard.html';
  const file = p.split('/').pop();
  return file || 'dashboard.html';
}

function filterLinks(links, member) {
  return links.filter(l => !l.customOnly || member.plan === 'Custom');
}

function linkHtml(l, active) {
  const actionAttr = l.action ? ` data-action="${l.action}"` : '';
  return `<a href="${l.href}"${active ? ' class="active"' : ''}${actionAttr}>${l.icon}<span>${l.label}</span></a>`;
}

/* ---- Renderers ---- */
function renderSidebar(member) {
  const here = currentAppPage();
  const mainLinks = filterLinks(APP_NAV_LINKS, member)
    .map(l => linkHtml(l, l.href === here))
    .join('');
  const footerLinks = APP_FOOTER_NAV
    .map(l => linkHtml(l, l.href === here))
    .join('');

  return `
    <aside class="app-sidebar" id="app-sidebar-el" aria-label="Member navigation">
      <div class="app-sidebar-brand">
        ${APP_BRAND_MARK}
        <span class="brand-text">
          All Paddling
          <small>Member area<span class="coach-mode-badge coach-only">Member view</span></small>
        </span>
      </div>
      <nav class="app-sidebar-nav">
        ${mainLinks}
      </nav>
      <div class="app-sidebar-footer">
        <a href="admin.html" class="role-switch-btn coach-only" aria-label="Switch to Coach Admin">
          <span>Coach Admin</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/></svg>
        </a>
        <div class="app-member-chip">
          <div class="app-member-avatar">${initials(member.name)}</div>
          <div class="app-member-meta">
            <div class="name">${member.name}</div>
            <div class="plan">${member.plan} · ${member.discipline}</div>
          </div>
        </div>
        ${footerLinks}
      </div>
    </aside>`;
}

function renderMobileHeader(member) {
  return `
    <div class="app-mobile-header">
      <button class="app-menu-toggle" id="app-menu-toggle" aria-label="Open menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
      <div style="display:flex;align-items:center;gap:0.5rem;">
        ${APP_BRAND_MARK}
        <strong style="font-family:'Space Grotesk',sans-serif;">All Paddling</strong>
      </div>
    </div>`;
}

/* ---- Member state (localStorage stub) ---- */
const STATE_KEY = 'ap.memberState';

function defaultState() {
  return {
    thresholdSec: 330,          // 5:30 / km default (Z3 threshold)
    unit: 'metric',             // 'metric' | 'imperial'
    discipline: 'Prone',        // 'Prone' | 'SUP' | 'Ski' | 'Outrigger'
    completedSessions: {},      // { 'p1w1s1': true, ... }
    sessionNotes: {},           // { 'p1w1s1': { rpe: 7, note: '...' } }
    thresholdHistory: [],       // [{ at: '2026-04-24', thresholdSec: 330 }]
    lastVisited: null,
  };
}

/* ============================================================
   Preview-mode state cache
   ----------------------------------------------------------------
   The training-state functions below (loadMemberState/saveMemberState,
   plus the Supabase mirror pushers) are the source of truth for
   threshold pace, completed sessions, and RPE/notes on every
   member-facing page. Pre-2026-05-26 they always read from the
   COACH'S OWN localStorage even when "Preview as Member" was on —
   so Mick would see Kanesa's plan rendered against his own ticks
   and threshold (the original preview-mode bug).
   The fix: when preview mode is active, each page calls
   ensurePreviewStateLoaded() once at boot, which fetches the
   previewed member's threshold_log + session_completions rows from
   Supabase and assembles a synthetic state object identical in
   shape to defaultState(). loadMemberState() returns that cache
   instead of localStorage; saveMemberState() mutates the cache
   in-memory only (no localStorage write, no Supabase push). All
   three push helpers + backfillEngagementOnce() bail out when
   preview is active so Mick can't accidentally pollute Kanesa's
   history by ticking a session while previewing.
   The cache is cleared on every ensurePreviewStateLoaded() call,
   so toggling preview off and back on always pulls fresh.
   ============================================================ */
let _previewStateCache = null;

/* Deep-clone helper — keeps loadMemberState's contract of returning
   a fresh object on each call, so existing call sites that mutate
   the returned object don't accidentally mutate the shared cache. */
function _cloneState (s) {
  try { return JSON.parse(JSON.stringify(s)); }
  catch (e) { return { ...defaultState(), ...(s || {}) }; }
}

/* Called once at the top of each member-facing page's boot IIFE,
   after the auth gate. No-op when preview mode is off. When on,
   loads the previewed member's Supabase rows into _previewStateCache
   and returns it. Pages don't need to use the return value — every
   subsequent loadMemberState() call will pick the cache up. */
async function ensurePreviewStateLoaded () {
  _previewStateCache = null;
  try {
    if (typeof getPreviewContext !== 'function') return null;
    const ctx = await getPreviewContext();
    if (!ctx || !ctx.isPreview || !ctx.previewMember) return null;

    const authUserId = ctx.previewMember.authUserId;
    if (!authUserId) {
      // Member hasn't signed in yet — no rows to fetch. Use defaults
      // so the page renders cleanly instead of falling through to the
      // coach's localStorage.
      const seed = defaultState();
      if (ctx.previewMember.type === 'progressive' && ctx.previewMember.planKey) {
        const PLAN_KEY_TO_DISC = { prone: 'Prone', sup: 'SUP', oc: 'OC', ski: 'Ski' };
        seed.discipline = PLAN_KEY_TO_DISC[ctx.previewMember.planKey] || 'Prone';
      }
      _previewStateCache = seed;
      return seed;
    }

    const [thrRes, scRes] = await Promise.all([
      sb.from('threshold_log')
        .select('threshold_sec, unit, recorded_at')
        .eq('user_id', authUserId)
        .order('recorded_at', { ascending: true }),
      sb.from('session_completions')
        .select('session_key, plan_key, completed_at, rpe, note')
        .eq('user_id', authUserId),
    ]);

    const thr = (thrRes && thrRes.data) || [];
    const sc  = (scRes  && scRes.data)  || [];
    const latest = thr[thr.length - 1];

    const state = defaultState();
    if (latest) {
      state.thresholdSec = latest.threshold_sec || state.thresholdSec;
      state.unit         = (latest.unit === 'imperial' || latest.unit === 'metric')
        ? latest.unit : state.unit;
    }
    state.thresholdHistory = thr.map(r => ({
      at:           r.recorded_at,
      thresholdSec: r.threshold_sec,
      unit:         r.unit,
    }));

    for (const r of sc) {
      if (!r || !r.session_key) continue;
      state.completedSessions[r.session_key] = true;
      const noteObj = {};
      if (r.rpe != null)         noteObj.rpe = r.rpe;
      if (r.note)                noteObj.note = r.note;
      if (r.completed_at)        noteObj.completedAt = r.completed_at;
      if (Object.keys(noteObj).length) {
        state.sessionNotes[r.session_key] = noteObj;
      }
    }

    if (ctx.previewMember.type === 'progressive' && ctx.previewMember.planKey) {
      const PLAN_KEY_TO_DISC = { prone: 'Prone', sup: 'SUP', oc: 'OC', ski: 'Ski' };
      state.discipline = PLAN_KEY_TO_DISC[ctx.previewMember.planKey] || state.discipline;
    }

    _previewStateCache = state;
    return state;
  } catch (e) {
    console.warn('ensurePreviewStateLoaded failed (non-fatal):', e);
    _previewStateCache = null;
    return null;
  }
}

/* ============================================================
   Cross-device hydration — pull the SIGNED-IN member's own training
   state (completed sessions, RPE/notes, threshold history) down from
   Supabase into localStorage on page load, so an update made on one
   device shows up on every other device.

   Why this is needed: completed sessions + threshold live in
   localStorage (the original "stub") and are *mirrored* to Supabase on
   every write (session_completions / threshold_log) for the coach's
   engagement view. But the member's own read path (loadMemberState)
   only ever read localStorage — so a tick on the phone never appeared
   on the desktop. This seeds localStorage from the server before the
   page renders. It is the member-facing twin of
   ensurePreviewStateLoaded() (which does the same for a coach
   previewing a member).

   Source-of-truth model: the SERVER is authoritative for the set of
   completions, so a cross-device *un-tick* (delete) propagates too. To
   avoid dropping a local-only row that never reached the server (e.g. a
   mirror write that failed offline), we await the idempotent backfill
   push first — it uploads any such rows before we pull them back down.

   No-op while previewing (preview is read-only and owned by
   ensurePreviewStateLoaded) and when signed out (local-only mode).
   Never throws — on any failure the page falls back to localStorage. */
async function ensureMemberStateHydrated () {
  // Preview is the coach's read-only view of a member — handled by
  // ensurePreviewStateLoaded(). Never hydrate over it here.
  if (_isPreviewActiveSync()) return;
  try {
    const userId = await _getEngagementUserId();
    if (!userId) return; // signed out → stay in local-only mode

    // Push any local-only ticks/threshold up first (idempotent, flag-
    // guarded). Guarantees the server-authoritative pull below can't drop
    // a row that was logged on this device but never mirrored.
    await backfillEngagementOnce();

    const [thrRes, scRes] = await Promise.all([
      sb.from('threshold_log')
        .select('threshold_sec, unit, recorded_at')
        .eq('user_id', userId)
        .order('recorded_at', { ascending: true }),
      sb.from('session_completions')
        .select('session_key, completed_at, rpe, note')
        .eq('user_id', userId),
    ]);

    // Start from current local state so device-side prefs not represented
    // server-side (e.g. discipline) survive the hydrate.
    let state;
    try {
      const raw = localStorage.getItem(STATE_KEY);
      state = raw ? { ...defaultState(), ...JSON.parse(raw) } : defaultState();
    } catch (_) { state = defaultState(); }

    let changed = false;

    // Completed sessions + notes — server authoritative (so un-ticks sync).
    // Only overwrite if the fetch succeeded; a failed query must not wipe
    // the member's local ticks.
    if (!scRes.error && Array.isArray(scRes.data)) {
      const completedSessions = {};
      const sessionNotes = {};
      for (const r of scRes.data) {
        if (!r || !r.session_key) continue;
        completedSessions[r.session_key] = true;
        const noteObj = {};
        if (r.rpe != null)  noteObj.rpe = r.rpe;
        if (r.note)         noteObj.note = r.note;
        if (r.completed_at) noteObj.completedAt = r.completed_at;
        if (Object.keys(noteObj).length) sessionNotes[r.session_key] = noteObj;
      }
      state.completedSessions = completedSessions;
      state.sessionNotes = sessionNotes;
      changed = true;
    }

    // Threshold history + latest threshold/unit — server authoritative.
    if (!thrRes.error && Array.isArray(thrRes.data)) {
      const thr = thrRes.data;
      state.thresholdHistory = thr.map(r => ({
        at: r.recorded_at, thresholdSec: r.threshold_sec, unit: r.unit,
      }));
      const latest = thr[thr.length - 1];
      if (latest) {
        if (latest.threshold_sec) state.thresholdSec = latest.threshold_sec;
        if (latest.unit === 'metric' || latest.unit === 'imperial') state.unit = latest.unit;
      }
      changed = true;
    }

    // Persist so loadMemberState() (which reads localStorage) returns
    // server truth on this device from here on.
    if (changed) {
      try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (_) {}
    }
  } catch (e) {
    // Never break the page on hydration — fall back to localStorage.
    console.warn('ensureMemberStateHydrated failed (non-fatal):', e);
  }
}

/* Sync helper for write-side guards. Returns true when preview is
   active *right now*, based on the sessionStorage flag — used by
   the Supabase push helpers below to refuse to write while in
   preview without needing to be async. */
function _isPreviewActiveSync () {
  try {
    if (typeof getPreviewMemberIdRaw === 'function') {
      return !!getPreviewMemberIdRaw();
    }
    return !!sessionStorage.getItem('viewAsMemberId');
  } catch (_) { return false; }
}

function loadMemberState() {
  // Preview mode: serve the cached previewed-member state instead of
  // the coach's localStorage. ensurePreviewStateLoaded() must have
  // been awaited by the page boot for this to be populated.
  if (_previewStateCache) return _cloneState(_previewStateCache);
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch (e) {
    return defaultState();
  }
}

/* One-shot migration: session-completion keys went from legacy
   "p1w2s3" (no discipline) to "{planKey}-w{n}s{n}" in Phase B.
   We wipe the legacy keys rather than guessing which discipline
   they belonged to — these were pre-launch test stamps. */
(function migrateLegacySessionKeys () {
  const FLAG = 'ap.sessionKeysMigrated_v2';
  try {
    if (localStorage.getItem(FLAG)) return;
    const state = loadMemberState();
    const legacyRe = /^p\d+w\d+s\d+$/;
    let touched = false;
    if (state.completedSessions) {
      Object.keys(state.completedSessions).forEach(k => {
        if (legacyRe.test(k)) {
          delete state.completedSessions[k];
          if (state.sessionNotes && state.sessionNotes[k]) delete state.sessionNotes[k];
          touched = true;
        }
      });
    }
    if (touched) saveMemberState(state);
    localStorage.setItem(FLAG, '1');
  } catch (e) { /* best-effort; never break the page on this */ }
})();

/* Convert a stored discipline label to the plan key format used in
   session keys. Mirrors disciplineToPlanKey in published-plans.js so
   we can compute the key without depending on that file's load order. */
function disciplinePlanKey (d) {
  switch ((d || '').toString().toLowerCase()) {
    case 'sup':       return 'sup';
    case 'ski':       return 'ski';
    case 'oc':
    case 'outrigger': return 'oc';
    case 'prone':     return 'prone';
    default:          return 'prone';
  }
}

function saveMemberState(state) {
  // Preview mode: update the in-memory cache so the UI stays responsive
  // if Mick fiddles with controls, but do NOT touch localStorage or
  // mirror to Supabase. Preview is read-only by design.
  if (_previewStateCache) {
    _previewStateCache = _cloneState(state);
    return;
  }
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (e) {
    /* ignore */
  }
}

/* ---- Combined view: member + state (source of truth for any page) ---- */
function getMember() {
  const s = loadMemberState();
  return {
    ...MOCK_MEMBER,
    discipline: s.discipline || MOCK_MEMBER.discipline,
  };
}

/* ============================================================================
   Engagement tracking — mirror localStorage writes to Supabase so the coach
   admin can see who's actually doing the training. Two tables introduced in
   migration 023 (threshold_log + session_completions). All helpers fail
   silently when there's no session or sb isn't loaded — public pages and
   logged-out states should never break.
   ============================================================================ */

const ENGAGEMENT_BACKFILL_FLAG = 'ap.engagementBackfilled_v1';

async function _getEngagementUserId () {
  try {
    if (typeof sb === 'undefined' || !sb || !sb.auth) return null;
    const { data: { session } } = await sb.auth.getSession();
    return session?.user?.id || null;
  } catch { return null; }
}

/* Insert a row into threshold_log. Called from threshold.html when the
   member commits a change. Source defaults to 'manual'. */
async function pushThresholdToServer (thresholdSec, unit, source) {
  // Refuse writes while previewing — preview is read-only.
  if (_isPreviewActiveSync()) return;
  const userId = await _getEngagementUserId();
  if (!userId) return; // not signed in — local-only mode
  if (!Number.isFinite(thresholdSec) || thresholdSec <= 0 || thresholdSec >= 3600) return;
  if (unit !== 'metric' && unit !== 'imperial') return;
  try {
    const { error } = await sb.from('threshold_log').insert({
      user_id:       userId,
      threshold_sec: Math.round(thresholdSec),
      unit:          unit,
      source:        source || 'manual',
    });
    if (error) console.warn('threshold_log insert failed', error);
  } catch (e) { console.warn('threshold_log insert exception', e); }
}

/* Upsert (when completedNow=true) or delete (when false) a session_completions
   row. session.html calls this on every toggle of the Mark Complete button. */
async function pushSessionCompletionToServer (planKey, sessionKey, completedNow, rpe, note, meta) {
  // Refuse writes while previewing — preview is read-only.
  if (_isPreviewActiveSync()) return;
  const userId = await _getEngagementUserId();
  if (!userId) return;
  if (!sessionKey) return;
  try {
    if (completedNow) {
      // Upsert against the unique (user_id, session_key) constraint so we
      // don't accumulate duplicates if the user toggles repeatedly.
      const payload = {
        user_id:      userId,
        session_key:  sessionKey,
        plan_key:     planKey || null,
        completed_at: new Date().toISOString(),
        rpe:          (rpe != null && rpe !== '') ? Number(rpe) : null,
        note:         (note || '').trim() || null,
        // Display context captured at completion time so History can render
        // independently of the live plan (Custom weeks get deleted block-by-
        // block). Shape: { week_label, session_title, session_index, focus }.
        // Only written when provided, so a notes-only re-toggle never clobbers
        // an existing snapshot with null.
        ...(meta && typeof meta === 'object' ? { meta } : {}),
      };
      const { error } = await sb.from('session_completions')
        .upsert(payload, { onConflict: 'user_id,session_key' });
      if (error) console.warn('session_completions upsert failed', error);
    } else {
      const { error } = await sb.from('session_completions')
        .delete()
        .eq('user_id', userId)
        .eq('session_key', sessionKey);
      if (error) console.warn('session_completions delete failed', error);
    }
  } catch (e) { console.warn('session_completions write exception', e); }
}

/* Patch RPE / note on an existing completion row without touching completed_at.
   No-op if the row doesn't exist (member adjusted notes before clicking Mark
   Complete) — the next push from the Complete toggle will set everything. */
async function patchSessionCompletionOnServer (sessionKey, patch) {
  // Refuse writes while previewing — preview is read-only.
  if (_isPreviewActiveSync()) return;
  const userId = await _getEngagementUserId();
  if (!userId || !sessionKey) return;
  const fields = {};
  if (patch && 'rpe'  in patch) fields.rpe  = (patch.rpe  != null && patch.rpe !== '') ? Number(patch.rpe) : null;
  if (patch && 'note' in patch) fields.note = (patch.note || '').trim() || null;
  if (Object.keys(fields).length === 0) return;
  try {
    const { error } = await sb.from('session_completions')
      .update(fields)
      .eq('user_id', userId)
      .eq('session_key', sessionKey);
    if (error) console.warn('session_completions patch failed', error);
  } catch (e) { console.warn('session_completions patch exception', e); }
}

/* One-time push of pre-existing localStorage state to the server. Runs at
   most once per browser per user (flag in localStorage). Safe to call from
   any page — bails out fast when nothing to do or no session.
   Idempotency: threshold rows tagged source='backfill'; session_completions
   upsert against the unique key so re-running this on another device is a
   no-op for rows that already exist. */
async function backfillEngagementOnce () {
  try {
    // Never backfill while previewing — this fires at mountApp time and
    // could race with ensurePreviewStateLoaded(). Without this guard,
    // a coach previewing a member could push the previewed-member's
    // (or worse, their own localStorage) state under the coach's user_id.
    if (_isPreviewActiveSync()) return;
    if (localStorage.getItem(ENGAGEMENT_BACKFILL_FLAG)) return;
    const userId = await _getEngagementUserId();
    if (!userId) return;
    const state = loadMemberState();

    // Threshold history → threshold_log
    const history = Array.isArray(state.thresholdHistory) ? state.thresholdHistory : [];
    const validHistory = history.filter(h =>
      h && Number.isFinite(h.thresholdSec) && h.thresholdSec > 0 && h.thresholdSec < 3600 &&
      (h.unit === 'metric' || h.unit === 'imperial') && h.at
    );
    // If there's a current threshold but no history (older state shape),
    // synthesise one snapshot row so the latest_threshold view has something
    // to surface.
    if (!validHistory.length && Number.isFinite(state.thresholdSec) && state.thresholdSec > 0) {
      validHistory.push({
        at:            new Date().toISOString(),
        thresholdSec:  state.thresholdSec,
        unit:          state.unit || 'metric',
      });
    }
    if (validHistory.length) {
      const rows = validHistory.map(h => ({
        user_id:       userId,
        threshold_sec: Math.round(h.thresholdSec),
        unit:          h.unit,
        recorded_at:   h.at,
        source:        'backfill',
      }));
      const { error } = await sb.from('threshold_log').insert(rows);
      if (error) console.warn('threshold backfill insert failed', error);
    }

    // Completed sessions → session_completions (upsert idempotently)
    const completed = state.completedSessions || {};
    const notes     = state.sessionNotes || {};
    const rows = Object.keys(completed).filter(k => completed[k]).map(k => {
      const n = notes[k] || {};
      // Recover plan_key from the "{plan}-w..s.." prefix.
      const prefix = (k.split('-')[0] || '').toLowerCase();
      const planKey = ['prone','sup','oc','ski','primer','custom'].includes(prefix) ? prefix : null;
      return {
        user_id:      userId,
        session_key:  k,
        plan_key:     planKey,
        completed_at: n.completedAt || new Date().toISOString(),
        rpe:          (n.rpe != null) ? Number(n.rpe) : null,
        note:         (n.note || '').trim() || null,
      };
    });
    if (rows.length) {
      const { error } = await sb.from('session_completions')
        .upsert(rows, { onConflict: 'user_id,session_key' });
      if (error) console.warn('session_completions backfill failed', error);
    }

    localStorage.setItem(ENGAGEMENT_BACKFILL_FLAG, '1');
  } catch (e) {
    // Never break the page on backfill — log and move on.
    console.warn('backfillEngagementOnce exception', e);
  }
}

/* ---- Member access gates ----
   Combined subscription + onboarding gate. Runs on every /app/* page
   that loads app.js (onboarding.html itself doesn't load app.js, so
   no redirect loop).

   Two checks, in order:

   1. SUBSCRIPTION GATE — must have a row in `progressive_members` OR
      `custom_members`. These rows are only created by the Stripe
      webhook on paid checkouts, by the migration runner, or manually
      by Mick — so their presence is a reliable proxy for "paid". If
      missing, redirect to /plans.html (the public sales page) so the
      user can subscribe.

      Why this matters: before 2026-04-29 only the onboarding gate
      existed, so anyone who could log in (e.g. via the public /login
      magic-link page) and then completed the onboarding form would
      have been let into the empty member shell. We caught
      chriskrussell@gmail.com in this state — he never paid but had a
      valid auth.users row from /login. This gate closes that hole.

   2. ONBOARDING GATE — paid members must complete the onboarding
      form (preferred name, ability, race goal) before exploring the
      app. Originally lived only on dashboard.html (§3.3); was raised
      to /app/* level after Jake hit a case where clicking "Set my
      threshold pace" on welcome.html bypassed onboarding entirely.

   Coaches bypass both gates (no member row of their own; their
   admin pages reveal coach chrome via separate logic). Sessions with
   no logged-in user also pass through — each page's own auth logic
   handles that. */
async function enforceMemberGates () {
  if (typeof sb === 'undefined' || !sb) return;
  // Onboarding.html and membership-paused.html are redirect targets — never gate them.
  const here = (location.pathname.split('/').pop() || '').toLowerCase();
  if (here === 'onboarding.html' || here === 'membership-paused.html') return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user?.email) return;
    const email  = session.user.email.toLowerCase();
    const userId = session.user.id;

    // Coaches bypass the subscription gate. But if they're also a paying
    // member who hasn't completed onboarding yet, send them through it —
    // so Mick gets the full onboarding experience when he signs up for
    // his own training. If there's no member_profiles row at all (coach
    // without a membership), the check is a no-op and they bypass as normal.
    const { data: coachRow } = await sb
      .from('coaches')
      .select('email')
      .eq('email', email)
      .maybeSingle();
    if (coachRow) {
      const { data: mp } = await sb
        .from('member_profiles')
        .select('completed_onboarding_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (mp && !mp.completed_onboarding_at) {
        location.href = 'onboarding.html';
      }
      return;
    }

    // SUBSCRIPTION GATE — match by auth_user_id OR email. The latter
    // catches members whose auth_user_id was never linked (e.g. rows
    // Mick added manually before the customer first signed in).
    const [pmAuth, cmAuth, pmEmail, cmEmail] = await Promise.all([
      sb.from('progressive_members').select('id').eq('auth_user_id', userId).maybeSingle(),
      sb.from('custom_members')     .select('id').eq('auth_user_id', userId).maybeSingle(),
      sb.from('progressive_members').select('id').eq('email',         email ).maybeSingle(),
      sb.from('custom_members')     .select('id').eq('email',         email ).maybeSingle(),
    ]);
    const isPaidMember = !!(pmAuth.data || cmAuth.data || pmEmail.data || cmEmail.data);
    if (!isPaidMember) {
      // Bounce to the public plans page (NOT a /app/* path — that
      // would loop through this gate again).
      location.href = '/plans.html';
      return;
    }

    // SUBSCRIPTION STATUS GATE — paused or canceled members go to the
    // friendly locked-out page, not /plans.html (existing members have
    // history, threshold, and a one-click resume path; we don't want
    // to treat them like fresh visitors).
    //
    // Active / trialing                → allow.
    // Active with cancel_at_period_end=true → allow until period ends.
    // Active with pause_collection scheduled → allow until period ends.
    // Status='past_due'            → lock (payment failed; no grace period).
    // Status='paused'              → lock (Stripe activated the pause).
    // Status='canceled'            → lock (sub deleted; access ended).
    // Status='unpaid' / 'incomplete_expired' → lock (defensive).
    // No subscriptions row found = legacy member (manually-added by Mick) → fall through.
    const { data: subRow } = await sb
      .from('subscriptions')
      .select('status')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (subRow) {
      const blockedStatuses = ['past_due', 'paused', 'canceled', 'unpaid', 'incomplete_expired'];
      if (blockedStatuses.includes(subRow.status)) {
        location.href = '/app/membership-paused.html';
        return;
      }
    }

    // ONBOARDING GATE — paid member but profile incomplete.
    const { data: mp } = await sb
      .from('member_profiles')
      .select('completed_onboarding_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (!mp || !mp.completed_onboarding_at) {
      location.href = 'onboarding.html';
    }
  } catch (e) {
    // Non-fatal — keep showing the page rather than redirect-loop on
    // a transient error. Each page should still enforce its own auth
    // as a backstop.
    console.warn('enforceMemberGates failed (non-fatal):', e);
  }
}

/* ---- Patch the rendered sidebar with the member's real name ----
   The initial sidebar render uses MOCK_MEMBER for synchronous mount
   (so the page doesn't flash empty). Once Supabase auth has loaded
   we fetch the member's actual preferred_name from member_profiles
   (set during onboarding) — falling back to the Stripe-billing name
   on progressive_members/custom_members, then to the email prefix.
   Hits every /app/* page that renders the sidebar via mountApp().

   In preview-as-member mode this resolves the PREVIEWED member's
   identity, not the signed-in coach's, so the sidebar chip mirrors
   the yellow "Previewing as X" banner. Without this, a coach
   previewing a member would see the coach's own name in the chip. */
async function patchSidebarWithRealName () {
  if (typeof sb === 'undefined' || !sb) return;
  try {
    // Resolve which user we're rendering for. Preview mode wins; otherwise
    // fall back to the signed-in session.
    let userId       = null;
    let email        = null;
    let billingName  = null;  // pre-resolved Stripe billing name (preview path)

    if (typeof getPreviewContext === 'function') {
      const ctx = await getPreviewContext();
      if (ctx.isPreview && ctx.previewMember) {
        userId      = ctx.previewMember.authUserId || null;
        email       = (ctx.previewMember.email || '').toLowerCase() || null;
        billingName = (ctx.previewMember.name || '').trim() || null;
      }
    }
    if (!userId && !email) {
      const { data: { session } } = await sb.auth.getSession();
      if (!session?.user?.email) return;
      userId = session.user.id;
      email  = session.user.email.toLowerCase();
    }

    // Pull preferred_name + family_name from member_profiles (the
    // onboarding form's canonical store) and the Stripe billing name
    // from the member rows. Preferred display: "Pat O'Keefe" when both
    // onboarding fields are set; falls back to Stripe billing name (which
    // may be just "Pat" or "Pat O'Keefe" depending on what the customer
    // entered as cardholder); final fallback is the email local part.
    // Skip the member-row lookups when preview context already gave us
    // the billing name; skip the profile lookup when there's no userId
    // (preview of a member who hasn't signed in yet).
    const profilePromise = userId
      ? sb.from('member_profiles').select('preferred_name, family_name').eq('user_id', userId).maybeSingle()
      : Promise.resolve({ data: null });
    const pmPromise = billingName
      ? Promise.resolve({ data: null })
      : sb.from('progressive_members').select('name').eq('email', email).maybeSingle();
    const cmPromise = billingName
      ? Promise.resolve({ data: null })
      : sb.from('custom_members').select('name').eq('email', email).maybeSingle();
    const [profileRes, pmRes, cmRes] = await Promise.all([profilePromise, pmPromise, cmPromise]);

    const preferred = profileRes?.data?.preferred_name?.trim();
    const family    = profileRes?.data?.family_name?.trim();
    const fullFromProfile = (preferred && family) ? `${preferred} ${family}` : (preferred || '');
    const memberName  = billingName || pmRes?.data?.name?.trim() || cmRes?.data?.name?.trim();
    const emailPrefix = (email || '').split('@')[0];
    const displayName = fullFromProfile || memberName || emailPrefix;
    if (!displayName) return;

    // Patch the sidebar (desktop + any mobile-rendered chip).
    document.querySelectorAll('.app-member-meta .name').forEach(el => {
      el.textContent = displayName;
    });
    document.querySelectorAll('.app-member-avatar').forEach(el => {
      el.textContent = initials(displayName);
    });
  } catch (e) {
    // Non-fatal — sidebar keeps showing the synchronous mount value.
    console.warn('patchSidebarWithRealName failed:', e);
  }
}

/* ---- "Previewing as <member>" banner ----
   When the coach toggles preview mode (sessionStorage flag set via
   admin-edit/admin-members "Preview as <member>" button), every
   /app/* page should show a persistent yellow strip at the top of
   the page reading:

     Previewing as Daniel Michaluk — [Exit preview →]

   The exit button clears the flag and navigates back to the Members
   page. Defensive: if anything in getPreviewContext() throws or the
   flag id no longer resolves to a real member, the banner just
   silently doesn't render — preview mode is unset by the helper. */
function mountTopStrip (id, bg, fg, borderColor, html) {
  if (document.getElementById(id)) return null;
  const el = document.createElement('div');
  el.id = id;
  el.setAttribute('role', 'status');
  el.style.cssText = [
    'background:' + bg,
    'color:' + fg,
    'border-bottom:2px solid ' + borderColor,
    'padding:0.65rem 1rem',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'gap:0.85rem',
    'font-size:0.9rem',
    'font-weight:500',
    'position:sticky',
    'top:0',
    'z-index:200',
    'flex-wrap:wrap',
  ].join(';');
  el.innerHTML = html;
  document.body.insertBefore(el, document.body.firstChild);
  return el;
}

async function renderPreviewBanner () {
  if (typeof getPreviewContext !== 'function') return;
  try {
    const ctx = await getPreviewContext();

    if (!ctx.isPreview || !ctx.previewMember) {
      /* A preview was asked for but couldn't be honoured — say so.
         Previously this fell through silently and the page rendered
         the signed-in coach's OWN plan with no banner, which looks
         exactly like "the member's plan is out of date". */
      const err = (typeof getPreviewError === 'function') ? getPreviewError() : null;
      if (err === 'not-found') {
        mountTopStrip('preview-banner-error', '#fee2e2', '#991b1b', '#ef4444',
          '<span><strong>Preview unavailable</strong>' +
          '<span style="opacity:0.8; margin-left:0.4rem;">That member no longer exists. You are seeing your own member area, not theirs.</span></span>' +
          '<a href="admin-members.html" style="background:#991b1b; color:white; padding:0.3rem 0.8rem; border-radius:5px; text-decoration:none; font-size:0.85rem;">Pick a member &rarr;</a>');
        return;
      }

      /* Not previewing at all. If the signed-in user is a coach, make
         that unmistakable — Mick is also a Custom member, so his own
         (older) plan renders here and is easy to mistake for the
         member's. Members never see this strip. */
      if (typeof isCurrentUserCoach === 'function') {
        let isCoach = false;
        try { isCoach = await isCurrentUserCoach(); } catch (_) { isCoach = false; }
        if (isCoach) {
          mountTopStrip('preview-banner-own', '#f1f5f9', '#334155', '#cbd5e1',
            '<span><strong>Your own member area</strong>' +
            '<span style="opacity:0.8; margin-left:0.4rem;">Not previewing anyone &mdash; this is your plan, not a member\'s.</span></span>' +
            '<a href="admin-members.html" style="background:#334155; color:white; padding:0.3rem 0.8rem; border-radius:5px; text-decoration:none; font-size:0.85rem;">View as a member &rarr;</a>');
        }
      }
      return;
    }

    // Don't double-render if a banner already exists (e.g. on a
    // second mountApp call from a hot-reload edge case).
    if (document.getElementById('preview-banner')) return;

    const m = ctx.previewMember;
    const displayName = (m.name && m.name.trim()) || m.email || 'this member';
    const planLabel = m.type === 'progressive'
      ? `Progressive · ${({prone:'Prone',sup:'SUP',oc:'OC',ski:'Ski'})[m.planKey] || m.planKey || ''}`
      : 'Custom Plan';

    const banner = document.createElement('div');
    banner.id = 'preview-banner';
    banner.setAttribute('role', 'status');
    banner.style.cssText = [
      'background:#fef3c7',
      'color:#92400e',
      'border-bottom:2px solid #f59e0b',
      'padding:0.65rem 1rem',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'gap:0.85rem',
      'font-size:0.9rem',
      'font-weight:500',
      'position:sticky',
      'top:0',
      'z-index:200',
      'flex-wrap:wrap',
    ].join(';');
    const escName = displayName
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    banner.innerHTML = `
      <span>
        <strong>Previewing as ${escName}</strong>
        <span style="opacity:0.75; margin-left:0.4rem;">${planLabel} · you're seeing exactly what they see</span>
      </span>
      <a href="#" id="preview-banner-exit" style="background:#92400e; color:white; padding:0.3rem 0.8rem; border-radius:5px; text-decoration:none; font-size:0.85rem;">Exit preview →</a>
    `;
    document.body.insertBefore(banner, document.body.firstChild);

    document.getElementById('preview-banner-exit').addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof exitPreviewMode === 'function') exitPreviewMode();
      // Bounce back to the Members admin page so Mick lands somewhere
      // useful instead of staring at his own dashboard post-exit.
      window.location.href = 'admin-members.html';
    });
  } catch (e) {
    console.warn('renderPreviewBanner failed (non-fatal):', e);
  }
}

/* ---- Mount ---- */
function mountApp() {
  document.body.classList.add('app-body');

  const sidebarMount = document.getElementById('app-sidebar');
  const mobileMount  = document.getElementById('app-mobile-header');
  const member = getMember();

  if (sidebarMount) sidebarMount.outerHTML = renderSidebar(member);
  if (mobileMount)  mobileMount.outerHTML  = renderMobileHeader(member);

  // Async — replace the placeholder name with the real one once
  // Supabase auth + DB are reachable. Doesn't block render.
  patchSidebarWithRealName();
  // Async — enforce subscription + onboarding gates. Redirects
  // unpaid users to /plans.html and paid-but-not-onboarded users to
  // onboarding.html. Coaches bypass both. See enforceMemberGates().
  enforceMemberGates();
  // Async — render the "Previewing as <Member>" banner if a coach has
  // toggled preview mode. See getPreviewContext() in admin.js.
  renderPreviewBanner();
  // Async — one-time push of pre-existing localStorage threshold +
  // session-completion state to Supabase. No-op after first run per
  // browser (flag in localStorage). See backfillEngagementOnce().
  backfillEngagementOnce();

  // Ensure a scrim exists for the mobile drawer
  let scrim = document.getElementById('app-scrim');
  if (!scrim) {
    scrim = document.createElement('div');
    scrim.className = 'app-scrim';
    scrim.id = 'app-scrim';
    document.body.appendChild(scrim);
  }

  const sidebar = document.getElementById('app-sidebar-el');
  const toggle  = document.getElementById('app-menu-toggle');
  const closeDrawer = () => {
    if (sidebar) sidebar.classList.remove('open');
    scrim.classList.remove('visible');
  };
  const openDrawer = () => {
    if (sidebar) sidebar.classList.add('open');
    scrim.classList.add('visible');
  };
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => {
      if (sidebar.classList.contains('open')) closeDrawer();
      else openDrawer();
    });
  }
  scrim.addEventListener('click', closeDrawer);

  /* Sign-out button — actually sign out (was previously just a
     plain link to login.html, which left the Supabase session
     intact and therefore bounced straight back to the dashboard
     via login.html's auth check). Hooks any element with
     data-action="signout", so the same wiring applies to whatever
     surface renders one. */
  document.addEventListener('click', async function (e) {
    const target = e.target.closest('[data-action="signout"]');
    if (!target) return;
    e.preventDefault();
    try {
      // signOut may not exist on first load if supabase-config.js
      // hasn't loaded yet — fall back to redirect-only in that case.
      if (typeof sb !== 'undefined' && sb.auth) {
        await sb.auth.signOut();
      }
    } catch (ex) {
      console.error('signOut error', ex);
    }
    // Redirect to login regardless. On Google OAuth sign-ins the
    // signOut call clears the Supabase session; the Google account
    // remains signed in to Google itself (expected — that's not our
    // session to clear), but they won't be auto-signed-back-in here
    // because login.html requires a click to start a new OAuth flow.
    window.location.href = target.getAttribute('href') || '../login.html';
  });

  /* Feedback — inject the modal once and open it on any
     element with data-action="feedback" (the sidebar footer link).
     Guarded so a second mountApp call doesn't double-bind. */
  ensureFeedbackModal();
  if (!window.__apFeedbackWired) {
    window.__apFeedbackWired = true;
    document.addEventListener('click', function (e) {
      const t = e.target.closest('[data-action="feedback"]');
      if (!t) return;
      e.preventDefault();
      openFeedbackModal();
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp);
} else {
  mountApp();
}

/* ---- Coach-mode chrome reveal ----
   Member pages are public-by-default, but Mick (the coach) signs
   in to the same site to preview the athlete experience. When the
   logged-in user is also in the `coaches` table, we reveal:
     * a "Coach Admin →" pill at the top of the sidebar footer
     * a "(MEMBER VIEW)" badge in the brand area
   Both are baked into the markup as .coach-only and hidden via CSS
   until body.is-coach is added by the check below. Fail-quiet — a
   network error here just leaves the page in normal member mode. */
(async function revealCoachChromeIfApplicable () {
  try {
    if (typeof isCurrentUserCoach !== 'function') return;
    const isCoach = await isCurrentUserCoach();
    if (isCoach) document.body.classList.add('is-coach');
  } catch { /* fail quiet */ }
})();

/* ---- Tiny toast (for "Saved" confirmations, etc.) ---- */
function showToast(message) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.className = 'app-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('visible'), 2400);
}

/* ============================================================
   Member feedback modal
   ----------------------------------------------------------------
   A "Send feedback" sidebar footer link (data-action="feedback")
   opens this modal. On submit it invokes the submit-feedback Edge
   Function, which emails the message straight to the team with the
   member's address as reply-to. Injected entirely by JS so every
   /app/* page that loads app.js gets it with no per-page markup.
   ============================================================ */
function ensureFeedbackModal() {
  if (document.getElementById('ap-feedback-overlay')) return;

  const style = document.createElement('style');
  style.id = 'ap-feedback-styles';
  style.textContent = `
    .ap-fb-overlay{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(15,23,42,.55);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);}
    .ap-fb-overlay[hidden]{display:none;}
    .ap-fb-modal{background:#fff;border-radius:14px;width:100%;max-width:460px;box-shadow:0 20px 50px rgba(15,23,42,.3);padding:1.5rem 1.5rem 1.25rem;position:relative;animation:apFbIn .16s ease-out;}
    @keyframes apFbIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}
    .ap-fb-modal h2{font-family:'Space Grotesk',sans-serif;font-size:1.2rem;margin:0 0 .35rem;color:#0f172a;}
    .ap-fb-sub{font-size:.88rem;color:#64748b;margin:0 0 1rem;line-height:1.45;}
    .ap-fb-modal textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:9px;padding:.7rem .8rem;font:inherit;font-size:.95rem;resize:vertical;min-height:120px;color:#0f172a;}
    .ap-fb-modal textarea:focus{outline:none;border-color:#155e75;box-shadow:0 0 0 3px rgba(21,94,117,.15);}
    .ap-fb-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0;}
    .ap-fb-actions{display:flex;justify-content:flex-end;gap:.6rem;margin-top:1rem;}
    .ap-fb-btn{border:none;border-radius:8px;padding:.6rem 1.1rem;font:inherit;font-weight:600;font-size:.9rem;cursor:pointer;}
    .ap-fb-cancel{background:#f1f5f9;color:#475569;}
    .ap-fb-cancel:hover{background:#e2e8f0;}
    .ap-fb-send{background:#155e75;color:#fff;}
    .ap-fb-send:hover{background:#124e60;}
    .ap-fb-send:disabled{opacity:.6;cursor:default;}
    .ap-fb-status{font-size:.85rem;margin:.7rem 0 0;min-height:1.1em;color:#15803d;}
    .ap-fb-status.err{color:#b91c1c;}
    .ap-fb-close{position:absolute;top:.6rem;right:.7rem;background:none;border:none;font-size:1.5rem;line-height:1;color:#94a3b8;cursor:pointer;padding:.2rem .4rem;}
    .ap-fb-close:hover{color:#475569;}
  `;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'ap-fb-overlay';
  overlay.id = 'ap-feedback-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'ap-fb-title');
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="ap-fb-modal">
      <button type="button" class="ap-fb-close" id="ap-fb-close" aria-label="Close">&times;</button>
      <h2 id="ap-fb-title">Send feedback</h2>
      <p class="ap-fb-sub">Questions, ideas, or something not working right? It goes straight to the team — we read every note.</p>
      <form id="ap-fb-form" novalidate>
        <textarea id="ap-fb-message" maxlength="5000" placeholder="What's on your mind?" required></textarea>
        <input type="text" id="ap-fb-hp" class="ap-fb-hp" tabindex="-1" autocomplete="off" aria-hidden="true" />
        <div class="ap-fb-actions">
          <button type="button" class="ap-fb-btn ap-fb-cancel" id="ap-fb-cancel">Cancel</button>
          <button type="submit" class="ap-fb-btn ap-fb-send" id="ap-fb-send">Send feedback</button>
        </div>
        <p class="ap-fb-status" id="ap-fb-status" role="status" aria-live="polite"></p>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('ap-fb-close').addEventListener('click', closeFeedbackModal);
  document.getElementById('ap-fb-cancel').addEventListener('click', closeFeedbackModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeFeedbackModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) closeFeedbackModal();
  });
  document.getElementById('ap-fb-form').addEventListener('submit', submitFeedback);
}

function openFeedbackModal() {
  ensureFeedbackModal();
  const overlay = document.getElementById('ap-feedback-overlay');
  // Close the mobile drawer if it's open underneath.
  const sidebar = document.getElementById('app-sidebar-el');
  const scrim   = document.getElementById('app-scrim');
  if (sidebar) sidebar.classList.remove('open');
  if (scrim)   scrim.classList.remove('visible');
  const status = document.getElementById('ap-fb-status');
  if (status) { status.textContent = ''; status.classList.remove('err'); }
  overlay.hidden = false;
  const ta = document.getElementById('ap-fb-message');
  if (ta) setTimeout(() => ta.focus(), 30);
}

function closeFeedbackModal() {
  const overlay = document.getElementById('ap-feedback-overlay');
  if (overlay) overlay.hidden = true;
}

async function submitFeedback(e) {
  e.preventDefault();
  const ta      = document.getElementById('ap-fb-message');
  const hp      = document.getElementById('ap-fb-hp');
  const sendBtn = document.getElementById('ap-fb-send');
  const status  = document.getElementById('ap-fb-status');
  const message = (ta.value || '').trim();

  status.classList.remove('err');

  // Honeypot filled (bot) → silently pretend success.
  if (hp && hp.value) { closeFeedbackModal(); return; }

  if (!message) {
    status.textContent = 'Please write a message first.';
    status.classList.add('err');
    ta.focus();
    return;
  }

  sendBtn.disabled = true;
  const original = sendBtn.textContent;
  sendBtn.textContent = 'Sending…';
  status.textContent = '';

  try {
    if (typeof sb === 'undefined' || !sb.functions) throw new Error('client not ready');
    const { data, error } = await sb.functions.invoke('submit-feedback', {
      body: { message, page: window.location.pathname, _hp: '' },
    });
    if (error || !data || !data.ok) throw error || new Error('send failed');
    ta.value = '';
    closeFeedbackModal();
    if (typeof showToast === 'function') showToast('Thanks — your feedback was sent');
  } catch (ex) {
    console.error('submitFeedback failed:', ex);
    status.textContent = "Couldn't send just now. Please try again, or email mick@allpaddling.online.";
    status.classList.add('err');
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = original;
  }
}
