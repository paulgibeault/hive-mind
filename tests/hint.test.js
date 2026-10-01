/* The bee-line hint (#07): which move it shows and what it says. hint.js is
 * pure, so this drives it with real core states. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../arcade-rng.js';
import * as C from '../core.js';
import * as Hint from '../hint.js';

/* The PlayProposed state from the design canvas (see tests/solver.test.js):
 * Clover Field seed 7 mid-game, with the player's guard marks on it. */
const PLAY_PROPOSED =
  'cccwwcccwccwwcccwcccwccccccccccwwwcwccwc3cwcccwc1m22wccc11011ccc110001mcw10001cccc11001mccw101ccccm201w1cc100110cm100000';
function playProposed() {
  const s = C.newGame('clover', 7);
  [...PLAY_PROPOSED].forEach((ch, i) => {
    if (/\d/.test(ch)) s.open[i] = 1;
    if (ch === 'm') s.mark[i] = C.MARK_G;
  });
  return s;
}

const TWO_ONES_LOWER = "The lower 1 has one capped neighbour, so that's its guard (dashed). "
  + 'The same guard fills the upper 1, so the lit cell is safe.';

test('pinned example: from a tap near it, step 1 rings [93, 101]; step 2 lights 94 and dashes 102', () => {
  const s = playProposed();
  // 100 is the open 0 under the two 1s: a tap there changes nothing but
  // says where the player is looking
  for (const last of [100, 101, 93]) {
    const h = Hint.pickHint(s, last);
    assert.equal(h.kind, 'move');
    assert.deepEqual(h.clues, [93, 101], `from ${last}`);
    assert.equal(h.target, 94);
    assert.equal(h.value, C.SAFE);
    assert.deepEqual(h.ghosts, [{ i: 102, value: C.GUARD }]);
    assert.equal(h.look, 'Look at these numbers together.');
    assert.equal(h.why, TWO_ONES_LOWER);
  }
});

test('no last tap: nowhere to be near, so the smallest proof decides (then the lowest cell)', () => {
  const s = playProposed();
  const h = Hint.pickHint(s, -1);
  // eight proven safe cells; 81 and 94 tie on the fewest clues (2) touching
  // the fewest capped cells (2), and 81 is the lower index
  assert.equal(h.target, 81);
  assert.deepEqual(h.clues, [64, 73]);
  assert.deepEqual(h.ghosts, [{ i: 72, value: C.GUARD }]);
  assert.equal(h.why, "The upper 1 has one capped neighbour, so that's its guard (dashed). "
    + 'The same guard fills the lower 1, so the lit cell is safe.');
  assert.deepEqual(Hint.pickHint(s, -1), h, 'deterministic');
});

test('proven safe cells come before proven guards, however near the guard', () => {
  const s = playProposed();
  const p = C.provenNow(s);
  assert.ok(p.guard.has(49) && p.guard.has(102));
  for (const last of [49, 102, 52, 90]) assert.equal(Hint.pickHint(s, last, p).value, C.SAFE, `from ${last}`);
});

test('only guards proven: the nearest unmarked one, and step 2 says "Mark it."', () => {
  const s = playProposed();
  const p = C.provenNow(s);
  const only = { safe: new Set(), guard: p.guard };
  const h = Hint.pickHint(s, 98, only);           // 98 is a proven guard the player has marked
  assert.notEqual(s.mark[h.target], C.MARK_G, 'a marked guard is not worth pointing at');
  assert.equal(h.value, C.GUARD);
  assert.equal(h.target, 90);
  assert.deepEqual(h.clues, [83]);
  assert.equal(h.look, 'Look at this number.');
  assert.equal(h.why, 'This 1 has just one capped neighbour, so a guard sleeps there. Mark it.');
  // a guard with a bigger proof gets the generic line, still ending "Mark it."
  const g = Hint.whyLine(s, { target: 113, value: C.GUARD, clues: [99, 106, 114] });
  assert.equal(g, `${Hint.GENERIC} Mark it.`);
});

test('nothing proven (the budget ran out): "Try around here", the undecided group nearest the tap, no step 2', () => {
  const s = playProposed();
  const h = Hint.pickHint(s, 101, { safe: new Set(), guard: new Map() });
  assert.equal(h.kind, 'fallback');
  assert.equal(h.look, 'Try around here.');
  assert.equal(h.target, undefined);
  const nb = C.nbrsOf(s.cols, s.rows);
  assert.ok(h.clues.includes(101) && h.clues.includes(93));
  for (const c of h.clues) assert.ok(s.open[c] && nb[c].some((j) => !s.open[j]), `${c} is a clue on the edge`);
});

test('specific sentences only for the simple cases; the generic line otherwise', () => {
  const s = playProposed();
  // a safe cell whose proof isn't the two-1s shape
  assert.equal(Hint.whyLine(s, { target: 78, value: C.SAFE, clues: [59, 60, 69, 77] }), Hint.GENERIC);
  assert.equal(Hint.whyLine(s, { target: 105, value: C.SAFE, clues: [99, 106] }), Hint.GENERIC);   // 99 reads 2
  // a full clue of n > 1
  const t = C.newGame('clover', 7);
  const nb = C.nbrsOf(t.cols, t.rows);
  const c = t.cells.findIndex((v, i) => v === C.EMPTY && t.shown[i] === 2 && nb[i].filter((j) => t.cells[j] !== C.EMPTY).length === 2);
  assert.ok(c >= 0);
  for (let i = 0; i < t.open.length; i++) t.open[i] = i === c || t.cells[i] === C.EMPTY ? 1 : 0;
  const g = nb[c].find((j) => t.cells[j] !== C.EMPTY);
  assert.equal(Hint.whyLine(t, { target: g, value: C.GUARD, clues: [c] }),
    'This 2 has just two capped neighbours, so every one hides a guard. Mark it.');
});

test('Apple Orchard names the kind: amber for guards, red for the queen\'s guards', () => {
  for (let seed = 1; seed < 40; seed++) {
    const s = C.newGame('apple', seed);
    const nb = C.nbrsOf(s.cols, s.rows);
    const c = s.cells.findIndex((v, i) => v === C.EMPTY && s.shown[i] === 0 && s.shownH[i] === 1);
    if (c < 0) continue;
    for (let i = 0; i < s.open.length; i++) s.open[i] = i === c || s.cells[i] === C.EMPTY ? 1 : 0;
    const q = nb[c].find((j) => s.cells[j] === C.Q);
    assert.equal(Hint.whyLine(s, { target: q, value: C.QUEEN, clues: [c] }),
      "This red 1 has just one capped neighbour, so a queen's guard sleeps there. Mark it.");
    return;
  }
  assert.fail('no red 1 found');
});

test('costLine: what the hints cost, said plainly; nothing when none', () => {
  assert.equal(Hint.costLine(0), '');
  assert.equal(Hint.costLine(1), '1 bee-line hint · +10 s · no Pure seal');
  assert.equal(Hint.costLine(3), '3 bee-line hints · +30 s · no Pure seal');
  assert.equal(Hint.PENALTY_MS, 10_000);
});

test('hexDistance: every neighbour is one step; symmetric; zero to itself', () => {
  for (const [cols, rows] of [[8, 15], [9, 18]]) {
    const nb = C.nbrsOf(cols, rows);
    for (let i = 0; i < cols * rows; i++) {
      assert.equal(Hint.hexDistance(cols, i, i), 0);
      for (const j of nb[i]) assert.equal(Hint.hexDistance(cols, i, j), 1, `${i}–${j}`);
    }
    assert.equal(Hint.hexDistance(cols, 0, cols * rows - 1), Hint.hexDistance(cols, cols * rows - 1, 0));
  }
});

/* A mid-game state: some proven and some lucky uncaps, then random marks
 * (right and wrong). As in tests/solver.test.js. */
const fresh = new Map();
function midGame(hive, seed, rnd) {
  const key = `${hive}/${seed}`;
  if (!fresh.has(key)) fresh.set(key, C.newGame(hive, seed));
  const s = structuredClone(fresh.get(key));
  const steps = rnd.int(0, 14);
  for (let k = 0; k < steps; k++) {
    const hidden = s.cells.flatMap((c, i) => (!s.open[i] && c === C.EMPTY ? [i] : []));
    if (hidden.length < 2) break;
    const proven = rnd() < 0.5 ? [...C.provenNow(s).safe] : [];
    const pool = proven.length ? proven : hidden;
    C.reveal(s, pool[rnd.int(0, pool.length - 1)]);
    if (s.phase !== 'play' || C.safeLeft(s) < 2) break;
  }
  for (let i = 0; i < s.mark.length; i++) if (!s.open[i] && rnd() < 0.15) s.mark[i] = rnd.int(1, s.queens ? 2 : 1);
  return s;
}
const KIND = { [C.G]: C.GUARD, [C.Q]: C.QUEEN };

test('the hint never lights a cell that isn\'t provable: 1,200 mid-game states, every hive', () => {
  const rnd = makeRng(707);
  let safe = 0, guard = 0, ghosts = 0, specific = 0, fallbacks = 0;
  for (let k = 0; k < 1200; k++) {
    const hive = C.HIVES[k % 3].id;
    const s = midGame(hive, 1 + (k % 89), rnd);
    if (s.phase !== 'play') continue;
    const last = rnd() < 0.25 ? -1 : rnd.int(0, s.open.length - 1);
    const p = C.provenNow(s);
    const h = Hint.pickHint(s, last, p);
    const at = `${hive}#${k} from ${last}`;
    assert.deepEqual(Hint.pickHint(s, last), h, `${at}: deterministic`);
    if (h.kind === 'fallback') {
      // a lucky uncap can join groups past the solver's budget: nothing is
      // proven, and the hint lights nothing, only rings clues
      assert.equal(p.safe.size + p.guard.size, 0, `${at}: fell back with something proven`);
      assert.equal(h.target, undefined);
      for (const c of h.clues) assert.ok(s.open[c] && !s.broken[c] && s.cells[c] === C.EMPTY, `${at}: ring ${c} is no clue`);
      fallbacks++;
      continue;
    }
    assert.equal(h.kind, 'move');
    // the target: hidden, and exactly what the hint says it is
    assert.ok(!s.open[h.target], `${at}: target ${h.target} is open`);
    if (h.value === C.SAFE) { assert.equal(s.cells[h.target], C.EMPTY, `${at}: ${h.target} not safe`); safe++; }
    else { assert.equal(KIND[s.cells[h.target]], h.value, `${at}: ${h.target} wrong kind`); guard++; }
    // it is provable now, by exactly the rings
    assert.equal(p.safe.has(h.target) ? C.SAFE : p.guard.get(h.target), h.value);
    assert.deepEqual(C.minimalProof(s, h.target, p), { value: h.value, clues: h.clues });
    for (const c of h.clues) assert.ok(s.open[c] && !s.broken[c] && s.cells[c] === C.EMPTY, `${at}: ring ${c} is no clue`);
    // safe before guards
    if (p.safe.size) assert.equal(h.value, C.SAFE, `${at}: a safe cell was proven`);
    // nearest the last tap
    if (last >= 0) {
      const pool = p.safe.size ? [...p.safe] : [...p.guard.keys()].filter((i) => !s.mark[i] || (s.queens && s.mark[i] !== (p.guard.get(i) === C.QUEEN ? C.MARK_Q : C.MARK_G)));
      const d = Hint.hexDistance(s.cols, last, h.target);
      for (const i of pool) assert.ok(Hint.hexDistance(s.cols, last, i) >= d, `${at}: ${i} is nearer than ${h.target}`);
    }
    // the dashed guards are real, and of their kind
    for (const g of h.ghosts) {
      assert.ok(!s.open[g.i] && g.i !== h.target, `${at}: ghost ${g.i}`);
      assert.equal(KIND[s.cells[g.i]], g.value, `${at}: ghost ${g.i} is not a ${g.value}`);
      ghosts++;
    }
    if (h.why !== Hint.GENERIC && !h.why.startsWith(Hint.GENERIC)) specific++;
  }
  assert.ok(safe > 800 && ghosts > 300 && specific > 100, `vacuous: ${safe} safe, ${guard} guard, ${ghosts} ghosts, ${specific} specific`);
  assert.ok(fallbacks < 12, `the fallback is rare (${fallbacks})`);
});

// ── Scouts (#12) ────────────────────────────────────────────────────────────

test('Sunflower Field: the hint lights only provable cells, and a Scout\'s proof gets the generic line', () => {
  const rnd = makeRng(1201);
  let moves = 0, scoutProofs = 0, specific = 0, scoutRings = 0;
  for (let k = 0; k < 300; k++) {
    const s = midGame('sunflower', 1 + (k % 61), rnd);
    if (s.phase !== 'play') continue;
    const last = rnd() < 0.25 ? -1 : rnd.int(0, s.open.length - 1);
    const p = C.provenNow(s);
    const h = Hint.pickHint(s, last, p);
    if (!h) continue;
    for (const c of h.clues) assert.ok(s.open[c] && !s.broken[c] && s.cells[c] === C.EMPTY, `#${k}: ring ${c}`);
    if (h.clues.some((c) => C.isScout(s, c))) scoutRings++;
    if (h.kind !== 'move') continue;
    moves++;
    assert.ok(!s.open[h.target]);
    assert.equal(h.value === C.SAFE ? C.EMPTY : C.G, s.cells[h.target], `#${k}: ${h.target}`);
    assert.deepEqual(C.minimalProof(s, h.target, p), { value: h.value, clues: h.clues });
    for (const g of h.ghosts) assert.equal(s.cells[g.i], C.G, `#${k}: ghost ${g.i}`);
    if (h.clues.some((c) => C.isScout(s, c))) {
      scoutProofs++;
      assert.ok(h.why === Hint.GENERIC || h.why === `${Hint.GENERIC} Mark it.`, `#${k}: "${h.why}"`);
    } else if (!h.why.startsWith(Hint.GENERIC)) specific++;
  }
  assert.ok(moves > 200 && specific > 20, `vacuous: ${moves} moves, ${specific} specific`);
  assert.ok(scoutRings > 0, 'some hint rings a Scout');
  // and any one-Scout proof that happens to be "full" over its neighbours
  // still gets the generic line: the sentence would talk about neighbours
  const s = C.newGame('sunflower', 7);
  const sc = s.scout.findIndex((v) => v);
  s.open[sc] = 1;
  const g = C.ring2Of(s.cols, s.rows)[sc].find((j) => s.cells[j] === C.G);
  assert.equal(Hint.whyLine(s, { target: g, value: C.GUARD, clues: [sc] }), `${Hint.GENERIC} Mark it.`);
  console.log(`# sunflower hints: ${moves} moves, ${scoutProofs} proved with a Scout`);
});

test('Scouts: the fallback and the "capped cells a clue touches" count a Scout\'s whole range', () => {
  // a Sunflower frame with only one Scout uncapped (and the opening): its
  // range's capped cells are what the group is built from
  let checked = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const s = C.newGame('sunflower', seed);
    const range = C.ring2Of(s.cols, s.rows);
    for (const sc of s.scout.flatMap((v, i) => (v && !s.open[i] ? [i] : []))) {
      const t = structuredClone(s);
      C.reveal(t, sc);
      // every other uncapped cell read as blank: the Scout is the only clue
      const masked = { ...t, broken: t.broken.map((b, i) => (t.open[i] && i !== sc ? 1 : 0)) };
      const capped = range[sc].filter((j) => !t.open[j]);
      if (t.shown[sc] === 0 || t.shown[sc] === capped.length) continue;    // those prove their whole range
      const p = C.provenNow(masked);
      assert.equal(p.safe.size + p.guard.size, 0, 'a lone Scout, neither 0 nor full, proves nothing');
      const h = Hint.pickHint(masked, sc, p);
      assert.deepEqual({ kind: h.kind, clues: h.clues }, { kind: 'fallback', clues: [sc] });
      checked++;
    }
  }
  assert.ok(checked > 50, `only ${checked}`);
});

