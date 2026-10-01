/* week.js — the Queen's Frame's calendar (#10). Which week it is, and its seed.
 *
 * Pure: a local date string in ('2026-10-04', from Arcade.daily.dateStr()),
 * plain data out. No DOM, no clock: main.js passes today in, which is what
 * lets the tests walk year ends and the Sunday-midnight switch with fixed
 * dates.
 *
 * An ISO week runs Monday to Sunday, but the Queen's Frame opens on Sunday.
 * So a FRAME WEEK runs from Sunday 00:00 local to the next Sunday 00:00, and
 * takes its name from the ISO week of the Monday after that Sunday:
 *
 *   frameWeek(date) = isoWeek(date + 1 day)
 *
 * which for Monday..Saturday is just their own ISO week, and for Sunday is
 * the next one. Sunday 4 October 2026 opens frame week 2026-W41 (Monday
 * 5 October is in W41), and that frame plays until Saturday 10 October ends.
 * At a year end the Monday decides the year, as ISO weeks do: Sunday
 * 27 December 2026 opens 2026-W53, and Sunday 3 January 2027 opens 2027-W01.
 *
 * The seed is a hash of the week's name, so every device on the same week
 * plays the same frame: weekSeed('2026-W41') = hashU32('queen-2026-W41').
 */

import { hashU32 } from './arcade-rng.js';
import { dayNumber, dateOf } from './pantry.js';

const DAY_SUN = 4;   // 1970-01-01 was a Thursday: (day + 4) % 7 is 0 on a Sunday
const DAY_MON = 3;   // and (day + 3) % 7 is 0 on a Monday

const wd = (day, from) => (((day + from) % 7) + 7) % 7;

/** 'YYYY-MM-DD' → its ISO 8601 week, 'YYYY-Www' (week-numbering year). Null for junk. */
export function isoWeek(date) {
  const d = dayNumber(date);
  if (!Number.isFinite(d)) return null;
  const thursday = d - wd(d, DAY_MON) + 3;          // the week's Thursday names its year
  const year = +dateOf(thursday).slice(0, 4);
  const week = Math.floor((thursday - dayNumber(`${year}-01-01`)) / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The frame week a local date falls in: the ISO week of the day after it. */
export function frameWeek(date) {
  const d = dayNumber(date);
  return Number.isFinite(d) ? isoWeek(dateOf(d + 1)) : null;
}

/** A frame week's seed: the same on every device. */
export const weekSeed = (week) => hashU32(`queen-${week}`);

/**
 * Everything the menu strip needs about the frame week `date` falls in:
 *   { week, seed, opened: the Sunday it opened, next: the Sunday it ends,
 *     daysLeft: whole days until the next frame (7 on a Sunday, 1 on a Saturday) }
 */
export function thisWeek(date) {
  const d = dayNumber(date);
  if (!Number.isFinite(d)) return null;
  const sunday = d - wd(d, DAY_SUN);
  const week = frameWeek(date);
  return { week, seed: weekSeed(week), opened: dateOf(sunday), next: dateOf(sunday + 7), daysLeft: sunday + 7 - d };
}

/**
 * Which frame week a Queen's Frame seed belongs to, seen from `date`: this
 * week's, or last week's (a frame started on Saturday night and cleared after
 * midnight still counts for the week it was dealt). Null for any other seed,
 * such as a QU- code typed in.
 */
export function weekOf(seed, date) {
  const now = thisWeek(date);
  if (!now) return null;
  if (now.seed === seed >>> 0) return now.week;
  const last = frameWeek(dateOf(dayNumber(date) - 7));
  return weekSeed(last) === seed >>> 0 ? last : null;
}

/** The strip's countdown, in words: 'New today · open all week' on a Sunday, then 'New frame in N days', then 'New frame tomorrow'. */
export function nextFrameWords(daysLeft) {
  if (daysLeft >= 7) return 'New today · open all week';
  if (daysLeft === 1) return 'New frame tomorrow';
  return `New frame in ${daysLeft} days`;
}
