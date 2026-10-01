/* reads.js — how a move read: clean or lucky, and whether the frame is still
 * Pure (the frame kind). The module is pure too: no DOM, no clock. main.js
 * asks; core.js stays rules-only.
 *
 * Everything here is decided from the state BEFORE the tap, with one
 * provenNow(s) computed per tap by main.js and passed in:
 *
 *   clean   an uncap whose every cell was in provenNow(s).safe before the tap.
 *           A sweep is clean only if all of its targets were.
 *   lucky   an uncap that succeeded but wasn't provable. No penalty; the
 *           frame just isn't Pure any more.
 *   Pure    cleared with 0 lucky moves, 0 hints (#07) and 0 smoke (#08).
 *
 * No tells: nothing here reads a hidden cell's contents before the move has
 * happened.
 */

import { nbrsOf, EMPTY, NONE } from './core.js';

// ── the run's counters ──────────────────────────────────────────────────

/** A new run's counters. */
export const fresh = () => ({ clean: 0, lucky: 0, hints: 0, puffs: 0 });

/**
 * The counters for a resumed run. Saves from before clean reads carry none:
 * if the saved frame had any move played, what those moves were is unknown,
 * so the run is marked `untracked` and can't be Pure (no claim we can't
 * back). A save with no moves yet has nothing to account for and starts
 * fresh.
 */
export function restore(saved, s) {
  const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  if (saved && typeof saved === 'object') {
    const r = { clean: n(saved.clean), lucky: n(saved.lucky), hints: n(saved.hints), puffs: n(saved.puffs) };
    if (saved.untracked) r.untracked = true;
    return r;
  }
  return s && s.moves > 0 ? { ...fresh(), untracked: true } : fresh();
}

export const isPure = (r) => !r.untracked && r.lucky === 0 && r.hints === 0 && r.puffs === 0;

/** The rail's second line: "31 clean · pure", or "· assisted" once Pure is lost. */
export const railLine = (r) => `${r.clean} clean · ${isPure(r) ? 'pure' : 'assisted'}`;

// ── one move ────────────────────────────────────────────────────────────

/**
 * What tapping i would uncap, read before it happens:
 *   { type: 'reveal', cell: i, targets: [i] }
 *   { type: 'sweep',  cell: i, targets: [hidden unmarked neighbours] }
 * or null when the tap can't uncap anything. Core.tap still decides whether
 * the move is legal (a sweep needs its marks placed); this only names what
 * it would touch.
 */
export function moveAt(s, i) {
  if (s.phase !== 'play' || i < 0 || i >= s.open.length) return null;
  if (!s.open[i]) return s.mark[i] === NONE ? { type: 'reveal', cell: i, targets: [i] } : null;
  if (s.cells[i] !== EMPTY || s.broken[i]) return null;
  const targets = nbrsOf(s.cols, s.rows)[i].filter((j) => !s.open[j] && s.mark[j] === NONE);
  return targets.length ? { type: 'sweep', cell: i, targets } : null;
}

/** 'clean' if every cell the move uncaps was proven safe before it, else 'lucky'. */
export const classify = (move, proven) => (move.targets.every((j) => proven.safe.has(j)) ? 'clean' : 'lucky');

/** The counters after a move that uncapped and didn't sting. */
export const tally = (r, verdict) => ({ ...r, [verdict]: r[verdict] + 1 });
