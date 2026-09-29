import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../core.js';
import { neighbours, centre, cellAt } from '../hex.js';
import { makeRng } from '../arcade-rng.js';

test('arcade-rng is the fleet algorithm (known-answer vector, GAME_INTEGRATION §7c)', () => {
  const r = makeRng(42);
  assert.deepEqual([r(), r(), r()], [0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
});

test('hex neighbours: interior cells have six, the relation is symmetric', () => {
  const nb = neighbours(9, 14);
  for (let i = 0; i < nb.length; i++) {
    const x = i % 9, y = (i / 9) | 0;
    if (x > 0 && x < 8 && y > 0 && y < 13) assert.equal(nb[i].length, 6);
    for (const j of nb[i]) assert.ok(nb[j].includes(i), `${i}↔${j}`);
  }
  assert.deepEqual(neighbours(3, 3)[4].sort((a, b) => a - b), [1, 2, 3, 5, 7, 8]);   // odd row shifts right
});

test('hex hit-testing finds every cell at its own centre', () => {
  for (let i = 0; i < 9 * 14; i++) {
    const c = centre(i, 9, 20);
    assert.equal(cellAt(c.x, c.y, 9, 14, 20), i);
  }
  assert.equal(cellAt(-50, -50, 9, 14, 20), -1);
});

test('a frame is fixed by (hive, seed) — the daily and racing depend on it', () => {
  for (const h of C.HIVES) {
    const a = C.generate(h.id, 1234), b = C.generate(h.id, 1234);
    assert.deepEqual(a.cells, b.cells);
    assert.deepEqual(a.shown, b.shown);
    assert.deepEqual(a.broken, b.broken);
    assert.notDeepEqual(C.generate(h.id, 1235).cells, a.cells);
  }
});

test('pinned frame: a change to generation or the solver shows up here first', () => {
  // If this moves on purpose, every shared code and every past daily changes
  // with it — bump core's `v` and say so in the design doc.
  const f = C.generate('clover', 7);
  const fp = f.cells.reduce((h, c, i) => (Math.imul(h ^ (c * 31 + i), 16777619) >>> 0), 2166136261);
  assert.equal(f.start, 75);
  assert.equal(fp, 3497674226);
});

test('every hive: the right counts, a clear flooding opening, honest readings', () => {
  for (const h of C.HIVES) {
    for (let seed = 1; seed <= 25; seed++) {
      const f = C.generate(h.id, seed);
      const nb = C.nbrsOf(f.cols, f.rows);
      assert.equal(f.cells.filter((c) => c === C.G).length, h.guards);
      assert.equal(f.cells.filter((c) => c === C.Q).length, h.queens);
      assert.equal(f.cells[f.start], C.EMPTY);
      for (const j of nb[f.start]) assert.equal(f.cells[j], C.EMPTY);
      assert.ok(C.floods(f, f.start));
      let broken = 0;
      for (let i = 0; i < f.cells.length; i++) {
        if (f.cells[i] !== C.EMPTY) { assert.equal(f.broken[i], 0, 'only safe comb breaks'); continue; }
        const g = nb[i].filter((j) => f.cells[j] === C.G).length;
        const q = nb[i].filter((j) => f.cells[j] === C.Q).length;
        assert.equal(f.shown[i], g, 'the stored count is the truth, broken or not');
        assert.equal(f.shownH[i], q);
        if (f.broken[i]) {
          broken++;
          assert.equal(C.clueOf(f, i), null, 'broken comb reads nothing');
          assert.equal(C.floods(f, i), false, 'broken comb never floods');
          assert.ok(i !== f.start && !nb[f.start].includes(i), 'the opening is whole');
        } else {
          assert.deepEqual(C.clueOf(f, i), { guards: g, queens: q });
        }
      }
      assert.equal(broken, h.broken);
    }
  }
});

test('every generated frame is solvable without a guess', () => {
  for (const h of C.HIVES) for (let seed = 100; seed < 140; seed++) assert.ok(C.solvable(C.generate(h.id, seed)));
});

test('newGame opens the opening; uncap floods zeros; a guard stings', () => {
  const s = C.newGame('clover', 99);
  assert.equal(s.v, C.SAVE_V);
  assert.equal(s.open[s.start], 1);
  assert.ok(s.open.filter(Boolean).length > 7, 'the opening floods past its ring');
  const guard = s.cells.indexOf(C.G);
  assert.ok(C.reveal(s, guard));
  assert.equal(s.phase, 'lost');
  assert.equal(s.stung, guard);
  assert.deepEqual(s.events.map((e) => e.type), ['sting']);
  assert.equal(C.reveal(s, s.cells.indexOf(C.EMPTY)), false, 'nothing moves after the end');
});

test('marks: cycle per hive, protect a cell, and are dropped when a flood opens it', () => {
  const s = C.newGame('clover', 5);
  const hidden = s.open.findIndex((o, i) => !o && s.cells[i] === C.EMPTY);
  C.mark(s, hidden); assert.equal(s.mark[hidden], C.MARK_G);
  assert.equal(C.reveal(s, hidden), false, 'a marked cell is protected');
  C.mark(s, hidden); assert.equal(s.mark[hidden], C.NONE, 'clover cycles none → guard → none');

  const o = C.newGame('apple', 5);
  const h2 = o.open.findIndex((v) => !v);
  C.mark(o, h2); C.mark(o, h2); assert.equal(o.mark[h2], C.MARK_Q);
  C.mark(o, h2); assert.equal(o.mark[h2], C.NONE);
});

test('playing the frame out by truth wins it, and sweeping works on plain numbers', () => {
  for (const h of C.HIVES) {
    const s = C.newGame(h.id, 321);
    // mark every hazard truthfully, then sweep every opened plain number, then
    // tap anything left: that is a complete, legal game
    s.cells.forEach((c, i) => { if (c === C.G) C.setMark(s, i, C.MARK_G); if (c === C.Q) C.setMark(s, i, C.MARK_Q); });
    for (let pass = 0; pass < 4 && s.phase === 'play'; pass++) {
      for (let i = 0; i < s.cells.length && s.phase === 'play'; i++) if (s.open[i]) C.sweep(s, i);
    }
    for (let i = 0; i < s.cells.length && s.phase === 'play'; i++) if (!s.open[i] && s.cells[i] === C.EMPTY) C.reveal(s, i);
    assert.equal(s.phase, 'won', h.id);
    assert.equal(C.safeLeft(s), 0);
    assert.equal(s.events.at(-1).type, 'won');
  }
});

test('sweep refuses broken comb and unsatisfied numbers; a wrong mark stings', () => {
  const w = C.newGame('wildflowers', 8);
  const broken = w.broken.findIndex((c, i) => c && w.cells[i] === C.EMPTY);
  w.open[broken] = 1;
  // mark its true neighbours: were it a plain number, this sweep would go
  C.nbrsOf(w.cols, w.rows)[broken].forEach((j) => { if (w.cells[j] === C.G) C.setMark(w, j, C.MARK_G); });
  assert.equal(C.sweep(w, broken), false);

  const s = C.newGame('clover', 12);
  const nb = C.nbrsOf(s.cols, s.rows);
  const num = s.open.findIndex((o, i) => o && s.shown[i] > 0 && nb[i].some((j) => !s.open[j]));
  assert.equal(C.sweep(s, num), false, 'no marks yet');
  // mark SAFE hidden neighbours instead of the guards: the sweep believes you
  const hid = nb[num].filter((j) => !s.open[j]);
  const safe = hid.filter((j) => s.cells[j] === C.EMPTY);
  if (safe.length >= s.shown[num] && hid.some((j) => s.cells[j] !== C.EMPTY)) {
    safe.slice(0, s.shown[num]).forEach((j) => C.setMark(s, j, C.MARK_G));
    assert.ok(C.sweep(s, num));
    assert.equal(s.phase, 'lost');
  }
});

test('board codes round-trip, and junk is rejected', () => {
  for (const h of C.HIVES) {
    for (const seed of [0, 1, 123456789, 0xffffffff]) {
      assert.deepEqual(C.parseCode(C.boardCode(h.id, seed)), { hive: h.id, seed });
    }
  }
  assert.equal(C.boardCode('clover', 35), 'CL-000000Z');
  assert.equal(C.boardCode('apple', 35), 'AP-000000Z');
  assert.equal(C.boardCode('wildflowers', 35), 'WI-000000Z');
  assert.deepEqual(C.parseCode(' wi-00000zz '), { hive: 'wildflowers', seed: 35 * 36 + 35 });
  for (const bad of ['', 'XX-1', 'CL-', 'CL-ZZZZZZZZ', 'clover', null]) assert.equal(C.parseCode(bad), null);
});

test('old ids still resolve: hiveById aliases them, never falling back to the first hive', () => {
  assert.equal(C.hiveById('meadow').id, 'clover');
  assert.equal(C.hiveById('orchard').id, 'apple');
  assert.equal(C.hiveById('wild').id, 'wildflowers');
  for (const h of C.HIVES) assert.equal(C.hiveById(h.id), h);
  assert.equal(C.hiveById('toString').id, 'clover', 'unknown ids (even Object.prototype names) fall back');
});

test('old ME-/OR- codes parse to clover/apple and open the identical frame', () => {
  for (const [old, now, was, id] of [['ME', 'CL', 'meadow', 'clover'], ['OR', 'AP', 'orchard', 'apple']]) {
    for (const seed of [0, 7, 0xabc, 123456789, 0xffffffff]) {
      const tail = (seed >>> 0).toString(36).toUpperCase().padStart(7, '0');
      const a = C.parseCode(`${old}-${tail}`), b = C.parseCode(`${now}-${tail}`);
      assert.deepEqual(a, { hive: id, seed });
      assert.deepEqual(b, a);
      // the hive id is not in the RNG: renamed, the frame is the same frame
      assert.deepEqual(C.generate(a.hive, a.seed), C.generate(b.hive, b.seed));
      assert.deepEqual(C.generate(was, seed), C.generate(id, seed));
    }
  }
  // …and the same frame the old code opened before the rename: these prints
  // were taken from the v0.0.2 generator (meadow/orchard)
  const fp = (f) => [...f.cells, ...f.shown, ...f.shownH, f.start]
    .reduce((h, c, i) => (Math.imul(h ^ (c * 31 + i), 16777619) >>> 0), 2166136261);
  assert.equal(fp(C.generate('clover', 7)), 1650734399);
  assert.equal(fp(C.generate('clover', 0xabc)), 3006078245);
  assert.equal(fp(C.generate('apple', 7)), 2129512871);
  assert.equal(fp(C.generate('apple', 0xabc)), 3811161821);
});

test('Wildflowers generation budget: 1,000 seeds, median tries ≤ 10, max well under MAX_TRIES', () => {
  const tries = [];
  for (let seed = 1; seed <= 1000; seed++) tries.push(C.generate('wildflowers', seed).tries);
  tries.sort((a, b) => a - b);
  const median = tries[500], max = tries.at(-1);
  assert.ok(median <= 10, `median tries ${median}`);
  assert.ok(max <= C.MAX_TRIES / 10, `max tries ${max} of ${C.MAX_TRIES}`);
});

test('a saved game is plain JSON and plays on after a round trip', () => {
  const s = C.newGame('apple', 77);
  const back = JSON.parse(JSON.stringify({ ...s, events: [] }));
  const i = back.open.findIndex((o, k) => !o && back.cells[k] === C.EMPTY);
  assert.ok(C.reveal(back, i));
  assert.equal(back.open[i], 1);
});
