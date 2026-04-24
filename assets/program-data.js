/* ============================================================
   ALL PADDLING — shared program data + pace math
   Loaded by BOTH the public pace calculator AND the /app/ pages
   so the same source of truth drives both.
   ============================================================ */

/* ---- Training zones (percent of FTP / threshold pace) ---- */
const ZONES = [
  { key: 'tz1', label: 'TZ1', name: 'Recovery',   purpose: 'Easy aerobic · active recovery',     lo: 0.00, hi: 0.77 },
  { key: 'tz2', label: 'TZ2', name: 'Endurance',  purpose: 'Aerobic base · long distance',       lo: 0.88, hi: 0.94 },
  { key: 'tz3', label: 'TZ3', name: 'Threshold',  purpose: 'Tempo · lactate threshold',          lo: 1.00, hi: 1.04 },
  { key: 'tz4', label: 'TZ4', name: 'VO₂max',     purpose: 'Hard intervals · aerobic power',     lo: 1.04, hi: 1.11 },
  { key: 'tz5', label: 'TZ5', name: 'Sprint',     purpose: 'Max effort · anaerobic capacity',    lo: 1.11, hi: 999 },
];

/* ---- Time formatting ---- */
function formatSeconds(s) {
  if (!isFinite(s) || s <= 0) return '—';
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/* ---- Pace math ----
   Higher %FTP = FASTER pace = lower time.
   For a zone [lo, hi] of FTP:
     - fastest time = FTP_seconds / hi
     - slowest time = FTP_seconds / lo
   Display the range "slowest – fastest" (bigger number first).
*/
function zonePaceRange(zone, ftpSec) {
  if (ftpSec <= 0) return { label: '—' };
  if (zone.key === 'tz1') {
    return { label: `slower than ${formatSeconds(ftpSec / zone.hi)}` };
  }
  if (zone.key === 'tz5') {
    return { label: `faster than ${formatSeconds(ftpSec / zone.lo)}` };
  }
  const slow = ftpSec / zone.lo;
  const fast = ftpSec / zone.hi;
  return { label: `${formatSeconds(slow)} – ${formatSeconds(fast)}` };
}

function unitLabel(unit) {
  return unit === 'imperial' ? '/ mile' : '/ km';
}

/* ---- Focus-tag colour class ---- */
function focusClass(f) {
  const s = (f || '').toUpperCase();
  if (s.includes('AEROBIC CAPACITY'))    return 'f-aer-cap';
  if (s.includes('ANAEROBIC THRESHOLD')) return 'f-ana-th';
  if (s.includes('ANAEROBIC CAPACITY'))  return 'f-ana-cap';
  return 'f-aer-th';
}

/* ---- Interval HTML (pure — takes ftp + unit as args) ---- */
function renderIntervalHtml(iv, ftpSec, unit) {
  const zone = ZONES[iv.z - 1];
  const range = zonePaceRange(zone, ftpSec);
  const u = unitLabel(unit);
  return `
    <div class="interval" data-zone="${iv.z}">
      <div class="interval-zone">TZ ${iv.z}</div>
      <div class="interval-desc">${iv.d}</div>
      <div class="interval-pace">${range.label} ${u}</div>
    </div>
  `;
}

/* ---- Session card HTML ---- */
function renderSessionCardHtml(session, index, ftpSec, unit, options) {
  options = options || {};
  const focus = session.focus
    .map(f => `<span class="focus-tag ${focusClass(f)}">${f}</span>`)
    .join('');

  let body;
  if (session.longSteady) {
    body = `
      <div class="session-intervals">
        ${renderIntervalHtml({z: session.longSteady.z, d: session.longSteady.d}, ftpSec, unit)}
      </div>
      <div class="session-repeat steady">Single steady effort</div>
    `;
  } else {
    const warm = (session.warmup || []).map(iv => renderIntervalHtml(iv, ftpSec, unit)).join('');
    const setBlock = (session.set || []).map(iv => renderIntervalHtml(iv, ftpSec, unit)).join('');
    body = `
      <div class="session-intervals">
        ${warm}
        ${setBlock}
      </div>
      <div class="session-repeat">↻ Repeat all ${session.repeat} times</div>
    `;
  }

  const titleSuffix = options.titleSuffix || '';
  const completed = !!options.completed;
  const completedClass = completed ? ' completed' : '';
  const href = options.href;
  const wrapper = href
    ? `<a class="session-card session-card-link${completedClass}" href="${href}">`
    : `<div class="session-card${completedClass}">`;
  const wrapperClose = href ? `</a>` : `</div>`;

  const checkBadge = completed
    ? `<span class="session-check" aria-label="Completed">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20,6 9,17 4,12"/></svg>
       </span>`
    : '';

  return `
    ${wrapper}
      <div class="session-head">
        <div class="session-num">${checkBadge}Session ${index + 1}${titleSuffix}</div>
        <div class="session-focus">${focus}</div>
      </div>
      ${body}
    ${wrapperClose}
  `;
}

/* ---- Program 1: Aerobic base + intro intensity — 4 weeks ---- */
const PROGRAM_1 = {
  name: 'Program 1',
  subtitle: 'Aerobic base · intro intensity',
  weeks: [
    {
      label: 'Week 1',
      startDate: '30 Mar',
      note: 'Introduction week — establish rhythm and get familiar with the zones.',
      sessions: [
        {
          focus: ['AEROBIC THRESHOLD', 'AEROBIC CAPACITY'],
          warmup: [{z:1, d:'2 min'}],
          set: [
            {z:4, d:'20 sec'},
            {z:2, d:'60 sec'},
            {z:4, d:'20 sec'},
            {z:2, d:'3 min'},
            {z:4, d:'20 sec'}
          ],
          repeat: 8
        },
        {
          focus: ['ANAEROBIC THRESHOLD', 'AEROBIC THRESHOLD'],
          warmup: [{z:1, d:'2 min'}],
          set: [
            {z:3, d:'1 min'},
            {z:2, d:'1 min'},
            {z:3, d:'2 min'},
            {z:2, d:'2 min'},
            {z:3, d:'2 min'}
          ],
          repeat: 6
        },
        {
          focus: ['AEROBIC THRESHOLD'],
          warmup: [{z:1, d:'2 min'}],
          set: [
            {z:2, d:'2 min'},
            {z:1, d:'1 min'},
            {z:2, d:'4 min'}
          ],
          repeat: 6
        },
        {
          focus: ['AEROBIC THRESHOLD'],
          longSteady: {z:2, d:'60 minutes'}
        }
      ]
    },
    {
      label: 'Week 2',
      startDate: '6 Apr',
      note: 'Volume build — more reps at the same intensity.',
      sessions: [
        {
          focus: ['AEROBIC THRESHOLD', 'AEROBIC CAPACITY'],
          warmup: [{z:1, d:'2 min'}],
          set: [
            {z:4, d:'20 sec'},
            {z:2, d:'60 sec'},
            {z:4, d:'20 sec'},
            {z:2, d:'3 min'},
            {z:4, d:'20 sec'}
          ],
          repeat: 10
        },
        {
          focus: ['ANAEROBIC THRESHOLD', 'AEROBIC THRESHOLD'],
          warmup: [{z:1, d:'3 min'}],
          set: [
            {z:3, d:'1 min'},
            {z:2, d:'1 min'},
            {z:3, d:'2 min'},
            {z:2, d:'2 min'},
            {z:3, d:'2 min'}
          ],
          repeat: 7
        },
        {
          focus: ['AEROBIC THRESHOLD'],
          warmup: [{z:1, d:'3 min'}],
          set: [
            {z:2, d:'2 min'},
            {z:1, d:'1 min'},
            {z:2, d:'5 min'}
          ],
          repeat: 7
        },
        {
          focus: ['AEROBIC THRESHOLD'],
          longSteady: {z:2, d:'75 minutes'}
        }
      ]
    },
    {
      label: 'Week 3',
      startDate: '13 Apr',
      note: 'Intensity build — the intervals get sharper.',
      sessions: [
        {
          focus: ['AEROBIC CAPACITY', 'ANAEROBIC CAPACITY'],
          warmup: [{z:1, d:'3 min'}],
          set: [
            {z:4, d:'30 sec'},
            {z:2, d:'60 sec'},
            {z:4, d:'30 sec'},
            {z:2, d:'3 min'},
            {z:4, d:'30 sec'}
          ],
          repeat: 8
        },
        {
          focus: ['ANAEROBIC THRESHOLD'],
          warmup: [{z:1, d:'3 min'}],
          set: [
            {z:3, d:'2 min'},
            {z:2, d:'1 min'},
            {z:3, d:'2 min'},
            {z:2, d:'1 min'},
            {z:3, d:'2 min'}
          ],
          repeat: 6
        },
        {
          focus: ['AEROBIC THRESHOLD'],
          warmup: [{z:1, d:'3 min'}],
          set: [
            {z:2, d:'3 min'},
            {z:1, d:'1 min'},
            {z:2, d:'4 min'}
          ],
          repeat: 6
        },
        {
          focus: ['AEROBIC THRESHOLD'],
          longSteady: {z:2, d:'75 minutes'}
        }
      ]
    },
    {
      label: 'Week 4',
      startDate: '20 Apr',
      note: 'Recovery + threshold test. Reduced volume, then retest your 3-minute pace.',
      sessions: [
        {
          focus: ['AEROBIC THRESHOLD'],
          warmup: [{z:1, d:'2 min'}],
          set: [
            {z:4, d:'20 sec'},
            {z:2, d:'60 sec'},
            {z:4, d:'20 sec'},
            {z:2, d:'3 min'},
            {z:4, d:'20 sec'}
          ],
          repeat: 6
        },
        {
          focus: ['ANAEROBIC CAPACITY'],
          warmup: [{z:1, d:'5 min'}],
          set: [
            {z:5, d:'3 min'}
          ],
          repeat: 1
        },
        {
          focus: ['AEROBIC THRESHOLD'],
          warmup: [{z:1, d:'3 min'}],
          set: [
            {z:2, d:'2 min'},
            {z:1, d:'1 min'},
            {z:2, d:'4 min'}
          ],
          repeat: 5
        },
        {
          focus: ['AEROBIC THRESHOLD'],
          longSteady: {z:2, d:'45 minutes'}
        }
      ]
    }
  ]
};

/* ---- Collected programs (for future expansion: PROGRAM_2, PROGRAM_3, PROGRAM_4) ---- */
const PROGRAMS = [PROGRAM_1];

/* ---- Lookup helpers ---- */
function getProgram(programNum) {
  return PROGRAMS[programNum - 1] || null;
}

function getWeek(programNum, weekNum) {
  const p = getProgram(programNum);
  if (!p) return null;
  return p.weeks[weekNum - 1] || null;
}

function getSession(programNum, weekNum, sessionNum) {
  const w = getWeek(programNum, weekNum);
  if (!w) return null;
  return w.sessions[sessionNum - 1] || null;
}

function sessionKey(programNum, weekNum, sessionNum) {
  return `p${programNum}w${weekNum}s${sessionNum}`;
}

function sessionTitle(session) {
  return (session.focus || []).join(' · ');
}
