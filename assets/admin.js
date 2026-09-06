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
  // One shared primer across all disciplines — every new Progressive
  // member sees this for their first 4 weeks (or until Mick flips
  // primer_completed=true). Edited via admin-edit.html?plan=primer.
  primer: { title: 'Primer (first 4 weeks)',      tier: 'Progressive', cadence: 'Settling-in plan' },
  custom: { title: 'Custom Season Race Plan',     tier: 'Custom',      cadence: '12 weeks' },
};
const PROGRESSIVE_KEYS = ['prone', 'sup', 'oc', 'ski', 'primer'];
function isValidPlanKey (k) { return Object.prototype.hasOwnProperty.call(PLAN_META, k); }
function isPrimerKey (k) { return k === 'primer'; }

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

/* Read-only fetch of a Progressive plan's CURRENT content for copying
   into another discipline. Returns the most-recent state — draft if
   anything has been edited, otherwise the published version. Doesn't
   touch __cache so this is safe to call from inside the editor of a
   different plan key (the editor's own cache for the destination
   stays intact until saveProgressivePlan() writes the copy). */
async function loadAnyProgressivePlanSource (planKey) {
  if (!isValidPlanKey(planKey) || planKey === 'custom') {
    throw new Error('loadAnyProgressivePlanSource: invalid key ' + planKey);
  }
  const { data, error } = await sb
    .from('progressive_plans')
    .select('key, meta, programs, draft_meta, draft_programs, last_edited, published_at')
    .eq('key', planKey)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // Prefer draft if anything is in there — that's Mick's most recent work.
  const draftHasContent =
    (data.draft_meta && Object.keys(data.draft_meta).length > 0) ||
    (Array.isArray(data.draft_programs) && data.draft_programs.length > 0);

  const meta     = draftHasContent ? (data.draft_meta || {})     : (data.meta || {});
  const programs = draftHasContent ? (data.draft_programs || []) : (data.programs || []);
  return {
    meta,
    programs,
    source:     draftHasContent ? 'draft' : 'published',
    isEmpty:    !programs || programs.length === 0,
    lastEdited: data.last_edited,
    publishedAt:data.published_at,
  };
}

/* Load a single custom member's plan as a copy SOURCE — used by the
   "Copy plan from another customer" feature in admin-edit. Mirrors
   loadAnyProgressivePlanSource: prefers the draft if anything has
   been edited there, otherwise the published version. Returns null
   if the member has no custom_plans row at all (brand-new signup).
   Doesn't touch the in-memory cache so the destination editor's
   working state stays intact. */
async function loadAnyCustomPlanSource (memberId) {
  if (!memberId) throw new Error('loadAnyCustomPlanSource: memberId required');
  const { data, error } = await sb
    .from('custom_plans')
    .select('member_id, meta, programs, draft_meta, draft_programs, last_edited, published_at')
    .eq('member_id', memberId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const draftHasContent =
    (data.draft_meta && Object.keys(data.draft_meta).length > 0) ||
    (Array.isArray(data.draft_programs) && data.draft_programs.length > 0);

  const meta     = draftHasContent ? (data.draft_meta || {})     : (data.meta || {});
  const programs = draftHasContent ? (data.draft_programs || []) : (data.programs || []);
  return {
    meta,
    programs,
    source:     draftHasContent ? 'draft' : 'published',
    isEmpty:    !programs || programs.length === 0,
    lastEdited: data.last_edited,
    publishedAt:data.published_at,
  };
}

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
      cadence: '12 weeks',
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
    authUserId: row.auth_user_id || null,
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

/* Auto-save target. Writes ONLY to draft columns.
   Uses upsert so the very first save for a self-signup member (whose
   webhook only created custom_members, not custom_plans) creates the
   row instead of silently no-op'ing on an UPDATE that matches 0 rows. */
async function saveCustomPlan (memberId, plan) {
  const now = new Date().toISOString();
  const entry = __customCache.plans[memberId] || planRowToCacheEntry({});
  entry.draft = { meta: plan.meta, programs: plan.programs };
  entry.lastEdited = now;
  __customCache.plans[memberId] = entry;

  const { error } = await sb
    .from('custom_plans')
    .upsert(
      {
        member_id:      memberId,
        draft_meta:     plan.meta,
        draft_programs: plan.programs,
        last_edited:    now,
        // Don't touch published columns on the upsert path — leave them
        // at their existing values. For a fresh-insert (new self-signup)
        // they'll default to {}/[] which matches the addCustomMember flow.
      },
      { onConflict: 'member_id' },
    );
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

function progressiveMemberRowToCache (row) {
  if (!row) return null;
  return {
    id:               row.id,
    email:            row.email     || '',
    name:             row.name      || '',
    planKey:          row.plan_key  || 'prone',
    notes:            row.notes     || '',
    authUserId:       row.auth_user_id || null,
    primerCompleted:  !!row.primer_completed,
    createdAt:        row.created_at || null,
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

  // Race-tolerant lookup. The webhook that creates a member row (Stripe →
  // Supabase) may not have replicated by the time the post-checkout redirect
  // lands here, so a single empty result is not conclusive. Retry the lookup
  // a small bounded number of times with backoff; only after every attempt
  // returns nothing do we treat the user as "not a member yet".
  //
  // Worst-case added latency for genuine non-members is ~1.6s, paid for once
  // per page load; this is well below the cost of mis-routing a paying
  // customer to the "no access" view.
  const RETRY_DELAYS_MS = [0, 400, 1200];

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt] > 0) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }

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
        createdAt: pm.created_at || null,
        primerCompleted: !!pm.primer_completed,
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
        createdAt: cm.created_at || null,
      };
    }

    // Both tables returned empty (or errored). If this isn't the last attempt,
    // wait and try again — the row may still be replicating.
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

/* ============================================================
   "Preview as member" — coach impersonation-lite
   ============================================================
   Mick wanted a way to see exactly what each member sees in their
   /app/* pages without having to actually sign in as them. This
   helper set lets a coach flip a sessionStorage flag and have all
   member-side pages render that member's data instead of the coach's.

   Why sessionStorage (not auth swap):
     * No real impersonation — Mick stays signed in as himself, RLS
       still applies, no risk of accidental destructive action under
       the member's auth.
     * Ends cleanly when Mick closes the tab — no stale state.
     * The flag is just an id; data lookups always go through these
       helpers which validate is_coach() before honouring it.

   Flow:
     1. Mick clicks "Preview as Daniel" on admin-members.html or
        admin-edit.html. setPreviewMode() writes the member id.
     2. Mick is navigated to /app/dashboard.html (or wherever).
     3. app.js's mountApp() calls renderPreviewBanner() which adds
        a yellow "Previewing as Daniel — Exit preview" strip.
     4. Member-side pages call getEffectiveMemberProfile() and
        getEffectiveAuthUserId() instead of the raw versions; both
        return Daniel's data when previewing, the signed-in user's
        otherwise.
     5. Mick clicks "Exit preview" → exitPreviewMode() clears the
        flag and bounces to admin-members.html.
   ============================================================ */

const PREVIEW_FLAG_KEY  = 'viewAsMemberId';
const PREVIEW_URL_PARAM = 'viewAs';

/* Why the URL param exists (added 2026-09-06):
   sessionStorage is per-TAB. If Mick opened a preview in a new tab,
   restored a tab, or came back via a bookmark, the flag was gone and
   the member pages silently rendered HIS OWN plan with no banner —
   which reads as "the preview is showing an old program". Carrying the
   member id in the URL makes a preview link survive new tabs, reloads
   and tab restore. sessionStorage is still seeded from it on load so
   in-tab sidebar navigation (Dashboard -> Current Program -> ...)
   keeps working without every link needing the param. */
function getPreviewMemberIdFromUrl () {
  try {
    const v = new URLSearchParams(location.search).get(PREVIEW_URL_PARAM);
    return (v && v.trim()) ? v.trim() : null;
  } catch (_) { return null; }
}

function getPreviewMemberIdRaw () {
  const fromUrl = getPreviewMemberIdFromUrl();
  if (fromUrl) {
    setPreviewMode(fromUrl);   // seed the tab so in-tab nav keeps it
    return fromUrl;
  }
  try { return sessionStorage.getItem(PREVIEW_FLAG_KEY); }
  catch (_) { return null; }
}

function setPreviewMode (memberId) {
  try { sessionStorage.setItem(PREVIEW_FLAG_KEY, memberId); }
  catch (_) { /* sessionStorage may be unavailable */ }
}

/* Build a member-page URL that carries the preview with it. */
function previewHref (page, memberId) {
  return page + '?' + PREVIEW_URL_PARAM + '=' + encodeURIComponent(memberId);
}

function exitPreviewMode () {
  try { sessionStorage.removeItem(PREVIEW_FLAG_KEY); }
  catch (_) { /* no-op */ }
  // Also strip the param, otherwise a reload re-enters preview.
  try {
    const url = new URL(location.href);
    if (url.searchParams.has(PREVIEW_URL_PARAM)) {
      url.searchParams.delete(PREVIEW_URL_PARAM);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  } catch (_) { /* no-op */ }
}

/* Set when a preview was ASKED FOR but could not be honoured, so the
   page can say so out loud instead of quietly rendering the coach's
   own data. Read by renderPreviewBanner() in app.js.
     null            — nothing was requested, or it worked
     'not-coach'     — flag present but the signed-in user isn't a coach
     'not-found'     — member id doesn't match any member row */
let __previewError = null;
function getPreviewError () { return __previewError; }

/* Resolve the previewed member's full record by id. Tries
   custom_members first, then progressive_members. Returns null
   if not previewing, not a coach, or member id doesn't match
   anything (in which case the stale flag is also cleared). */
async function getPreviewContext () {
  __previewError = null;
  const id = getPreviewMemberIdRaw();
  if (!id) return { isPreview: false, previewMember: null };

  // Coach gate — only coaches can preview-as-member. Non-coaches
  // get the flag silently ignored (defence-in-depth alongside RLS).
  const isCoach = await isCurrentUserCoach();
  if (!isCoach) {
    // Don't leave a coach-only flag sitting in a member's tab.
    exitPreviewMode();
    __previewError = 'not-coach';
    return { isPreview: false, previewMember: null };
  }

  // Try custom_members first (Custom Plan customers).
  const { data: cm, error: cmErr } = await sb
    .from('custom_members')
    .select('id, email, name, auth_user_id, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!cmErr && cm) {
    return {
      isPreview: true,
      previewMember: {
        type: 'custom', id: cm.id, email: cm.email, name: cm.name,
        authUserId: cm.auth_user_id, createdAt: cm.created_at,
      },
    };
  }

  // Fall back to progressive_members.
  const { data: pm, error: pmErr } = await sb
    .from('progressive_members')
    .select('id, email, name, plan_key, auth_user_id, created_at, primer_completed')
    .eq('id', id)
    .maybeSingle();
  if (!pmErr && pm) {
    return {
      isPreview: true,
      previewMember: {
        type: 'progressive', id: pm.id, email: pm.email, name: pm.name,
        planKey: pm.plan_key, authUserId: pm.auth_user_id,
        createdAt: pm.created_at, primerCompleted: !!pm.primer_completed,
      },
    };
  }

  // Stale flag — the member id no longer resolves. Clear it and
  // flag it so the page can warn rather than fall back silently.
  exitPreviewMode();
  __previewError = 'not-found';
  return { isPreview: false, previewMember: null };
}

/* Drop-in replacement for getCurrentMemberProfile() that respects
   preview mode. Returns the same shape as getCurrentMemberProfile(). */
async function getEffectiveMemberProfile () {
  const ctx = await getPreviewContext();
  if (ctx.isPreview && ctx.previewMember) {
    const m = ctx.previewMember;
    return m.type === 'progressive'
      ? { type: 'progressive', id: m.id, email: m.email, name: m.name,
          planKey: m.planKey, createdAt: m.createdAt,
          primerCompleted: m.primerCompleted }
      : { type: 'custom', id: m.id, email: m.email, name: m.name,
          createdAt: m.createdAt };
  }
  return getCurrentMemberProfile();
}

/* Returns the auth.users id whose member_profiles / subscriptions /
   training-log rows the page should be querying. In preview mode
   this is the previewed member's auth_user_id (which may be null
   for members who haven't signed in yet — caller must handle that
   case gracefully). */
async function getEffectiveAuthUserId (session) {
  const ctx = await getPreviewContext();
  if (ctx.isPreview && ctx.previewMember) {
    return ctx.previewMember.authUserId || null;
  }
  return (session && session.user && session.user.id) || null;
}

/* ============================================================
   Admin mobile nav
   Injects a sticky mobile header (hamburger + brand) and a
   drawer-close scrim into every admin page. Works by prepending
   into the existing .app-main inside #admin-shell — the shell
   starts hidden, so the header only becomes visible once auth
   succeeds and the shell is revealed. The CSS drawer system
   (app-sidebar.open, .app-scrim.visible) already exists in
   app.css; this just wires it up for admin pages.
   ============================================================ */
function mountAdminMobile () {
  const shell = document.getElementById('admin-shell');
  if (!shell) return;
  const main    = shell.querySelector('.app-main');
  const sidebar = shell.querySelector('.app-sidebar');
  if (!main || !sidebar) return;

  // ---- Mobile header ----
  const hdr = document.createElement('div');
  hdr.className = 'app-mobile-header';
  hdr.id = 'admin-mobile-header';
  hdr.innerHTML = `
    <button class="app-menu-toggle" id="admin-menu-toggle" aria-label="Open navigation menu">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="3" y1="6" x2="21" y2="6"/>
        <line x1="3" y1="12" x2="21" y2="12"/>
        <line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    </button>
    <div style="display:flex;align-items:center;gap:0.5rem;">
      <span class="brand-mark-sm" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"
                fill="currentColor" stroke="none"/>
          <polyline points="3,13 8,13 10,9 14,17 16,13 21,13"
                    stroke="#155e75" stroke-width="2.4" fill="none"/>
        </svg>
      </span>
      <strong style="font-family:'Space Grotesk',sans-serif;font-size:0.95rem;">All Paddling</strong>
      <span style="display:inline-flex;align-items:center;background:var(--brand-50);
                   color:var(--brand-700);font-size:0.68rem;font-weight:700;letter-spacing:0.05em;
                   padding:0.15rem 0.45rem;border-radius:5px;margin-left:0.1rem;">ADMIN</span>
    </div>`;
  main.prepend(hdr);

  // ---- Scrim (behind open drawer) ----
  let scrim = document.getElementById('admin-mobile-scrim');
  if (!scrim) {
    scrim = document.createElement('div');
    scrim.className = 'app-scrim';
    scrim.id = 'admin-mobile-scrim';
    document.body.appendChild(scrim);
  }

  // ---- Toggle wiring ----
  const toggle = document.getElementById('admin-menu-toggle');

  function closeDrawer () {
    sidebar.classList.remove('open');
    scrim.classList.remove('visible');
  }
  function openDrawer () {
    sidebar.classList.add('open');
    scrim.classList.add('visible');
  }

  if (toggle) {
    toggle.addEventListener('click', function () {
      if (sidebar.classList.contains('open')) closeDrawer(); else openDrawer();
    });
  }
  scrim.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
  });
  // Close when a nav link is tapped (navigating away)
  sidebar.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () { setTimeout(closeDrawer, 60); });
  });
}

document.addEventListener('DOMContentLoaded', mountAdminMobile);
