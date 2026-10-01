/* The solver is the fairness promise: it must never claim something the
 * clues don't prove. These tests check it against the truth and by brute
 * force on small frames. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, SAFE, GUARD, QUEEN } from '../solver.js';
import { neighbours } from '../hex.js';
import * as C from '../core.js';

const BIT = [SAFE, GUARD, QUEEN];

function run(f) {
  const nbrs = C.nbrsOf(f.cols, f.rows);
  const n = f.cols * f.rows;
  const dom = new Uint8Array(n).fill(f.queens ? 7 : 3);
  const opened = new Uint8Array(n);
  const wrong = [];
  const open = (i) => {
    const st = [i];
    while (st.length) {
      const c = st.pop();
      if (opened[c]) continue;
      if (f.cells[c] !== C.EMPTY) wrong.push(c);
      opened[c] = 1; dom[c] = SAFE;
      if (f.cells[c] === C.EMPTY && C.floods(f, c)) st.push(...nbrs[c]);
    }
  };
  open(f.start);
  const done = solve(nbrs, dom, (i) => (f.cells[i] === C.EMPTY ? C.clueOf(f, i) : null), open, opened);
  return { dom, done, wrong };
}

test('never opens a hazard, never rules out the truth — every hive, many seeds', () => {
  for (const h of C.HIVES) {
    for (let seed = 1; seed <= 60; seed++) {
      const f = C.generate(h.id, seed);
      const { dom, done, wrong } = run(f);
      assert.deepEqual(wrong, [], `${h.id}/${seed} opened a hazard`);
      assert.ok(done);
      for (let i = 0; i < dom.length; i++) assert.ok(dom[i] & BIT[f.cells[i]], `${h.id}/${seed} cell ${i}`);
    }
  }
});

test('also sound on frames it cannot finish (raw random layouts)', () => {
  // Deliberately dense layouts, no generator filtering: the solver will stall,
  // and whatever it did claim must still be true.
  let stalled = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const hive = C.HIVES[seed % 3];
    const f = C.generate(hive.id, seed);
    // re-scatter the hazards densely with a simple LCG, keep the opening clear
    let x = seed * 2654435761 >>> 0;
    const rnd = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
    const nb = C.nbrsOf(f.cols, f.rows);
    const clear = new Set([f.start, ...nb[f.start]]);
    f.cells = f.cells.map((_, i) => (clear.has(i) ? 0 : rnd() < 0.28 ? (f.queens && rnd() < 0.4 ? 2 : 1) : 0));
    f.broken = f.broken.map(() => 0);
    for (let i = 0; i < f.cells.length; i++) {
      f.shown[i] = nb[i].filter((j) => f.cells[j] === 1).length;
      f.shownH[i] = nb[i].filter((j) => f.cells[j] === 2).length;
      if (!f.queens) f.shown[i] += f.shownH[i];
    }
    if (!C.floods(f, f.start)) continue;
    const { dom, done, wrong } = run(f);
    assert.deepEqual(wrong, []);
    if (!done) stalled++;
    for (let i = 0; i < dom.length; i++) assert.ok(dom[i] & BIT[f.cells[i]]);
  }
  assert.ok(stalled > 0, 'dense frames should sometimes need a guess — else this test proves nothing');
});

test('exact on a tiny frame, against brute force over every layout', () => {
  // 4×3 frame, one-kind, a single clue from an opened cell: whatever the solver
  // concludes must agree with enumerating all 2^k layouts of the hidden cells.
  const cols = 4, rows = 3, n = 12;
  const nbrs = neighbours(cols, rows);
  for (let mask = 0; mask < 1 << n; mask += 37) {
    if (mask & 1) continue;                                // cell 0 is the opened clue
    const cells = [...Array(n)].map((_, i) => (mask >> i) & 1);
    const clue = nbrs[0].filter((j) => cells[j]).length;
    const dom = new Uint8Array(n).fill(3);
    const opened = new Uint8Array(n);
    opened[0] = 1; dom[0] = SAFE;
    solve(nbrs, dom, (i) => (i === 0 ? { guards: clue, queens: 0 } : null), (i) => { opened[i] = 1; }, opened);
    // brute force: which values can each neighbour take given the clue?
    const k = nbrs[0].length;
    for (let t = 0; t < k; t++) {
      let can0 = false, can1 = false;
      for (let a = 0; a < 1 << k; a++) {
        let c = 0; for (let b = 0; b < k; b++) c += (a >> b) & 1;
        if (c !== clue) continue;
        if ((a >> t) & 1) can1 = true; else can0 = true;
      }
      const want = (can0 ? SAFE : 0) | (can1 ? GUARD : 0);
      assert.equal(dom[nbrs[0][t]], want, `mask ${mask} nbr ${t}`);
    }
  }
});

test('broken comb: clueAt is null there, it adds nothing, and the solver still finishes', () => {
  // generated Wildflowers frames: every broken cell reads null, and the
  // solver clears the frame without ever leaning on one
  for (let seed = 1; seed <= 40; seed++) {
    const f = C.generate('wildflowers', seed);
    const broken = f.broken.flatMap((b, i) => (b ? [i] : []));
    assert.equal(broken.length, C.HIVES.find((h) => h.id === 'wildflowers').broken);
    for (const i of broken) assert.equal(C.clueOf(f, i), null);
    const { done, wrong } = run(f);
    assert.ok(done, `wildflowers/${seed}`);
    assert.deepEqual(wrong, []);
  }

  // brute force, 4×3: cell 0 an opened plain clue, cell 5 opened broken comb.
  // The broken cell must add no constraint: the solver's verdict on cell 0's
  // hidden neighbours is exactly what enumeration over cell 0's clue gives.
  const cols = 4, rows = 3, n = 12;
  const nbrs = neighbours(cols, rows);
  const around = nbrs[0].filter((j) => j !== 5);
  for (let mask = 0; mask < 1 << n; mask += 29) {
    if (mask & 1 || mask & (1 << 5)) continue;
    const cells = [...Array(n)].map((_, i) => (mask >> i) & 1);
    const clue = nbrs[0].filter((j) => cells[j]).length;
    const dom = new Uint8Array(n).fill(3);
    const opened = new Uint8Array(n);
    opened[0] = opened[5] = 1; dom[0] = dom[5] = SAFE;
    solve(nbrs, dom, (i) => (i === 0 ? { guards: clue, queens: 0 } : null), (i) => { opened[i] = 1; }, opened);
    for (const t of around) {
      let can0 = false, can1 = false;
      for (let a = 0; a < 1 << around.length; a++) {
        let c = 0; for (let b = 0; b < around.length; b++) c += (a >> b) & 1;
        if (c !== clue) continue;
        if ((a >> around.indexOf(t)) & 1) can1 = true; else can0 = true;
      }
      assert.equal(dom[t], (can0 ? SAFE : 0) | (can1 ? GUARD : 0), `mask ${mask} cell ${t}`);
    }
    // cells next to the broken comb only are never decided
    for (const j of nbrs[5]) if (!opened[j] && !nbrs[0].includes(j)) assert.equal(dom[j], 3, `mask ${mask} cell ${j}`);
  }
});
