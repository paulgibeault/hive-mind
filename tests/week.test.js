/* week.js (#10): ISO weeks, the Queen's Frame's Sunday-to-Sunday frame week,
 * and its seed — with injected dates, never the real clock.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../week.js';
import * as C from '../core.js';
import { hashU32 } from '../arcade-rng.js';

/** The local date string for a Date, as Arcade.daily.dateStr() makes it. */
const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('isoWeek: ordinary weeks run Monday to Sunday', () => {
  assert.equal(W.isoWeek('2026-09-28'), '2026-W40');    // Monday
  assert.equal(W.isoWeek('2026-10-03'), '2026-W40');    // Saturday
  assert.equal(W.isoWeek('2026-10-04'), '2026-W40');    // Sunday ends it
  assert.equal(W.isoWeek('2026-10-05'), '2026-W41');
  assert.equal(W.isoWeek('2026-02-28'), '2026-W09');
  assert.equal(W.isoWeek('2028-02-29'), '2028-W09');    // a leap day
});

test('isoWeek: year boundaries, where the Thursday decides the year', () => {
  const cases = {
    '2020-12-31': '2020-W53', '2021-01-01': '2020-W53', '2021-01-03': '2020-W53', '2021-01-04': '2021-W01',
    '2024-12-29': '2024-W52', '2024-12-30': '2025-W01', '2025-01-01': '2025-W01',
    '2026-01-01': '2026-W01', '2026-12-28': '2026-W53', '2027-01-03': '2026-W53', '2027-01-04': '2027-W01',
    '2015-12-31': '2015-W53', '2016-01-03': '2015-W53', '2018-12-31': '2019-W01', '2022-01-02': '2021-W52',
  };
  for (const [date, week] of Object.entries(cases)) assert.equal(W.isoWeek(date), week, date);
  for (const junk of ['', 'nonsense', null, '2026-9-1']) assert.equal(W.isoWeek(junk), null);
});

test('isoWeek agrees with a plain-Date ISO week for every day of 2015–2035', () => {
  // an independent reference: the textbook algorithm on UTC Dates
  const ref = (y, m, d) => {
    const t = new Date(Date.UTC(y, m, d));
    const dow = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dow);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, '0')}`;
  };
  for (let t = Date.UTC(2015, 0, 1); t <= Date.UTC(2035, 11, 31); t += 86400000) {
    const d = new Date(t), date = d.toISOString().slice(0, 10);
    assert.equal(W.isoWeek(date), ref(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), date);
  }
});

test('the frame week opens on Sunday: Saturday is still last week, Sunday is the new one', () => {
  assert.equal(W.frameWeek('2026-10-03'), '2026-W40');   // Saturday
  assert.equal(W.frameWeek('2026-10-04'), '2026-W41');   // Sunday: the next ISO week's frame
  for (const d of ['2026-10-05', '2026-10-07', '2026-10-10']) assert.equal(W.frameWeek(d), '2026-W41', d);
  assert.equal(W.frameWeek('2026-10-11'), '2026-W42');
  // every frame week is seven days, Sunday to Saturday, and names the ISO week of its Monday
  for (let t = Date.UTC(2015, 0, 4); t <= Date.UTC(2035, 11, 30); t += 7 * 86400000) {   // 2015-01-04 is a Sunday
    const day = (k) => new Date(t + k * 86400000).toISOString().slice(0, 10);
    const week = W.frameWeek(day(0));
    assert.equal(week, W.isoWeek(day(1)), `opened ${day(0)}`);
    for (let k = 1; k < 7; k++) assert.equal(W.frameWeek(day(k)), week, day(k));
    assert.notEqual(W.frameWeek(day(7)), week);
  }
});

test('the frame week across year ends', () => {
  // 2026 has 53 ISO weeks: the frame that opens Sunday 27 Dec is W53
  assert.equal(W.frameWeek('2026-12-26'), '2026-W52');
  assert.equal(W.frameWeek('2026-12-27'), '2026-W53');
  assert.equal(W.frameWeek('2026-12-31'), '2026-W53');
  assert.equal(W.frameWeek('2027-01-01'), '2026-W53', 'New Year\'s Day plays the year before\'s frame');
  assert.equal(W.frameWeek('2027-01-02'), '2026-W53');
  assert.equal(W.frameWeek('2027-01-03'), '2027-W01');
  // and the Sunday before a Monday 30 December opens next year's W01
  assert.equal(W.frameWeek('2024-12-28'), '2024-W52');
  assert.equal(W.frameWeek('2024-12-29'), '2025-W01');
  assert.equal(W.frameWeek('2020-12-27'), '2020-W53');
  assert.equal(W.frameWeek('2021-01-03'), '2021-W01');
});

test('the week changes at local Sunday midnight, whatever the time zone', () => {
  // dates as a device would make them from its own local clock
  const sat = new Date(2026, 9, 3, 23, 59, 59, 999), sun = new Date(2026, 9, 4, 0, 0, 0, 0);
  assert.equal(W.frameWeek(dateStr(sat)), '2026-W40');
  assert.equal(W.frameWeek(dateStr(sun)), '2026-W41');
  assert.equal(W.frameWeek(dateStr(new Date(2026, 9, 10, 23, 59))), '2026-W41');
  // two devices half a world apart on the same local day agree
  assert.equal(W.thisWeek('2026-10-07').seed, W.thisWeek('2026-10-07').seed);
});

test('thisWeek: the Sunday it opened, the Sunday it ends, and the days left', () => {
  assert.deepEqual(W.thisWeek('2026-10-04'), {
    week: '2026-W41', seed: hashU32('queen-2026-W41'), opened: '2026-10-04', next: '2026-10-11', daysLeft: 7,
  });
  assert.equal(W.thisWeek('2026-10-05').daysLeft, 6);
  assert.equal(W.thisWeek('2026-10-10').daysLeft, 1);
  assert.equal(W.thisWeek('2026-10-10').opened, '2026-10-04');
  assert.equal(W.thisWeek('2026-12-31').opened, '2026-12-27');
  assert.equal(W.thisWeek('2026-12-31').next, '2027-01-03');
  assert.equal(W.thisWeek('bad'), null);
  assert.equal(W.nextFrameWords(7), 'New today · open all week');
  assert.equal(W.nextFrameWords(4), 'New frame in 4 days');
  assert.equal(W.nextFrameWords(1), 'New frame tomorrow');
});

test('one seed per frame week: the same all week, different every week', () => {
  assert.equal(W.weekSeed('2026-W41'), hashU32('queen-2026-W41'));
  assert.equal(W.weekSeed('2026-W41'), 911952649, 'pinned: a change here moves every past Queen\'s Frame');
  const seen = new Set();
  for (let t = Date.UTC(2020, 0, 5); t <= Date.UTC(2040, 0, 1); t += 7 * 86400000) {
    const s = W.thisWeek(new Date(t).toISOString().slice(0, 10)).seed;
    assert.equal(W.thisWeek(new Date(t + 3 * 86400000).toISOString().slice(0, 10)).seed, s);
    seen.add(s);
  }
  assert.equal(seen.size, 1044, 'twenty years of weeks, no two seeds alike');
});

test("the week's frame is the same frame anywhere, and it is a Queen's Frame", () => {
  const { seed } = W.thisWeek('2026-10-07');
  const a = C.generate('queen', seed), b = C.generate('queen', seed);
  assert.deepEqual(a, b);
  const fp = [...a.cells, ...a.shown, ...a.shownH, ...a.broken, a.start]
    .reduce((h, c, i) => (Math.imul(h ^ (c * 31 + i), 16777619) >>> 0), 2166136261);
  assert.equal(fp, 2244822749, 'pinned: the frame for 2026-W41');
  assert.equal(C.parseCode(C.boardCode('queen', seed)).seed, seed, 'its QU- code opens it again');
});

test('weekOf: this week\'s seed, last week\'s (a Saturday-night frame cleared after midnight), else none', () => {
  const w40 = W.weekSeed('2026-W40'), w41 = W.weekSeed('2026-W41');
  assert.equal(W.weekOf(w41, '2026-10-04'), '2026-W41');
  assert.equal(W.weekOf(w40, '2026-10-04'), '2026-W40', 'started Saturday, cleared Sunday');
  assert.equal(W.weekOf(w40, '2026-10-10'), '2026-W40');
  assert.equal(W.weekOf(W.weekSeed('2026-W39'), '2026-10-04'), null, 'older weeks are just codes');
  assert.equal(W.weekOf(12345, '2026-10-04'), null);
  assert.equal(W.weekOf(w40, 'bad'), null);
  assert.equal(W.weekOf(W.weekSeed('2026-W53'), '2027-01-03'), '2026-W53', 'across the year end too');
});

