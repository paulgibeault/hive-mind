/* solver.js — what a careful player can know, and nothing more. No DOM.
 *
 * The generator only keeps frames this solver can finish from the opening
 * without a guess; later, split sight will ask it the same question about
 * two players' pooled clues.
 *
 * Every hidden cell carries a DOMAIN: a bitmask of what it might still be —
 * SAFE, GUARD, QUEEN (a queen's guard). A clue is a revealed cell's reading
 * of its neighbours, { guards: a, queens: b }: exactly a guards and b queen's
 * guards. Broken comb has no clue at all (clueAt → null).
 *
 * A clue counts its SCOPE: the six neighbours, unless it names its own cells
 * with `over` — { guards, queens, over: number[] }. A Scout (#12) does: it
 * counts every cell within two steps. Such WIDE clues join the reasoning only
 * once the plain ones are stuck (they merge groups aggressively, and a group
 * too big for the budget teaches nothing), and inside a group the plain
 * clues are walked first so they prune before a wide one closes. A frame
 * with no wide clue is solved exactly as it was before Scouts existed.
 *
 * The solver narrows domains until nothing more follows. It works a
 * connected group of hidden cells at a time and enumerates every assignment
 * consistent with the clues touching it; whatever holds in all of them is
 * known. Enumeration is capped by a node budget (not a clock), so the answer
 * is the same on every device.
 *
 * Two queries ride on the same machinery, for telling the story of a move
 * (clean reads, the sting lesson, hints):
 *   provenNow     what a careful player can know from the clues on screen now
 *   minimalProof  the fewest revealed clues that alone prove one cell
 *
 * Like solve(), neither uses the global hazard count (the HUD's "guards
 * left"). That keeps one definition of "provable" everywhere: what the
 * generator promised is exactly what these report, and a proof is always a
 * handful of local clues a player can point at.
 */

export const SAFE = 1, GUARD = 2, QUEEN = 4;
const BUDGET = 60000;
// minimalProof's whole search (subsets tried + enumeration nodes) per call
export const PROOF_BUDGET = 200000;
// minimalProof looks for proofs of at most this many clues before falling
// back to the whole group
export const PROOF_MAX = 4;

/* The cells a clue counts: its `over`, or the neighbours of its cell. */
const scopeOf = (nbrs, clue, c) => clue.over || nbrs[c];

const kindOf = (bit) => (bit === GUARD ? 1 : bit === QUEEN ? 2 : 0);
const single = (m) => m === SAFE || m === GUARD || m === QUEEN;

/**
 * Deduce as far as possible.
 *   nbrs      neighbour lists
 *   dom       Uint8Array of domains — narrowed IN PLACE
 *   clueAt(i) → the clue a revealed cell shows, or null for none:
 *             { guards, queens } over nbrs[i], or { guards, queens, over }
 *             over the cells `over` names (a Scout's range)
 *   open(i)   called for each cell proven SAFE. The generator's open()
 *             uncaps it (and floods), setting opened[] so new clues join the
 *             reasoning. An open() that only records — or none at all —
 *             leaves the cell hidden but decided: the loop then chains
 *             through domains alone, which is what provenNow wants.
 *   opened    Uint8Array, 1 for an uncapped cell
 * Returns true if every SAFE cell ended up opened. Either way dom is left
 * narrowed as far as the clues go; callers may read it.
 */
export function solve(nbrs, dom, clueAt, open = () => {}, opened) {
  // Learning anything can open cells (a flood) and so reshape every group:
  // after any progress, the groups are drawn again from scratch.
  //
  // A group that taught nothing (or ran out of budget) would teach nothing
  // again from the same position, so it is remembered by everything its
  // enumeration reads — its clues, in order, and the state of their
  // neighbours — and skipped until that changes. Same answers, fewer nodes:
  // it matters most for a group too big for the budget, which would
  // otherwise be re-enumerated in full after every unrelated step.
  //
  // Plain clues first; only when they teach nothing more do the wide ones
  // (Scouts) join in, and any progress goes back to plain clues alone. With
  // no wide clue on the board the second pass never runs.
  const barren = new Set();
  let progress = true;
  while (progress) {
    progress = false;
    for (const reach of [false, true]) {
      const { list, skipped } = groups(nbrs, dom, clueAt, opened, reach);
      for (const group of list) {
        const key = position(group, dom, opened);
        if (barren.has(key)) continue;
        const seen = enumerate(group, dom, clueAt, opened);
        if (!seen) { barren.add(key); continue; }
        const learnt = [];
        for (let k = 0; k < group.cells.length; k++) {
          const i = group.cells[k];
          if (seen[k] !== dom[i]) { dom[i] = seen[k]; learnt.push(i); }
        }
        if (!learnt.length) barren.add(key);
        for (const i of learnt) if (dom[i] === SAFE && !opened[i]) open(i);
        if (learnt.length) { progress = true; break; }
      }
      if (progress || !skipped) break;
    }
  }
  for (let i = 0; i < dom.length; i++) if (dom[i] & SAFE && !opened[i]) return false;
  return true;
}

/**
 * What a careful player can know right now.
 *   nbrs       neighbour lists
 *   opened     1 for an uncapped cell (safe, by definition); 0 for hidden
 *   clueAt(i)  the clue an uncapped cell shows, or null (broken comb). Only
 *              called for opened cells.
 *   kinds      what a hidden cell might be: SAFE|GUARD, or SAFE|GUARD|QUEEN
 * Returns { safe: Set<i>, guard: Map<i, GUARD|QUEEN> } over hidden cells.
 *
 * Chains through decided cells (a known guard feeds its neighbours' clues)
 * but never opens a cell, so no clue the player hasn't seen enters. It
 * knows nothing of contents or marks: give it only what is on screen.
 * Exact on every group whose enumeration fits the node budget; a group that
 * doesn't is left undecided (never guessed).
 */
export function provenNow(nbrs, opened, clueAt, kinds) {
  const n = nbrs.length;
  const seen = Uint8Array.from(opened, (o) => (o ? 1 : 0));   // solve() must not touch the caller's
  const dom = new Uint8Array(n);
  for (let i = 0; i < n; i++) dom[i] = seen[i] ? SAFE : kinds;
  solve(nbrs, dom, (i) => (seen[i] ? clueAt(i) : null), undefined, seen);
  const safe = new Set(), guard = new Map();
  for (let i = 0; i < n; i++) {
    if (seen[i] || !single(dom[i])) continue;
    if (dom[i] === SAFE) safe.add(i); else guard.set(i, dom[i]);
  }
  return { safe, guard };
}

/**
 * The smallest set of revealed clue cells that alone proves hidden cell i.
 * Same inputs as provenNow, plus i and, optionally, provenNow's result for
 * this state (to save recomputing it when asking about many cells).
 * Returns { value: SAFE|GUARD|QUEEN, clues: number[] (ascending) }, or null
 * if i isn't provable now.
 *
 * "Alone proves" means: with only those clues on screen (every other cell
 * hidden and unknown), every assignment consistent with them gives i the same
 * value. A minimal proof is always CONNECTED to i — each clue reaches i
 * through clues that share hidden cells in their scopes — since a clue in a
 * separate component constrains nothing i depends on. So subsets are grown
 * outward from the clues whose scope holds i (a Scout's reaches two steps),
 * size 1..PROOF_MAX, in a fixed order (by size, then lexicographically by
 * cell index); the first that proves i wins. With plain clues that covers
 * every proof within 3 rings of i and also chains that reach further (a
 * 3-clue chain can end 5 rings out). If none of size ≤ PROOF_MAX proves it,
 * or PROOF_BUDGET runs out, the answer is every clue of i's group: all
 * revealed clues connected to i, which prove it whenever anything does.
 */
export function minimalProof(nbrs, opened, clueAt, kinds, i, known) {
  if (opened[i]) return null;
  const now = known || provenNow(nbrs, opened, clueAt, kinds);
  const value = now.safe.has(i) ? SAFE : now.guard.get(i);
  if (!value) return null;

  // a usable clue: uncapped, has a clue, and its scope still holds a hidden cell
  const scope = new Map();                                   // usable clue cell → its scope
  for (let c = 0; c < nbrs.length; c++) {
    if (!opened[c]) continue;
    const clue = clueAt(c);
    if (clue === null) continue;
    const over = scopeOf(nbrs, clue, c);
    if (over.some((j) => !opened[j])) scope.set(c, over);
  }
  const near = new Map();                                    // hidden h → the clues counting it
  for (const [c, over] of scope) {
    for (const h of over) {
      if (opened[h]) continue;
      if (!near.has(h)) near.set(h, []);
      near.get(h).push(c);
    }
  }
  const cluesNear = (h) => near.get(h) || [];
  const adj = new Map();                                     // clue → clues sharing a hidden cell
  const adjOf = (c) => {
    if (!adj.has(c)) {
      const out = new Set();
      for (const h of scope.get(c)) if (!opened[h]) for (const d of cluesNear(h)) if (d !== c) out.add(d);
      adj.set(c, [...out].sort((a, b) => a - b));
    }
    return adj.get(c);
  };

  // i's group: every clue connected to i
  const roots = [...cluesNear(i)].sort((a, b) => a - b);
  const groupClues = () => {
    const got = new Set(roots), stack = [...roots];
    while (stack.length) for (const d of adjOf(stack.pop())) if (!got.has(d)) { got.add(d); stack.push(d); }
    return { value, clues: [...got].sort((a, b) => a - b) };
  };

  const budget = { left: PROOF_BUDGET };
  let level = roots.map((c) => [c]);
  for (let size = 1; size <= PROOF_MAX && level.length; size++) {
    for (const set of level) {
      if (--budget.left < 0) return groupClues();
      const r = counterexample(scope, opened, clueAt, kinds, i, value, set, budget);
      if (r === null) return groupClues();                   // budget ran out mid-search
      if (!r) return { value, clues: set };
    }
    if (size === PROOF_MAX) break;
    const next = new Map();
    for (const set of level) {
      const have = new Set(set);
      for (const c of set) {
        for (const d of adjOf(c)) {
          if (have.has(d)) continue;
          const grown = [...set, d].sort((a, b) => a - b);
          const key = grown.join(',');
          if (!next.has(key)) {
            if (--budget.left < 0) return groupClues();
            next.set(key, grown);
          }
        }
      }
    }
    level = [...next.values()].sort(lexical);
  }
  return groupClues();
}

const lexical = (a, b) => {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] - b[k];
  return 0;
};

/* Is there an assignment of the hidden cells around `clueCells` that fits
 * every one of those clues and gives i something other than `value`?
 * true/false, or null if the budget ran out. */
function counterexample(scope, opened, clueAt, kinds, i, value, clueCells, budget) {
  const order = [i];
  const at = new Map([[i, 0]]);
  for (const c of clueCells) for (const j of scope.get(c)) if (!opened[j] && !at.has(j)) { at.set(j, order.length); order.push(j); }
  const qs = clueCells.map((c) => ({ clue: clueAt(c), slots: scope.get(c).filter((j) => !opened[j]).map((j) => at.get(j)) }));
  const cluesOf = order.map(() => []);
  qs.forEach((q, qi) => q.slots.forEach((s) => cluesOf[s].push(qi)));
  const cw = qs.map(() => 0), ch = qs.map(() => 0), left = qs.map((q) => q.slots.length);
  const BITS = [SAFE, GUARD, QUEEN].filter((b) => kinds & b);
  const first = BITS.filter((b) => b !== value);
  const ok = (qi) => {
    const q = qs[qi].clue;
    return cw[qi] <= q.guards && ch[qi] <= q.queens && (q.guards - cw[qi]) + (q.queens - ch[qi]) <= left[qi];
  };
  const step = (k) => {
    if (--budget.left < 0) return null;
    if (k === order.length) return true;
    for (const b of k === 0 ? first : BITS) {
      for (const qi of cluesOf[k]) { left[qi]--; if (b === GUARD) cw[qi]++; else if (b === QUEEN) ch[qi]++; }
      let good = true;
      for (const qi of cluesOf[k]) if (!ok(qi)) { good = false; break; }
      const r = good ? step(k + 1) : false;
      for (const qi of cluesOf[k]) { left[qi]++; if (b === GUARD) cw[qi]--; else if (b === QUEEN) ch[qi]--; }
      if (r !== false) return r;                             // found one, or out of budget
    }
    return false;
  };
  return step(0);
}

/* Everything enumerate() reads for a group, as a key: its clues in order and,
 * for each, whether each cell of its scope is open and what it might be. (The
 * group's cells are exactly the hidden, undecided ones among those.) */
function position(group, dom, opened) {
  let key = '';
  for (let k = 0; k < group.clues.length; k++) {
    key += group.clues[k] + ':';
    for (const j of group.scopes[k]) key += opened[j] ? 'o' : dom[j];
    key += ',';
  }
  return key;
}

/* Hidden, undecided cells in a clue's scope, split into groups that share no
 * clue. Each group comes with the clues that count it, and their scopes.
 * Without `reach`, wide clues (Scouts) are left out and counted in `skipped`.
 * Within a group holding a wide clue, the plain clues come first. */
function groups(nbrs, dom, clueAt, opened, reach) {
  const n = dom.length;
  const clueCells = [], scopes = [], wide = [];
  let skipped = 0;
  for (let i = 0; i < n; i++) {
    if (!opened[i]) continue;
    const clue = clueAt(i);
    if (!clue) continue;
    const over = scopeOf(nbrs, clue, i);
    if (!over.some((j) => !opened[j] && !single(dom[j]))) continue;
    if (clue.over && !reach) { skipped++; continue; }
    clueCells.push(i); scopes.push(over); wide.push(!!clue.over);
  }
  const owner = new Int32Array(n).fill(-1);          // hidden cell → group
  const out = [];
  clueCells.forEach((c, k) => {
    const hidden = scopes[k].filter((j) => !opened[j] && !single(dom[j]));
    const joined = new Set(hidden.map((j) => owner[j]).filter((g) => g >= 0));
    let g;
    if (joined.size === 0) { g = out.length; out.push({ cells: [], clues: [], scopes: [], wide: [], alive: true }); }
    else {
      const ids = [...joined].sort((a, b) => a - b);
      g = ids[0];
      for (const other of ids.slice(1)) {             // merge into the lowest id
        for (const j of out[other].cells) owner[j] = g;
        out[g].cells.push(...out[other].cells);
        out[g].clues.push(...out[other].clues);
        out[g].scopes.push(...out[other].scopes);
        out[g].wide.push(...out[other].wide);
        out[other] = { cells: [], clues: [], scopes: [], wide: [], alive: false };
      }
    }
    for (const j of hidden) if (owner[j] < 0) { owner[j] = g; out[g].cells.push(j); }
    out[g].clues.push(c);
    out[g].scopes.push(scopes[k]);
    out[g].wide.push(wide[k]);
  });
  const list = out.filter((g) => g.alive);
  for (const g of list) {
    if (!g.wide.includes(true)) continue;
    const ord = g.clues.map((_, k) => k).sort((a, b) => g.wide[a] - g.wide[b] || a - b);
    g.clues = ord.map((k) => g.clues[k]);
    g.scopes = ord.map((k) => g.scopes[k]);
  }
  return { list, skipped };
}

/* Every consistent assignment of one group. Returns, per cell, the OR of the
 * values it took — or null if the budget ran out (then nothing is claimed). */
function enumerate(group, dom, clueAt, opened) {
  // order cells so each clue closes as early as possible: walk clue by clue
  const order = [];
  const at = new Map();
  for (const over of group.scopes) {
    for (const j of over) {
      if (!opened[j] && !single(dom[j]) && !at.has(j) && group.cells.includes(j)) {
        at.set(j, order.length); order.push(j);
      }
    }
  }
  const cells = group.cells;
  const idx = cells.map((j) => at.get(j));

  // per clue: fixed contribution from decided neighbours + its open slots
  const clues = group.clues.map((c, k) => {
    const clue = clueAt(c);
    let w = 0, h = 0;
    const slots = [];
    for (const j of group.scopes[k]) {
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
