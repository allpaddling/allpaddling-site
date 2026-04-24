/* ============================================================
   admin.js — shared helpers for the Coach Admin area.

   Phase A — backend wiring:
   - Auth: Supabase magic-link sign-in (email OTP), gated by the
     `coaches` allowlist table.
   - Progressive plans (prone, sup, oc, ski): persisted to the
     `progressive_plans` Supabase table. Cached in memory after
     first load so synchronous getters still work.
   - Custom plans: still on localStorage (Phase C will migrate).

   Loads AFTER supabase-config.js, so `sb` (the client) and
   `PROGRAM_1` (from program-data.js) are already in scope.
   ============================================================ */

/* ---------- Plan key registry ---------- */
const PLAN_META = {
  prone:  { title: 'Prone Paddle Board Plan',     tier: 'Progressive', cadence: '4 weeks'  },
  sup:    { title: 'Stand Up Paddle Board Plan',  tier: 'Progressive', cadence: '4 weeks'  },
  oc:     { title: 'Outrigger Canoe Plan',        tier: 'Progressive', cadence: '4 weeks'  },
  ski:    { title: 'Surf Ski Plan',               tier: 'Progressive', cadence: '4 weeks'  },
  custom: { title: 'Custom Season Race Plan',     tier: 'Custom',      cadence: '16 weeks' },
};
const PROGRESSIVE_KEYS = ['prone', 'sup', 'oc', 'ski'];
function isValidPlanKey (k) { return Object.prototype.hasOwnProperty.call(PLAN_META, k); }

/* ---------- localStorage keys (Custom plan only now) ---------- */
const LEGACY_DATA_KEY  = 'admin_programs_v1';   // old unified store
const CUSTOM_DATA_KEY  = 'admin_custom_v1';     // new Custom-only store

/* ============================================================
   Auth — Supabase magic link
   ============================================================ */

async function sendMagicLink (email) {
  const redirectTo = window.location.origin + window.location.pathname;
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) throw error;
}

async function getCurrentSession () {
  const { data, error } = await sb.auth.getSession();
  if (error) { console.warn('admin.js — getSession error', error); return null; }
  return data.session || null;
}

async function getAdminEmail () {
  const session = await getCurrentSession();
  return session && session.user ? session.user.email : null;
}

/* Is the signed-in user actually a coach?
   We hit the `coaches` table — RLS lets coaches see the list,
   so this returns a row only if they're allowed. */
async function isCurrentUserCoach () {
  const email = await getAdminEmail();
  if (!email) return false;
  const { data, error } = await sb
    .from('coaches')
    .select('email')
    .eq('email', email)
    .maybeSingle();
  if (error) { console.warn('admin.js — coach lookup error', error); return false; }
  return !!data;
}

async function adminIsAuthed () {
  return await isCurrentUserCoach();
}

async function signOut () {
  await sb.auth.signOut();
}

/* ============================================================
   Progressive plans — Supabase-backed with in-memory cache
   ============================================================ */

let __cache = {
  prone: null, sup: null, oc: null, ski: null,
  custom: null,
};
let __progressiveLoaded = false;

function rowToPlan (row, planKey) {
  if (!row) {
    return defaultProgressivePlan(planKey);
  }
  return {
    meta: row.meta && Object.keys(row.meta).length ? row.meta : defaultProgressiveMeta(planKey),
    programs: Array.isArray(row.programs) ? row.programs : [],
    lastEdited: row.last_edited || null,
  };
}

async function loadProgressivePlans () {
  const { data, error } = await sb
    .from('progressive_plans')
    .select('*');
  if (error) {
    console.error('admin.js — failed to load progressive_plans', error);
    PROGRESSIVE_KEYS.forEach(k => { __cache[k] = defaultProgressivePlan(k); });
    __progressiveLoaded = true;
    return;
  }
  PROGRESSIVE_KEYS.forEach(k => {
    const row = data.find(r => r.key === k);
    __cache[k] = rowToPlan(row, k);
  });
  __progressiveLoaded = true;
}

/* Synchronous read after loadProgressivePlans() has resolved. */
function getProgressivePlan (planKey) {
  if (!__progressiveLoaded) {
    console.warn('admin.js — getProgressivePlan called before load');
  }
  return __cache[planKey] || defaultProgressivePlan(planKey);
}

/* Write-through: update cache + persist to Supabase. */
async function saveProgressivePlan (planKey, planData) {
  if (!isValidPlanKey(planKey) || planKey === 'custom') {
    throw new Error('saveProgressivePlan called with invalid key: ' + planKey);
  }
  planData.lastEdited = new Date().toISOString();
  __cache[planKey] = planData;

  const { error } = await sb
    .from('progressive_plans')
    .update({
      meta: planData.meta,
      programs: planData.programs,
      last_edited: planData.lastEdited,
    })
    .eq('key', planKey);

  if (error) {
    console.error('admin.js — saveProgressivePlan failed', error);
    throw error;
  }
}

async function resetProgressivePlan (planKey) {
  const fresh = defaultProgressivePlan(planKey);
  await saveProgressivePlan(planKey, fresh);
  return fresh;
}

function defaultProgressiveMeta (planKey) {
  const source = (typeof PROGRAM_1 !== 'undefined') ? PROGRAM_1 : null;
  return {
    name: (source && source.name) || 'Program 1',
    subtitle: (source && source.subtitle) || 'Aerobic base · intro intensity',
    tier: 'Progressive',
    cadence: '4 weeks',
  };
}

function defaultProgressivePlan (planKey) {
  const source = (typeof PROGRAM_1 !== 'undefined') ? PROGRAM_1 : null;
  return {
    meta: defaultProgressiveMeta(planKey),
    programs: source ? clone(source.weeks) : [],
    lastEdited: null,
  };
}

/* ============================================================
   Compatibility shims — older callers used loadAdminData()
   ============================================================ */

/* Returns the same flat shape the prototype used so the rest of
   the admin pages can keep their existing calls. Progressive
   plans come from the cache; Custom comes from localStorage. */
function loadAdminData () {
  return {
    prone:  __cache.prone  || defaultProgressivePlan('prone'),
    sup:    __cache.sup    || defaultProgressivePlan('sup'),
    oc:     __cache.oc     || defaultProgressivePlan('oc'),
    ski:    __cache.ski    || defaultProgressivePlan('ski'),
    custom: loadCustomBlob(),
  };
}

/* Older async-aware callers: kept for backwards compat. */
async function savePlan (planKey, planData) {
  if (planKey === 'custom') {
    throw new Error('Use saveCustomPlan(memberId, plan) for custom plans');
  }
  await saveProgressivePlan(planKey, planData);
}

async function resetPlan (planKey) {
  return await resetProgressivePlan(planKey);
}

/* ============================================================
   Custom plans (per-member) — localStorage for now
   ============================================================ */

function loadCustomBlob () {
  // Migration: if new key is missing but legacy exists, lift the
  // .custom subtree across so we don't lose the prototype's data.
  if (!localStorage.getItem(CUSTOM_DATA_KEY)) {
    const legacy = localStorage.getItem(LEGACY_DATA_KEY);
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy);
        if (parsed && parsed.custom) {
          localStorage.setItem(CUSTOM_DATA_KEY, JSON.stringify(parsed.custom));
        }
      } catch (e) {
        console.warn('admin.js — could not migrate legacy custom blob', e);
      }
    }
  }

  let blob = null;
  try {
    const raw = localStorage.getItem(CUSTOM_DATA_KEY);
    if (raw) blob = JSON.parse(raw);
  } catch (e) {
    console.warn('admin.js — custom blob parse failed', e);
  }
  if (!blob || typeof blob !== 'object') {
    blob = { members: [], plans: {} };
  }

  // Legacy upgrade: the very first prototype shape had
  // { meta, programs, lastEdited } at the top level.
  if (blob.meta && blob.programs && !blob.members) {
    const legacyId = makeMemberId();
    blob = {
      members: [Object.assign(defaultCustomMember(), {
        id: legacyId,
        name: 'Legacy plan',
        notes: 'Imported from the previous single-plan editor.',
      })],
      plans: {
        [legacyId]: {
          meta: blob.meta,
          programs: blob.programs,
          lastEdited: blob.lastEdited || null,
        },
      },
    };
    saveCustomBlob(blob);
  }

  if (!Array.isArray(blob.members)) blob.members = [];
  if (!blob.plans || typeof blob.plans !== 'object') blob.plans = {};
  __cache.custom = blob;
  return blob;
}

function saveCustomBlob (blob) {
  __cache.custom = blob;
  localStorage.setItem(CUSTOM_DATA_KEY, JSON.stringify(blob));
}

function defaultCustomPlan () {
  const source = (typeof PROGRAM_1 !== 'undefined') ? PROGRAM_1 : null;
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

function defaultCustomMember () {
  return {
    id: '',
    name: '',
    email: '',
    raceGoal: '',
    raceDate: '',
    notes: '',
    createdAt: new Date().toISOString(),
  };
}

function makeMemberId () {
  return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

function getCustomMembers ()   { return loadCustomBlob().members; }
function getCustomMember (id)  { return getCustomMembers().find(m => m.id === id) || null; }

function addCustomMember (partial) {
  const blob = loadCustomBlob();
  const member = Object.assign(defaultCustomMember(), partial || {}, {
    id: makeMemberId(),
    createdAt: new Date().toISOString(),
  });
  blob.members.push(member);
  blob.plans[member.id] = defaultCustomPlan();
  saveCustomBlob(blob);
  return member;
}

function updateCustomMember (id, patch) {
  const blob = loadCustomBlob();
  const idx = blob.members.findIndex(m => m.id === id);
  if (idx === -1) return null;
  blob.members[idx] = Object.assign({}, blob.members[idx], patch || {});
  saveCustomBlob(blob);
  return blob.members[idx];
}

function removeCustomMember (id) {
  const blob = loadCustomBlob();
  blob.members = blob.members.filter(m => m.id !== id);
  if (blob.plans) delete blob.plans[id];
  saveCustomBlob(blob);
}

function getCustomPlan (memberId) {
  const blob = loadCustomBlob();
  return (blob.plans && blob.plans[memberId]) || null;
}

function saveCustomPlan (memberId, plan) {
  const blob = loadCustomBlob();
  if (!blob.plans) blob.plans = {};
  plan.lastEdited = new Date().toISOString();
  blob.plans[memberId] = plan;
  saveCustomBlob(blob);
}

function resetCustomPlan (memberId) {
  const blob = loadCustomBlob();
  if (!blob.plans) return;
  blob.plans[memberId] = defaultCustomPlan();
  saveCustomBlob(blob);
}

/* ============================================================
   Small shared helpers
   ============================================================ */

function clone (obj) { return JSON.parse(JSON.stringify(obj)); }

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
  { value: 1, label: 'TZ1 · Warmup/Recovery'     },
  { value: 2, label: 'TZ2 · Aerobic threshold'   },
  { value: 3, label: 'TZ3 · Anaerobic threshold' },
  { value: 4, label: 'TZ4 · Aerobic capacity'    },
  { value: 5, label: 'TZ5 · Anaerobic capacity'  },
];
