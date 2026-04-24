/* ============================================================
   admin.js — shared helpers for the Coach Admin area
   Handles auth gate + localStorage data model for the 4
   Progressive plans + Custom plan.

   Prototype note: everything lives in localStorage. Swap the
   data layer for a real backend (Supabase / CMS) in Phase 2.
   ============================================================ */

/* ---------- Allowed admin emails (prototype) ---------- */
/* Change this list to grant access. Case-insensitive compare.   */
const ADMIN_EMAILS = [
  'mick@allpaddling.com',
  'jakedibetta@gmail.com',
];

const ADMIN_AUTH_KEY = 'admin_auth_email';
const ADMIN_DATA_KEY = 'admin_programs_v1';

function isAdminEmail (email) {
  if (!email) return false;
  return ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email.toLowerCase());
}
function getAdminAuth ()  { return localStorage.getItem(ADMIN_AUTH_KEY); }
function setAdminAuth (e) { localStorage.setItem(ADMIN_AUTH_KEY, e); }
function clearAdminAuth () { localStorage.removeItem(ADMIN_AUTH_KEY); }
function adminIsAuthed () {
  const e = getAdminAuth();
  return e && isAdminEmail(e);
}

/* ---------- Plan key registry ---------- */
const PLAN_META = {
  prone:  { title: 'Prone Paddle Board Plan',    tier: 'Progressive', cadence: '4 weeks' },
  sup:    { title: 'Stand Up Paddle Board Plan', tier: 'Progressive', cadence: '4 weeks' },
  oc:     { title: 'Outrigger Canoe Plan',        tier: 'Progressive', cadence: '4 weeks' },
  ski:    { title: 'Surf Ski Plan',               tier: 'Progressive', cadence: '4 weeks' },
  custom: { title: 'Custom Season Race Plan',     tier: 'Custom',      cadence: '16 weeks' },
};
function isValidPlanKey (k) { return Object.prototype.hasOwnProperty.call(PLAN_META, k); }

/* ---------- Data load / save ---------- */
/* Shape:
   {
     prone:  { meta: {...}, programs: [<week>, ...], lastEdited: ISO|null },
     sup:    { ... },
     oc:     { ... },
     ski:    { ... },
     custom: { meta: {...}, programs: [...], lastEdited: ISO|null }
   }
*/

function loadAdminData () {
  try {
    const raw = localStorage.getItem(ADMIN_DATA_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (err) {
    console.warn('admin.js — could not parse saved data, falling back to defaults', err);
  }
  return defaultAdminData();
}

function saveAdminData (data) {
  localStorage.setItem(ADMIN_DATA_KEY, JSON.stringify(data));
}

function savePlan (planKey, planData) {
  const all = loadAdminData();
  planData.lastEdited = new Date().toISOString();
  all[planKey] = planData;
  saveAdminData(all);
}

function resetPlan (planKey) {
  const all = loadAdminData();
  all[planKey] = defaultPlan(planKey);
  saveAdminData(all);
}

/* ---------- Defaults ---------- */
function defaultAdminData () {
  const data = {};
  Object.keys(PLAN_META).forEach(k => { data[k] = defaultPlan(k); });
  return data;
}

function defaultPlan (planKey) {
  const meta = PLAN_META[planKey] || { title: planKey, tier: 'Progressive', cadence: '4 weeks' };
  const source = (typeof PROGRAM_1 !== 'undefined') ? PROGRAM_1 : null;

  // For prototype: clone PROGRAM_1 as the seed for each Progressive plan.
  // Custom gets the same seed but labelled differently — real data comes later.
  if (planKey === 'custom') {
    return {
      meta: {
        name: 'Custom Season Race Plan · Block 1',
        subtitle: 'Base block — aerobic + threshold foundation',
        tier: 'Custom',
        cadence: '16 weeks',
      },
      programs: source ? clone(source.weeks) : [],
      lastEdited: null,
    };
  }
  return {
    meta: {
      name: (source && source.name) || 'Program 1',
      subtitle: (source && source.subtitle) || 'Aerobic base · intro intensity',
      tier: 'Progressive',
      cadence: '4 weeks',
    },
    programs: source ? clone(source.weeks) : [],
    lastEdited: null,
  };
}

function clone (obj) { return JSON.parse(JSON.stringify(obj)); }

function migrate (data) {
  // Ensure every plan key exists (future-proofing if we add plans later).
  Object.keys(PLAN_META).forEach(k => {
    if (!data[k]) data[k] = defaultPlan(k);
    if (!data[k].meta) data[k].meta = defaultPlan(k).meta;
    if (!Array.isArray(data[k].programs)) data[k].programs = defaultPlan(k).programs;
  });
  return data;
}

/* ---------- Small shared helpers used by editor ----------
   Focus values are stored uppercase to match program-data.js
   (e.g. 'AEROBIC THRESHOLD') — focusClass() in program-data.js
   pattern-matches on those strings.
*/
const FOCUS_OPTIONS = [
  { value: 'AEROBIC THRESHOLD',   label: 'Aerobic threshold'   },
  { value: 'ANAEROBIC THRESHOLD', label: 'Anaerobic threshold' },
  { value: 'AEROBIC CAPACITY',    label: 'Aerobic capacity'    },
  { value: 'ANAEROBIC CAPACITY',  label: 'Anaerobic capacity'  },
];
function focusLabel (f) {
  const opt = FOCUS_OPTIONS.find(o => o.value === f);
  return opt ? opt.label : f;
}
const ZONE_OPTIONS = [
  { value: 1, label: 'TZ1 · Recovery'   },
  { value: 2, label: 'TZ2 · Endurance'  },
  { value: 3, label: 'TZ3 · Threshold'  },
  { value: 4, label: 'TZ4 · VO₂max'     },
  { value: 5, label: 'TZ5 · Sprint'     },
];
