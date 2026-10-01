/* pantry.js (#09): jars in, jars out, the 200-jar shelf, replays, storage
 * size, and the comb calendar's month.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../pantry.js';
import { migrate } from '../migrate.js';

const run = (over = {}) => ({
  hive: 'wildflowers', seed: 0x2a, ms: 228000, pure: false, clean: 61, hints: 1, puffs: 0, date: '2026-09-21', ...over,
});

test('a win fills a jar, read back with every field the spec names', () => {
  const { pantry, jar, fresh } = P.addJar(null, run());
  assert.equal(fresh, true);
  assert.deepEqual(jar, {
    code: 'WI-0000016', hive: 'wildflowers', seed: 42, ms: 228000, pure: false,
    clean: 61, hints: 1, puffs: 0, date: '2026-09-21', n: 1,
  });
  assert.deepEqual(P.jarsOf(pantry, 'wildflowers'), [jar]);
  assert.deepEqual(P.totals(pantry), { jars: 1, pure: 0 });
  assert.deepEqual(P.countsOf(pantry, 'clover'), { jars: 0, pure: 0, older: 0 });
  // pantry numbers run across hives
  const b = P.addJar(pantry, run({ hive: 'clover', seed: 7, pure: true, hints: 0 }));
  assert.equal(b.jar.n, 2);
  assert.equal(b.jar.pure, true);
  assert.deepEqual(P.totals(b.pantry), { jars: 2, pure: 1 });
  assert.deepEqual(P.recent(b.pantry, 5).map((j) => j.code), ['WI-0000016', 'CL-0000007']);
  // the input pantry is left alone
  assert.deepEqual(P.totals(pantry), { jars: 1, pure: 0 });
});

test('a replayed code updates its jar: best time, Pure once earned', () => {
  let p = P.addJar(null, run({ ms: 228000 })).pantry;
  p = P.addJar(p, run({ hive: 'apple', seed: 3 })).pantry;
  // slower and assisted: nothing changes
  let r = P.addJar(p, run({ ms: 300000, clean: 10, date: '2026-09-25' }));
  assert.equal(r.fresh, false);
  assert.deepEqual([r.jar.ms, r.jar.clean, r.jar.date, r.jar.n, r.jar.pure], [228000, 61, '2026-09-21', 1, false]);
  // faster: the time and its counts
  r = P.addJar(r.pantry, run({ ms: 200000, clean: 70, hints: 0, date: '2026-09-26' }));
  assert.deepEqual([r.jar.ms, r.jar.clean, r.jar.hints, r.jar.date, r.jar.pure], [200000, 70, 0, '2026-09-21', false]);
  // Pure but slower: the seal is earned, the best time stays
  r = P.addJar(r.pantry, run({ ms: 260000, pure: true, clean: 64, hints: 0 }));
  assert.deepEqual([r.jar.ms, r.jar.pure, r.jar.clean], [200000, true, 64]);
  // and is never lost again
  r = P.addJar(r.pantry, run({ ms: 100000, pure: false, clean: 12, hints: 3 }));
  assert.deepEqual([r.jar.ms, r.jar.pure, r.jar.clean], [100000, true, 64]);
  assert.equal(P.jarsOf(r.pantry, 'wildflowers').length, 1, 'still one jar');
  assert.deepEqual(P.totals(r.pantry), { jars: 2, pure: 1 });
  assert.equal(r.pantry.made, 2);
});

test('per hive, the newest 200 jars stay whole and older ones fold into counts', () => {
  let p = null;
  for (let k = 0; k < 250; k++) p = P.addJar(p, run({ hive: 'clover', seed: 1000 + k, pure: k % 5 === 0 })).pantry;
  p = P.addJar(p, run({ hive: 'apple', seed: 1 })).pantry;
  const clover = P.jarsOf(p, 'clover');
  assert.equal(clover.length, P.KEEP);
  assert.equal(clover[0].seed, 1050, 'the oldest 50 folded away');
  assert.equal(clover.at(-1).seed, 1249);
  assert.deepEqual(P.countsOf(p, 'clover'), { jars: 250, pure: 50, older: 50 });
  assert.equal(P.jarsOf(p, 'apple').length, 1, 'other hives keep their own 200');
  assert.deepEqual(P.totals(p), { jars: 251, pure: 50 });
  // a folded-away frame cleared again fills a fresh jar
  const r = P.addJar(p, run({ hive: 'clover', seed: 1000 }));
  assert.equal(r.fresh, true);
  assert.equal(r.jar.n, 252);
  assert.deepEqual(P.countsOf(r.pantry, 'clover'), { jars: 251, pure: 50, older: 51 });
});

test('600 jars store in under 50 KB', () => {
  let p = null;
  // worst case for size: big seeds, long times, every count non-zero
  for (let k = 0; k < 600; k++) {
    p = P.addJar(p, {
      hive: ['clover', 'apple', 'wildflowers'][k % 3], seed: 0xffffffff - k, ms: 3599999 - k,
      pure: k % 2 === 0, clean: 140 + (k % 9), hints: 1 + (k % 9), puffs: 1 + (k % 3), date: '2026-12-31',
    }).pantry;
  }
  assert.equal(P.totals(p).jars, 600);
  const bytes = Buffer.byteLength(JSON.stringify(p));
  assert.ok(bytes < 50 * 1024, `600 jars take ${bytes} bytes`);
  console.log(`# 600 jars, worst case: ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB)`);
});

test('an old save has no pantry: nothing is invented from its frame counts', () => {
  // no pantry stat at all, whatever frames says
  const p = P.normalize(undefined);
  assert.deepEqual(p, P.empty());
  assert.deepEqual(P.totals(p), { jars: 0, pure: 0 });
  assert.deepEqual(P.recent(p, 16), []);
  // migrate.js knows nothing of the pantry, and doesn't create one
  const m = migrate({ frames: { meadow: { played: 9, won: 7 } }, daily: {} });
  assert.ok(!('pantry' in m));
  // junk normalizes to empty, a partial store keeps what's sound
  for (const junk of [null, 5, 'x', [], { hives: 3 }]) assert.deepEqual(P.normalize(junk), P.empty());
  const half = P.normalize({ made: 3, hives: { clover: { jars: [{ s: 1, t: 5, d: 20000, n: 3 }, { s: 'x' }] } } });
  assert.equal(P.jarsOf(half, 'clover').length, 1);
  assert.equal(P.addJar(half, run()).jar.n, 4);
});

test('migrate keeps a daily entry\'s pure flag when it renames the hive', () => {
  const m = migrate({ daily: { '2026-09-01': { ms: 90000, hive: 'orchard', pure: true }, '2026-09-02': { ms: 5, hive: 'wild' } } });
  assert.deepEqual(m.daily, { '2026-09-01': { ms: 90000, hive: 'apple', pure: true }, '2026-09-02': { ms: 5, hive: 'wildflowers' } });
});

test('dates: day numbers, short labels, weekdays', () => {
  assert.equal(P.dateOf(P.dayNumber('2026-09-21')), '2026-09-21');
  assert.equal(P.shortDate('2026-09-21'), '21 Sep');
  assert.equal(P.dayDate('2026-09-28'), 'Mon 28 Sep');
  assert.equal(P.dayDate('2026-09-30'), 'Wed 30 Sep');
  assert.equal(P.dayDate('2027-01-03'), 'Sun 3 Jan');
  assert.equal(P.shortDate('nonsense'), '');
});

test('the comb calendar: Monday first, cleared / pure / today / missed / future', () => {
  const log = {
    '2026-09-01': { ms: 1, hive: 'clover', pure: true },
    '2026-09-02': { ms: 1, hive: 'apple' },
    '2026-09-28': { ms: 1, hive: 'apple', pure: true },
    '2026-08-31': { ms: 1, hive: 'clover' },             // another month
  };
  const c = P.combMonth('2026-09-28', log);
  assert.equal(c.name, 'September');
  assert.equal(c.lead, 1, '1 September 2026 is a Tuesday: one blank Monday before it');
  assert.equal(c.days.length, 30);
  assert.deepEqual(c.days[0], { day: 1, date: '2026-09-01', state: 'cleared', cleared: true, pure: true });
  assert.equal(c.days[1].state, 'cleared');
  assert.equal(c.days[1].pure, false);
  assert.equal(c.days[2].state, 'missed');
  assert.deepEqual(c.days[27], { day: 28, date: '2026-09-28', state: 'today', cleared: true, pure: true });
  assert.equal(c.days[28].state, 'future');
  assert.deepEqual([c.cleared, c.pure], [3, 2]);
  // a month starting on a Monday has no lead; February has its own length
  assert.equal(P.combMonth('2027-02-10', {}).lead, 0);
  assert.equal(P.combMonth('2027-02-10', {}).days.length, 28);
  assert.equal(P.combMonth('2028-02-10', {}).days.length, 29);
  assert.equal(P.combMonth('2026-11-15', {}).lead, 6, '1 November 2026 is a Sunday');
  // a log entry dated in the future (a clock moved back) isn't counted as cleared
  assert.equal(P.combMonth('2026-09-01', log).cleared, 1);
  assert.equal(P.combMonth('bad', log), null);
});
