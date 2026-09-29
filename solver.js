/* solver.js — what a careful player can know, and nothing more. No DOM.
 *
 * The generator only keeps frames this solver can finish from the opening
 * without a guess; later, split sight will ask it the same question about
 * two players' pooled clues.
 *
 * Every hidden cell carries a DOMAIN: a bitmask of what it might still be —
 * SAFE, GUARD, QUEEN (a queen's guard). A clue is a revealed cell's reading
 * of its neighbours, { guards: a, queens: b }: exactly a guards and b queen's
 * guards. Broken comb has no clue at all (clueAt → null). The solver narrows domains until nothing more follows. It works a
 * connected group of hidden cells at a time and enumerates every assignment
 * consistent with the clues touching it; whatever holds in all of them is
 * known. Enumeration is capped by a node budget (not a clock), so the answer
 * is the same on every device.
 */

export const SAFE = 1, GUARD = 2, QUEEN = 4;
const BUDGET = 60000;

const kindOf = (bit) => (bit === GUARD ? 1 : bit === QUEEN ? 2 : 0);
const single = (m) => m === SAFE || m === GUARD || m === QUEEN;

/**
 * Deduce as far as possible.
 *   nbrs      neighbour lists
 *   dom       Uint8Array of domains — narrowed IN PLACE
 *   clueAt(i) → the clue a revealed cell shows, or null for none
 *   open(i)   called for each cell proven SAFE; returns the indices that
 *             reveal opens (the cell itself, plus a flood) so their clues
 *             join the reasoning
 * Returns true if every SAFE cell ended up opened.
 */
export function solve(nbrs, dom, clueAt, open, opened) {
  // Learning anything can open cells (a flood) and so reshape every group:
  // after any progress, the groups are drawn again from scratch.
  let progress = true;
  while (progress) {
    progress = false;
    for (const group of groups(nbrs, dom, clueAt, opened)) {
      const seen = enumerate(group, nbrs, dom, clueAt, opened);
      if (!seen) continue;
      const learnt = [];
      for (let k = 0; k < group.cells.length; k++) {
        const i = group.cells[k];
        if (seen[k] !== dom[i]) { dom[i] = seen[k]; learnt.push(i); }
      }
      for (const i of learnt) if (dom[i] === SAFE && !opened[i]) open(i);
      if (learnt.length) { progress = true; break; }
    }
  }
  for (let i = 0; i < dom.length; i++) if (dom[i] & SAFE && !opened[i]) return false;
  return true;
}

/* Hidden, undecided cells next to a clue, split into groups that share no
 * clue. Each group comes with the clues that touch it. */
function groups(nbrs, dom, clueAt, opened) {
  const n = dom.length;
  const clueCells = [];
  for (let i = 0; i < n; i++) {
    if (!opened[i] || !clueAt(i)) continue;
    if (nbrs[i].some((j) => !opened[j] && !single(dom[j]))) clueCells.push(i);
  }
  const owner = new Int32Array(n).fill(-1);          // hidden cell → group
  const out = [];
  for (const c of clueCells) {
    const hidden = nbrs[c].filter((j) => !opened[j] && !single(dom[j]));
    const joined = new Set(hidden.map((j) => owner[j]).filter((g) => g >= 0));
    let g;
    if (joined.size === 0) { g = out.length; out.push({ cells: [], clues: [], alive: true }); }
    else {
      const ids = [...joined].sort((a, b) => a - b);
      g = ids[0];
      for (const other of ids.slice(1)) {             // merge into the lowest id
        for (const j of out[other].cells) owner[j] = g;
        out[g].cells.push(...out[other].cells);
        out[g].clues.push(...out[other].clues);
        out[other] = { cells: [], clues: [], alive: false };
      }
    }
    for (const j of hidden) if (owner[j] < 0) { owner[j] = g; out[g].cells.push(j); }
    out[g].clues.push(c);
  }
  return out.filter((g) => g.alive);
}

/* Every consistent assignment of one group. Returns, per cell, the OR of the
 * values it took — or null if the budget ran out (then nothing is claimed). */
function enumerate(group, nbrs, dom, clueAt, opened) {
  // order cells so each clue closes as early as possible: walk clue by clue
  const order = [];
  const at = new Map();
  for (const c of group.clues) {
    for (const j of nbrs[c]) {
      if (!opened[j] && !single(dom[j]) && !at.has(j) && group.cells.includes(j)) {
        at.set(j, order.length); order.push(j);
      }
    }
  }
  const cells = group.cells;
  const idx = cells.map((j) => at.get(j));

  // per clue: fixed contribution from decided neighbours + its open slots
  const clues = group.clues.map((c) => {
    const clue = clueAt(c);
    let w = 0, h = 0;
    const slots = [];
    for (const j of nbrs[c]) {
      if (opened[j]) continue;
      if (single(dom[j])) { const k = kindOf(dom[j]); if (k === 1) w++; else if (k === 2) h++; }
      else slots.push(at.get(j));
    }
    return { clue, w, h, slots, last: Math.max(...slots) };
  });
  const cluesOf = order.map(() => []);
  clues.forEach((q, qi) => q.slots.forEach((s) => cluesOf[s].push(qi)));

  const val = new Int8Array(order.length);            // 0 safe, 1 guard, 2 queen
  const cw = clues.map((q) => q.w), ch = clues.map((q) => q.h), left = clues.map((q) => q.slots.length);
  const seen = new Uint8Array(order.length);
  const full = order.map((j) => dom[j]);
  let nodes = 0, saturated = 0;

  const ok = (qi) => {
    const q = clues[qi].clue, w = cw[qi], h = ch[qi], u = left[qi];
    return w <= q.guards && h <= q.queens && (q.guards - w) + (q.queens - h) <= u;
  };

  const step = (k) => {
    if (++nodes > BUDGET) return false;
    if (k === order.length) {
      for (let s = 0; s < order.length; s++) {
        const bit = val[s] === 0 ? SAFE : val[s] === 1 ? GUARD : QUEEN;
        if (!(seen[s] & bit)) { seen[s] |= bit; if (seen[s] === full[s]) saturated++; }
      }
      return saturated < order.length;              // nothing left to learn → stop
    }
    const m = dom[order[k]];
    for (const v of [0, 1, 2]) {
      if (!(m & (v === 0 ? SAFE : v === 1 ? GUARD : QUEEN))) continue;
      val[k] = v;
      let good = true;
      for (const qi of cluesOf[k]) {
        left[qi]--; if (v === 1) cw[qi]++; else if (v === 2) ch[qi]++;
      }
      for (const qi of cluesOf[k]) if (!ok(qi)) { good = false; break; }
      const go = good ? step(k + 1) : true;
      for (const qi of cluesOf[k]) {
        left[qi]++; if (v === 1) cw[qi]--; else if (v === 2) ch[qi]--;
      }
      if (!go) return false;
    }
    return true;
  };

  step(0);
  if (nodes > BUDGET) return null;                  // too big to be sure of anything
  if (saturated >= order.length) return null;       // stopped early: nothing new
  // a cell whose seen set is empty would mean no assignment exists — a broken
  // frame, not a deduction; refuse to claim anything then
  if (seen.some((m) => m === 0)) return null;
  return idx.map((s) => seen[s]);
}
