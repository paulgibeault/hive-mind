/* core.js — Hive Mind: the rules. Seeded, deterministic; no DOM, no clock.
 *
 * A FRAME of honeycomb hides sleeping guard bees. Uncap a cell and it tells
 * you how many of its six neighbours hide one. Uncap every safe cell to take
 * the honey; uncap a guard and you are stung.
 *
 * Three hives, each adding one idea to that:
 *   clover       the plain comb — one kind of guard
 *   apple        guards AND the queen's guards; a cell counts each kind
 *                separately
 *   wildflowers  one kind, but some comb is BROKEN: safe, but it tells you
 *                nothing. The break is drawn once it is uncapped, never before.
 *
 * Every frame is fixed by (hive, seed) and ships with its OPENING already
 * uncapped. The generator keeps only frames the solver (solver.js) can
 * finish from that opening by logic alone — there is never a forced guess —
 * which is also what makes the Daily Frame and, later, racing and split sight
 * possible: the same seed is the same frame on every device.
 */

import { makeRng } from './arcade-rng.js';
import { neighbours } from './hex.js';
import { solve, provenNow as provenFrom, minimalProof as proofFrom, SAFE, GUARD, QUEEN } from './solver.js';

export const HIVES = [
  { id: 'clover',      name: 'Clover Field',  cols: 8, rows: 15, guards: 23, queens: 0,  broken: 0 },
  { id: 'apple',       name: 'Apple Orchard', cols: 9, rows: 18, guards: 18, queens: 13, broken: 0 },
  { id: 'wildflowers', name: 'Wildflowers',   cols: 9, rows: 18, guards: 26, queens: 0,  broken: 12 },
];

// The hives' ids before 2026-09-28. Saves, records and codes from then still
// name them; this map is the one place those names live.
export const OLD_IDS = Object.freeze({ meadow: 'clover', orchard: 'apple', wild: 'wildflowers' });
const current = (id) => (Object.hasOwn(OLD_IDS, id) ? OLD_IDS[id] : id);
export const hiveById = (id) => HIVES.find((h) => h.id === current(id)) || HIVES[0];

// Sizes fill a portrait phone (the frame is width-bound at 8–9 cells across).
// Densities (~19%) are first guesses, set so a fair frame still turns up in a
// handful of tries (a millisecond or two); tune them by playtest.

// a cell's contents
export const EMPTY = 0, G = 1, Q = 2;
// a player's mark on a hidden cell
export const NONE = 0, MARK_G = 1, MARK_Q = 2;

// the solver's domain bits, for reading provenNow / minimalProof
export { SAFE, GUARD, QUEEN };

export const MAX_TRIES = 4000;
// the save format of a game state: 2 since the guards and broken comb
export const SAVE_V = 2;

const nbrCache = new Map();
export function nbrsOf(cols, rows) {
  const k = `${cols}x${rows}`;
  if (!nbrCache.has(k)) nbrCache.set(k, neighbours(cols, rows));
  return nbrCache.get(k);
}

/** What cell i reads, from the contents alone. */
function count(nbrs, cells, i) {
  let g = 0, q = 0;
  for (const j of nbrs[i]) { if (cells[j] === G) g++; else if (cells[j] === Q) q++; }
  return { g, q };
}

/** The clue a revealed cell shows: { guards, queens }, or null for broken comb. */
export function clueOf(f, i) {
  if (f.broken[i]) return null;
  return { guards: f.shown[i], queens: f.shownH[i] };
}

/** Does uncapping this cell open its neighbours too? (A plain zero.) */
export const floods = (f, i) => !f.broken[i] && f.shown[i] === 0 && f.shownH[i] === 0;

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
  const kinds = f.queens > 0 ? SAFE | GUARD | QUEEN : SAFE | GUARD;
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
  pool.slice(0, hive.guards).forEach((i) => { cells[i] = G; });
  pool.slice(hive.guards, hive.guards + hive.queens).forEach((i) => { cells[i] = Q; });

  const shown = new Array(n).fill(0), shownH = new Array(n).fill(0), broken = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const c = count(nbrs, cells, i);
    shown[i] = c.g; shownH[i] = c.q;
  }
  if (hive.broken) {
    // broken comb goes on safe cells outside the opening; its count is kept
    // (the truth), but clueOf() never shows it
    const safe = rng.shuffle([...Array(n).keys()].filter((i) => cells[i] === EMPTY && !clear.has(i)));
    for (const i of safe.slice(0, hive.broken)) broken[i] = 1;
  }
  return { cols, rows, guards: hive.guards, queens: hive.queens, cells, shown, shownH, broken, start };
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
    v: SAVE_V, ...f,
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

/** Cycle a hidden cell's mark: none → guard (→ queen's guard, in Apple Orchard) → none. */
export function mark(s, i) {
  if (s.phase !== 'play' || s.open[i]) return false;
  const top = s.queens > 0 ? MARK_Q : MARK_G;
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
 * every unmarked hidden neighbour is uncapped. Broken comb can't be swept.
 * Marks are the player's word — a wrong mark here stings, as in the classic.
 */
export function sweep(s, i) {
  if (s.phase !== 'play' || !s.open[i] || s.cells[i] !== EMPTY || s.broken[i]) return false;
  const nbrs = nbrsOf(s.cols, s.rows);
  let mg = 0, mq = 0;
  for (const j of nbrs[i]) {
    if (s.open[j] && s.cells[j] === EMPTY) continue;
    if (s.mark[j] === MARK_G) mg++;
    else if (s.mark[j] === MARK_Q) mq++;
  }
  const want = s.queens > 0 ? [s.shown[i], s.shownH[i]] : [s.shown[i], 0];
  // one-kind hives: any mark counts toward the one kind
  const ok = s.queens > 0 ? mg === want[0] && mq === want[1] : mg + mq === want[0];
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

// ── what the player can know ─────────────────────────────────────────────

/* The screen as the solver should see it: which cells are uncapped (safe),
 * and what each shows. Reads s.cells only for uncapped cells, and never
 * reads marks — marks are the player's word, not knowledge. The cell that
 * stung is treated as still hidden, so after a sting these queries describe
 * the board as it was just before the tap ("was it provable?"). */
function onScreen(s) {
  const n = s.cols * s.rows;
  const opened = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (s.open[i] && s.cells[i] === EMPTY) opened[i] = 1;
  return {
    nbrs: nbrsOf(s.cols, s.rows),
    opened,
    clueAt: (i) => (opened[i] ? clueOf(s, i) : null),
    kinds: s.queens > 0 ? SAFE | GUARD | QUEEN : SAFE | GUARD,
  };
}

/**
 * What a careful player can know from the clues on screen now:
 * { safe: Set<i>, guard: Map<i, GUARD|QUEEN> } over hidden cells (solver.js
 * bits). Ignores the global guard count, as the generator's solver does.
 */
export function provenNow(s) {
  const v = onScreen(s);
  return provenFrom(v.nbrs, v.opened, v.clueAt, v.kinds);
}

/**
 * The smallest set of uncapped clue cells that alone proves hidden cell i:
 * { value: SAFE|GUARD|QUEEN, clues: number[] }, or null if i isn't provable
 * now. Pass provenNow(s) as `known` when asking about many cells of one state.
 */
export function minimalProof(s, i, known) {
  const v = onScreen(s);
  return proofFrom(v.nbrs, v.opened, v.clueAt, v.kinds, i, known);
}

/** A human-sized board code for a frame, e.g. "AP-005K2QX". */
export function boardCode(hiveId, seed) {
  return `${hiveId.slice(0, 2).toUpperCase()}-${(seed >>> 0).toString(36).toUpperCase().padStart(7, '0')}`;
}
/* Old codes still parse: the hive id isn't in the RNG, so an old ME-/OR- code
 * is the same frame under its new name. (WI- is WI- either way, but its
 * frames changed with broken comb.) */
const PREFIX = new Map([
  ...Object.entries(OLD_IDS).map(([old, id]) => [old.slice(0, 2), id]),
  ...HIVES.map((h) => [h.id.slice(0, 2), h.id]),
]);
export function parseCode(code) {
  const m = /^\s*([A-Za-z]{2})-([0-9A-Za-z]{1,7})\s*$/.exec(code || '');
  if (!m) return null;
  const hive = PREFIX.get(m[1].toLowerCase());
  const seed = parseInt(m[2], 36);
  if (!hive || !Number.isFinite(seed) || seed > 0xffffffff) return null;
  return { hive, seed: seed >>> 0 };
}
