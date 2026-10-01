/* pantry.js — the jars a player has filled, and the month drawn as comb.
 *
 * Pure: plain data in, plain data out. No DOM, no clock: main.js passes the
 * date in and keeps the result in Arcade.stats('pantry').
 *
 * Every cleared frame fills a jar. Read back, a jar is
 *
 *   { code, hive, seed, ms, pure, clean, hints, puffs, date, n }
 *
 * where `date` is the local day it was filled ('2026-09-21') and `n` its
 * number in the pantry (jar 16 is the sixteenth ever filled).
 *
 * Stored, it is smaller, so 600 jars stay well under 50 KB: per hive, a list
 * of { s: seed, t: ms, d: day number, n, c: clean, h: hints, f: puffs, p: 1 }
 * with the zero counts and a false `p` left out; the hive and the code come
 * from where the jar sits. The pantry itself is
 *
 *   { v: 1, made: <jars ever filled>, hives: { <id>: { jars: [...], older: { jars, pure } } } }
 *
 * Per hive the newest KEEP jars are kept whole, oldest first; older ones fold
 * into `older`, which only counts. A frame cleared again updates its own jar
 * (the best time, and Pure once earned) instead of filling another; a jar
 * already folded into `older` can't be found, so its frame fills a new one.
 *
 * Nothing is ever backfilled: a save from before the pantry has none.
 *
 * The ghost race (#11): a jar may also carry `g`, the pace of the run that
 * set its best time (ghost.js's 38-character timeline, read back against
 * `t`). It is written only when a clear sets the jar's best time, and only
 * the GHOSTS newest-filled jars per hive keep one, so 600 jars still fit the
 * budget. A jar without `g` (an old one, or one past that line) has no ghost.
 */

import { boardCode } from './core.js';
import { encode as encodeGhost, decode as decodeGhost } from './ghost.js';

export const KEEP = 200;
export const GHOSTS = 50;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── dates (strings and day numbers; no clock) ───────────────────────────
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** 'YYYY-MM-DD' → days since 1970-01-01, or NaN. */
export function dayNumber(date) {
  const m = DATE_RE.exec(date || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN;
}
/** days since 1970-01-01 → 'YYYY-MM-DD'. */
export function dateOf(day) {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}
/** '2026-09-21' → '21 Sep'. */
export function shortDate(date) {
  const m = DATE_RE.exec(date || '');
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]}` : '';
}
/** '2026-09-28' → 'Mon 28 Sep'. */
export function dayDate(date) {
  const d = dayNumber(date);
  return Number.isFinite(d) ? `${DAYS[(d + 4) % 7]} ${shortDate(date)}` : '';
}

// ── the store ───────────────────────────────────────────────────────────
export const empty = () => ({ v: 1, made: 0, hives: {} });

const nat = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Whatever was stored (or imported) → a pantry this module can trust. */
export function normalize(p) {
  if (!p || typeof p !== 'object' || !p.hives || typeof p.hives !== 'object') return empty();
  const out = { v: 1, made: nat(p.made), hives: {} };
  for (const [id, h] of Object.entries(p.hives)) {
    if (!h || typeof h !== 'object') continue;
    const jars = (Array.isArray(h.jars) ? h.jars : [])
      .filter((j) => j && Number.isFinite(j.s) && Number.isFinite(j.t) && Number.isFinite(j.d));
    const older = { jars: nat(h.older && h.older.jars), pure: nat(h.older && h.older.pure) };
    out.hives[id] = { jars, older };
    for (const j of jars) out.made = Math.max(out.made, nat(j.n));
  }
  return out;
}

const pack = (r, n) => {
  const j = { s: r.seed >>> 0, t: Math.round(r.ms), d: dayNumber(r.date), n };
  if (nat(r.clean)) j.c = nat(r.clean);
  if (nat(r.hints)) j.h = nat(r.hints);
  if (nat(r.puffs)) j.f = nat(r.puffs);
  if (r.pure) j.p = 1;
  return j;
};
const unpack = (hive, j) => ({
  code: boardCode(hive, j.s), hive, seed: j.s, ms: j.t, pure: !!j.p,
  clean: j.c || 0, hints: j.h || 0, puffs: j.f || 0, date: dateOf(j.d), n: j.n || 0,
});

/**
 * A cleared frame, into the pantry.
 *   run = { hive, seed, ms, pure, clean, hints, puffs, date, timeline? }
 * → { pantry, jar (read back), fresh: true for a new jar, false for an update }
 *
 * An update keeps the jar's number and the day it was first filled. Its time
 * is the best of the two; it is Pure if either clear was; and its counts are
 * the better clear's, where a Pure clear beats a faster assisted one.
 */
export function addJar(p, run) {
  const pantry = normalize(p);
  const hive = run.hive;
  const h = pantry.hives[hive] || { jars: [], older: { jars: 0, pure: 0 } };
  const seed = run.seed >>> 0;
  const at = h.jars.findIndex((j) => j.s === seed);
  let jars, jar, fresh;
  if (at >= 0) {
    const was = h.jars[at];
    const better = (run.pure && !was.p) || (!!run.pure === !!was.p && run.ms < was.t);
    jar = better ? pack(run, was.n) : { ...was };
    jar.t = Math.min(was.t, Math.round(run.ms));
    jar.d = was.d;
    if (run.pure || was.p) jar.p = 1;
    // the ghost is the best time's pace: a new best brings its own (or none)
    delete jar.g;
    if (Math.round(run.ms) < was.t) setGhost(jar, run.timeline);
    else if (was.g) jar.g = was.g;
    jars = h.jars.slice();
    jars[at] = jar;
    fresh = false;
  } else {
    pantry.made += 1;
    jar = pack(run, pantry.made);
    setGhost(jar, run.timeline);
    jars = [...h.jars, jar];
    fresh = true;
  }
  jars = trimGhosts(jars, jar);
  const older = { ...h.older };
  while (jars.length > KEEP) {
    const gone = jars.shift();
    older.jars += 1;
    if (gone.p) older.pure += 1;
  }
  pantry.hives = { ...pantry.hives, [hive]: { jars, older } };
  return { pantry, jar: unpack(hive, jar), fresh };
}

function setGhost(jar, tl) {
  const g = Array.isArray(tl) && tl[tl.length - 1] === jar.t ? encodeGhost(tl) : null;
  if (g) jar.g = g;
}

/* Past GHOSTS timelines in a hive, the earliest-filled jars give theirs up,
 * never the one just written. */
function trimGhosts(jars, keep) {
  let n = jars.reduce((k, j) => k + (j.g ? 1 : 0), 0);
  if (n <= GHOSTS) return jars;
  return jars.map((j) => {
    if (n > GHOSTS && j.g && j !== keep) { n--; const { g, ...rest } = j; return rest; }
    return j;
  });
}

/**
 * The ghost a frame races (#11): { ms, timeline } from its jar's best run,
 * or null when it has no jar or its jar keeps no pace.
 */
export function ghostOf(p, hive, seed) {
  const h = p && p.hives && p.hives[hive];
  if (!h || !Array.isArray(h.jars)) return null;
  const j = h.jars.find((x) => x && x.s === seed >>> 0);
  const timeline = j && j.g ? decodeGhost(j.g, j.t) : null;
  return timeline ? { ms: j.t, timeline } : null;
}

/** One hive's whole jars, read back, oldest first. */
export function jarsOf(p, hive) {
  const h = p && p.hives && p.hives[hive];
  return h && Array.isArray(h.jars) ? h.jars.map((j) => unpack(hive, j)) : [];
}

/** One hive's counts: { jars, pure, older } (older: the folded-away ones). */
export function countsOf(p, hive) {
  const h = p && p.hives && p.hives[hive];
  if (!h) return { jars: 0, pure: 0, older: 0 };
  const older = (h.older && h.older.jars) || 0;
  return {
    jars: h.jars.length + older,
    pure: h.jars.filter((j) => j.p).length + ((h.older && h.older.pure) || 0),
    older,
  };
}

/** Every hive's counts summed: { jars, pure }. */
export function totals(p) {
  let jars = 0, pure = 0;
  for (const id of Object.keys((p && p.hives) || {})) {
    const c = countsOf(p, id);
    jars += c.jars; pure += c.pure;
  }
  return { jars, pure };
}

/** The newest `k` whole jars across every hive, oldest first (the menu's mini shelf). */
export function recent(p, k) {
  const all = Object.keys((p && p.hives) || {}).flatMap((id) => jarsOf(p, id));
  return all.sort((a, b) => a.n - b.n).slice(-k);
}

// ── the comb calendar ───────────────────────────────────────────────────
/**
 * The month `today` falls in, as comb: Monday first. `log` is
 * Arcade.stats('daily') ({ date: { ms, hive, pure } }).
 * → { year, month (0-11), name ('September'), lead (blank slots before the
 *     1st), days: [{ day, date, state, pure }], cleared, pure }
 * state: 'cleared' | 'today' | 'missed' | 'future'. Today is 'today' whether
 * or not it's cleared yet; `cleared` on the day says which.
 */
export function combMonth(today, log = {}) {
  const m = DATE_RE.exec(today || '');
  if (!m) return null;
  const year = +m[1], month = +m[2] - 1, now = +m[3];
  const first = Date.UTC(year, month, 1) / 86400000;
  const length = (Date.UTC(year, month + 1, 1) / 86400000) - first;
  const lead = (first + 3) % 7;                      // 1970-01-01 was a Thursday; Monday = 0
  const days = [];
  let cleared = 0, pure = 0;
  for (let d = 1; d <= length; d++) {
    const date = dateOf(first + d - 1);
    const e = log && log[date];
    const done = !!e && d <= now;
    if (done) { cleared++; if (e.pure) pure++; }
    const state = d === now ? 'today' : d > now ? 'future' : done ? 'cleared' : 'missed';
    days.push({ day: d, date, state, cleared: done, pure: done && !!e.pure });
  }
  return { year, month, name: MONTH_NAMES[month], lead, days, cleared, pure };
}
