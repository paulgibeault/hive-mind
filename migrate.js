/* migrate.js — stored data from older versions, brought up to date. No DOM.
 *
 * Pure: plain data in, plain data out. main.js reads the stores (the run,
 * the records, the stats), hands them here, and writes back only what this
 * says moved — so a second pass over migrated data changes nothing.
 *
 * v1 → v2 (2026-09-28): the hives were renamed (core.js OLD_IDS), the hazards
 * became guards, and cracked cells became broken comb. What moves:
 *   run      the saved game: its hive, its field names, and v: 2
 *   records  time-<old id> → time-<new id>
 *   frames   Arcade.stats('frames') keys, old id → new id
 *   daily    Arcade.stats('daily') entries' hive
 * Where an old and a new entry both exist, the better one is kept.
 */

import { HIVES, OLD_IDS, SAVE_V, G, Q, nbrsOf, solvable } from './core.js';

const newId = (id) => (Object.hasOwn(OLD_IDS, id) ? OLD_IDS[id] : id);
const hiveOf = (id) => HIVES.find((h) => h.id === newId(id)) || null;

/** The record categories this reads: time-<id> for every old and new id. */
export const recordKeys = () =>
  [...Object.keys(OLD_IDS), ...HIVES.map((h) => h.id)].map((id) => `time-${id}`);

// Every field a v1 game state carries that v2 keeps as it is. The two count
// fields are recomputed from the cells and `cracked` becomes `broken`, so
// the v1 names never need spelling out here.
const KEPT = ['cols', 'rows', 'cells', 'shown', 'shownH', 'start', 'seed', 'tries',
  'open', 'mark', 'phase', 'stung', 'moves', 'events'];

/** One saved game state, v1 → v2. Null when it can't come across. */
export function migrateState(s) {
  if (!s || s.v !== 1) return s;
  const hive = hiveOf(s.hive);
  if (!hive) return null;
  const out = { v: SAVE_V, hive: hive.id };
  for (const k of KEPT) if (k in s) out[k] = s[k];
  if (!Array.isArray(out.cells)) return null;
  out.guards = out.cells.filter((c) => c === G).length;
  out.queens = out.cells.filter((c) => c === Q).length;
  out.broken = Array.isArray(s.cracked) ? s.cracked.map((c) => (c ? 1 : 0)) : out.cells.map(() => 0);
  if (out.broken.some(Boolean)) {
    // a cracked cell's number was a lie; broken comb keeps the truth, which
    // nothing shows. The promise is checked again under the new reading: a
    // frame that needed its cracks' numbers is let go rather than resumed
    // into a guess.
    const nbrs = nbrsOf(out.cols, out.rows);
    out.shown = out.shown.map((v, i) => (out.broken[i] ? nbrs[i].filter((j) => out.cells[j] === G).length : v));
    if (!solvable(out)) return null;
  }
  return out;
}

/* The better of two duration records; the stored one's direction rules. */
function better(a, b) {
  if (!b) return a;
  if (!a) return b;
  return (b.direction === 'higher' ? a.value > b.value : a.value < b.value) ? a : b;
}

/**
 * Everything, at once.
 *   { run, records: { category: record|null }, frames, daily }
 * → { run: undefined (unchanged) | the new run | null (drop it),
 *     records: { category: record } to write, dropRecords: [category],
 *     frames: the new stat or null (unchanged), daily: likewise }
 */
export function migrate({ run = null, records = {}, frames = {}, daily = {} } = {}) {
  const out = { run: undefined, records: {}, dropRecords: [], frames: null, daily: null };

  if (run && run.s && run.s.v === 1) {
    const s = migrateState(run.s);
    out.run = s ? { ...run, s } : null;
  }

  for (const [old, id] of Object.entries(OLD_IDS)) {
    const was = records[`time-${old}`];
    if (!was) continue;
    const now = records[`time-${id}`];
    const best = better(was, now);
    if (best !== now) {
      out.records[`time-${id}`] = { ...best, label: `${hiveOf(id).name} — fastest frame` };
    }
    out.dropRecords.push(`time-${old}`);
  }

  if (frames && Object.keys(OLD_IDS).some((old) => Object.hasOwn(frames, old))) {
    const next = { ...frames };
    for (const [old, id] of Object.entries(OLD_IDS)) {
      if (!Object.hasOwn(next, old)) continue;
      const a = next[old] || {}, b = next[id] || {};
      next[id] = {
        played: Math.max(a.played || 0, b.played || 0),
        won: Math.max(a.won || 0, b.won || 0),
      };
      delete next[old];
    }
    out.frames = next;
  }

  if (daily && Object.values(daily).some((d) => d && Object.hasOwn(OLD_IDS, d.hive))) {
    const next = {};
    for (const [date, d] of Object.entries(daily)) {
      next[date] = d && Object.hasOwn(OLD_IDS, d.hive) ? { ...d, hive: OLD_IDS[d.hive] } : d;
    }
    out.daily = next;
  }

  return out;
}
