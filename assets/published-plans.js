/* ============================================================
   published-plans.js — public reader for the 4 Progressive
   plans Mick edits in the admin.

   Member-facing pages (/app/*) load from Supabase via this
   module instead of the static PROGRAM_1 export. Reads are
   anonymous — RLS allows SELECT for everyone — so members
   don't need to be signed in to fetch their plan.

   Loaded AFTER supabase-config.js, so `sb` is in scope.
   Loaded AFTER program-data.js, so `PROGRAM_1` is available
   as a fallback if Mick hasn't seeded a plan yet.
   ============================================================ */

const VALID_PLAN_KEYS = ['prone', 'sup', 'oc', 'ski'];

/* In-memory cache, keyed by plan key. Each entry is the
   normalised {name, subtitle, weeks, lastEdited} shape that
   member pages expect — matches the legacy PROGRAM_1 layout. */
const __publishedCache = {};

/* Map a stored discipline label (Prone / SUP / Ski / Outrigger)
   to a plan key (prone / sup / ski / oc). Falls back to 'prone'. */
function disciplineToPlanKey (d) {
  switch ((d || '').toString().toLowerCase()) {
    case 'sup':       return 'sup';
    case 'ski':       return 'ski';
    case 'oc':
    case 'outrigger': return 'oc';
    case 'prone':     return 'prone';
    default:          return 'prone';
  }
}

/* What plan key is the current member on?
   Reads `state.discipline` from the localStorage helpers in
   app.js, so pages should load app.js first. */
function getCurrentPlanKey () {
  if (typeof loadMemberState !== 'function') return 'prone';
  const s = loadMemberState();
  return disciplineToPlanKey(s && s.discipline);
}

/* Convert a Supabase row to the legacy program shape so
   member pages can use it without changing their access
   patterns (program.name, program.weeks, etc.). */
function rowToProgram (row) {
  if (!row) return null;
  const meta = row.meta || {};
  const weeks = Array.isArray(row.programs) ? row.programs : [];
  return {
    name: meta.name || 'Program 1',
    subtitle: meta.subtitle || '',
    weeks: weeks,
    lastEdited: row.last_edited || null,
    /* Flag so member pages can show an empty state when Mick
       hasn't seeded the plan yet. */
    isEmpty: weeks.length === 0,
  };
}

/* Load (or cache-hit) the published plan for one discipline. */
async function loadPublishedPlan (planKey) {
  if (!VALID_PLAN_KEYS.includes(planKey)) {
    console.warn('published-plans — invalid key', planKey);
    planKey = 'prone';
  }
  if (__publishedCache[planKey]) return __publishedCache[planKey];

  if (typeof sb === 'undefined') {
    console.warn('published-plans — Supabase client not loaded');
    return null;
  }

  const { data, error } = await sb
    .from('progressive_plans')
    .select('*')
    .eq('key', planKey)
    .maybeSingle();

  if (error) {
    console.warn('published-plans — load failed', error);
    return null;
  }
  const program = rowToProgram(data);
  if (program) __publishedCache[planKey] = program;
  return program;
}

/* Convenience: load the plan for the current member's discipline. */
async function loadCurrentPlan () {
  return await loadPublishedPlan(getCurrentPlanKey());
}

/* Force a fresh fetch (bypasses cache) — useful when the user
   switches discipline or returns to a tab after editing. */
async function reloadPublishedPlan (planKey) {
  delete __publishedCache[planKey];
  return await loadPublishedPlan(planKey);
}
