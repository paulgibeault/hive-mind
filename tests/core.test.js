import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../core.js';
import { neighbours, ring2, centre, cellAt } from '../hex.js';
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
      let broken = 0, scouts = 0;
      const range = C.ring2Of(f.cols, f.rows);
      for (let i = 0; i < f.cells.length; i++) {
        if (f.cells[i] !== C.EMPTY) {
          assert.equal(f.broken[i], 0, 'only safe comb breaks');
          assert.equal(f.scout[i], 0, 'only safe comb scouts');
          continue;
        }
        if (f.scout[i]) {
          // a Scout (#12): its count is over its range, and it never floods
          scouts++;
          assert.equal(f.broken[i], 0, 'a Scout is never broken too');
          assert.ok(i !== f.start && !nb[f.start].includes(i), 'the opening has no Scout');
          const g = range[i].filter((j) => f.cells[j] === C.G).length;
          assert.equal(f.shown[i], g, "a Scout's stored count is its range's");
          assert.equal(f.shownH[i], 0);
          assert.deepEqual(C.clueOf(f, i), { guards: g, queens: 0, over: range[i] });
          assert.equal(C.floods(f, i), false, 'a Scout never floods, not even a 0');
          continue;
        }
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
      assert.equal(scouts, h.scouts || 0);
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

// ── the Queen's Frame (#10) ──────────────────────────────────────────────

test("the Queen's Frame: Apple Orchard's two kinds on broken comb, 9 × 20, hidden", () => {
  const q = C.hiveById('queen');
  assert.equal(q.id, 'queen');
  assert.equal(q.name, "Queen's Frame");
  assert.deepEqual([q.cols, q.rows], [9, 20], '9 wide: 10 drops a cell under 40 px on a 390 px phone');
  assert.ok(q.guards > 0 && q.queens > 0 && q.broken > 0, 'both kinds, and broken comb');
  assert.equal(q.puffs, 2);
  assert.equal(q.hidden, true);
  assert.ok(!C.PICKABLE.includes(q), 'the selector and the daily never offer it');
  assert.deepEqual(C.HIVES.filter((h) => h.hidden).map((h) => h.id), ['queen']);
  // appended after the three pickable hives, so they kept their indices
  // (prefs.hive); Sunflower Field (#12) was appended after it in turn
  assert.deepEqual(C.HIVES.map((h) => h.id).slice(0, 4), ['clover', 'apple', 'wildflowers', 'queen']);

  const f = C.generate('queen', 9);
  assert.ok(f.cells.includes(C.Q) && f.broken.some(Boolean));
});

test("QU- codes round-trip and open the Queen's Frame", () => {
  assert.equal(C.boardCode('queen', 35), 'QU-000000Z');
  assert.deepEqual(C.parseCode('qu-000000z'), { hive: 'queen', seed: 35 });
  const s = C.newGame(C.parseCode('QU-0AB12CD').hive, C.parseCode('QU-0AB12CD').seed);
  assert.equal(s.hive, 'queen');
  assert.deepEqual([s.cols, s.rows, s.puffs], [9, 20, 2]);
});

test("adding the Queen's Frame moved no other hive's frames", () => {
  // the same prints as the pinned tests above, taken before the queen existed,
  // plus Wildflowers (broken comb shares the stacked hive's code path)
  const fp = (f) => [...f.cells, ...f.shown, ...f.shownH, ...f.broken, f.start]
    .reduce((h, c, i) => (Math.imul(h ^ (c * 31 + i), 16777619) >>> 0), 2166136261);
  assert.equal(fp(C.generate('clover', 7)), 3445885415);
  assert.equal(fp(C.generate('apple', 7)), 4092483904);
  assert.equal(fp(C.generate('wildflowers', 7)), 604351643);
  assert.equal(fp(C.generate('wildflowers', 0xabc)), 1852827782);
});

test("Queen's Frame generation budget: 1,000 seeds, median tries ≤ 20, max < MAX_TRIES", () => {
  const tries = [], ms = [];
  for (let seed = 1; seed <= 1000; seed++) {
    const t0 = performance.now();
    tries.push(C.generate('queen', seed).tries);
    ms.push(performance.now() - t0);
  }
  tries.sort((a, b) => a - b);
  ms.sort((a, b) => a - b);
  const median = tries[500], max = tries.at(-1);
  console.log(`# queen tries: median ${median}, p90 ${tries[900]}, max ${max}; ms: median ${ms[500].toFixed(2)}, p99 ${ms[990].toFixed(1)}, max ${ms.at(-1).toFixed(1)}`);
  assert.ok(median <= 20, `median tries ${median}`);
  assert.ok(max < C.MAX_TRIES / 10, `max tries ${max} of ${C.MAX_TRIES}`);
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

// ── the smoker (#08) ─────────────────────────────────────────────────────

/* A frame stung on its first guard of `kind`: 'lost', the sting fresh. */
function stungOn(hive, seed, kind = C.G) {
  const s = C.newGame(hive, seed);
  const i = s.cells.indexOf(kind);
  assert.ok(C.reveal(s, i));
  assert.equal(s.phase, 'lost');
  s.events = [];
  return { s, i };
}

test('smoker: every hive starts with its puffs, and a new game carries them', () => {
  for (const h of C.HIVES) {
    assert.equal(h.puffs, h.id === 'queen' ? 2 : 1, `${h.id} gives ${h.id === 'queen' ? 'two puffs' : 'one puff'}`);
    assert.equal(C.newGame(h.id, 3).puffs, h.puffs);
  }
});

test("smoker: the Queen's Frame calms twice, and a third sting is the end", () => {
  const s = C.newGame('queen', 41);
  for (const k of [1, 0]) {
    const i = s.cells.findIndex((c, j) => c !== C.EMPTY && !s.mark[j]);
    assert.ok(C.reveal(s, i));
    assert.ok(C.calm(s));
    assert.equal(s.puffs, k);
  }
  assert.ok(C.reveal(s, s.cells.findIndex((c, j) => c !== C.EMPTY && !s.mark[j])));
  assert.equal(C.calm(s), false);
  assert.equal(s.phase, 'lost');
});

test('smoker: calm restores play, puts the right mark in, and costs a puff', () => {
  const { s, i } = stungOn('clover', 99);
  const before = { open: [...s.open], mark: [...s.mark], moves: s.moves };
  assert.equal(C.calm(s), true);
  assert.equal(s.phase, 'play');
  assert.equal(s.stung, -1);
  assert.equal(s.puffs, 0);
  assert.equal(s.open[i], 0, 'the cell is capped again');
  assert.equal(s.mark[i], C.MARK_G, 'and marked as a guard');
  assert.deepEqual(s.events, [{ type: 'calm', cell: i, kind: C.G }]);
  // nothing else moved
  assert.deepEqual(s.open.map((o, k) => (k === i ? 0 : o)), before.open.map((o, k) => (k === i ? 0 : o)));
  assert.deepEqual(s.mark.map((m, k) => (k === i ? 0 : m)), before.mark);
  assert.equal(s.moves, before.moves);
  // and play really goes on
  const next = s.open.findIndex((o, k) => !o && s.cells[k] === C.EMPTY && !s.mark[k]);
  assert.ok(C.reveal(s, next));
  assert.equal(C.reveal(s, i), false, 'the calmed cell is protected by its mark');
});

test("smoker: a queen's guard is marked as a queen's guard", () => {
  const { s, i } = stungOn('apple', 77, C.Q);
  assert.ok(C.calm(s));
  assert.equal(s.mark[i], C.MARK_Q);
  assert.deepEqual(s.events, [{ type: 'calm', cell: i, kind: C.Q }]);
  const g = stungOn('apple', 77, C.G);
  assert.ok(C.calm(g.s));
  assert.equal(g.s.mark[g.i], C.MARK_G);
});

test('smoker: calm refuses without puffs, in play, after a win, and without a sting', () => {
  const { s } = stungOn('clover', 4);
  s.puffs = 0;
  const snap = JSON.stringify(s);
  assert.equal(C.calm(s), false, 'no puffs left');
  assert.equal(JSON.stringify(s), snap, 'and nothing moved');

  const play = C.newGame('clover', 4);
  assert.equal(C.calm(play), false, 'phase play');
  assert.equal(play.puffs, 1, 'no puff spent');

  const one = stungOn('wildflowers', 6);
  assert.ok(C.calm(one.s));
  assert.equal(C.calm(one.s), false, 'calming twice is not a thing');
  // a second sting with the one puff spent stays a loss
  const g2 = one.s.cells.findIndex((c, k) => c === C.G && !one.s.mark[k]);
  assert.ok(C.reveal(one.s, g2));
  assert.equal(C.calm(one.s), false);
  assert.equal(one.s.phase, 'lost');

  const odd = stungOn('clover', 5);
  odd.s.stung = -1;
  assert.equal(C.calm(odd.s), false, 'lost without a stung cell');

  const won = C.newGame('clover', 321);
  for (let k = 0; k < won.cells.length && won.phase === 'play'; k++) if (!won.open[k] && won.cells[k] === C.EMPTY) C.reveal(won, k);
  assert.equal(won.phase, 'won');
  assert.equal(C.calm(won), false, 'phase won');
});

test('smoker: a sweep-sting calmed leaves the other targets capped and the wrong mark in place', () => {
  // a 1 with one guard and 2+ capped safe neighbours; mark a safe one in the
  // guard's place, so the sweep stings partway round
  let found = null;
  for (let seed = 1; seed < 200 && !found; seed++) {
    const s = C.newGame('clover', seed);
    const nb = C.nbrsOf(s.cols, s.rows);
    for (let c = 0; c < s.cells.length && !found; c++) {
      if (!s.open[c] || s.shown[c] !== 1) continue;
      const hid = nb[c].filter((j) => !s.open[j]);
      const safe = hid.filter((j) => s.cells[j] === C.EMPTY);
      if (hid.length - safe.length !== 1 || safe.length < 2) continue;
      const t = structuredClone({ ...s, events: [] });
      C.setMark(t, safe[0], C.MARK_G);
      assert.ok(C.sweep(t, c));
      if (t.phase !== 'lost') continue;
      const left = nb[c].filter((j) => !t.open[j] && t.cells[j] === C.EMPTY && !t.mark[j]);
      if (left.length) found = { t, wrong: safe[0], left };
    }
  }
  assert.ok(found, 'a sweep that stung before reaching all of its targets');
  const { t, wrong, left } = found;
  const stung = t.stung;
  t.events = [];
  assert.ok(C.calm(t));
  assert.equal(t.phase, 'play');
  assert.equal(t.open[stung], 0);
  assert.equal(t.mark[stung], C.MARK_G);
  for (const j of left) assert.equal(t.open[j], 0, `target ${j} is still capped`);
  assert.equal(t.mark[wrong], C.MARK_G, 'the wrong mark stays for the player to fix');
  assert.equal(t.open[wrong], 0);
});

test('smoker: a frame calmed and played out still wins, and survives a save in between', () => {
  for (const h of C.HIVES) {
    const { s } = stungOn(h.id, 41, h.queens ? C.Q : C.G);
    // the stung state is plain JSON: saved between the sting and the puff
    const back = JSON.parse(JSON.stringify({ ...s, events: [] }));
    assert.equal(back.phase, 'lost');
    assert.ok(C.calm(back));
    for (let k = 0; k < back.cells.length && back.phase === 'play'; k++) {
      if (!back.open[k] && back.cells[k] === C.EMPTY) C.reveal(back, k);
    }
    assert.equal(back.phase, 'won', h.id);
    assert.equal(back.events.at(-1).type, 'won');
    assert.equal(back.puffs, h.puffs - 1);
  }
});

// ── Sunflower Field: Scouts (#12) ───────────────────────────────────────

test('ring2: a cell\'s range is every cell one or two steps away, up to 18', () => {
  for (const [cols, rows] of [[9, 18], [5, 5], [3, 4]]) {
    const nb = neighbours(cols, rows), range = ring2(cols, rows);
    // two steps by breadth-first search, independently
    for (let i = 0; i < cols * rows; i++) {
      const want = new Set(nb[i]);
      for (const j of nb[i]) for (const k of nb[j]) want.add(k);
      want.delete(i);
      assert.deepEqual(range[i], [...want].sort((a, b) => a - b), `${cols}×${rows} cell ${i}`);
      for (const j of range[i]) assert.ok(range[j].includes(i), 'symmetric');
    }
  }
  const range = ring2(9, 18);
  const x = 4, y = 8;                                       // an interior cell
  assert.equal(range[y * 9 + x].length, 18);
  assert.equal(Math.max(...range.map((r) => r.length)), 18);
  assert.equal(C.ring2Of(9, 18), C.ring2Of(9, 18), 'cached like nbrsOf');
  assert.deepEqual(C.ring2Of(9, 18), range);
});

test('Sunflower Field: one kind, 9 × 18, Scouts, pickable — appended after the Queen\'s Frame', () => {
  const h = C.hiveById('sunflower');
  assert.equal(h.name, 'Sunflower Field');
  assert.deepEqual([h.cols, h.rows, h.queens, h.broken, h.puffs], [9, 18, 0, 0, 1]);
  assert.ok(h.scouts > 0 && h.guards > 0);
  assert.equal(C.HIVES.at(-1), h, 'appended: no other hive moves');
  // prefs.hive is an index into PICKABLE: the first three keep theirs
  assert.deepEqual(C.PICKABLE.map((x) => x.id), ['clover', 'apple', 'wildflowers', 'sunflower']);
  assert.equal(C.boardCode('sunflower', 35), 'SU-000000Z');
  assert.deepEqual(C.parseCode('su-000000z'), { hive: 'sunflower', seed: 35 });
  // a Scout's reading is one number: no hive puts them on two kinds
  for (const x of C.HIVES) assert.ok(!(x.scouts && x.queens), `${x.id} mixes Scouts and two kinds`);
});

test('no hive but Sunflower Field has a Scout; adding it moved no other frame', () => {
  for (const h of C.HIVES.filter((x) => x.id !== 'sunflower')) {
    for (const seed of [1, 7, 0xabc]) assert.ok(C.generate(h.id, seed).scout.every((v) => v === 0), h.id);
  }
  // the same prints as "adding the Queen's Frame moved no other hive's frames"
  const fp = (f) => [...f.cells, ...f.shown, ...f.shownH, ...f.broken, f.start]
    .reduce((h, c, i) => (Math.imul(h ^ (c * 31 + i), 16777619) >>> 0), 2166136261);
  assert.equal(fp(C.generate('clover', 7)), 3445885415);
  assert.equal(fp(C.generate('apple', 7)), 4092483904);
  assert.equal(fp(C.generate('wildflowers', 7)), 604351643);
});

test('Scouts: clueOf names the range, they never flood, and a sweep on one is refused', () => {
  const s = C.newGame('sunflower', 7);
  const nb = C.nbrsOf(s.cols, s.rows), range = C.ring2Of(s.cols, s.rows);
  const scouts = s.scout.flatMap((v, i) => (v ? [i] : []));
  assert.equal(scouts.length, C.hiveById('sunflower').scouts);
  for (const i of scouts) {
    assert.ok(C.isScout(s, i));
    assert.equal(C.rangeOf(s, i), range[i]);
    assert.equal(C.clueOf(s, i).over, range[i]);
    assert.equal(C.floods(s, i), false);
  }
  const plain = s.open.findIndex((o, i) => o && !C.isScout(s, i));
  assert.equal(C.rangeOf(s, plain), nb[plain]);
  assert.equal(C.clueOf(s, plain).over, undefined);
  // a zero Scout still doesn't flood
  assert.equal(C.floods({ ...s, shown: s.shown.map(() => 0), shownH: s.shownH.map(() => 0) }, scouts[0]), false);

  // uncap a Scout: it opens alone
  const i = scouts.find((c) => !s.open[c]);
  assert.ok(C.reveal(s, i));
  assert.deepEqual(s.events.at(-1), { type: 'uncap', cell: i, cells: [i] });
  // mark every guard in its range truthfully: still no sweep, nothing moves
  for (const j of range[i]) if (s.cells[j] === C.G) C.setMark(s, j, C.MARK_G);
  const before = JSON.stringify(s);
  assert.equal(C.sweep(s, i), false, 'a Scout is never swept');
  assert.equal(C.tap(s, i), false);
  assert.equal(JSON.stringify(s), before);
});

test('saves from before #12 carry no scout array: no cell is a Scout, and play goes on', () => {
  const s = C.newGame('clover', 9);
  delete s.scout;
  const back = JSON.parse(JSON.stringify({ ...s, events: [] }));
  assert.equal(C.isScout(back, back.start), false);
  assert.deepEqual(C.clueOf(back, back.start), { guards: 0, queens: 0 });
  assert.ok(C.floods(back, back.start));
  assert.ok(C.provenNow(back).safe.size > 0);
  const i = back.open.findIndex((o, k) => !o && back.cells[k] === C.EMPTY);
  assert.ok(C.reveal(back, i));
});

test('Sunflower Field generation budget: 1,000 seeds, median tries ≤ 10, max well under MAX_TRIES', () => {
  const tries = [], ms = [];
  for (let seed = 1; seed <= 1000; seed++) {
    const t0 = performance.now();
    tries.push(C.generate('sunflower', seed).tries);
    ms.push(performance.now() - t0);
  }
  tries.sort((a, b) => a - b);
  ms.sort((a, b) => a - b);
  const median = tries[500], max = tries.at(-1);
  console.log(`# sunflower tries: median ${median}, p90 ${tries[900]}, max ${max}; ms: median ${ms[500].toFixed(2)}, p99 ${ms[990].toFixed(1)}, max ${ms.at(-1).toFixed(1)}`);
  assert.ok(median <= 10, `median tries ${median}`);
  assert.ok(max <= C.MAX_TRIES / 20, `max tries ${max} of ${C.MAX_TRIES}`);
});

test('Scouts matter: most Sunflower frames can\'t be finished with their Scouts read as blank comb', () => {
  let need = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const f = C.generate('sunflower', seed);
    assert.ok(C.solvable(f));
    if (!C.solvable({ ...f, broken: f.broken.map((b, i) => b || f.scout[i]) })) need++;
  }
  assert.ok(need >= 50, `only ${need} of 100 frames needed a Scout`);
});

test('the daily rotation: unchanged through the day before Sunflower Field joins, all four after', () => {
  const old = ['clover', 'apple', 'wildflowers'];
  const day = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86400000);
  const from = C.hiveById('sunflower').dailyFrom;
  assert.match(from, /^\d{4}-\d{2}-\d{2}$/);
  // after this issue's release (2026-09-30): today's daily never switches
  // hive under a player, and every past daily log entry keeps its hive
  assert.ok(from > '2026-09-30', 'Sunflower Field joins the daily only after the release');
  const dates = [];
  for (let t = Date.UTC(2025, 0, 1); ; t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (d >= from) break;
    dates.push(d);
  }
  assert.ok(dates.length > 600);
  for (const d of dates) assert.equal(C.dailyHive(d), old[day(d) % 3], d);
  // from its first day: Sunflower Field leads, then all four take turns
  const after = [];
  for (let k = 0; k < 40; k++) after.push(C.dailyHive(new Date(Date.parse(`${from}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10)));
  assert.equal(after[0], 'sunflower');
  for (let k = 0; k + 4 <= after.length; k += 4) {
    assert.deepEqual([...after.slice(k, k + 4)].sort(), ['apple', 'clover', 'sunflower', 'wildflowers']);
  }
  assert.deepEqual(after.slice(0, 4), ['sunflower', 'clover', 'apple', 'wildflowers']);
  // never the hidden Queen's Frame
  assert.ok(!after.includes('queen'));
});
