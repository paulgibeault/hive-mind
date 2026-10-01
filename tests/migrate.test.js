/* Stored data from v1 (meadow / orchard / wild, wasps and cracks) must come
 * across whole: the run, the records, the stats. migrate.js is pure, so the
 * stores here are plain objects shaped as the Arcade SDK returns them. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../core.js';
import { migrate, migrateState, recordKeys } from '../migrate.js';

/* A v1 game state, shaped as core.js v0.0.2 saved it, rebuilt from a v2 one. */
function v1State(hive, oldId, seed) {
  const s = C.newGame(hive, seed);
  const { guards, queens, broken, ...rest } = s;
  return { ...rest, v: 1, hive: oldId, wasps: guards, hornets: queens, cracked: broken, events: [] };
}
const rec = (value, label, ts = 1) => ({ value, direction: 'lower', ts, label, format: 'duration-ms' });

/* Apply a migration to a plain-object store, as main.js does to the SDK. */
function apply(store, m) {
  if (m.run !== undefined) store.run = m.run;
  for (const [k, r] of Object.entries(m.records)) store.records[k] = r;
  for (const k of m.dropRecords) delete store.records[k];
  if (m.frames) store.frames = m.frames;
  if (m.daily) store.daily = m.daily;
  return store;
}
const read = (store) => ({
  run: store.run,
  records: Object.fromEntries(recordKeys().map((k) => [k, store.records[k] || null])),
  frames: store.frames,
  daily: store.daily,
});

test('a v1 orchard save with time-orchard loads as apple, best time intact', () => {
  const s1 = v1State('apple', 'orchard', 77);
  const i = s1.open.findIndex((o, k) => !o && s1.cells[k] === C.EMPTY);
  s1.mark[s1.cells.indexOf(C.Q)] = C.MARK_Q;
  const store = {
    run: { s: JSON.parse(JSON.stringify(s1)), ms: 41234, daily: null },
    records: { 'time-orchard': rec(52100, 'Orchard — fastest frame', 111) },
    frames: { orchard: { played: 9, won: 4 } },
    daily: { '2026-09-27': { ms: 60000, hive: 'orchard' } },
  };
  apply(store, migrate(read(store)));

  const s = store.run.s;
  assert.equal(s.v, C.SAVE_V);
  assert.equal(s.hive, 'apple');
  assert.equal(C.hiveById(s.hive).name, 'Apple Orchard');
  assert.equal(s.guards, 18);
  assert.equal(s.queens, 13);
  assert.ok(!('wasps' in s) && !('hornets' in s) && !('cracked' in s), 'no v1 field names left');
  assert.deepEqual(s.broken, s.cells.map(() => 0));
  assert.equal(store.run.ms, 41234);
  assert.deepEqual(s.open, s1.open);
  assert.deepEqual(s.mark, s1.mark);

  assert.equal(store.records['time-orchard'], undefined);
  assert.equal(store.records['time-apple'].value, 52100);
  assert.equal(store.records['time-apple'].ts, 111);
  assert.equal(store.records['time-apple'].label, 'Apple Orchard — fastest frame');
  assert.deepEqual(store.frames, { apple: { played: 9, won: 4 } });
  assert.deepEqual(store.daily, { '2026-09-27': { ms: 60000, hive: 'apple' } });

  // and it plays on as a v2 game
  assert.ok(C.reveal(s, i));
  assert.equal(s.open[i], 1);
  assert.equal(C.mark(s, s.open.findIndex((o) => !o)), true);
});

test('migration is idempotent: a second pass changes nothing', () => {
  const store = {
    run: { s: v1State('clover', 'meadow', 5), ms: 10, daily: '2026-09-26' },
    records: { 'time-meadow': rec(30000, 'Meadow — fastest frame'), 'time-wild': rec(90000, 'Wild — fastest frame') },
    frames: { meadow: { played: 2, won: 1 }, wild: { played: 1, won: 0 } },
    daily: { '2026-09-26': { ms: 1, hive: 'meadow' }, '2026-09-28': { ms: 2, hive: 'wildflowers' } },
  };
  apply(store, migrate(read(store)));
  const once = JSON.parse(JSON.stringify(store));
  const again = migrate(read(store));
  assert.deepEqual(again, { run: undefined, records: {}, dropRecords: [], frames: null, daily: null });
  apply(store, again);
  assert.deepEqual(store, once);
  assert.equal(store.run.s.hive, 'clover');
  assert.equal(store.records['time-wildflowers'].value, 90000);
});

test('where an old and a new entry both exist, the better one is kept', () => {
  const store = {
    run: null,
    records: {
      'time-meadow': rec(20000, 'Meadow — fastest frame'),          // better than the new one
      'time-clover': rec(25000, 'Clover Field — fastest frame'),
      'time-orchard': rec(70000, 'Orchard — fastest frame'),        // worse than the new one
      'time-apple': rec(50000, 'Apple Orchard — fastest frame', 7),
    },
    frames: { meadow: { played: 10, won: 3 }, clover: { played: 4, won: 4 }, apple: { played: 1, won: 1 } },
    daily: {},
  };
  const m = migrate(read(store));
  assert.equal(m.run, undefined, 'no run, nothing to write');
  assert.equal(m.daily, null);
  apply(store, m);
  assert.equal(store.records['time-clover'].value, 20000);
  assert.equal(store.records['time-clover'].label, 'Clover Field — fastest frame');
  assert.equal(store.records['time-apple'].value, 50000);
  assert.equal(store.records['time-apple'].ts, 7, 'the kept record is untouched');
  assert.ok(!('time-apple' in m.records), 'and not rewritten');
  assert.deepEqual(Object.keys(store.records).sort(), ['time-apple', 'time-clover']);
  assert.deepEqual(store.frames, { clover: { played: 10, won: 4 }, apple: { played: 1, won: 1 } });
});

test('v2 data and empty stores are left alone', () => {
  const s = C.newGame('wildflowers', 3);
  assert.equal(migrateState(s), s);
  assert.deepEqual(migrate({ run: { s, ms: 0 }, records: {}, frames: {}, daily: {} }),
    { run: undefined, records: {}, dropRecords: [], frames: null, daily: null });
  assert.deepEqual(migrate({}), { run: undefined, records: {}, dropRecords: [], frames: null, daily: null });
  assert.deepEqual(migrate({ run: null, records: {}, frames: null, daily: null }),
    { run: undefined, records: {}, dropRecords: [], frames: null, daily: null });
});

test('a v1 wild run comes across as broken comb only while it stays fair', () => {
  // v1 cracks lied by one; broken comb shows nothing. A run is kept only if
  // its frame can still be finished by logic under the new reading.
  for (let seed = 1; seed <= 20; seed++) {
    const s1 = v1State('wildflowers', 'wild', seed);
    s1.shown = s1.shown.map((v, i) => (s1.cracked[i] ? v + 1 : v));   // lying, as a v1 crack did
    const s = migrateState(JSON.parse(JSON.stringify(s1)));
    assert.ok(s, `wild/${seed}: a frame fair under broken comb comes across`);
    assert.equal(s.hive, 'wildflowers');
    assert.deepEqual(s.broken, s1.cracked);
    const nb = C.nbrsOf(s.cols, s.rows);
    s.broken.forEach((b, i) => { if (b) assert.equal(s.shown[i], nb[i].filter((j) => s.cells[j] === C.G).length, 'the truth'); });
    assert.ok(C.solvable(s));
  }
  // v1 put 20 cracks down: with that many blanks a frame is rarely still fair,
  // and one that isn't is let go rather than resumed into a guess
  let dropped = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const s1 = v1State('wildflowers', 'wild', seed);
    const nb = C.nbrsOf(s1.cols, s1.rows);
    const clear = new Set([s1.start, ...nb[s1.start]]);
    let k = 0;
    s1.cracked = s1.cells.map((c, i) => (c === C.EMPTY && !clear.has(i) && k++ % 3 === 0 ? 1 : 0));
    const m = migrate({ run: { s: s1, ms: 5 } });
    if (m.run === null) dropped++;
    else assert.ok(C.solvable(m.run.s));
  }
  assert.ok(dropped > 0, 'unfair frames are dropped');
  assert.equal(migrate({ run: { s: { v: 1, hive: 'somewhere-else', cells: [] } } }).run, null, 'an unknown hive is let go');
});

test('clean reads (#03): run counters, Pure counts and daily pure flags pass through untouched', () => {
  const s = C.newGame('clover', 5);
  const m = migrate({
    run: { s, ms: 9, reads: { clean: 4, lucky: 1, hints: 0, puffs: 0 } },
    records: { 'time-clover': rec(30000, 'Clover Field — fastest frame') },
    frames: { clover: { played: 6, won: 3, pure: 2 } },
    daily: { '2026-09-30': { ms: 61000, hive: 'clover', pure: true } },
  });
  assert.deepEqual(m, { run: undefined, records: {}, dropRecords: [], frames: null, daily: null });
  // an old id merging into a new one keeps the new entry's Pure count
  const store = { run: null, records: {}, frames: { meadow: { played: 2, won: 1 }, clover: { played: 5, won: 4, pure: 3 } }, daily: {} };
  apply(store, migrate(read(store)));
  assert.deepEqual(store.frames, { clover: { played: 5, won: 4, pure: 3 } });
});

/* A v2 game state, as #01–#07 saved it: no puffs. */
function v2State(hive, seed) {
  const { puffs, ...rest } = C.newGame(hive, seed);
  return { ...rest, v: 2, events: [] };
}

test('the smoker (#08): a v2 run moves to v3 with one puff, and plays on', () => {
  assert.equal(C.SAVE_V, 3);
  const s2 = v2State('wildflowers', 9);
  const i = s2.open.findIndex((o, k) => !o && s2.cells[k] === C.EMPTY);
  s2.mark[s2.cells.indexOf(C.G)] = C.MARK_G;
  const run = { s: JSON.parse(JSON.stringify(s2)), ms: 31000, daily: '2026-09-29', reads: { clean: 3, lucky: 0, hints: 0, puffs: 0 } };
  const m = migrate({ run });
  assert.deepEqual(m.run, { ...run, s: { ...s2, v: 3, puffs: 1 } }, 'everything else unchanged');
  const s = m.run.s;
  assert.equal(s.v, C.SAVE_V);
  assert.ok(C.reveal(s, i));
  // and it can be stung, calmed, and go on
  const g = s.cells.findIndex((c, k) => c === C.G && !s.mark[k]);
  assert.ok(C.reveal(s, g));
  assert.ok(C.calm(s));
  assert.equal(s.phase, 'play');
  // a second pass finds nothing to do
  assert.equal(migrate({ run: m.run }).run, undefined);
});

test('the smoker (#08): a v1 run takes both steps, v1 → v2 → v3', () => {
  const s = migrateState(JSON.parse(JSON.stringify(v1State('clover', 'meadow', 12))));
  assert.equal(s.v, C.SAVE_V);
  assert.equal(s.hive, 'clover');
  assert.equal(s.puffs, 1);
  assert.ok(!('wasps' in s));
});

test('the smoker (#08): a v2 save only ever held a run in play; anything else is let go', () => {
  // before v3 a sting (or a clear) dropped the run, so a stung or won v2 run
  // was never written by the game
  for (const phase of ['lost', 'won']) {
    const s2 = { ...v2State('clover', 3), phase, stung: phase === 'lost' ? 10 : -1 };
    assert.equal(migrateState(s2), null, phase);
    assert.equal(migrate({ run: { s: s2, ms: 1 } }).run, null);
  }
  // a v3 stung run is the game's own, kept for the smoker: left alone
  const s3 = C.newGame('clover', 3);
  C.reveal(s3, s3.cells.indexOf(C.G));
  assert.equal(migrateState(s3), s3);
  assert.equal(migrate({ run: { s: s3, ms: 1 } }).run, undefined);
});
