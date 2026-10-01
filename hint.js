/* hint.js — the bee-line hint (#07): which move to show, and what to say
 * about it. Pure: no DOM, no clock. main.js runs the state machine
 * (off → look → why → off) and charges for it; this only decides.
 *
 * A hint is honest by construction: its target comes from provenNow(s),
 * its rings from minimalProof(), and both read only the clues on screen.
 * Marks are ignored for the proof (they are the player's word, not
 * knowledge), though a guard the player has already marked is not worth
 * pointing at.
 *
 * Which move, deterministically:
 *   1. proven SAFE cells if there are any; only if none, proven guards that
 *      don't already carry a mark of their kind ("Mark it.")
 *   2. nearest the player's last tap, in hex steps
 *   3. the smallest proof: fewest clues, then fewest capped cells those
 *      clues touch (the fewer unknowns, the easier to see)
 *   4. the lowest cell index
 * With no last tap (a fresh frame, or a run just resumed — the last tap is
 * never saved), there is nowhere to be near, so step 2 is skipped and the
 * smallest proof decides.
 */

import { nbrsOf, provenNow, minimalProof, SAFE, GUARD, QUEEN, NONE, MARK_G, MARK_Q } from './core.js';

/** What a hint costs on the clock (ms). It also costs the Pure seal. */
export const PENALTY_MS = 10_000;

/** The won sheet's line for a run's hints: what they cost, said plainly. */
export function costLine(hints) {
  if (!hints) return '';
  return `${hints} bee-line hint${hints === 1 ? '' : 's'} · +${(hints * PENALTY_MS) / 1000} s · no Pure seal`;
}

/** Hex steps between two cells of a `cols`-wide odd-r frame. */
export function hexDistance(cols, a, b) {
  const cube = (i) => {
    const x = i % cols, y = (i / cols) | 0;
    const q = x - ((y - (y & 1)) >> 1);
    return [q, y, -q - y];
  };
  const A = cube(a), B = cube(b);
  return Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2]));
}

const capped = (s, nb, c) => nb[c].filter((j) => !s.open[j]);

/**
 * The hint for state s, measured from the last tapped cell `last` (-1 for
 * none). `proven` is provenNow(s), passed in when the caller has it.
 *
 *   { kind: 'move', target, value, clues, ghosts, look, why }
 *       target  the cell step 2 lights; value SAFE | GUARD | QUEEN
 *       clues   the smallest proof's clue cells (step 1's rings)
 *       ghosts  [{ i, value }]: guards the proof clues imply on their own,
 *               drawn dashed in step 2 (the target itself excluded)
 *   { kind: 'fallback', clues, look }
 *       nothing proven (the solver's budget ran out): the clues of the
 *       undecided group nearest the last tap. No step 2.
 *   null: nothing on screen to point at.
 */
export function pickHint(s, last = -1, proven = provenNow(s)) {
  const nb = nbrsOf(s.cols, s.rows);
  let pool = [...proven.safe];
  if (!pool.length) {
    pool = [...proven.guard].filter(([i, v]) => s.mark[i] !== (v === QUEEN ? MARK_Q : MARK_G)
      && !(s.queens === 0 && s.mark[i] !== NONE)).map(([i]) => i);
  }
  if (!pool.length) return fallback(s, nb, last);

  const far = (i) => (last >= 0 ? hexDistance(s.cols, last, i) : 0);
  const near = Math.min(...pool.map(far));
  let best = null;
  for (const i of pool.filter((j) => far(j) === near).sort((a, b) => a - b)) {
    const p = minimalProof(s, i, proven);
    const touch = new Set(p.clues.flatMap((c) => capped(s, nb, c))).size;
    const key = [p.clues.length, touch, i];
    if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && key[1] < best.key[1])) {
      best = { key, target: i, value: p.value, clues: p.clues };
    }
  }
  const { target, value, clues } = best;
  const ghosts = implied(s, nb, clues, target);
  const pick = { kind: 'move', target, value, clues, ghosts };
  return { ...pick, look: lookLine(pick), why: whyLine(s, pick) };
}

/* The guards the proof's clues prove on their own: provenNow over a copy
 * of the frame where every other uncapped cell keeps its place but shows no
 * number (read as broken comb, which the solver already treats as "no clue
 * here"). Fewer clues can only prove less, so these are real guards. */
function implied(s, nb, clues, target) {
  const keep = new Set(clues);
  const masked = { ...s, broken: s.broken.map((b, i) => (b || (s.open[i] && !keep.has(i)) ? 1 : 0)) };
  const p = provenNow(masked);
  const near = new Set(clues.flatMap((c) => nb[c]));
  return [...p.guard].filter(([i]) => i !== target && near.has(i))
    .map(([i, value]) => ({ i, value })).sort((a, b) => a.i - b.i);
}

/* Nothing proven: ring the clues of the undecided group nearest the last
 * tap (or the lowest such cell, with none). */
function fallback(s, nb, last) {
  const isClue = (c) => s.open[c] && !s.broken[c] && s.cells[c] === 0;
  const frontier = [];
  for (let i = 0; i < s.open.length; i++) if (!s.open[i] && nb[i].some(isClue)) frontier.push(i);
  if (!frontier.length) return null;
  const far = (i) => (last >= 0 ? hexDistance(s.cols, last, i) : 0);
  const from = frontier.reduce((a, b) => (far(b) < far(a) ? b : a));
  // the group: clues joined through the capped cells they share
  const got = new Set(nb[from].filter(isClue)), stack = [...got];
  while (stack.length) {
    for (const h of capped(s, nb, stack.pop())) {
      for (const d of nb[h]) if (isClue(d) && !got.has(d)) { got.add(d); stack.push(d); }
    }
  }
  const pick = { kind: 'fallback', clues: [...got].sort((a, b) => a - b) };
  return { ...pick, look: lookLine(pick) };
}

// ── what the sheet says ─────────────────────────────────────────────────

/** Step 1's line. */
export function lookLine(pick) {
  if (pick.kind === 'fallback') return 'Try around here.';
  return pick.clues.length === 1 ? 'Look at this number.' : 'Look at these numbers together.';
}

export const GENERIC = 'Together these numbers leave only one possibility for the lit cell.';
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

/* How a clue is named: "1", or "amber 1" / "red 1" where two kinds are
 * counted; null when it counts both kinds (no short sentence for that). */
function label(s, c) {
  const g = s.shown[c], q = s.queens > 0 ? s.shownH[c] : 0;
  if (s.queens === 0) return { n: g, kind: GUARD, text: String(g) };
  if (g && q) return null;
  return q ? { n: q, kind: QUEEN, text: `red ${q}` } : { n: g, kind: GUARD, text: `amber ${g}` };
}
const what = (kind) => (kind === QUEEN ? "queen's guard" : 'guard');

/**
 * Step 2's line. A specific sentence only for the simple cases (#04's
 * list) and the canvas's one two-clue case; the generic line otherwise.
 * Never a general proof in English. A guard target ends "Mark it."
 */
export function whyLine(s, pick) {
  const nb = nbrsOf(s.cols, s.rows);
  const { target, value, clues } = pick;
  if (value !== SAFE) return `${(clues.length === 1 && fullClue(s, nb, clues[0], value)) || GENERIC} Mark it.`;
  return (clues.length === 2 && twoOnes(s, nb, clues, target)) || GENERIC;
}

/* One clue, FULL: exactly n capped neighbours and n hazards of the target's
 * kind, so every one of them is a hazard. (A clue with no hazards left would
 * prove cells safe on its own, but such a clue is a zero, which floods: it
 * never has a capped neighbour to explain.) */
function fullClue(s, nb, c, value) {
  if (s.broken[c]) return null;
  const l = label(s, c);
  if (!l || l.kind !== value || l.n !== capped(s, nb, c).length) return null;
  if (l.n === 1) return `This ${l.text} has just one capped neighbour, so a ${what(value)} sleeps there.`;
  return `This ${l.text} has just ${WORDS[l.n] || l.n} capped neighbours, so every one hides a ${what(value)}.`;
}

/* The canvas's case: two 1s of one kind. One of them has a single capped
 * neighbour, its guard (drawn dashed); that guard also touches the other 1
 * and fills it, so the other 1's remaining capped cells (the lit one among
 * them) are safe. */
function twoOnes(s, nb, clues, target) {
  if (clues.some((c) => s.broken[c])) return null;
  const ls = clues.map((c) => label(s, c));
  if (ls.some((l) => !l || l.n !== 1) || ls[0].kind !== ls[1].kind) return null;
  for (const [a, b] of [[0, 1], [1, 0]]) {
    const A = clues[a], B = clues[b];
    const own = capped(s, nb, A);
    if (own.length !== 1 || own[0] === target) continue;
    if (!nb[B].includes(own[0]) || !nb[B].includes(target)) continue;
    const [here, there] = side(s.cols, A, B);
    const k = what(ls[a].kind);
    return `The ${here} ${ls[a].text} has one capped neighbour, so that's its ${k} (dashed). `
      + `The same ${k} fills the ${there} ${ls[b].text}, so the lit cell is safe.`;
  }
  return null;
}

/* Where A sits relative to B, in words, and where B sits relative to A. */
function side(cols, A, B) {
  const ra = (A / cols) | 0, rb = (B / cols) | 0;
  if (ra !== rb) return ra > rb ? ['lower', 'upper'] : ['upper', 'lower'];
  return A < B ? ['left', 'right'] : ['right', 'left'];
}
