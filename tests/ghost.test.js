/* ghost.js (#11): recording a run's pace, replaying it, the finish line, the
 * compact form a jar keeps, and that the progress it reads is public.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../ghost.js';
import * as Core from '../core.js';

const even = (t) => Array.from({ length: 20 }, (_, k) => Math.round(((k + 1) * t) / 20));

test('checkpoints: integer 5% steps past the opening', () => {
  assert.equal(G.reached(0, 100), 0);
  assert.equal(G.reached(4, 100), 0);
  assert.equal(G.reached(5, 100), 1);
  assert.equal(G.reached(99, 100), 19);
  assert.equal(G.reached(100, 100), 20);
  assert.equal(G.reached(1, 3), 6, 'one of three cells is 33%: six checkpoints');
  assert.equal(G.reached(0, 0), 20, 'an opening that finished the frame is all of it');
  assert.equal(G.fraction(3, 12), 0.25);
  assert.equal(G.fraction(0, 0), 1);
});

test('record stamps each checkpoint once, a flood stamps several, and finish closes it', () => {
  let tl = [];
  tl = G.record(tl, 3, 100, 1500);
  assert.deepEqual(tl, []);
  const same = G.record(tl, 4, 100, 1600);
  assert.equal(same, tl, 'nothing reached: the same array');
  tl = G.record(tl, 5, 100, 2000.4);
  assert.deepEqual(tl, [2000]);
  tl = G.record(tl, 17, 100, 5000);                 // a flood: 10% and 15% at once
  assert.deepEqual(tl, [2000, 5000, 5000]);
  assert.deepEqual(G.record(tl, 17, 100, 9000), tl, 'a checkpoint keeps its first time');
  // never earlier than the last checkpoint
  assert.deepEqual(G.record([3000], 10, 100, 2500), [3000, 3000]);
  // the win closes it: the rest at the finish, the last exactly the recorded time
  const done = G.finish(tl, 60000.2);
  assert.equal(done.length, 20);
  assert.equal(done[19], 60000);
  assert.deepEqual(done.slice(0, 4), [2000, 5000, 5000, 60000]);
  assert.ok(G.complete(done));
  // nothing sits after the finish (a clamp, should a stamp ever outrun it)
  assert.deepEqual(G.finish([100, 900], 500).slice(0, 2), [100, 500]);
  assert.equal(G.finish(null, 700).every((v) => v === 700), true);
});

test('restore keeps a sound timeline and drops anything else', () => {
  assert.deepEqual(G.restore([1, 2, 2, 9]), [1, 2, 2, 9]);
  assert.deepEqual(G.restore([]), []);
  for (const junk of [null, undefined, 'x', [2, 1], [1.5], [-1], new Array(21).fill(1), [1, 'a']]) {
    assert.equal(G.restore(junk), null, JSON.stringify(junk));
  }
});

test('the ghost moves in straight lines between its checkpoints', () => {
  const tl = even(20000);                           // 1 s per 5%
  assert.equal(G.ghostAt(tl, 0), 0);
  assert.equal(G.ghostAt(tl, -5), 0);
  assert.equal(G.ghostAt(tl, 500), 0.025);
  assert.equal(G.ghostAt(tl, 1000), 0.05);
  assert.ok(Math.abs(G.ghostAt(tl, 10250) - 0.5125) < 1e-9);
  assert.equal(G.ghostAt(tl, 20000), 1);
  assert.equal(G.ghostAt(tl, 99999), 1);
  // a flood: three checkpoints at 4 s, so the ghost jumps from 5% to 20% there
  const jump = [2000, 4000, 4000, 4000, ...even(20000).slice(4)];
  assert.equal(G.ghostAt(jump, 3999), 0.05 + (1999 / 2000) * 0.05);
  assert.equal(G.ghostAt(jump, 4000), 0.2);
  // monotonic, whatever the pace
  let last = 0;
  for (let ms = 0; ms <= 21000; ms += 37) {
    const g = G.ghostAt(jump, ms);
    assert.ok(g >= last && g <= 1);
    last = g;
  }
  assert.equal(G.ghostAt([1, 2], 5), 0, 'an unfinished timeline races nothing');
});

test('the finish line: beat it, lose to it, or tie', () => {
  assert.equal(G.raceLine(87600, 100000), 'Beat your ghost by 12.4 s');
  assert.equal(G.raceLine(103100, 100000), 'Ghost won by 3.1 s');
  assert.equal(G.raceLine(100020, 100000), 'Dead heat with your ghost');
  assert.equal(G.raceLine(30000, 95200), 'Beat your ghost by 1:05.2');
  assert.equal(G.gap(59960), '1:00.0', 'rounds into the next minute cleanly');
});

test('a jar keeps 38 characters, and they read back within a hair', () => {
  const tl = G.finish([400, 1200, 1200, 5000, 9000, 9100, 30000], 287345);
  const g = G.encode(tl);
  assert.match(g, /^[0-9a-z]{38}$/);
  const back = G.decode(g, 287345);
  assert.equal(back.length, 20);
  assert.equal(back[19], 287345);
  for (let k = 0; k < 20; k++) assert.ok(Math.abs(back[k] - tl[k]) <= 287345 / 1295 / 2 + 1, `checkpoint ${k}`);
  assert.ok(G.complete(back));
  // worst-case time: an hour, still two digits each
  assert.equal(G.encode(G.finish([], 3599999)).length, 38);
  // what isn't a finished timeline isn't stored; what isn't a stored one isn't read
  assert.equal(G.encode([1, 2, 3]), null);
  assert.equal(G.decode('zz', 100), null);
  assert.equal(G.decode(g.toUpperCase(), 100), null);
  assert.equal(G.decode(g, -1), null);
  assert.equal(G.decode(`${'10'.repeat(18)}0z`, 100), null, 'a timeline that runs backwards');
});

test('progress reads only the open cells: two frames that differ only under caps agree', () => {
  const s = Core.newGame('apple', 77);
  const opening = G.openingOf(s);
  assert.equal(opening, s.open.reduce((k, o) => k + o, 0), 'a new frame shows only its opening');
  assert.deepEqual(G.progressOf(s, opening), { done: 0, total: s.cols * s.rows - s.guards - s.queens - opening });
  // move a guard between two capped cells: nothing on screen changes, nor does progress
  const t = { ...s, cells: s.cells.slice() };
  const g = t.cells.findIndex((c, i) => c !== Core.EMPTY && !t.open[i]);
  const e = t.cells.findIndex((c, i) => c === Core.EMPTY && !t.open[i]);
  [t.cells[g], t.cells[e]] = [t.cells[e], t.cells[g]];
  assert.deepEqual(G.progressOf(t, opening), G.progressOf(s, opening));
  // a solver-played clear climbs every checkpoint, and the last cell is 100%
  let tl = [], ms = 0;
  while (s.phase === 'play') {
    const [i] = Core.provenNow(s).safe;
    Core.tap(s, i);
    const p = G.progressOf(s, opening);
    tl = G.record(tl, p.done, p.total, (ms += 1000));
  }
  assert.equal(s.phase, 'won');
  assert.equal(tl.length, 20);
  assert.equal(tl[19], ms);
  // the cell that stung is open, but it isn't progress
  const u = Core.newGame('clover', 5);
  const before = G.progressOf(u);
  Core.tap(u, u.cells.findIndex((c) => c !== Core.EMPTY));
  assert.equal(u.phase, 'lost');
  assert.deepEqual(G.progressOf(u), before);
});
