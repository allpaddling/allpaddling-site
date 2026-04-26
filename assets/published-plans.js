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

/* Session-scoped plan-key override.
   When an authenticated Progressive member loads a page, the auth
   gate calls setSessionPlanKey() with the server-locked plan_key
   from progressive_members. That value wins over anything in
   localStorage — so members can't change their discipline by
   tampering with localStorage. */
let __sessionPlanKey = null;
function setSessionPlanKey (planKey) {
  if (typeof planKey === 'string' && VALID_PLAN_KEYS.includes(planKey)) {
    __sessionPlanKey = planKey;
  }
}

/* What plan key is the current member on?
   Priority: server-locked entitlement > localStorage discipline.
   For unauthenticated/test contexts, falls back to localStorage. */
function getCurrentPlanKey () {
  if (__sessionPlanKey) return __sessionPlanKey;
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
    lastEdited:  row.last_edited  || null,
    publishedAt: row.published_at || null,
    /* Flag so member pages can show an empty state when Mick
       hasn't seeded/published the plan yet. */
    isEmpty: weeks.length === 0 || !row.published_at,
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

  /* Explicit column list — we deliberately do NOT pull draft_meta or
     draft_programs, so members never see Mick's in-progress edits. */
  const { data, error } = await sb
    .from('progressive_plans')
    .select('key, meta, programs, published_at, last_edited')
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

/* Convenience: load the plan for the current member's discipline.
 *
 * For Progressive members, this implements the calendar-cohort + primer
 * model:
 *   - Members in their first 28 days see the "<discipline>_primer"
 *     plan (a settling-in baseline that doesn't roll on the calendar).
 *   - After 28 days they merge into the cohort and see the regular
 *     "<discipline>" plan that everyone else sees.
 *
 * Coach previewing draft content uses loadDraftProgressivePlan directly,
 * not this function — so coach-side flows are unaffected.
 *
 * The 28-day boundary uses the member's `created_at` if available
 * (passed in via the `joinedAt` arg as ISO date or Date), falling back
 * to "treat as long-term member" if not provided. That's the safe
 * default — better to serve the cohort plan than the empty primer
 * shell when we can't tell when they joined.
 *
 * If the primer is empty (member joined before Mick filled it in),
 * we transparently fall back to the regular cohort block so the
 * member never sees a blank plan.
 */
async function loadCurrentPlan (joinedAt) {
  const baseKey = getCurrentPlanKey();
  const PRIMER_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;

  let inPrimerWindow = false;
  if (joinedAt) {
    const t = (joinedAt instanceof Date) ? joinedAt.getTime() : Date.parse(joinedAt);
    if (!isNaN(t)) {
      inPrimerWindow = (Date.now() - t) < PRIMER_WINDOW_MS;
    }
  }

  if (inPrimerWindow) {
    const primer = await loadPublishedPlan(baseKey + '_primer');
    if (primer && !primer.isEmpty) {
      // Decorate so the dashboard can show the "settling-in" banner.
      primer.isPrimer = true;
      return primer;
    }
    // Fall through to the cohort plan if the primer hasn't been
    // published yet — better than a blank dashboard.
  }
  return await loadPublishedPlan(baseKey);
}

/* Force a fresh fetch (bypasses cache) — useful when the user
   switches discipline or returns to a tab after editing. */
async function reloadPublishedPlan (planKey) {
  delete __publishedCache[planKey];
  return await loadPublishedPlan(planKey);
}

/* ============================================================
   DRAFT loaders — only used in coach Preview-as-member mode.
   These bypass the normal "members never see drafts" isolation
   above; the calling page MUST gate on isCurrentUserCoach()
   before invoking either of these.
   ============================================================ */

/* Load the DRAFT version of a Progressive discipline plan.
   Falls back to the published version if no draft has been
   started yet (so the preview always shows something). */
async function loadDraftProgressivePlan (planKey) {
  if (!VALID_PLAN_KEYS.includes(planKey)) {
    console.warn('published-plans — invalid key for draft', planKey);
    planKey = 'prone';
  }
  if (typeof sb === 'undefined') return null;

  const { data, error } = await sb
    .from('progressive_plans')
    .select('key, meta, programs, draft_meta, draft_programs, last_edited, published_at')
    .eq('key', planKey)
    .maybeSingle();
  if (error) { console.warn('published-plans — draft load failed', error); return null; }
  if (!data)  return null;

  // Prefer draft fields when populated; otherwise fall back to published.
  const draftMeta     = (data.draft_meta     && Object.keys(data.draft_meta).length)     ? data.draft_meta     : null;
  const draftPrograms = Array.isArray(data.draft_programs) && data.draft_programs.length ? data.draft_programs : null;
  return rowToProgram({
    meta:         draftMeta || data.meta,
    programs:     draftPrograms || data.programs,
    last_edited:  data.last_edited,
    published_at: data.published_at,
  });
}

/* Load the DRAFT custom plan for a single member. */
async function loadDraftCustomPlan (memberId) {
  if (typeof sb === 'undefined' || !memberId) return null;
  const { data, error } = await sb
    .from('custom_plans')
    .select('member_id, meta, programs, draft_meta, draft_programs, last_edited, published_at')
    .eq('member_id', memberId)
    .maybeSingle();
  if (error) { console.warn('published-plans — custom draft load failed', error); return null; }
  if (!data)  return null;

  const draftMeta     = (data.draft_meta     && Object.keys(data.draft_meta).length)     ? data.draft_meta     : null;
  const draftPrograms = Array.isArray(data.draft_programs) && data.draft_programs.length ? data.draft_programs : null;
  return rowToProgram({
    meta:         draftMeta || data.meta,
    programs:     draftPrograms || data.programs,
    last_edited:  data.last_edited,
    published_at: data.published_at,
  });
}

/* Per-discipline session completion key.
   Format: "{planKey}-w{weekNum}s{sessionNum}" e.g. "prone-w2s3".
   Replaces the legacy "p1w2s3" format which didn't track discipline. */
function memberSessionKey (planKey, weekNum, sessionNum) {
  return planKey + '-w' + weekNum + 's' + sessionNum;
}
