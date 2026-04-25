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
   Progressive plans — Supabase-backed with in-memory cache.

   Phase B: each plan has a draft + published version. The editor
   reads/writes draft. Members read published. Mick clicks Publish
   to copy draft → published. Cache entry shape:

     {
       draft:     { meta, programs },
       published: { meta, programs },
       lastEdited:  ISO,           // last draft save
       publishedAt: ISO|null,      // last publish
     }
   ============================================================ */

let __cache = {
  prone: null, sup: null, oc: null, ski: null,
  custom: null,
};
let __progressiveLoaded = false;

function rowToCacheEntry (row, planKey) {
  if (!row) {
    const fresh = defaultProgressivePlan(planKey);
    return {
      draft:     { meta: fresh.meta, programs: fresh.programs },
      published: { meta: fresh.meta, programs: fresh.programs },
      lastEdited:  null,
      publishedAt: null,
    };
  }
  const draftMeta = (row.draft_meta && Object.keys(row.draft_meta).length)
    ? row.draft_meta : defaultProgressiveMeta(planKey);
  const draftPrograms = Array.isArray(row.draft_programs) ? row.draft_programs : [];
  const publishedMeta = (row.meta && Object.keys(row.meta).length)
    ? row.meta : defaultProgressiveMeta(planKey);
  const publishedPrograms = Array.isArray(row.programs) ? row.programs : [];
  return {
    draft:     { meta: draftMeta,     programs: draftPrograms     },
    published: { meta: publishedMeta, programs: publishedPrograms },
    lastEdited:  row.last_edited  || null,
    publishedAt: row.published_at || null,
  };
}

async function loadProgressivePlans () {
  const { data, error } = await sb
    .from('progressive_plans')
    .select('*');
  if (error) {
    console.error('admin.js — failed to load progressive_plans', error);
    PROGRESSIVE_KEYS.forEach(k => { __cache[k] = rowToCacheEntry(null, k); });
    __progressiveLoaded = true;
    return;
  }
  PROGRESSIVE_KEYS.forEach(k => {
    const row = data.find(r => r.key === k);
    __cache[k] = rowToCacheEntry(row, k);
  });
  __progressiveLoaded = true;
}

/* ---------- Draft (editor) reads ---------- */
function getProgressiveDraft (planKey) {
  if (!__progressiveLoaded) {
    console.warn('admin.js — getProgressiveDraft called before load');
  }
  const entry = __cache[planKey];
  if (!entry) return defaultProgressivePlan(planKey);
  return {
    meta: entry.draft.meta,
    programs: entry.draft.programs,
    lastEdited: entry.lastEdited,
  };
}

/* Older shorthand used across the editor — still returns the draft view. */
function getProgressivePlan (planKey) {
  return getProgressiveDraft(planKey);
}

/* ---------- Published reads ---------- */
function getProgressivePublished (planKey) {
  const entry = __cache[planKey];
  if (!entry) return null;
  return {
    meta: entry.published.meta,
    programs: entry.published.programs,
    publishedAt: entry.publishedAt,
  };
}

function getPublishedAt (planKey) {
  const entry = __cache[planKey];
  return entry ? entry.publishedAt : null;
}

/* Diff check — does the draft differ from the published version? */
function hasUnpublishedChanges (planKey) {
  const entry = __cache[planKey];
  if (!entry) return false;
  return JSON.stringify(entry.draft.meta)     !== JSON.stringify(entry.published.meta) ||
         JSON.stringify(entry.draft.programs) !== JSON.stringify(entry.published.programs);
}

/* ---------- Writes ---------- */

/* Auto-save target. Writes ONLY to draft columns; members never see this
   until publishProgressivePlan() is called. */
async function saveProgressivePlan (planKey, planData) {
  if (!isValidPlanKey(planKey) || planKey === 'custom') {
    throw new Error('saveProgressivePlan called with invalid key: ' + planKey);
  }
  const now = new Date().toISOString();
  if (!__cache[planKey]) __cache[planKey] = rowToCacheEntry(null, planKey);
  __cache[planKey].draft      = { meta: planData.meta, programs: planData.programs };
  __cache[planKey].lastEdited = now;

  const { error } = await sb
    .from('progressive_plans')
    .update({
      draft_meta:     planData.meta,
      draft_programs: planData.programs,
      last_edited:    now,
    })
    .eq('key', planKey);

  if (error) {
    console.error('admin.js — saveProgressivePlan failed', error);
    throw error;
  }
}

/* Publish — copy draft into the live (member-facing) columns.
   IMPORTANT: deep-clone when copying so the editor's subsequent
   mutations of `draft` don't silently bleed into `published`.
   The same nested object reference would otherwise alias both views
   and break hasUnpublishedChanges() until the next page load. */
async function publishProgressivePlan (planKey) {
  if (!isValidPlanKey(planKey) || planKey === 'custom') {
    throw new Error('publishProgressivePlan called with invalid key: ' + planKey);
  }
  const entry = __cache[planKey];
  if (!entry) throw new Error('Plan not loaded: ' + planKey);
  const now = new Date().toISOString();
  entry.published = {
    meta:     clone(entry.draft.meta),
    programs: clone(entry.draft.programs),
  };
  entry.publishedAt = now;

  const { error } = await sb
    .from('progressive_plans')
    .update({
      meta:         entry.draft.meta,
      programs:     entry.draft.programs,
      published_at: now,
    })
    .eq('key', planKey);

  if (error) {
    console.error('admin.js — publishProgressivePlan failed', error);
    throw error;
  }
}

/* Revert — copy published back into draft, throwing away in-progress edits.
   Same deep-clone requirement as publish. */
async function revertProgressiveDraft (planKey) {
  if (!isValidPlanKey(planKey) || planKey === 'custom') {
    throw new Error('revertProgressiveDraft called with invalid key: ' + planKey);
  }
  const entry = __cache[planKey];
  if (!entry) throw new Error('Plan not loaded: ' + planKey);
  const now = new Date().toISOString();
  entry.draft = {
    meta:     clone(entry.published.meta),
    programs: clone(entry.published.programs),
  };
  entry.lastEdited = now;

  const { error } = await sb
    .from('progressive_plans')
    .update({
      draft_meta:     entry.published.meta,
      draft_programs: entry.published.programs,
      last_edited:    now,
    })
    .eq('key', planKey);

  if (error) {
    console.error('admin.js — revertProgressiveDraft failed', error);
    throw error;
  }
}

/* Reset draft to PROGRAM_1 defaults. Does NOT publish — members keep
   seeing whatever was last published until Mick reviews and publishes. */
async function resetProgressivePlan (planKey) {
  const fresh = defaultProgressivePlan(planKey);
  await saveProgressivePlan(planKey, { meta: fresh.meta, programs: fresh.programs });
  return getProgressiveDraft(planKey);
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

/* Returns the same flat shape the prototype used. For Progressive
   plans we return the *draft* view, since this shim is consumed by
   admin pages that operate on what Mick is editing — not what's live
   to members. Custom returns the cached members + plans collection. */
function loadAdminData () {
  return {
    prone:  getProgressiveDraft('prone'),
    sup:    getProgressiveDraft('sup'),
    oc:     getProgressiveDraft('oc'),
    ski:    getProgressiveDraft('ski'),
    custom: { members: __customCache.members, plans: __customCache.plans },
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
   Custom plans (per-member) — Supabase-backed (Phase C).

   Two tables:
     custom_members  — one row per paying Custom subscriber
     custom_plans    — one row per member (their personalised plan)

   Cache shape (in-memory, populated by loadCustomData()):

     __customCache = {
       loaded: true,
       members: [ {...}, ... ],
       plans: {
         '<member-id>': {
           draft:     { meta, programs },
           published: { meta, programs },
           lastEdited:  ISO,
           publishedAt: ISO|null,
         }
       }
     }
   ============================================================ */

let __customCache = { loaded: false, members: [], plans: {} };

/* ---------- Defaults ---------- */
function defaultCustomPlanContent () {
  const source = (typeof PROGRAM_1 !== 'undefined') ? PROGRAM_1 : null;
  return {
    meta: {
      name: 'Custom Season Race Plan · Block 1',
      subtitle: 'Base block — aerobic + threshold foundation',
      tier: 'Custom',
      cadence: '16 weeks',
    },
    programs: source ? clone(source.weeks) : [],
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

/* ---------- Row → cache shape ---------- */
function memberRowToCache (row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    email: row.email || '',
    raceGoal: row.race_goal || '',
    raceDate: row.race_date || '',
    notes: row.notes || '',
    createdAt: row.created_at || null,
  };
}

function planRowToCacheEntry (row) {
  if (!row) return null;
  const draftMeta     = row.draft_meta     && Object.keys(row.draft_meta).length     ? row.draft_meta     : {};
  const draftPrograms = Array.isArray(row.draft_programs) ? row.draft_programs : [];
  const pubMeta       = row.meta           && Object.keys(row.meta).length           ? row.meta           : {};
  const pubPrograms   = Array.isArray(row.programs)       ? row.programs       : [];
  return {
    draft:     { meta: draftMeta, programs: draftPrograms },
    published: { meta: pubMeta,   programs: pubPrograms   },
    lastEdited:  row.last_edited  || null,
    publishedAt: row.published_at || null,
  };
}

/* ---------- Load ---------- */
async function loadCustomData () {
  const [membersRes, plansRes] = await Promise.all([
    sb.from('custom_members').select('*').order('created_at', { ascending: false }),
    sb.from('custom_plans').select('*'),
  ]);
  if (membersRes.error) {
    console.error('admin.js — failed to load custom_members', membersRes.error);
    __customCache = { loaded: true, members: [], plans: {} };
    return;
  }
  const members = (membersRes.data || []).map(memberRowToCache);
  const plans = {};
  if (!plansRes.error) {
    (plansRes.data || []).forEach(row => {
      const entry = planRowToCacheEntry(row);
      if (entry) plans[row.member_id] = entry;
    });
  } else {
    console.warn('admin.js — failed to load custom_plans', plansRes.error);
  }
  __customCache = { loaded: true, members, plans };
}

/* ---------- Sync getters (after loadCustomData) ---------- */
function getCustomMembers ()  { return __customCache.members.slice(); }
function getCustomMember (id) { return __customCache.members.find(m => m.id === id) || null; }

function getCustomPlanDraft (memberId) {
  const entry = __customCache.plans[memberId];
  if (!entry) return null;
  return {
    meta:       entry.draft.meta,
    programs:   entry.draft.programs,
    lastEdited: entry.lastEdited,
  };
}

/* Older shorthand used across the editor — returns the draft view. */
function getCustomPlan (memberId) {
  return getCustomPlanDraft(memberId);
}

function getCustomPlanPublished (memberId) {
  const entry = __customCache.plans[memberId];
  if (!entry) return null;
  return {
    meta:        entry.published.meta,
    programs:    entry.published.programs,
    publishedAt: entry.publishedAt,
  };
}

function hasCustomUnpublishedChanges (memberId) {
  const entry = __customCache.plans[memberId];
  if (!entry) return false;
  return JSON.stringify(entry.draft.meta)     !== JSON.stringify(entry.published.meta) ||
         JSON.stringify(entry.draft.programs) !== JSON.stringify(entry.published.programs);
}

function getCustomPublishedAt (memberId) {
  const entry = __customCache.plans[memberId];
  return entry ? entry.publishedAt : null;
}

/* ---------- Mutations (write through Supabase, then update cache) ---------- */

async function addCustomMember (partial) {
  const p = partial || {};
  const insertRow = {
    name:      (p.name      || '').trim(),
    email:     (p.email     || '').trim() || null,
    race_goal: (p.raceGoal  || '').trim() || null,
    race_date: (p.raceDate  || '') || null,
    notes:     (p.notes     || '').trim() || null,
  };
  const { data: memberRow, error: memberErr } = await sb
    .from('custom_members')
    .insert(insertRow)
    .select()
    .single();
  if (memberErr) { console.error('addCustomMember — insert failed', memberErr); throw memberErr; }

  // Seed a fresh plan row with PROGRAM_1 defaults in the draft.
  // Members see nothing until Mick reviews and publishes.
  const fresh = defaultCustomPlanContent();
  const { data: planRow, error: planErr } = await sb
    .from('custom_plans')
    .insert({
      member_id:      memberRow.id,
      draft_meta:     fresh.meta,
      draft_programs: fresh.programs,
      meta:           {},
      programs:       [],
      last_edited:    new Date().toISOString(),
    })
    .select()
    .single();
  if (planErr) {
    console.error('addCustomMember — plan insert failed', planErr);
    // Roll back the member if plan creation failed
    await sb.from('custom_members').delete().eq('id', memberRow.id);
    throw planErr;
  }

  const member = memberRowToCache(memberRow);
  __customCache.members.unshift(member);
  __customCache.plans[member.id] = planRowToCacheEntry(planRow);
  return member;
}

async function updateCustomMember (id, patch) {
  const p = patch || {};
  const updateRow = {};
  if ('name'      in p) updateRow.name      = p.name;
  if ('email'     in p) updateRow.email     = (p.email     || '').trim() || null;
  if ('raceGoal'  in p) updateRow.race_goal = (p.raceGoal  || '').trim() || null;
  if ('raceDate'  in p) updateRow.race_date = p.raceDate || null;
  if ('notes'     in p) updateRow.notes     = (p.notes     || '').trim() || null;

  const { data, error } = await sb
    .from('custom_members')
    .update(updateRow)
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error('updateCustomMember failed', error); throw error; }

  const idx = __customCache.members.findIndex(m => m.id === id);
  if (idx !== -1) __customCache.members[idx] = memberRowToCache(data);
  return memberRowToCache(data);
}

async function removeCustomMember (id) {
  const { error } = await sb
    .from('custom_members')
    .delete()
    .eq('id', id);
  if (error) { console.error('removeCustomMember failed', error); throw error; }
  // ON DELETE CASCADE removes the matching custom_plans row server-side.
  __customCache.members = __customCache.members.filter(m => m.id !== id);
  delete __customCache.plans[id];
}

/* Auto-save target. Writes ONLY to draft columns. */
async function saveCustomPlan (memberId, plan) {
  const now = new Date().toISOString();
  const entry = __customCache.plans[memberId] || planRowToCacheEntry({});
  entry.draft = { meta: plan.meta, programs: plan.programs };
  entry.lastEdited = now;
  __customCache.plans[memberId] = entry;

  const { error } = await sb
    .from('custom_plans')
    .update({
      draft_meta:     plan.meta,
      draft_programs: plan.programs,
      last_edited:    now,
    })
    .eq('member_id', memberId);
  if (error) { console.error('saveCustomPlan failed', error); throw error; }
}

/* Publish — copy draft into the live (member-facing) columns. */
async function publishCustomPlan (memberId) {
  const entry = __customCache.plans[memberId];
  if (!entry) throw new Error('Plan not loaded for member: ' + memberId);
  const now = new Date().toISOString();
  entry.published = {
    meta:     clone(entry.draft.meta),
    programs: clone(entry.draft.programs),
  };
  entry.publishedAt = now;

  const { error } = await sb
    .from('custom_plans')
    .update({
      meta:         entry.draft.meta,
      programs:     entry.draft.programs,
      published_at: now,
    })
    .eq('member_id', memberId);
  if (error) { console.error('publishCustomPlan failed', error); throw error; }
}

/* Revert — copy published back into draft. */
async function revertCustomDraft (memberId) {
  const entry = __customCache.plans[memberId];
  if (!entry) throw new Error('Plan not loaded for member: ' + memberId);
  const now = new Date().toISOString();
  entry.draft = {
    meta:     clone(entry.published.meta),
    programs: clone(entry.published.programs),
  };
  entry.lastEdited = now;

  const { error } = await sb
    .from('custom_plans')
    .update({
      draft_meta:     entry.published.meta,
      draft_programs: entry.published.programs,
      last_edited:    now,
    })
    .eq('member_id', memberId);
  if (error) { console.error('revertCustomDraft failed', error); throw error; }
}

/* Reset draft to PROGRAM_1 defaults — does NOT publish. */
async function resetCustomPlan (memberId) {
  const fresh = defaultCustomPlanContent();
  await saveCustomPlan(memberId, { meta: fresh.meta, programs: fresh.programs });
}

/* ============================================================
   Progressive plan members — Supabase-backed (Phase D.1).

   Each Progressive member is locked to one of the four
   disciplines (prone/sup/oc/ski). The plan_key is set by the
   coach when adding the member; the member can't change it
   themselves. Admin uses these helpers to manage the roster.

   Cache shape:
     __progressiveMembersCache = {
       loaded: true,
       members: [ { id, email, name, planKey, notes, createdAt }, ... ]
     }
   ============================================================ */

let __progressiveMembersCache = { loaded: false, members: [] };

const PROGRESSIVE_PLAN_KEYS = ['prone', 'sup', 'oc', 'ski'];

function defaultProgressiveMember () {
  return {
    id: '',
    email: '',
    name: '',
    planKey: 'prone',
    notes: '',
    createdAt: new Date().toISOString(),
  };
}

function progressiveMemberRowToCache (row) {
  if (!row) return null;
  return {
    id:        row.id,
    email:     row.email     || '',
    name:      row.name      || '',
    planKey:   row.plan_key  || 'prone',
    notes:     row.notes     || '',
    createdAt: row.created_at || null,
  };
}

async function loadProgressiveMembers () {
  const { data, error } = await sb
    .from('progressive_members')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('admin.js — failed to load progressive_members', error);
    __progressiveMembersCache = { loaded: true, members: [] };
    return;
  }
  __progressiveMembersCache = {
    loaded: true,
    members: (data || []).map(progressiveMemberRowToCache),
  };
}

function getProgressiveMembers () { return __progressiveMembersCache.members.slice(); }
function getProgressiveMember (id) {
  return __progressiveMembersCache.members.find(m => m.id === id) || null;
}

/* Group helper for showing member counts per discipline. */
function getProgressiveMembersByPlan (planKey) {
  return __progressiveMembersCache.members.filter(m => m.planKey === planKey);
}

async function addProgressiveMember (partial) {
  const p = partial || {};
  if (!PROGRESSIVE_PLAN_KEYS.includes(p.planKey)) {
    throw new Error('Invalid plan_key: must be prone/sup/oc/ski');
  }
  const insertRow = {
    email:    (p.email || '').trim().toLowerCase(),
    name:     (p.name  || '').trim(),
    plan_key: p.planKey,
    notes:    (p.notes || '').trim() || null,
  };
  if (!insertRow.email) throw new Error('Email is required');
  if (!insertRow.name)  throw new Error('Name is required');

  const { data, error } = await sb
    .from('progressive_members')
    .insert(insertRow)
    .select()
    .single();
  if (error) { console.error('addProgressiveMember failed', error); throw error; }

  const member = progressiveMemberRowToCache(data);
  __progressiveMembersCache.members.unshift(member);
  return member;
}

async function updateProgressiveMember (id, patch) {
  const p = patch || {};
  const updateRow = {};
  if ('email'    in p) updateRow.email    = (p.email || '').trim().toLowerCase();
  if ('name'     in p) updateRow.name     = (p.name  || '').trim();
  if ('planKey'  in p) {
    if (!PROGRESSIVE_PLAN_KEYS.includes(p.planKey)) {
      throw new Error('Invalid plan_key: must be prone/sup/oc/ski');
    }
    updateRow.plan_key = p.planKey;
  }
  if ('notes'    in p) updateRow.notes    = (p.notes || '').trim() || null;

  const { data, error } = await sb
    .from('progressive_members')
    .update(updateRow)
    .eq('id', id)
    .select()
    .single();
  if (error) { console.error('updateProgressiveMember failed', error); throw error; }

  const idx = __progressiveMembersCache.members.findIndex(m => m.id === id);
  if (idx !== -1) __progressiveMembersCache.members[idx] = progressiveMemberRowToCache(data);
  return progressiveMemberRowToCache(data);
}

async function removeProgressiveMember (id) {
  const { error } = await sb
    .from('progressive_members')
    .delete()
    .eq('id', id);
  if (error) { console.error('removeProgressiveMember failed', error); throw error; }
  __progressiveMembersCache.members = __progressiveMembersCache.members.filter(m => m.id !== id);
}

/* ============================================================
   Member-side helpers (used by login.html + /app/* pages)

   Determines which discipline an authenticated member is entitled
   to. Reads from progressive_members keyed on the JWT email.
   Returns null if the user isn't a Progressive member.
   ============================================================ */

async function getCurrentMemberProfile () {
  const session = await getCurrentSession();
  if (!session || !session.user || !session.user.email) return null;
  const email = session.user.email.toLowerCase();

  // Try progressive_members first (each member can read only their own row via RLS)
  const { data: pm, error: pmErr } = await sb
    .from('progressive_members')
    .select('*')
    .eq('email', email)
    .maybeSingle();
  if (!pmErr && pm) {
    return {
      type: 'progressive',
      id: pm.id,
      email: pm.email,
      name: pm.name,
      planKey: pm.plan_key,
    };
  }

  // Fall back to custom_members (still localStorage-side for plan_key concept,
  // but membership check works the same)
  const { data: cm, error: cmErr } = await sb
    .from('custom_members')
    .select('*')
    .eq('email', email)
    .maybeSingle();
  if (!cmErr && cm) {
    return {
      type: 'custom',
      id: cm.id,
      email: cm.email,
      name: cm.name,
    };
  }

  return null;
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
