/* Clean reads and the Pure seal (#03): a move is clean only if what it
 * uncapped was proven safe before the tap. reads.js is pure, so this drives
 * it with real core states, playing the moves the way main.js's act() does. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../core.js';
import * as Reads from '../reads.js';

/* act() in main.js, minus the DOM: read the move and the proof before the
 * tap, apply it, and tally it unless it stung. */
function play(s, reads, i) {
  const move = Reads.moveAt(s, i);
  const proven = move ? C.provenNow(s) : null;
  if (!C.tap(s, i)) return { reads, move: null };
  if (move && s.phase !== 'lost') return { reads: Reads.tally(reads, Reads.classify(move, proven)), move, proven };
  return { reads, move, proven };
}

/* The PlayProposed state from the design canvas (see tests/solver.test.js). */
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

test('tapping a proven-safe cell counts as clean and keeps the frame Pure', () => {
  const s = playProposed();
  assert.ok(C.provenNow(s).safe.has(94));
  const { reads, move } = play(s, Reads.fresh(), 94);
  assert.deepEqual(move, { type: 'reveal', cell: 94, targets: [94] });
  assert.deepEqual(reads, { clean: 1, lucky: 0, hints: 0, puffs: 0 });
  assert.ok(Reads.isPure(reads));
  assert.equal(Reads.railLine(reads), '1 clean · pure');
});

test('tapping an unproven safe cell counts as lucky and clears Pure', () => {
  const s = playProposed();
  const p = C.provenNow(s);
  const lucky = s.cells.findIndex((c, i) => c === C.EMPTY && !s.open[i] && !s.mark[i] && !p.safe.has(i));
  assert.ok(lucky >= 0);
  const { reads } = play(s, Reads.fresh(), lucky);
  assert.equal(s.phase, 'play');
  assert.deepEqual(reads, { clean: 0, lucky: 1, hints: 0, puffs: 0 });
  assert.ok(!Reads.isPure(reads));
  assert.equal(Reads.railLine(reads), '0 clean · assisted');
});

/* A sweep in a real frame: an uncapped number with all its hazards marked
 * (truthfully) and at least two capped safe neighbours, `unproven` of which
 * the clues on screen don't prove. */
function sweepable(hive, seed, unproven) {
  const s = C.newGame(hive, seed);
  const nb = C.nbrsOf(s.cols, s.rows);
  for (let c = 0; c < s.cells.length; c++) {
    if (!s.open[c] || s.broken[c] || s.shown[c] + s.shownH[c] === 0) continue;
    const hidden = nb[c].filter((j) => !s.open[j]);
    const safe = hidden.filter((j) => s.cells[j] === C.EMPTY);
    if (safe.length < 2) continue;
    const t = structuredClone(s);
    for (const j of hidden) if (t.cells[j] !== C.EMPTY) t.mark[j] = t.cells[j] === C.Q ? C.MARK_Q : C.MARK_G;
    const p = C.provenNow(t);
    if (safe.filter((j) => !p.safe.has(j)).length === unproven) return { s: t, c, safe };
  }
  return null;
}

test('a sweep with one unproven target counts as lucky; a fully proven one is clean', () => {
  let lucky = null, clean = null;
  for (let seed = 1; seed < 400 && !(lucky && clean); seed++) {
    lucky ||= sweepable('clover', seed, 1);
    clean ||= sweepable('clover', seed, 0);
  }
  assert.ok(lucky && clean, 'found both kinds of sweep');

  let r = play(lucky.s, Reads.fresh(), lucky.c);
  assert.equal(r.move.type, 'sweep');
  assert.deepEqual([...r.move.targets].sort(), [...lucky.safe].sort());
  assert.notEqual(lucky.s.phase, 'lost', 'the marks were true, so the sweep is safe');
  assert.deepEqual(r.reads, { clean: 0, lucky: 1, hints: 0, puffs: 0 });
  assert.ok(!Reads.isPure(r.reads));

  r = play(clean.s, Reads.fresh(), clean.c);
  assert.equal(r.move.type, 'sweep');
  assert.deepEqual(r.reads, { clean: 1, lucky: 0, hints: 0, puffs: 0 });
});

test('marks and dead taps are not moves', () => {
  const s = playProposed();
  assert.equal(Reads.moveAt(s, 49), null, 'a marked cell is protected');
  assert.equal(Reads.moveAt(s, 75), null, 'an uncapped 0 has nothing to sweep');
  const { reads, move } = play(s, Reads.fresh(), 49);
  assert.equal(move, null);
  assert.deepEqual(reads, Reads.fresh());
});

test('a stinging tap is not counted; it ends the run instead', () => {
  const s = playProposed();
  s.mark[49] = C.NONE;
  const { reads } = play(s, Reads.fresh(), 49);
  assert.equal(s.phase, 'lost');
  assert.deepEqual(reads, Reads.fresh());
});

test('a solver-driven clear is Pure; one lucky uncap on the way is not', () => {
  for (const h of C.HIVES) {
    const s = C.newGame(h.id, 11);
    let reads = Reads.fresh();
    while (s.phase === 'play') {
      const [i] = C.provenNow(s).safe;
      assert.ok(i !== undefined, `${h.id}: the promise — something is always provable`);
      ({ reads } = play(s, reads, i));
    }
    assert.equal(s.phase, 'won');
    assert.ok(Reads.isPure(reads), h.id);
    assert.equal(reads.lucky, 0);
    assert.ok(reads.clean > 0);
  }
  const s = C.newGame('clover', 11);
  const p = C.provenNow(s);
  const guess = s.cells.findIndex((c, i) => c === C.EMPTY && !s.open[i] && !p.safe.has(i));
  let { reads } = play(s, Reads.fresh(), guess);
  while (s.phase === 'play') ({ reads } = play(s, reads, [...C.provenNow(s).safe][0]));
  assert.equal(s.phase, 'won');
  assert.equal(reads.lucky, 1);
  assert.ok(!Reads.isPure(reads));
});

test('resuming keeps the counters; a save from before clean reads cannot be Pure', () => {
  const s = C.newGame('apple', 3);
  const saved = JSON.parse(JSON.stringify({ s, reads: { clean: 7, lucky: 0, hints: 0, puffs: 0 } }));
  assert.deepEqual(Reads.restore(saved.reads, saved.s), { clean: 7, lucky: 0, hints: 0, puffs: 0 });
  assert.ok(Reads.isPure(Reads.restore(saved.reads, saved.s)));
  // an old save with moves already played: its history is unknown, so not Pure
  const old = { ...s, moves: 5 };
  const r = Reads.restore(undefined, old);
  assert.equal(r.untracked, true);
  assert.ok(!Reads.isPure(r));
  assert.equal(Reads.railLine(r), '0 clean · assisted');
  // and it stays that way across the next save and resume
  assert.ok(!Reads.isPure(Reads.restore(JSON.parse(JSON.stringify(Reads.tally(r, 'clean'))), old)));
  // an old save with no move yet has nothing to account for
  assert.deepEqual(Reads.restore(undefined, { ...s, moves: 0 }), Reads.fresh());
  // junk in the counters reads as zero rather than breaking the rail
  assert.deepEqual(Reads.restore({ clean: 'x', lucky: -2 }, s), Reads.fresh());
});
