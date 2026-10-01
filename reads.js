/* reads.js — how a move read: clean or lucky, whether the frame is still
 * Pure, and what a sting should have taught. The module is pure too: no DOM,
 * no clock. main.js asks; core.js stays rules-only.
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
 * happened, and lesson() is only asked after a sting, when the frame is
 * shown anyway.
 */

import { nbrsOf, minimalProof, EMPTY, NONE, QUEEN } from './core.js';

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

// ── the sting lesson (#04) ──────────────────────────────────────────────

/**
 * What gave it away, for a move that stung. Decided from the state before
 * the tap: `move` from moveAt() and `proven` from provenNow(), both taken
 * before Core.tap (the same provenNow #03 reads clean moves with). `s` is
 * the state after the sting; minimalProof() treats the stung cell as still
 * hidden, and a stinging reveal changes nothing else, so it answers about
 * the board as it was.
 *
 * Returns { kind, clues, stung, safeHint, text, rings }:
 *   kind      'proven-guard'  the tapped cell was a proven guard
 *             'guess'         nothing proved it either way
 *             'wrong-mark'    a sweep trusted a mark on a safe cell
 *   clues     the clue cells ringed in honey: the smallest proof, or the
 *             sweep's source number
 *   stung     the cell that stung (ringed red)
 *   safeHint  for a guess, the first cell in provenNow().safe, or -1
 *   text      the card's sentence, under its "What gave it away" heading
 *   rings     [{ i, color: 'honey' | 'red' | 'safe' }] for the renderer
 */
export function lesson(s, move, proven) {
  const stung = s.stung;
  const rings = (clues, extra = []) =>
    [...clues.map((i) => ({ i, color: 'honey' })), ...extra, { i: stung, color: 'red' }];

  if (move.type === 'sweep') {
    return {
      kind: 'wrong-mark', clues: [move.cell], stung, safeHint: -1,
      text: 'A mark was on a safe cell, so the sweep trusted it.',
      rings: rings([move.cell]),
    };
  }

  const value = proven.guard.get(move.cell);
  if (value) {
    const p = minimalProof(s, move.cell, proven);
    const clues = p ? p.clues : [];
    return {
      kind: 'proven-guard', clues, stung, safeHint: -1,
      text: (clues.length === 1 && sentence(s, clues[0], move.cell, value))
        || `These numbers proved a ${value === QUEEN ? "queen's guard" : 'guard'} was sleeping there.`,
      rings: rings(clues),
    };
  }

  const first = proven.safe.values().next();
  const safeHint = first.done ? -1 : first.value;
  return {
    kind: 'guess', clues: [], stung, safeHint,
    text: 'That was a guess, and nothing proved it either way.'
      + (safeHint < 0 ? '' : ' This cell was safe to open:'),
    rings: rings([], safeHint < 0 ? [] : [{ i: safeHint, color: 'safe' }]),
  };
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

/**
 * The plain-English proof when one clue alone proves the guard, or null
 * (the caller then uses the generic line; no general proofs in English).
 * One clue proves a guard only by being FULL: exactly n capped neighbours
 * (before the tap, so the stung cell counts) and n hazards, all of one kind.
 * The spec's other one-clue case, a clue with 0 guards left, proves cells
 * SAFE, so it never explains a sting.
 */
export function sentence(s, c, cell, value) {
  if (s.broken[c]) return null;
  const nb = nbrsOf(s.cols, s.rows)[c];
  const capped = nb.filter((j) => j === cell || !s.open[j]).length;
  const g = s.shown[c], q = s.queens > 0 ? s.shownH[c] : 0;
  if (g + q !== capped) return null;
  if ((value === QUEEN ? g : q) !== 0) return null;   // two kinds: one clue names the kind only if it counts one
  const n = g + q;
  const label = s.queens > 0 ? `${value === QUEEN ? 'red' : 'amber'} ${n}` : String(n);
  const what = value === QUEEN ? "queen's guard" : 'guard';
  if (n === 1) return `This ${label} had just one capped neighbour, the cell you uncapped.`;
  return `This ${label} had just ${WORDS[n] || n} capped neighbours, so every one of them hid a ${what}, `
    + 'the cell you uncapped too.';
}
