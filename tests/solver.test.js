/* The solver is the fairness promise: it must never claim something the
 * clues don't prove. These tests check it against the truth and by brute
 * force on small frames. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { solve, provenNow, SAFE, GUARD, QUEEN, PROOF_MAX } from '../solver.js';
import { neighbours, ring2 } from '../hex.js';
import { makeRng } from '../arcade-rng.js';
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

// ── provenNow / minimalProof (#2) ───────────────────────────────────────────

const KIND_BIT = { [C.G]: GUARD, [C.Q]: QUEEN };

/* A mid-game state: the opening, then up to 14 more safe cells uncapped (some
 * provable, some lucky), then marks scattered on hidden cells — right and
 * wrong — since provenNow must not care. Never won: a safe cell stays. */
const freshGames = new Map();
function midGame(hive, seed, rnd) {
  const key = `${hive}/${seed}`;
  if (!freshGames.has(key)) freshGames.set(key, C.newGame(hive, seed));
  const s = structuredClone(freshGames.get(key));
  const steps = rnd.int(0, 14);
  for (let k = 0; k < steps; k++) {
    const hidden = s.cells.flatMap((c, i) => (!s.open[i] && c === C.EMPTY ? [i] : []));
    if (hidden.length < 2) break;
    const proven = rnd() < 0.5 ? [...C.provenNow(s).safe] : [];
    const pool = proven.length ? proven : hidden;
    C.reveal(s, pool[rnd.int(0, pool.length - 1)]);
    if (s.phase !== 'play' || C.safeLeft(s) < 2) break;
  }
  for (let i = 0; i < s.mark.length; i++) {
    if (!s.open[i] && rnd() < 0.15) s.mark[i] = rnd.int(1, s.queens ? 2 : 1);
  }
  return s;
}

const sorted = (it) => [...it].sort((a, b) => a - b);
const asPlain = (p) => ({ safe: sorted(p.safe), guard: sorted(p.guard.keys()).map((i) => [i, p.guard.get(i)]) });

/* The pinned example from the design canvas's PlayProposed artboard: Clover
 * Field seed 7, one char per cell — a digit is an uncapped cell showing that
 * number, c a capped safe cell, w a capped guard, m a capped cell carrying the
 * player's guard mark. Checked against the real frame below: the w/m cells
 * are exactly generate('clover', 7)'s 23 guards, every digit is the real
 * reading, every uncapped 0 has all its neighbours uncapped (the flood rule),
 * and the opening lies inside the uncapped set — a state play can reach. */
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

test('pinned example (PlayProposed, Clover Field seed 7): 94 safe by [93, 101], 49 a guard by [48]', () => {
  const s = playProposed();
  const nb = C.nbrsOf(s.cols, s.rows);
  // the string is an honest state of the real frame
  [...PLAY_PROPOSED].forEach((ch, i) => {
    assert.equal(s.cells[i] !== C.EMPTY, ch === 'w' || ch === 'm', `cell ${i} '${ch}'`);
    if (/\d/.test(ch)) assert.equal(s.shown[i], +ch, `cell ${i} reads ${s.shown[i]}`);
    if (ch === '0') for (const j of nb[i]) assert.equal(s.open[j], 1, `0 at ${i} left ${j} capped`);
  });
  assert.ok(C.newGame('clover', 7).open.every((o, i) => !o || s.open[i]));

  const p = C.provenNow(s);
  assert.ok(p.safe.has(94));
  assert.equal(p.guard.get(49), C.GUARD);
  assert.deepEqual(C.minimalProof(s, 94), { value: C.SAFE, clues: [93, 101] });
  assert.deepEqual(C.minimalProof(s, 49), { value: C.GUARD, clues: [48] });
  // 102, the guard that [93, 101] implies, is proven too, by 101 alone
  assert.deepEqual(C.minimalProof(s, 102, p), { value: C.GUARD, clues: [101] });
  assert.equal(C.minimalProof(s, 0, p), null);           // capped, nothing proves it yet
  assert.equal(C.minimalProof(s, 75, p), null);          // uncapped: nothing to prove
});

test('provenNow is sound: 2,000 mid-game states across every hive', () => {
  const rnd = makeRng(2026);
  let safe = 0, guard = 0, brokenOpen = 0;
  for (let k = 0; k < 2000; k++) {
    const hive = C.HIVES[k % 3].id;
    const s = midGame(hive, 1 + (k % 97), rnd);
    const p = C.provenNow(s);
    if (s.broken.some((b, i) => b && s.open[i])) brokenOpen++;
    for (const i of p.safe) { assert.ok(!s.open[i] && s.cells[i] === C.EMPTY, `${hive}#${k}: ${i} not safe`); safe++; }
    for (const [i, kind] of p.guard) {
      assert.ok(!s.open[i], `${hive}#${k}: ${i} is open`);
      assert.equal(kind, KIND_BIT[s.cells[i]], `${hive}#${k}: ${i} wrong kind`);
      guard++;
    }
  }
  assert.ok(safe > 2000 && guard > 2000, `vacuous: ${safe} safe, ${guard} guard`);
  assert.ok(brokenOpen > 100, `only ${brokenOpen} states with broken comb uncapped`);
});

/* Every assignment of the hidden cells consistent with the visible clues (no
 * global count, as provenNow): per cell, the OR of the bits it can take. */
function bruteForce(nbrs, opened, clueAt, kinds) {
  const n = nbrs.length;
  const hidden = [...Array(n).keys()].filter((i) => !opened[i]);
  const bits = BIT.filter((b) => kinds & b);
  const can = new Uint8Array(n);
  const val = new Uint8Array(n);
  const clues = [...Array(n).keys()].filter((i) => opened[i] && clueAt(i));
  const fits = () => clues.every((c) => {
    let g = 0, q = 0;
    const want = clueAt(c);
    for (const j of want.over || nbrs[c]) { if (val[j] === GUARD) g++; else if (val[j] === QUEEN) q++; }
    return g === want.guards && q === want.queens;
  });
  const go = (k) => {
    if (k === hidden.length) { if (fits()) for (const i of hidden) can[i] |= val[i]; return; }
    for (const b of bits) { val[hidden[k]] = b; go(k + 1); }
  };
  go(0);
  return can;
}

test('provenNow equals brute force on small frames (≤ 5×5), broken comb and queens included', () => {
  const rnd = makeRng(77);
  let decided = 0, tried = 0;
  for (let t = 0; t < 400; t++) {
    const cols = rnd.int(3, 5), rows = rnd.int(3, 5), n = cols * rows;
    const queens = t % 3 === 1;
    const nbrs = neighbours(cols, rows);
    const cells = [...Array(n)].map(() => (rnd() < 0.3 ? (queens && rnd() < 0.5 ? C.Q : C.G) : C.EMPTY));
    const broken = cells.map((c) => (t % 3 === 2 && c === C.EMPTY && rnd() < 0.2 ? 1 : 0));
    const f = {
      cols, rows, queens: queens ? 1 : 0, cells, broken,
      shown: cells.map((_, i) => nbrs[i].filter((j) => cells[j] !== C.EMPTY && (!queens || cells[j] === C.G)).length),
      shownH: cells.map((_, i) => (queens ? nbrs[i].filter((j) => cells[j] === C.Q).length : 0)),
    };
    // uncap safe cells until few enough stay hidden to enumerate every layout
    const limit = queens ? 8 : 12;
    const open = new Array(n).fill(0);
    const safeCells = cells.flatMap((c, i) => (c === C.EMPTY ? [i] : []));
    for (const i of safeCells) if (rnd() < 0.6) open[i] = 1;
    for (const i of safeCells) if (open.filter((o) => !o).length > limit) open[i] = 1;
    if (open.filter((o) => !o).length > limit) continue;
    const s = { ...f, open, mark: new Array(n).fill(0) };

    const want = bruteForce(nbrs, Uint8Array.from(open), (i) => C.clueOf(f, i), queens ? 7 : 3);
    const p = C.provenNow(s);
    for (let i = 0; i < n; i++) {
      if (open[i]) continue;
      const got = p.safe.has(i) ? SAFE : p.guard.get(i) ?? 0;
      const exact = BIT.includes(want[i]) ? want[i] : 0;
      assert.equal(got, exact, `t${t} ${cols}×${rows} cell ${i}: brute ${want[i]}`);
      if (exact) decided++;
    }
    tried++;
  }
  assert.ok(tried > 300 && decided > 300, `vacuous: ${tried} frames, ${decided} decided`);
});

/* A copy of s on which every read of a hidden cell's contents — or of any
 * mark — throws. */
function blindfold(s) {
  const watch = (arr, name, ok) => new Proxy(arr, {
    get(t, k) {
      if (typeof k === 'string' && /^\d+$/.test(k) && !ok(+k)) throw new Error(`peeked at ${name}[${k}]`);
      return t[k];
    },
  });
  const isOpen = (i) => s.open[i] === 1;
  return {
    ...s,
    cells: watch(s.cells, 'cells', isOpen),
    shown: watch(s.shown, 'shown', isOpen),
    shownH: watch(s.shownH, 'shownH', isOpen),
    broken: watch(s.broken, 'broken', isOpen),
    mark: watch(s.mark, 'mark', () => false),
  };
}

test('no peeking: hidden contents and marks are never read, and scrambling them changes nothing', () => {
  const rnd = makeRng(4242);
  for (let k = 0; k < 150; k++) {
    const hive = C.HIVES[k % 3].id;
    const s = midGame(hive, 200 + k, rnd);
    const p = C.provenNow(s);
    const plain = asPlain(p);
    const some = [...p.safe, ...p.guard.keys()].slice(0, 4);

    // 1) a read of a hidden cell (or of any mark) throws
    const b = blindfold(s);
    assert.deepEqual(asPlain(C.provenNow(b)), plain);
    for (const i of some) assert.deepEqual(C.minimalProof(b, i), C.minimalProof(s, i));

    // 2) scramble the hidden cells: move the guards (safe and hazard swap
    // places through a shuffle), garble their readings and broken comb,
    // re-mark at random. Uncapped cells and what they show are untouched.
    const hidden = s.cells.flatMap((_, i) => (s.open[i] ? [] : [i]));
    const perm = rnd.shuffle([...hidden]);
    const x = structuredClone(s);
    hidden.forEach((i, t) => {
      x.cells[i] = s.cells[perm[t]] === C.EMPTY ? (s.queens ? 1 + (t % 2) : C.G) : C.EMPTY;
      x.shown[i] = rnd.int(0, 6); x.shownH[i] = rnd.int(0, 6);
      x.broken[i] = rnd() < 0.3 ? 1 : 0;
      x.mark[i] = rnd.int(0, s.queens ? 2 : 1);
    });
    assert.deepEqual(asPlain(C.provenNow(x)), plain, `${hive}#${k}`);
    for (const i of some) assert.deepEqual(C.minimalProof(x, i), C.minimalProof(s, i), `${hive}#${k} cell ${i}`);
  }
});

test('deterministic: the same state gives the same answer, from a copy too', () => {
  const rnd = makeRng(9);
  for (let k = 0; k < 30; k++) {
    const s = midGame(C.HIVES[k % 3].id, 500 + k, rnd);
    const a = C.provenNow(s), b = C.provenNow(structuredClone(s));
    assert.deepEqual(asPlain(a), asPlain(b));
    for (const i of [...a.safe, ...a.guard.keys()]) {
      assert.deepEqual(C.minimalProof(s, i), C.minimalProof(structuredClone(s), i));
    }
  }
});

test('after a sting, the stung cell reads as it did just before the tap', () => {
  const rnd = makeRng(31);
  let checked = 0;
  for (let k = 0; k < 60; k++) {
    const s = midGame(C.HIVES[k % 3].id, 700 + k, rnd);
    if (s.phase !== 'play') continue;
    s.mark.fill(C.NONE);
    const before = C.provenNow(s);
    const hazard = s.cells.findIndex((c, i) => c !== C.EMPTY && !s.open[i]);
    const proof = C.minimalProof(s, hazard, before);
    C.reveal(s, hazard);
    assert.equal(s.phase, 'lost');
    assert.deepEqual(asPlain(C.provenNow(s)), asPlain(before));
    assert.deepEqual(C.minimalProof(s, hazard), proof);
    checked++;
  }
  assert.ok(checked > 30);
});

/* Do these clues ALONE prove that cell i is `value`? Independent of the
 * solver: enumerate every assignment of the hidden cells they touch. */
function provesAlone(s, clueCells, i, value) {
  const nbrs = { length: s.open.length };                  // each clue's own scope: a Scout's is its range (#12)
  for (const c of clueCells) nbrs[c] = C.rangeOf(s, c);
  const cells = [...new Set(clueCells.flatMap((c) => nbrs[c].filter((j) => !s.open[j])))];
  if (!cells.includes(i)) return false;
  const bits = BIT.filter((b) => (s.queens ? 7 : 3) & b);
  const val = new Map();
  const fits = (final) => clueCells.every((c) => {
    let g = 0, q = 0, u = 0;
    for (const j of nbrs[c]) {
      if (s.open[j]) continue;
      if (!val.has(j)) u++; else if (val.get(j) === GUARD) g++; else if (val.get(j) === QUEEN) q++;
    }
    const w = C.clueOf(s, c);
    return final ? g === w.guards && q === w.queens : g <= w.guards && q <= w.queens && w.guards - g + w.queens - q <= u;
  });
  let other = false;
  const go = (k) => {
    if (other) return;
    if (k === cells.length) { if (fits(true) && val.get(i) !== value) other = true; return; }
    for (const b of bits) { val.set(cells[k], b); if (fits(false)) go(k + 1); val.delete(cells[k]); }
  };
  go(0);
  return !other;
}

function* subsets(list, size, from = 0, acc = []) {
  if (acc.length === size) { yield acc; return; }
  for (let k = from; k < list.length; k++) yield* subsets(list, size, k + 1, [...acc, list[k]]);
}

test('minimal proofs: the clues alone prove the cell, and no smaller set does (brute force, sizes ≤ 3)', () => {
  const rnd = makeRng(1234);
  const sizes = new Map();
  let small = 0;
  for (let k = 0; k < 90; k++) {
    const s = midGame(C.HIVES[k % 3].id, 300 + k, rnd);
    const nbrs = C.nbrsOf(s.cols, s.rows);
    const p = C.provenNow(s);
    const clueCells = s.open.flatMap((o, c) => (o && C.clueOf(s, c) ? [c] : []));
    for (const i of [...p.safe, ...p.guard.keys()]) {
      const r = C.minimalProof(s, i, p);
      assert.equal(r.value, s.cells[i] === C.EMPTY ? SAFE : KIND_BIT[s.cells[i]]);
      assert.deepEqual(r.clues, sorted(r.clues));
      assert.ok(provesAlone(s, r.clues, i, r.value), `#${k} cell ${i}: [${r.clues}] does not prove it`);
      sizes.set(r.clues.length, (sizes.get(r.clues.length) || 0) + 1);
      if (r.clues.length > 3) continue;
      // no smaller subset of ALL uncapped clues proves it. (The one pruning:
      // a proof needs a clue touching i, else i is unconstrained.)
      for (let size = 1; size < r.clues.length; size++) {
        for (const sub of subsets(clueCells, size)) {
          if (!sub.some((c) => nbrs[c].includes(i))) continue;
          assert.ok(!provesAlone(s, sub, i, r.value), `#${k} cell ${i}: [${sub}] beats [${r.clues}]`);
        }
      }
      small++;
    }
  }
  const bySize = JSON.stringify([...sizes].sort((a, b) => a[0] - b[0]));
  assert.ok(small > 1000 && sizes.get(2) > 100 && sizes.get(3) > 20, `vacuous: ${bySize}`);
  // beyond PROOF_MAX, a proof is a whole group (the fallback), never a 5-subset search
  assert.ok([...sizes.keys()].some((n) => n <= PROOF_MAX));
});

test('generation is unchanged by #2 (fingerprint of seeds 1–300, every hive)', () => {
  // computed on origin/main before #2 touched solver.js (Wildflowers re-pinned
  // 2026-09-30 for its new guard and broken counts; the solver didn't change)
  const want = {
    clover: 'c7315847d520a8f27f5245e7d63880c3be8c22ae70a259b8723e2ac886c811e1',
    apple: '03e25b1e04cdf78aa2afe7e7e8f8e4eb09dd637f9de8e50ff13dd6a85115229b',
    wildflowers: '0eed28e057c14470ea69b7a5acfcc449f43d2860122eb5960f52229f80ef783a',   // re-pinned when Wildflowers moved to 26 guards / 12 broken
    queen: 'fd1cfdfd63ef58884ec85d11d8905d43850a6066e1f3f101246ab277b4ddc865',   // #10, pinned when it was added (21 + 12 guards, 10 broken)
    sunflower: '0b58e06de51cbe41e1b66486c06f64d217495906593f556e1db79a5f1a3b1c69',   // #12, pinned when it was added (32 guards, 8 Scouts)
  };
  for (const h of C.HIVES) {
    const hash = createHash('sha256');
    for (let seed = 1; seed <= 300; seed++) {
      const f = C.generate(h.id, seed);
      hash.update(JSON.stringify([f.start, f.tries, f.cells, f.shown, f.shownH, f.broken]));
    }
    assert.equal(hash.digest('hex'), want[h.id], h.id);
  }
});

// ── Scouts: clues two steps wide (#12) ──────────────────────────────────────

test('Sunflower Field\'s Scout positions are pinned too (seeds 1–300)', () => {
  const hash = createHash('sha256');
  for (let seed = 1; seed <= 300; seed++) hash.update(JSON.stringify(C.generate('sunflower', seed).scout));
  assert.equal(hash.digest('hex'), '6540c89983d41c9902b5b1db3378c86c8d8ce30c7b938c49b1272e5324ad7c3d');
});

test('solve() with one Scout clue is exact against brute force over its range', () => {
  // 5×5, the centre cell (12) an opened Scout counting all 18... of its 18
  // cells in range; every layout of a sample: the solver must say exactly
  // what enumerating its range says
  const cols = 5, rows = 5, n = 25, c = 12;
  const nbrs = neighbours(cols, rows), range = ring2(cols, rows)[c];
  assert.equal(range.length, 18);
  let decided = 0;
  for (let t = 0; t < 400; t++) {
    const rnd = makeRng(9000 + t);
    const cells = [...Array(n)].map((_, i) => (i !== c && rnd() < 0.15 + 0.7 * (t % 5) / 4 * 0.5 ? 1 : 0));
    const clue = range.filter((j) => cells[j]).length;
    const dom = new Uint8Array(n).fill(3);
    const opened = new Uint8Array(n);
    opened[c] = 1; dom[c] = SAFE;
    solve(nbrs, dom, (i) => (i === c ? { guards: clue, queens: 0, over: range } : null), () => {}, opened);
    // brute force: the clue alone constrains only the count over its range
    const k = range.length;
    const want = clue === 0 ? SAFE : clue === k ? GUARD : 3;
    for (const j of range) { assert.equal(dom[j], want, `t${t} clue ${clue} cell ${j}`); if (want !== 3) decided++; }
    for (let j = 0; j < n; j++) if (j !== c && !range.includes(j)) assert.equal(dom[j], 3, 'nothing outside the range');
  }
  assert.ok(decided > 0);
});

/* A small hand-built frame with Scouts on some safe cells: shown counts over
 * each cell's own scope, as core.js stores them. */
function scoutFrame(cols, rows, rnd, density) {
  const n = cols * rows;
  const nbrs = neighbours(cols, rows), range = ring2(cols, rows);
  const cells = [...Array(n)].map(() => (rnd() < density ? C.G : C.EMPTY));
  const scout = cells.map((v) => (v === C.EMPTY && rnd() < 0.35 ? 1 : 0));
  const shown = cells.map((_, i) => (scout[i] ? range[i] : nbrs[i]).filter((j) => cells[j] === C.G).length);
  return { cols, rows, queens: 0, guards: cells.filter((v) => v).length, cells, scout, shown, shownH: cells.map(() => 0), broken: cells.map(() => 0) };
}

test('provenNow equals brute force on small frames with Scouts (≤ 5×5)', () => {
  const rnd = makeRng(1212);
  let decided = 0, tried = 0, scoutsOpen = 0, byScout = 0;
  for (let t = 0; t < 500; t++) {
    const cols = rnd.int(3, 5), rows = rnd.int(3, 5), n = cols * rows;
    const f = scoutFrame(cols, rows, rnd, 0.3);
    const nbrs = neighbours(cols, rows);
    const open = new Array(n).fill(0);
    const safeCells = f.cells.flatMap((c, i) => (c === C.EMPTY ? [i] : []));
    for (const i of safeCells) if (rnd() < 0.5) open[i] = 1;
    for (const i of safeCells) if (open.filter((o) => !o).length > 12) open[i] = 1;
    if (open.filter((o) => !o).length > 12) continue;
    if (open.some((o, i) => o && f.scout[i])) scoutsOpen++;
    const s = { ...f, open, mark: new Array(n).fill(0) };

    const want = bruteForce(nbrs, Uint8Array.from(open), (i) => C.clueOf(f, i), 3);
    // the same frame with its Scouts blanked: what the Scouts alone added
    const blank = bruteForce(nbrs, Uint8Array.from(open), (i) => (f.scout[i] ? null : C.clueOf(f, i)), 3);
    const p = C.provenNow(s);
    for (let i = 0; i < n; i++) {
      if (open[i]) continue;
      const got = p.safe.has(i) ? SAFE : p.guard.get(i) ?? 0;
      const exact = BIT.includes(want[i]) ? want[i] : 0;
      assert.equal(got, exact, `t${t} ${cols}×${rows} cell ${i}: brute ${want[i]}`);
      if (exact) decided++;
      if (exact && !BIT.includes(blank[i])) byScout++;
    }
    tried++;
  }
  assert.ok(tried > 300 && decided > 300 && scoutsOpen > 200 && byScout > 50,
    `vacuous: ${tried} frames, ${decided} decided, ${scoutsOpen} with a Scout open, ${byScout} decided only by a Scout`);
});

test('Scouts: provenNow is sound and never peeks, on 600 mid-game Sunflower states', () => {
  const rnd = makeRng(1213);
  let safe = 0, guard = 0;
  for (let k = 0; k < 600; k++) {
    const s = midGame('sunflower', 1 + (k % 97), rnd);
    const p = C.provenNow(s);
    for (const i of p.safe) { assert.ok(!s.open[i] && s.cells[i] === C.EMPTY, `#${k}: ${i} not safe`); safe++; }
    for (const [i, kind] of p.guard) { assert.ok(!s.open[i] && s.cells[i] === C.G, `#${k}: ${i}`); assert.equal(kind, GUARD); guard++; }
    if (k % 4) continue;
    // a capped Scout is any cap: reading whether a hidden cell is a Scout
    // throws, and so does any hidden contents or mark
    const b = blindfold(s);
    b.scout = new Proxy(s.scout, {
      get(t, key) {
        if (typeof key === 'string' && /^\d+$/.test(key) && !s.open[+key]) throw new Error(`peeked at scout[${key}]`);
        return t[key];
      },
    });
    assert.deepEqual(asPlain(C.provenNow(b)), asPlain(p));
    for (const i of [...p.safe, ...p.guard.keys()].slice(0, 3)) assert.deepEqual(C.minimalProof(b, i), C.minimalProof(s, i, p));
  }
  assert.ok(safe > 1000 && guard > 1000, `vacuous: ${safe} safe, ${guard} guard`);
});

test('Scouts: minimal proofs prove the cell, and no smaller set does (brute force, sizes ≤ 3)', () => {
  const rnd = makeRng(4321);
  const sizes = new Map();
  let small = 0, withScout = 0;
  for (let k = 0; k < 70; k++) {
    const s = midGame('sunflower', 600 + k, rnd);
    const p = C.provenNow(s);
    const clueCells = s.open.flatMap((o, c) => (o && C.clueOf(s, c) ? [c] : []));
    for (const i of [...p.safe, ...p.guard.keys()]) {
      const r = C.minimalProof(s, i, p);
      assert.equal(r.value, s.cells[i] === C.EMPTY ? SAFE : GUARD);
      assert.ok(provesAlone(s, r.clues, i, r.value), `#${k} cell ${i}: [${r.clues}] does not prove it`);
      sizes.set(r.clues.length, (sizes.get(r.clues.length) || 0) + 1);
      if (r.clues.some((c) => C.isScout(s, c))) withScout++;
      if (r.clues.length > 3) continue;
      for (let size = 1; size < r.clues.length; size++) {
        for (const sub of subsets(clueCells, size)) {
          if (!sub.some((c) => C.rangeOf(s, c).includes(i))) continue;
          assert.ok(!provesAlone(s, sub, i, r.value), `#${k} cell ${i}: [${sub}] beats [${r.clues}]`);
        }
      }
      small++;
    }
  }
  assert.ok(small > 500 && withScout > 20 && sizes.get(2) > 50, `vacuous: ${small} small, ${withScout} with a Scout, ${JSON.stringify([...sizes])}`);
});

test('the wide pass only runs with a Scout on screen: no-Scout clue sets solve as before', () => {
  // the same clue function with and without an explicit `over` equal to the
  // neighbours: a plain clue named wide reaches the same verdict
  const rnd = makeRng(55);
  for (let t = 0; t < 60; t++) {
    const s = midGame(C.HIVES[t % 3].id, 900 + t, rnd);
    const nbrs = C.nbrsOf(s.cols, s.rows);
    const opened = Uint8Array.from(s.open, (o, i) => (o && s.cells[i] === C.EMPTY ? 1 : 0));
    const kinds = s.queens ? 7 : 3;
    const plain = provenNow(nbrs, opened, (i) => C.clueOf(s, i), kinds);
    const wide = provenNow(nbrs, opened, (i) => { const c = C.clueOf(s, i); return c && { ...c, over: nbrs[i] }; }, kinds);
    assert.deepEqual(asPlain(wide), asPlain(plain), `t${t}`);
  }
});
