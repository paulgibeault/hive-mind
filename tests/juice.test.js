import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../core.js';
import * as J from '../juice.js';

test('rings: a flood ripples out by BFS distance from the tapped cell', () => {
  // a 5 × 5 frame, a flood of the whole thing from the centre cell (12)
  const nbrs = C.nbrsOf(5, 5);
  const all = [...Array(25).keys()];
  const { ring, count } = J.rings(12, all, nbrs);
  assert.equal(ring.get(12), 0);
  for (const j of nbrs[12]) assert.equal(ring.get(j), 1);
  // every cell is one ring further than its nearest neighbour nearer in
  for (const c of all) {
    if (c === 12) continue;
    assert.equal(ring.get(c), Math.min(...nbrs[c].map((j) => ring.get(j))) + 1, `cell ${c}`);
  }
  assert.equal(count, Math.max(...ring.values()) + 1);
});

test('rings: distance walks only through the uncap event, never around it', () => {
  // a corridor along row 0 of a 6 × 3 frame: the walk can't shortcut through
  // row 1, which this uncap didn't open
  const nbrs = C.nbrsOf(6, 3);
  const { ring, count } = J.rings(0, [0, 1, 2, 3, 4, 5], nbrs);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((c) => ring.get(c)), [0, 1, 2, 3, 4, 5]);
  assert.equal(count, 6);
  assert.equal(ring.has(6), false, 'no cell outside the event gets a ring');
  // a single uncap is one ring
  assert.deepEqual(J.rings(7, [7], nbrs).count, 1);
});

test('rings: a real flood covers exactly its event, ring 0 only at the tap', () => {
  const s = C.newGame('clover', 7);
  s.events = [];
  const nbrs = C.nbrsOf(s.cols, s.rows);
  const zero = s.cells.findIndex((c, i) => c === C.EMPTY && !s.open[i] && C.floods(s, i));
  assert.ok(zero >= 0);
  C.tap(s, zero);
  const e = s.events.find((x) => x.type === 'uncap');
  const { ring } = J.rings(e.cell, e.cells, nbrs);
  assert.deepEqual([...ring.keys()].sort((a, b) => a - b), [...e.cells].sort((a, b) => a - b));
  assert.deepEqual([...ring].filter(([, d]) => d === 0).map(([c]) => c), [zero]);
});

test('clockwise: a cell\'s six neighbours, upper right first, round the clock', () => {
  const cols = 5, nbrs = C.nbrsOf(cols, 5);
  // cell 12 = (2, 2), an even row: NW 6, NE 7, W 11, E 13, SW 16, SE 17
  assert.deepEqual(J.clockwise(12, nbrs, cols), [7, 13, 17, 16, 11, 6]);
  // an odd row shifts right: cell 7 = (2, 1): NW 2, NE 3, W 6, E 8, SW 12, SE 13
  assert.deepEqual(J.clockwise(7, nbrs, cols), [3, 8, 13, 12, 6, 2]);
  // an edge cell keeps the order with fewer neighbours
  assert.deepEqual(J.clockwise(0, nbrs, cols), [1, 5]);
});

/* A hand-built 3 × 3 state: only the fields juice.js may read. */
function tiny({ open, mark, shown, broken = [] }) {
  const n = 9;
  const fill = (v, at) => Array.from({ length: n }, (_, i) => (at.includes(i) ? v : 0));
  return {
    open: fill(1, open), mark: mark || new Array(n).fill(0),
    shown: shown || new Array(n).fill(1), shownH: new Array(n).fill(0), broken: fill(1, broken),
  };
}

test('finished: a number with no unmarked capped neighbour, from open cells and marks alone', () => {
  const nbrs = C.nbrsOf(3, 3);   // cell 4's neighbours: 1, 2, 3, 5, 7, 8
  const s = tiny({ open: [4, 1, 2, 3, 5, 7] });
  assert.equal(J.finished(s, nbrs, 4), false, '8 is still capped and unmarked');
  s.mark[8] = C.MARK_G;
  assert.equal(J.finished(s, nbrs, 4), true, 'a mark finishes it');
  s.mark[8] = C.MARK_Q;
  assert.equal(J.finished(s, nbrs, 4), true, 'either kind of mark');
  s.mark[8] = 0; s.open[8] = 1;
  assert.equal(J.finished(s, nbrs, 4), true, 'all open');
});

test('finished: no tells — what a capped cell hides never changes the answer', () => {
  const nbrs = C.nbrsOf(3, 3);
  const s = tiny({ open: [4, 1, 2, 3, 5, 7] });
  // juice.js gets no `cells` at all; give it a poisoned one to prove it
  Object.defineProperty(s, 'cells', { get() { throw new Error('read the hidden contents'); } });
  assert.doesNotThrow(() => J.finished(s, nbrs, 4));
  assert.doesNotThrow(() => J.refused(s, nbrs, 4));
});

test('refused: only a number with unmarked capped neighbours refuses a sweep', () => {
  const nbrs = C.nbrsOf(3, 3);
  const s = tiny({ open: [4, 1, 2, 3, 5, 7] });
  assert.equal(J.refused(s, nbrs, 4), true);
  s.mark[8] = C.MARK_G;
  assert.equal(J.refused(s, nbrs, 4), false, 'finished: idle, not refused');
  s.mark[8] = 0;
  s.shown[4] = 0;
  assert.equal(J.refused(s, nbrs, 4), false, 'a zero');
  s.shown[4] = 1; s.broken[4] = 1;
  assert.equal(J.refused(s, nbrs, 4), false, 'broken comb');
  s.broken[4] = 0; s.open[4] = 0;
  assert.equal(J.refused(s, nbrs, 4), false, 'a capped cell is a reveal, not a sweep');
});

test('refused agrees with core: an idle tap (not refused) is never a sweep that could have fired', () => {
  // main.js asks refused() only after core's sweep said no. Whatever it
  // calls idle — a zero, broken comb, a finished number — core never sweeps.
  for (const hive of ['clover', 'apple', 'wildflowers']) {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = C.newGame(hive, seed);
      const nbrs = C.nbrsOf(s.cols, s.rows);
      // marks about, right and wrong, so some numbers finish and some can't sweep
      s.mark.forEach((_, i) => { if (!s.open[i] && i % 3 === 0) s.mark[i] = s.queens ? (i % 2) + 1 : 1; });
      // and some marked exactly right, so their sweeps fire
      s.cells.forEach((c, i) => { if (!s.open[i] && c !== C.EMPTY && i % 3 === 1) s.mark[i] = c; });
      let refusals = 0;
      for (let i = 0; i < s.cells.length; i++) {
        if (!s.open[i]) continue;
        const fired = C.sweep(structuredClone(s), i);
        if (!J.refused(s, nbrs, i)) assert.equal(fired, false, `${hive} ${seed} cell ${i}: idle, yet it swept`);
        else if (!fired) refusals++;
      }
      assert.ok(refusals > 0, `${hive} ${seed}: some sweeps are refused`);
    }
  }
});

test('pinScale: lands at 125%, dips once below 100%, settles at 100%', () => {
  assert.equal(J.pinScale(0), 1.25);
  assert.ok(Math.abs(J.pinScale(1) - 1) < 1e-9);
  const xs = Array.from({ length: 101 }, (_, k) => J.pinScale(k / 100));
  const low = Math.min(...xs);
  assert.ok(low < 1 && low > 0.9, 'one shallow bounce');
  // down, then up: one turn only
  let turns = 0;
  for (let k = 2; k < xs.length; k++) if (Math.sign(xs[k] - xs[k - 1]) !== Math.sign(xs[k - 1] - xs[k - 2])) turns++;
  assert.equal(turns, 1);
});

test('shake: still at both ends, within its amplitude, swinging the asked number of times', () => {
  assert.equal(J.shake(0, 6, 2), 0);
  assert.equal(J.shake(1, 6, 2), 0);
  const xs = Array.from({ length: 401 }, (_, k) => J.shake(k / 400, 6, 2));
  assert.ok(Math.max(...xs.map(Math.abs)) <= 6);
  assert.ok(Math.max(...xs) > 4 && Math.min(...xs) < -4);
  let crossings = 0;
  for (let k = 2; k < xs.length - 1; k++) if (xs[k - 1] > 0 && xs[k] <= 0) crossings++;
  assert.equal(crossings, 2, 'twice');
});

test('easing stays in range', () => {
  for (const f of [J.easeIn, J.easeOut]) {
    assert.equal(f(0), 0); assert.equal(f(1), 1);
  }
  assert.equal(J.clamp01(-1), 0); assert.equal(J.clamp01(2), 1);
});

// ── Scouts (#12) ────────────────────────────────────────────────────────────

test('Scouts: a Scout shows its number (0 too), dims only when its whole range is settled, and is never "refused"', () => {
  const s = C.newGame('sunflower', 7);
  const nbrs = C.nbrsOf(s.cols, s.rows), range = C.ring2Of(s.cols, s.rows);
  const sc = s.scout.findIndex((v, i) => v && !s.open[i]);
  C.reveal(s, sc);
  assert.ok(J.showsNumber(s, sc));
  assert.ok(J.showsNumber({ ...s, shown: s.shown.map(() => 0) }, sc), 'a Scout 0 still shows');
  // settle every neighbour: a plain number would be finished, a Scout isn't
  for (const j of nbrs[sc]) if (!s.open[j]) s.mark[j] = C.MARK_G;
  const outer = range[sc].filter((j) => !nbrs[sc].includes(j) && !s.open[j]);
  assert.ok(outer.length > 0);
  assert.equal(J.finished(s, nbrs, sc), false, 'its outer ring is still capped');
  assert.equal(J.refused(s, nbrs, sc), false, 'a Scout is never swept, so its tap is idle, not refused');
  for (const j of outer) s.mark[j] = C.MARK_G;
  assert.equal(J.finished(s, nbrs, sc), true, 'its whole range settled: it dims');
  // no tells: what the range hides never changes the answer
  const x = structuredClone(s);
  for (const j of range[sc]) if (!x.open[j]) x.cells[j] = x.cells[j] ? C.EMPTY : C.G;
  assert.equal(J.finished(x, nbrs, sc), true);
});
