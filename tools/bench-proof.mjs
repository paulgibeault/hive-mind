/* tools/bench-proof.mjs — how long provenNow and minimalProof take on
 * mid-game Apple Orchard (9×18, guards and queen's guards), the biggest
 * hive. Targets (issue #2): provenNow ≤ 3 ms, minimalProof ≤ 10 ms per call
 * on a mid-range phone. A laptop is several times faster; read the numbers
 * as headroom, not as the phone.
 *
 *   node tools/bench-proof.mjs [states=500] [hive=apple]
 *
 * States are seeded, so a run measures the same 500 boards every time. The
 * clock here is the benchmark's, never the solver's: the solver runs on
 * node budgets only. */
import * as C from '../core.js';
import { makeRng } from '../arcade-rng.js';

const STATES = Number(process.argv[2]) || 500;
const HIVE = process.argv[3] || 'apple';
const rnd = makeRng(20260930);

/* The opening, then 1–20 more safe cells uncapped (half of them provable,
 * half lucky), so the board is part-way through. */
function midGame(seed) {
  const s = C.newGame(HIVE, seed);
  const steps = rnd.int(1, 20);
  for (let k = 0; k < steps; k++) {
    const hidden = s.cells.flatMap((c, i) => (!s.open[i] && c === C.EMPTY ? [i] : []));
    if (hidden.length < 2) break;
    const proven = rnd() < 0.5 ? [...C.provenNow(s).safe] : [];
    const pool = proven.length ? proven : hidden;
    C.reveal(s, pool[rnd.int(0, pool.length - 1)]);
    if (s.phase !== 'play' || C.safeLeft(s) < 2) break;
  }
  return s;
}

const states = [];
for (let k = 0; k < STATES; k++) states.push(midGame(1000 + k));

// warm the JIT on states the timings don't use
for (let k = 0; k < 50; k++) {
  const s = midGame(900000 + k);
  const p = C.provenNow(s);
  for (const i of [...p.safe, ...p.guard.keys()].slice(0, 3)) C.minimalProof(s, i);
}

const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };
const tProven = [], tProof = [], tProofKnown = [];
let fallbacks = 0;
for (const s of states) {
  let p;
  tProven.push(time(() => { p = C.provenNow(s); }));
  const cells = [...p.safe, ...p.guard.keys()].sort((a, b) => a - b);
  if (!cells.length) continue;
  const i = cells[rnd.int(0, cells.length - 1)];
  let r;
  tProof.push(time(() => { r = C.minimalProof(s, i); }));            // the whole call
  tProofKnown.push(time(() => { C.minimalProof(s, i, p); }));        // provenNow already in hand
  if (r.clues.length > 4) fallbacks++;
}

const q = (xs, f) => { const v = [...xs].sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(f * v.length))]; };
const row = (name, xs) => console.log(
  `${name.padEnd(28)} n=${String(xs.length).padStart(4)}  p50 ${q(xs, 0.5).toFixed(3)} ms  p95 ${q(xs, 0.95).toFixed(3)} ms  max ${Math.max(...xs).toFixed(3)} ms`);

console.log(`${HIVE}, ${STATES} mid-game states, node ${process.version}`);
row('provenNow(s)', tProven);
row('minimalProof(s, i)', tProof);
row('minimalProof(s, i, known)', tProofKnown);
console.log(`provenNow over 1 ms: ${tProven.filter((t) => t > 1).length}, over 3 ms: ${tProven.filter((t) => t > 3).length}`);
console.log(`proofs that fell back to the whole group (> 4 clues): ${fallbacks}`);
