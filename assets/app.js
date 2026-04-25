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
    href: 'threshold.html',
    label: 'Threshold pace',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M9 2h6"/><path d="M12 5V2"/></svg>`,
  },
  {
    href: 'strength.html',
    label: 'Strength',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5 17.5 17.5"/><path d="m21 21-1-1"/><path d="m3 3 1 1"/><path d="m18 22 4-4"/><path d="m2 6 4-4"/><path d="m3 10 7-7"/><path d="m14 21 7-7"/></svg>`,
    customOnly: true,
  },
  {
    href: 'history.html',
    label: 'History',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>`,
  },
];

const APP_FOOTER_NAV = [
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
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  },
];

const APP_BRAND_MARK = `
  <span class="brand-mark-sm" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" fill="currentColor" stroke="none"/>
      <polyline points="3,13 8,13 10,9 14,17 16,13 21,13" stroke="white" stroke-width="1.8" fill="none"/>
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
  return `<a href="${l.href}"${active ? ' class="active"' : ''}>${l.icon}<span>${l.label}</span></a>`;
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
          <small>Member area</small>
        </span>
      </div>
      <nav class="app-sidebar-nav">
        ${mainLinks}
      </nav>
      <div class="app-sidebar-footer">
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

function loadMemberState() {
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

/* ---- Mount ---- */
function mountApp() {
  document.body.classList.add('app-body');

  const sidebarMount = document.getElementById('app-sidebar');
  const mobileMount  = document.getElementById('app-mobile-header');
  const member = getMember();

  if (sidebarMount) sidebarMount.outerHTML = renderSidebar(member);
  if (mobileMount)  mobileMount.outerHTML  = renderMobileHeader(member);

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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountApp);
} else {
  mountApp();
}

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
