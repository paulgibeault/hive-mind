/* core.js — Hive Mind: the rules. Seeded, deterministic; no DOM, no clock.
 *
 * A FRAME of honeycomb hides wasps. Uncap a cell and it tells you how many
 * of its six neighbours hide one. Uncap every safe cell to take the honey;
 * uncap a wasp and you are stung.
 *
 * Three hives, each adding one idea to that:
 *   meadow   the plain comb — one kind of wasp
 *   orchard  wasps AND hornets; a cell counts each kind separately
 *   wild     one kind, but some cells are CRACKED: their number is off by
 *            exactly one, up or down. The crack is visible; the lie is fair.
 *
 * Every frame is fixed by (hive, seed) and ships with its OPENING already
 * uncapped. The generator keeps only frames the solver (solver.js) can
 * finish from that opening by logic alone — there is never a forced guess —
 * which is also what makes the Daily Frame and, later, racing and split sight
 * possible: the same seed is the same frame on every device.
 */

import { makeRng } from './arcade-rng.js';
import { neighbours } from './hex.js';
import { solve, SAFE, WASP, HORNET } from './solver.js';

export const HIVES = [
  { id: 'meadow',  name: 'Meadow',  cols: 8, rows: 15, wasps: 23, hornets: 0,  cracked: 0 },
  { id: 'orchard', name: 'Orchard', cols: 9, rows: 18, wasps: 18, hornets: 13, cracked: 0 },
  { id: 'wild',    name: 'Wild',    cols: 9, rows: 18, wasps: 31, hornets: 0,  cracked: 20 },
];
export const hiveById = (id) => HIVES.find((h) => h.id === id) || HIVES[0];

// Sizes fill a portrait phone (the frame is width-bound at 8–9 cells across).
// Densities (~19%) are first guesses, set so a fair frame still turns up in a
// handful of tries (a millisecond or two); tune them by playtest.

// a cell's contents
export const EMPTY = 0, W = 1, H = 2;
// a player's mark on a hidden cell
export const NONE = 0, MARK_W = 1, MARK_H = 2;

const MAX_TRIES = 4000;

const nbrCache = new Map();
export function nbrsOf(cols, rows) {
  const k = `${cols}x${rows}`;
  if (!nbrCache.has(k)) nbrCache.set(k, neighbours(cols, rows));
  return nbrCache.get(k);
}

/** What cell i reads, from the contents alone (no crack applied). */
function count(nbrs, cells, i) {
  let w = 0, h = 0;
  for (const j of nbrs[i]) { if (cells[j] === W) w++; else if (cells[j] === H) h++; }
  return { w, h };
}

/** The clue a revealed cell shows: { wasps, hornets } or, cracked, { total }. */
export function clueOf(f, i) {
  if (f.cracked[i]) return { total: f.shown[i] };
  return { wasps: f.shown[i], hornets: f.shownH[i] };
}

/** Does uncapping this cell open its neighbours too? (A plain zero.) */
export const floods = (f, i) => !f.cracked[i] && f.shown[i] === 0 && f.shownH[i] === 0;

/** Uncap i and flood from it; returns every index newly opened. */
function flood(f, nbrs, open, i) {
  const out = [];
  const stack = [i];
  while (stack.length) {
    const c = stack.pop();
    if (open[c]) continue;
    open[c] = 1;
    out.push(c);
    if (f.cells[c] === EMPTY && floods(f, c)) for (const j of nbrs[c]) if (!open[j]) stack.push(j);
  }
  return out;
}

/** Can a careful player finish f from its opening? */
export function solvable(f) {
  const nbrs = nbrsOf(f.cols, f.rows);
  const n = f.cols * f.rows;
  const kinds = f.hornets > 0 ? SAFE | WASP | HORNET : SAFE | WASP;
  const dom = new Uint8Array(n).fill(kinds);
  const opened = new Uint8Array(n);
  const open = (i) => { for (const c of flood(f, nbrs, opened, i)) dom[c] = SAFE; };
  open(f.start);
  return solve(nbrs, dom, (i) => (f.cells[i] === EMPTY ? clueOf(f, i) : null), open, opened);
}

/* One candidate frame from the stream. */
function candidate(hive, rng) {
  const { cols, rows } = hive;
  const n = cols * rows;
  const nbrs = nbrsOf(cols, rows);
  // the opening: a cell near the middle, it and its ring kept clear so it floods
  const cx = (cols >> 1) + rng.int(-1, 1), cy = (rows >> 1) + rng.int(-2, 2);
  const start = cy * cols + cx;
  const clear = new Set([start, ...nbrs[start]]);
  const pool = rng.shuffle([...Array(n).keys()].filter((i) => !clear.has(i)));
  const cells = new Array(n).fill(EMPTY);
  pool.slice(0, hive.wasps).forEach((i) => { cells[i] = W; });
  pool.slice(hive.wasps, hive.wasps + hive.hornets).forEach((i) => { cells[i] = H; });

  const shown = new Array(n).fill(0), shownH = new Array(n).fill(0), cracked = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const c = count(nbrs, cells, i);
    shown[i] = c.w; shownH[i] = c.h;
  }
  if (hive.cracked) {
    // cracks go on safe cells outside the opening that have something to lie about
    const safe = rng.shuffle([...Array(n).keys()].filter((i) => cells[i] === EMPTY && !clear.has(i)));
    let placed = 0;
    for (const i of safe) {
      if (placed >= hive.cracked) break;
      const t = shown[i];
      const deg = nbrs[i].length;
      // never show a cracked 0: it can only mean 1, and reads like a mistake
      const dirs = [t - 1, t + 1].filter((d) => d >= 1 && d <= deg);
      if (!dirs.length) continue;
      shown[i] = rng.pick(dirs);
      cracked[i] = 1;
      placed++;
    }
  }
  return { cols, rows, wasps: hive.wasps, hornets: hive.hornets, cells, shown, shownH, cracked, start };
}

/** The frame for (hive, seed). Deterministic: same seed, same frame, anywhere. */
export function generate(hiveId, seed) {
  const hive = hiveById(hiveId);
  const rng = makeRng(seed >>> 0);
  for (let t = 0; t < MAX_TRIES; t++) {
    const f = candidate(hive, rng);
    if (solvable(f)) return { ...f, hive: hive.id, seed: seed >>> 0, tries: t + 1 };
  }
  throw new Error(`no fair ${hive.id} frame from seed ${seed}`);
}

// ── play ─────────────────────────────────────────────────────────────────

/** A new game on (hive, seed). The opening is already uncapped. */
export function newGame(hiveId, seed) {
  const f = generate(hiveId, seed);
  const n = f.cols * f.rows;
  const s = {
    v: 1, ...f,
    open: new Array(n).fill(0),
    mark: new Array(n).fill(NONE),
    phase: 'play',            // play | won | lost
    stung: -1,                // the cell that stung, when lost
    moves: 0,
    events: [],
  };
  flood(s, nbrsOf(s.cols, s.rows), s.open, s.start);
  return s;
}

export const safeLeft = (s) => s.open.reduce((k, o, i) => k + (!o && s.cells[i] === EMPTY ? 1 : 0), 0);
export const marksOf = (s, kind) => s.mark.reduce((k, m) => k + (m === kind ? 1 : 0), 0);

function uncap(s, i) {
  const nbrs = nbrsOf(s.cols, s.rows);
  if (s.cells[i] !== EMPTY) {
    s.open[i] = 1;
    s.phase = 'lost';
    s.stung = i;
    s.events.push({ type: 'sting', cell: i, kind: s.cells[i] });
    return;
  }
  const opened = flood(s, nbrs, s.open, i);
  for (const c of opened) s.mark[c] = NONE;
  s.events.push({ type: 'uncap', cell: i, cells: opened });
  if (safeLeft(s) === 0) {
    s.phase = 'won';
    s.events.push({ type: 'won' });
  }
}

/** Uncap a hidden cell. Marked cells are protected. */
export function reveal(s, i) {
  if (s.phase !== 'play' || s.open[i] || s.mark[i] !== NONE) return false;
  s.moves++;
  uncap(s, i);
  return true;
}

/** Cycle a hidden cell's mark: none → wasp (→ hornet, in an orchard) → none. */
export function mark(s, i) {
  if (s.phase !== 'play' || s.open[i]) return false;
  const top = s.hornets > 0 ? MARK_H : MARK_W;
  s.mark[i] = s.mark[i] >= top ? NONE : s.mark[i] + 1;
  s.events.push({ type: 'mark', cell: i, mark: s.mark[i] });
  return true;
}

/** Set a mark directly (for a long-press menu or a keyboard). */
export function setMark(s, i, m) {
  if (s.phase !== 'play' || s.open[i]) return false;
  s.mark[i] = m;
  s.events.push({ type: 'mark', cell: i, mark: m });
  return true;
}

/**
 * Sweep around an uncapped plain number whose marks already account for it:
 * every unmarked hidden neighbour is uncapped. Cracked cells can't be swept.
 * Marks are the player's word — a wrong mark here stings, as in the classic.
 */
export function sweep(s, i) {
  if (s.phase !== 'play' || !s.open[i] || s.cells[i] !== EMPTY || s.cracked[i]) return false;
  const nbrs = nbrsOf(s.cols, s.rows);
  let mw = 0, mh = 0;
  for (const j of nbrs[i]) {
    if (s.open[j] && s.cells[j] === EMPTY) continue;
    if (s.mark[j] === MARK_W) mw++;
    else if (s.mark[j] === MARK_H) mh++;
  }
  const want = s.hornets > 0 ? [s.shown[i], s.shownH[i]] : [s.shown[i], 0];
  // one-kind hives: any mark counts toward the one kind
  const ok = s.hornets > 0 ? mw === want[0] && mh === want[1] : mw + mh === want[0];
  const targets = nbrs[i].filter((j) => !s.open[j] && s.mark[j] === NONE);
  if (!ok || !targets.length) return false;
  s.moves++;
  for (const j of targets) {
    if (s.phase !== 'play') break;
    if (!s.open[j]) uncap(s, j);
  }
  return true;
}

/** The one gesture: tap a hidden cell to uncap it, a number to sweep it. */
export function tap(s, i) {
  return s.open[i] ? sweep(s, i) : reveal(s, i);
}

/** A human-sized board code for a frame, e.g. "OR-5K2QX". */
export function boardCode(hiveId, seed) {
  return `${hiveId.slice(0, 2).toUpperCase()}-${(seed >>> 0).toString(36).toUpperCase().padStart(7, '0')}`;
}
export function parseCode(code) {
  const m = /^\s*([A-Za-z]{2})-([0-9A-Za-z]{1,7})\s*$/.exec(code || '');
  if (!m) return null;
  const hive = HIVES.find((h) => h.id.slice(0, 2) === m[1].toLowerCase());
  const seed = parseInt(m[2], 36);
  if (!hive || !Number.isFinite(seed) || seed > 0xffffffff) return null;
  return { hive: hive.id, seed: seed >>> 0 };
}
