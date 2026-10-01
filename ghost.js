/* ghost.js — the ghost race (#11): a run's pace, kept as a timeline, and the
 * best run's pace replayed against the clock.
 *
 * Pure: no DOM, no clock. main.js passes the elapsed time in (the run's own
 * clock, hint and smoker penalties included, the same time the run records).
 *
 * A timeline is the elapsed ms at each 5% of the frame's progress: 20
 * non-decreasing integers, the last one the finish time. Progress is counted
 * past the opening, as the sound's climb is (mixer.js): opened safe cells
 * beyond the ones the opening uncapped, over the safe cells it left capped.
 * Every frame's 20 steps then span the play itself, however big its opening.
 * It reads only what the board shows (which cells are uncapped, and the
 * hive's totals), never a hidden cell, so the bars it drives tell nothing.
 *
 * Stored in a jar (pantry.js) a timeline is compacted to 38 base-36
 * characters: checkpoints 1–19 as two-digit fractions (0–1295) of the jar's
 * best time, which is the 20th. See `encode`.
 */

import { nbrsOf, floods } from './core.js';

export const STEPS = 20;
const SCALE = 36 * 36 - 1;                 // two base-36 digits: 0..1295

// ── progress (public: open cells and the hive's totals) ─────────────────

/** How many cells a frame's opening uncaps (a flood from s.start over open comb). */
export function openingOf(s) {
  const nbrs = nbrsOf(s.cols, s.rows);
  const seen = new Set([s.start]), stack = [s.start];
  while (stack.length) {
    const c = stack.pop();
    if (floods(s, c)) for (const j of nbrs[c]) if (!seen.has(j)) { seen.add(j); stack.push(j); }
  }
  return seen.size;
}

/**
 * How far past its opening a frame is: { done, total } in cells. `opening`
 * is openingOf(s), which the caller keeps for the run. The cell that stung
 * is open but isn't safe, so it doesn't count.
 */
export function progressOf(s, opening = openingOf(s)) {
  let open = 0;
  for (let i = 0; i < s.open.length; i++) if (s.open[i] && i !== s.stung) open++;
  const total = s.cols * s.rows - s.guards - s.queens - opening;
  return { done: Math.max(0, Math.min(total, open - opening)), total: Math.max(0, total) };
}

/** Checkpoints reached: 0..20. Integer maths, so 5% means exactly 5%. */
export function reached(done, total) {
  if (!(total > 0)) return STEPS;
  return Math.max(0, Math.min(STEPS, Math.floor((STEPS * done) / total)));
}

/** done/total as 0..1 (1 for a frame its opening finished). */
export const fraction = (done, total) => (total > 0 ? Math.max(0, Math.min(1, done / total)) : 1);

// ── recording ───────────────────────────────────────────────────────────

/** A timeline this module can trust, or null: 0..20 non-decreasing whole ms. */
export function restore(tl) {
  if (!Array.isArray(tl) || tl.length > STEPS) return null;
  let last = 0;
  for (const v of tl) {
    if (!Number.isInteger(v) || v < last) return null;
    last = v;
  }
  return tl.slice();
}

/**
 * The timeline after a move: every checkpoint newly reached gets `ms`. A
 * flood that crosses three checkpoints stamps all three with the same time.
 * Returns the same array when nothing new was reached.
 */
export function record(tl, done, total, ms) {
  const k = reached(done, total);
  if (tl.length >= k) return tl;
  const t = Math.max(Math.round(ms), tl.length ? tl[tl.length - 1] : 0);
  const out = tl.slice();
  while (out.length < k) out.push(t);
  return out;
}

/**
 * The finished run's timeline: all 20 checkpoints, the last exactly the time
 * the run records. Nothing may sit later than the finish.
 */
export function finish(tl, ms) {
  const t = Math.round(ms);
  const out = (restore(tl) || []).map((v) => Math.min(v, t));
  while (out.length < STEPS) out.push(t);
  out[STEPS - 1] = t;
  return out;
}

/** A finished timeline: 20 non-decreasing whole ms. */
export const complete = (tl) => !!restore(tl) && tl.length === STEPS;

// ── racing ──────────────────────────────────────────────────────────────

/**
 * The ghost's progress (0..1) at `ms` on the clock: a straight line between
 * its checkpoints, starting from (0 ms, 0). Where a flood stamped several
 * checkpoints at once, the ghost jumps, as the run did.
 */
export function ghostAt(tl, ms) {
  if (!complete(tl)) return 0;
  if (!(ms > 0)) return 0;
  for (let k = 0; k < STEPS; k++) {
    if (tl[k] > ms) {
      const t0 = k ? tl[k - 1] : 0, p0 = k / STEPS;
      return p0 + (ms - t0) / (tl[k] - t0) / STEPS;
    }
  }
  return 1;
}

/** Seconds for the finish sheet: "12.4 s", or "1:05.2" past a minute. */
export function gap(ms) {
  const d = Math.round(Math.abs(ms) / 100) / 10;
  if (d < 60) return `${d.toFixed(1)} s`;
  const m = Math.floor(d / 60);
  return `${m}:${(d - m * 60).toFixed(1).padStart(4, '0')}`;
}

/** The finish sheet's line, for a run of `ms` against a ghost of `ghostMs`. */
export function raceLine(ms, ghostMs) {
  const d = Math.round(ms) - Math.round(ghostMs);
  if (Math.abs(d) < 50) return 'Dead heat with your ghost';
  return d < 0 ? `Beat your ghost by ${gap(d)}` : `Ghost won by ${gap(d)}`;
}

// ── storage ─────────────────────────────────────────────────────────────

/**
 * A finished timeline → 38 characters: checkpoints 1–19 as fractions of the
 * finish time (tl[19]), two base-36 digits each. 1296 steps: a 5-minute
 * run's checkpoints keep to within ±0.12 s. The 20th is the jar's own time,
 * so it isn't stored. null for anything that isn't a finished timeline.
 */
export function encode(tl) {
  if (!complete(tl)) return null;
  const t = tl[STEPS - 1];
  let out = '';
  for (let k = 0; k < STEPS - 1; k++) {
    const q = t > 0 ? Math.round((tl[k] / t) * SCALE) : SCALE;
    out += q.toString(36).padStart(2, '0');
  }
  return out;
}

/** 38 characters and the jar's time → the timeline, or null if it isn't one. */
export function decode(g, t) {
  if (typeof g !== 'string' || g.length !== (STEPS - 1) * 2 || !/^[0-9a-z]+$/.test(g)) return null;
  if (!Number.isInteger(t) || t < 0) return null;
  const tl = [];
  let last = 0;
  for (let k = 0; k < STEPS - 1; k++) {
    const q = parseInt(g.slice(2 * k, 2 * k + 2), 36);
    if (q > SCALE || q < last) return null;
    last = q;
    tl.push(Math.round((q / SCALE) * t));
  }
  tl.push(t);
  return complete(tl) ? tl : null;
}
