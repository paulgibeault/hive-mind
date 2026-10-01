/* juice.js — the arithmetic behind the renderer's moments. Pure: no DOM, no
 * clock; every time here is a number handed in.
 *
 * No tells: everything below reads only what the player can already see —
 * the cells an uncap just opened, the open cells, and the player's own marks.
 * Nothing here looks at what a capped cell hides.
 */

import { centre } from './hex.js';
import { isScout, ring2Of } from './core.js';

export const RING_MS = 28;        // a flood opens one ring per this
export const SWEEP_MS = 30;       // a sweep's light moves one neighbour per this
export const POUR_ROW_MS = 20;    // the win's honey fills one row per this

/**
 * Ring distances of an uncap: breadth-first from the tapped cell, through
 * only the cells that uncap opened. Returns { ring: Map cell → ring, count }.
 * A cell the walk can't reach (never, for a flood) sits in ring 0.
 */
export function rings(origin, cells, nbrs) {
  const inEvent = new Set(cells);
  const ring = new Map();
  if (inEvent.has(origin)) {
    ring.set(origin, 0);
    const queue = [origin];
    for (let k = 0; k < queue.length; k++) {
      const c = queue[k], d = ring.get(c) + 1;
      for (const j of nbrs[c]) if (inEvent.has(j) && !ring.has(j)) { ring.set(j, d); queue.push(j); }
    }
  }
  let count = 0;
  for (const c of cells) {
    if (!ring.has(c)) ring.set(c, 0);
    count = Math.max(count, ring.get(c) + 1);
  }
  return { ring, count };
}

/** A cell's neighbours in clockwise order, starting from the upper right. */
export function clockwise(i, nbrs, cols) {
  const o = centre(i, cols, 1);
  const angle = (j) => {
    const c = centre(j, cols, 1);
    // screen y points down, so a growing angle runs clockwise; -60° (upper
    // right) comes first
    return (Math.atan2(c.y - o.y, c.x - o.x) + Math.PI / 3 + 2 * Math.PI) % (2 * Math.PI);
  };
  return [...nbrs[i]].sort((a, b) => angle(a) - angle(b));
}

/** Does an open cell show a number? (Broken comb and plain zeros don't; a
 *  Scout always does, 0 included — it never floods, so its 0 is news.) */
export const showsNumber = (s, i) => !s.broken[i] && (isScout(s, i) || s.shown[i] > 0 || s.shownH[i] > 0);

/**
 * A finished number: no cell it counts is still capped and unmarked — its
 * neighbours, or a Scout's whole range (#12), so a Scout dims exactly when
 * there is nothing left in its range for it to tell. It reads only the open
 * cells and the player's own marks — a wrong mark finishes it too.
 */
export function finished(s, nbrs, i) {
  const over = isScout(s, i) ? ring2Of(s.cols, s.rows)[i] : nbrs[i];
  for (const j of over) if (!s.open[j] && !s.mark[j]) return false;
  return true;
}

/**
 * A tap on this open number was a sweep that couldn't fire: it still has
 * unmarked capped neighbours, so the marks round it must not add up. (A tap
 * on a zero, broken comb or a finished number isn't refused, just idle; nor
 * is a Scout, which is never swept — its tap is idle too, so the shake keeps
 * meaning "your marks don't add up".)
 */
export const refused = (s, nbrs, i) => !!s.open[i] && !isScout(s, i) && showsNumber(s, i) && !finished(s, nbrs, i);

// ── easing, over t in 0..1 ──────────────────────────────────────────────
export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const easeOut = (t) => 1 - (1 - t) * (1 - t);
export const easeIn = (t) => t * t;

/** A pin's scale as it lands: in at 125%, down past 100%, one bounce back. */
export function pinScale(t) {
  t = clamp01(t);
  if (t < 0.55) return 1.25 - 0.31 * easeIn(t / 0.55);
  return 0.94 + 0.06 * easeOut((t - 0.55) / 0.45);
}

/** A sideways shake: `times` full swings of ±amp px, easing out. */
export const shake = (t, amp, times) => (t <= 0 || t >= 1 ? 0 : amp * Math.sin(2 * Math.PI * times * t) * (1 - 0.4 * t));
