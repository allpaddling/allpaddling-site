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

/* Plan keys valid in `progressive_plans.key`. Includes 'primer'
   because the primer is stored as a row in the same table and the
   load helpers below need to accept it. The four disciplines are
   the keys a member can be ASSIGNED — primer is computed routing,
   never set on `progressive_members.plan_key` directly. */
const VALID_PLAN_KEYS = ['prone', 'sup', 'oc', 'ski', 'primer'];

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

/* Load the PUBLISHED custom plan for one Custom member.
   Mirror of loadDraftCustomPlan below, but reads only the published
   meta/programs columns — never the draft fields — so members never
   see Mick's in-progress edits.

   Returns:
   - rowToProgram(...) when the row exists. If the row exists but
     published_at is null (Mick has started a draft but not published),
     the returned program has isEmpty=true so the call site can show
     an "awaiting plan" state.
   - null when there is no custom_plans row at all (brand-new signup
     before Mick has started the plan). The caller substitutes its
     usual empty-state placeholder.

   Not cached — custom plans are per-member and unlikely to be hot-cached;
   skipping cache also avoids stale state when a coach exits a
   Preview-as-member session and comes back later. */
async function loadPublishedCustomPlan (memberId) {
  if (typeof sb === 'undefined' || !memberId) return null;
  const { data, error } = await sb
    .from('custom_plans')
    .select('member_id, meta, programs, last_edited, published_at')
    .eq('member_id', memberId)
    .maybeSingle();
  if (error) {
    console.warn('published-plans — custom load failed', error);
    return null;
  }
  return rowToProgram(data);
}

/* Convenience: load the plan a signed-in member should see.
 *
 * Branches on profile.type:
 *
 *   CUSTOM members
 *     Returns the published custom_plans row for profile.id. There is no
 *     primer routing for Custom — Mick writes the entire plan, including
 *     any settling-in content. If no published custom plan exists yet,
 *     returns an isEmpty placeholder (NOT null) so callers don't fall
 *     back to PROGRAM_1 — that legacy default is Progressive content
 *     and would mislead a Custom member into thinking it's their plan.
 *
 *   PROGRESSIVE members (and unauthenticated/coach contexts where
 *   profile is null)
 *     Implements the calendar-cohort + primer model with two ways out
 *     of primer:
 *       - 28-day auto-graduation, driven by profile.createdAt.
 *       - Coach override, driven by profile.primerCompleted (Mick can
 *         flip primer_completed=true on the row to graduate someone
 *         early).
 *     The primer is one shared plan ("primer" in progressive_plans)
 *     that applies regardless of discipline — every new Progressive
 *     member sees the same settling-in content for their first 4
 *     weeks. After they exit primer, they see the calendar block for
 *     THEIR discipline.
 *     If the primer is empty (Mick hasn't filled it in yet), the
 *     loader transparently falls back to the regular cohort block so
 *     members never see a blank plan.
 *
 * Coach "Preview draft" flow (URL ?preview=draft) does NOT call this
 * function — those pages call loadDraftProgressivePlan / loadDraftCustomPlan
 * directly. The coach "View as member" flow (sessionStorage) DOES call
 * this function, via getEffectiveMemberProfile() — and that's the
 * intended path for surfacing the published custom plan to a coach.
 */
async function loadCurrentPlan (profile) {
  // Custom members: published custom plan, no primer routing.
  if (profile && profile.type === 'custom') {
    const plan = await loadPublishedCustomPlan(profile.id);
    if (plan) return plan;
    // No row yet — return an isEmpty placeholder so the call site does
    // NOT fall back to PROGRAM_1 (Progressive content).
    return { name: 'Your custom plan', subtitle: '', weeks: [], isEmpty: true };
  }

  // Progressive (or no profile — coach inspecting without preview).
  const joinedAt        = profile && profile.createdAt;
  const primerCompleted = profile && profile.primerCompleted;
  const baseKey = getCurrentPlanKey();
  const PRIMER_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;

  // Coach already graduated this member — straight to cohort.
  if (primerCompleted) return await loadPublishedPlan(baseKey);

  let inPrimerWindow = false;
  if (joinedAt) {
    const t = (joinedAt instanceof Date) ? joinedAt.getTime() : Date.parse(joinedAt);
    if (!isNaN(t)) {
      inPrimerWindow = (Date.now() - t) < PRIMER_WINDOW_MS;
    }
  }

  if (inPrimerWindow) {
    const primer = await loadPublishedPlan('primer');
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
