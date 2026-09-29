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
    assert.deepEqual(a.cracked, b.cracked);
    assert.notDeepEqual(C.generate(h.id, 1235).cells, a.cells);
  }
});

test('pinned frame: a change to generation or the solver shows up here first', () => {
  // If this moves on purpose, every shared code and every past daily changes
  // with it — bump core's `v` and say so in the design doc.
  const f = C.generate('meadow', 7);
  const fp = f.cells.reduce((h, c, i) => (Math.imul(h ^ (c * 31 + i), 16777619) >>> 0), 2166136261);
  assert.equal(f.start, 75);
  assert.equal(fp, 3497674226);
});

test('every hive: the right counts, a clear flooding opening, honest readings', () => {
  for (const h of C.HIVES) {
    for (let seed = 1; seed <= 25; seed++) {
      const f = C.generate(h.id, seed);
      const nb = C.nbrsOf(f.cols, f.rows);
      assert.equal(f.cells.filter((c) => c === C.W).length, h.wasps);
      assert.equal(f.cells.filter((c) => c === C.H).length, h.hornets);
      assert.equal(f.cells[f.start], C.EMPTY);
      for (const j of nb[f.start]) assert.equal(f.cells[j], C.EMPTY);
      assert.ok(C.floods(f, f.start));
      let cracks = 0;
      for (let i = 0; i < f.cells.length; i++) {
        if (f.cells[i] !== C.EMPTY) continue;
        const w = nb[i].filter((j) => f.cells[j] === C.W).length;
        const hh = nb[i].filter((j) => f.cells[j] === C.H).length;
        if (f.cracked[i]) {
          cracks++;
          assert.equal(Math.abs(f.shown[i] - (w + hh)), 1, 'a crack lies by exactly one');
          assert.ok(f.shown[i] >= 0 && f.shown[i] <= nb[i].length);
        } else {
          assert.equal(f.shown[i], w);
          assert.equal(f.shownH[i], hh);
        }
      }
      assert.equal(cracks, h.cracked);
    }
  }
});

test('every generated frame is solvable without a guess', () => {
  for (const h of C.HIVES) for (let seed = 100; seed < 140; seed++) assert.ok(C.solvable(C.generate(h.id, seed)));
});

test('newGame opens the opening; uncap floods zeros; a wasp stings', () => {
  const s = C.newGame('meadow', 99);
  assert.equal(s.open[s.start], 1);
  assert.ok(s.open.filter(Boolean).length > 7, 'the opening floods past its ring');
  const wasp = s.cells.indexOf(C.W);
  assert.ok(C.reveal(s, wasp));
  assert.equal(s.phase, 'lost');
  assert.equal(s.stung, wasp);
  assert.deepEqual(s.events.map((e) => e.type), ['sting']);
  assert.equal(C.reveal(s, s.cells.indexOf(C.EMPTY)), false, 'nothing moves after the end');
});

test('marks: cycle per hive, protect a cell, and are dropped when a flood opens it', () => {
  const s = C.newGame('meadow', 5);
  const hidden = s.open.findIndex((o, i) => !o && s.cells[i] === C.EMPTY);
  C.mark(s, hidden); assert.equal(s.mark[hidden], C.MARK_W);
  assert.equal(C.reveal(s, hidden), false, 'a marked cell is protected');
  C.mark(s, hidden); assert.equal(s.mark[hidden], C.NONE, 'meadow cycles none → wasp → none');

  const o = C.newGame('orchard', 5);
  const h2 = o.open.findIndex((v) => !v);
  C.mark(o, h2); C.mark(o, h2); assert.equal(o.mark[h2], C.MARK_H);
  C.mark(o, h2); assert.equal(o.mark[h2], C.NONE);
});

test('playing the frame out by truth wins it, and sweeping works on plain numbers', () => {
  for (const h of C.HIVES) {
    const s = C.newGame(h.id, 321);
    // mark every hazard truthfully, then sweep every opened plain number, then
    // tap anything left: that is a complete, legal game
    s.cells.forEach((c, i) => { if (c === C.W) C.setMark(s, i, C.MARK_W); if (c === C.H) C.setMark(s, i, C.MARK_H); });
    for (let pass = 0; pass < 4 && s.phase === 'play'; pass++) {
      for (let i = 0; i < s.cells.length && s.phase === 'play'; i++) if (s.open[i]) C.sweep(s, i);
    }
    for (let i = 0; i < s.cells.length && s.phase === 'play'; i++) if (!s.open[i] && s.cells[i] === C.EMPTY) C.reveal(s, i);
    assert.equal(s.phase, 'won', h.id);
    assert.equal(C.safeLeft(s), 0);
    assert.equal(s.events.at(-1).type, 'won');
  }
});

test('sweep refuses cracked cells and unsatisfied numbers; a wrong mark stings', () => {
  const w = C.newGame('wild', 8);
  const cracked = w.cracked.findIndex((c, i) => c && w.cells[i] === C.EMPTY);
  w.open[cracked] = 1;
  assert.equal(C.sweep(w, cracked), false);

  const s = C.newGame('meadow', 12);
  const nb = C.nbrsOf(s.cols, s.rows);
  const num = s.open.findIndex((o, i) => o && s.shown[i] > 0 && nb[i].some((j) => !s.open[j]));
  assert.equal(C.sweep(s, num), false, 'no marks yet');
  // mark SAFE hidden neighbours instead of the wasps: the sweep believes you
  const hid = nb[num].filter((j) => !s.open[j]);
  const safe = hid.filter((j) => s.cells[j] === C.EMPTY);
  if (safe.length >= s.shown[num] && hid.some((j) => s.cells[j] !== C.EMPTY)) {
    safe.slice(0, s.shown[num]).forEach((j) => C.setMark(s, j, C.MARK_W));
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
  assert.deepEqual(C.parseCode(' wi-00000zz '), { hive: 'wild', seed: 35 * 36 + 35 });
  for (const bad of ['', 'XX-1', 'ME-', 'ME-ZZZZZZZZ', 'meadow', null]) assert.equal(C.parseCode(bad), null);
});

test('a saved game is plain JSON and plays on after a round trip', () => {
  const s = C.newGame('orchard', 77);
  const back = JSON.parse(JSON.stringify({ ...s, events: [] }));
  const i = back.open.findIndex((o, k) => !o && back.cells[k] === C.EMPTY);
  assert.ok(C.reveal(back, i));
  assert.equal(back.open[i], 1);
});
