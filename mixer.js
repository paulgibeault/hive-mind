/* mixer.js — the pure half of audio.js: what a cue may hear, which variant it
 * plays, where on the scale it sits, and whether it plays at all.
 *
 * No WebAudio, no DOM, no clock: the caller passes `now` in. That keeps every
 * decision here unit-testable in Node, and keeps the one rule that matters
 * checkable — a cue hears where the frame is, never what is under a cap.
 */

import { nbrsOf, floods } from './core.js';

// What a cue's params may carry from the game. Anything else is stripped
// before a cue sees it.
//   hive, seed   which frame (public: the frame code)
//   progress     how far past the opening the frame is, 0..1: 0 with only
//                the opening uncapped, 1 at the clear (public: the open cells
//                and the hive's guard totals)
//   cells        how many cells this action opened (public once it has)
//   rings        how many rings deep a flood's ripple runs (public once it
//                has: the cells it opened, drawn ring by ring)
//   kind         what the action revealed or placed, AFTER it happened: the
//                guard kind that stung, the pin a mark put in, or 'broken' for
//                an uncapped broken comb. Never asked of a hidden cell.
// Extending this list is a design decision (#06 rule 6, "no tells"): a new
// field must be something the player can already see when the cue fires.
export const ALLOWED = Object.freeze(['hive', 'seed', 'progress', 'cells', 'rings', 'kind']);

// Rungs on the climb. Matches the length of each hive's ladder in soundpack.js.
export const STEPS = 6;

// Variant sets per cue. Frequent cues rotate through four; mark/unmark
// alternate between two; the rest still vary per play through their seed.
export const VARIANTS = Object.freeze({
  uncap: 4, flood: 4, mark: 2, unmark: 2, nope: 2, clean: 4,
  sting: 1, won: 1, hint: 1, smoke: 1, pour: 1, jar: 1,
});

// The throttle. `gap`: a second play inside this many ms of the last one is
// folded into the voice already sounding. `max`/`life`: at most `max` voices
// at once, each counted live for `life` ms (the cue plus its room).
export const THROTTLE = Object.freeze({
  uncap: { gap: 40, max: 3, life: 150 },
  nope: { gap: 300 },
});

/** Keep only the fields a cue may hear. Never throws. */
export function clean(params) {
  const out = {};
  if (!params || typeof params !== 'object') return out;
  for (const k of ALLOWED) if (params[k] !== undefined) out[k] = params[k];
  return out;
}

/** progress → a rung 0..steps-1. Monotonic, bounded, and 0 for nonsense. */
export function stepOf(progress, steps = STEPS) {
  const x = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return Math.min(steps - 1, Math.floor(x * steps));
}

// How many cells a frame's opening uncaps. The opening is uncapped before
// the first move, so walking it reads only open cells. One frame at a time
// is all a game needs, so one entry is kept.
let opening = { key: null, n: 0 };
function openingSize(s) {
  const key = `${s.hive}|${s.seed}`;
  if (opening.key === key) return opening.n;
  const nbrs = nbrsOf(s.cols, s.rows);
  const seen = new Set([s.start]), stack = [s.start];
  while (stack.length) {
    const c = stack.pop();
    if (floods(s, c)) for (const j of nbrs[c]) if (!seen.has(j)) { seen.add(j); stack.push(j); }
  }
  opening = { key, n: seen.size };
  return seen.size;
}

/**
 * The context every cue gets: which frame, and how far past its opening it
 * is. Reads only what the board shows — the open cells and the hive's totals
 * — so it cannot carry a hidden cell's contents. Progress is measured from
 * the opening (not from an empty frame) so every frame climbs the whole
 * ladder: the opening alone can be most of a frame.
 */
export function cueContext(s) {
  if (!s) return {};
  const safe = s.cols * s.rows - s.guards - s.queens;
  const start = openingSize(s);
  let open = 0;
  for (const o of s.open) if (o) open++;
  const span = safe - start;
  return { hive: s.hive, seed: s.seed >>> 0, progress: span > 0 ? Math.min(1, Math.max(0, (open - start) / span)) : 0 };
}

/** Two u32s → one well-mixed u32 (a murmur3-style finalizer). */
export function mix(a, b) {
  let h = (Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ (b >>> 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

const nameHash = (name) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193);
  return h >>> 0;
};

/**
 * Which of n variants plays next: seeded from (seed, counter), and never the
 * index in `last`. Pure, so the same frame code and the same moves give the
 * same sounds.
 */
export function pickVariant(seed, counter, last, n) {
  if (!(n > 1)) return 0;
  const skip = Number.isInteger(last) && last >= 0 && last < n;
  const k = mix(seed, counter) % (skip ? n - 1 : n);
  return skip && k >= last ? k + 1 : k;
}

/**
 * The stateful half: per-cue counters for variant rotation, and the throttle.
 * `plan(name, params, now)` returns the params the cue should play with, or
 * null when the throttle folds or drops it.
 */
export function createMixer(opts = {}) {
  const throttle = opts.throttle || THROTTLE;
  const variants = opts.variants || VARIANTS;
  const timing = new Map();   // name → { at, live: [end ms…] }
  const rotation = new Map(); // name → { counter, last }
  let frame = null;

  /** 'play' | 'merge' (inside the gap: the sounding voice stands for it) | 'drop' (voice cap). */
  function admit(name, now) {
    const rule = throttle[name];
    if (!rule) return 'play';
    let st = timing.get(name);
    if (!st) { st = { at: -Infinity, live: [] }; timing.set(name, st); }
    if (rule.gap && now >= st.at && now - st.at < rule.gap) return 'merge';
    if (rule.max) {
      st.live = st.live.filter((end) => end > now);
      if (st.live.length >= rule.max) return 'drop';
      st.live.push(now + (rule.life || 0));
    }
    st.at = now;
    return 'play';
  }

  /** Forget the rotation: a new frame (or the same code replayed) starts at counter 0. */
  function reset() { rotation.clear(); frame = null; }

  function plan(name, params, now) {
    const p = clean(params);
    const key = `${p.hive}|${p.seed}`;
    if (key !== frame) { rotation.clear(); frame = key; }
    if (admit(name, now) !== 'play') return null;
    let rot = rotation.get(name);
    if (!rot) { rot = { counter: 0, last: -1 }; rotation.set(name, rot); }
    const base = mix(p.seed >>> 0, nameHash(name));
    const variant = pickVariant(base, rot.counter, rot.last, variants[name] || 1);
    const vseed = mix(base ^ 0x5bd1e995, rot.counter) || 1;
    rot.counter++;
    rot.last = variant;
    return { ...p, step: stepOf(p.progress), variant, vseed };
  }

  return { plan, admit, reset };
}
