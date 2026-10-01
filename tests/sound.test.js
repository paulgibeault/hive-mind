/* The sound pass (#06): the pure decisions in mixer.js, the no-tells rule at
 * every call site, and the pack itself run against a stand-in element library
 * (no WebAudio in Node — what it sounds like is the workbench's job).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOWED, STEPS, THROTTLE, clean, stepOf, cueContext, pickVariant, createMixer,
} from '../mixer.js';
import * as Core from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// ── variant rotation ─────────────────────────────────────────────────────
test('variant rotation never plays the same index twice in a row', () => {
  for (const n of [2, 3, 4]) {
    for (const seed of [0, 1, 0xdeadbeef, 123456789]) {
      let last = -1;
      const seen = new Set();
      for (let c = 0; c < 500; c++) {
        const v = pickVariant(seed, c, last, n);
        assert.ok(v >= 0 && v < n, `variant ${v} out of range for n=${n}`);
        assert.notEqual(v, last, `seed ${seed} counter ${c} repeated ${v}`);
        seen.add(v);
        last = v;
      }
      assert.equal(seen.size, n, 'every variant gets played');
    }
  }
  assert.equal(pickVariant(5, 5, 0, 1), 0, 'a one-variant cue always plays 0');
});

test('two-variant cues alternate', () => {
  const m = createMixer();
  const got = [];
  for (let k = 0; k < 8; k++) got.push(m.plan('mark', { hive: 'apple', seed: 9 }, k * 1000).variant);
  for (let k = 1; k < got.length; k++) assert.notEqual(got[k], got[k - 1]);
});

test('the mixer never repeats a cue variant back to back', () => {
  const m = createMixer();
  const last = {};
  for (let k = 0; k < 400; k++) {
    for (const name of ['uncap', 'flood', 'mark', 'unmark', 'nope', 'clean']) {
      const p = m.plan(name, { hive: 'clover', seed: 77, progress: k / 400 }, k * 1000);
      assert.ok(p);
      assert.notEqual(p.variant, last[name], `${name} repeated variant ${p.variant}`);
      last[name] = p.variant;
    }
  }
});

test('the same (seed, counter) gives the same variant', () => {
  for (let c = 0; c < 50; c++) {
    assert.equal(pickVariant(0xabc, c, c % 4, 4), pickVariant(0xabc, c, c % 4, 4));
  }
  // and a whole replay: same frame, same moves, same sounds
  const run = () => {
    const m = createMixer();
    const out = [];
    for (let k = 0; k < 60; k++) {
      const name = ['uncap', 'flood', 'mark'][k % 3];
      out.push(m.plan(name, { hive: 'wildflowers', seed: 4242, progress: k / 60 }, k * 500));
    }
    return out;
  };
  assert.deepEqual(run(), run());
  // a different seed gives a different run
  const a = createMixer(), b = createMixer();
  const va = [], vb = [];
  for (let k = 0; k < 40; k++) {
    va.push(a.plan('uncap', { seed: 1 }, k * 500).vseed);
    vb.push(b.plan('uncap', { seed: 2 }, k * 500).vseed);
  }
  assert.notDeepEqual(va, vb);
});

test('a new frame, or reset(), starts the rotation from the top', () => {
  const m = createMixer();
  const first = m.plan('uncap', { hive: 'clover', seed: 3 }, 0);
  m.plan('uncap', { hive: 'clover', seed: 3 }, 1000);
  m.reset();
  assert.deepEqual(m.plan('uncap', { hive: 'clover', seed: 3 }, 2000), first);
  m.plan('uncap', { hive: 'apple', seed: 3 }, 3000);   // another frame
  assert.deepEqual(m.plan('uncap', { hive: 'clover', seed: 3 }, 4000), first);
});

// ── the throttle ─────────────────────────────────────────────────────────
test('an uncap within 40 ms of the last is folded into the sounding voice', () => {
  const m = createMixer();
  assert.equal(m.admit('uncap', 1000), 'play');
  assert.equal(m.admit('uncap', 1039), 'merge');
  assert.equal(m.admit('uncap', 1001), 'merge');
  assert.equal(m.admit('uncap', 1040), 'play');
  // through plan(): folded plays return nothing to play, and don't advance the rotation
  const n = createMixer();
  const a = n.plan('uncap', { seed: 1 }, 0);
  assert.equal(n.plan('uncap', { seed: 1 }, 20), null);
  const b = n.plan('uncap', { seed: 1 }, 200);
  const fresh = createMixer();
  fresh.plan('uncap', { seed: 1 }, 0);
  assert.deepEqual(b, fresh.plan('uncap', { seed: 1 }, 200));
  assert.notEqual(a.variant, b.variant);
});

test('at most three uncap voices sound at once', () => {
  const m = createMixer();
  const { gap, life, max } = THROTTLE.uncap;
  assert.equal(max, 3);
  const at = [0, gap, 2 * gap, 3 * gap];               // all inside one voice's life
  assert.ok(3 * gap < life, 'the test needs a fourth play while three still sound');
  assert.deepEqual(at.map((t) => m.admit('uncap', t)), ['play', 'play', 'play', 'drop']);
  // once the first voice has rung out there is room again
  assert.equal(m.admit('uncap', life + 1), 'play');
  // a hammered input never gets more than three going
  const h = createMixer();
  const live = [];
  for (let t = 0; t < 2000; t += 7) {
    if (h.admit('uncap', t) === 'play') live.push(t + life);
    assert.ok(live.filter((end) => end > t).length <= 3, `more than three voices at ${t} ms`);
  }
});

test('nope has a 300 ms cooldown; cues without a rule always play', () => {
  const m = createMixer();
  assert.equal(m.admit('nope', 0), 'play');
  assert.equal(m.admit('nope', 299), 'merge');
  assert.equal(m.admit('nope', 300), 'play');
  for (let k = 0; k < 10; k++) assert.equal(m.admit('won', k), 'play');
});

// ── the climb ────────────────────────────────────────────────────────────
test('the scale rung from progress is monotonic and bounded', () => {
  let prev = -1;
  for (let k = 0; k <= 1000; k++) {
    const s = stepOf(k / 1000);
    assert.ok(Number.isInteger(s) && s >= 0 && s < STEPS);
    assert.ok(s >= prev, `step fell at progress ${k / 1000}`);
    prev = s;
  }
  assert.equal(stepOf(0), 0);
  assert.equal(stepOf(1), STEPS - 1);
  for (const x of [-1, 2, NaN, undefined, null, 'x', Infinity]) {
    const s = stepOf(x);
    assert.ok(s >= 0 && s < STEPS, `stepOf(${x}) = ${s}`);
  }
  for (const n of [1, 3, 8]) assert.equal(stepOf(1, n), n - 1);
});

// ── no tells ─────────────────────────────────────────────────────────────
test('sfx params only include hive, seed, progress, cells and kind', () => {
  assert.deepEqual([...ALLOWED].sort(), ['cells', 'hive', 'kind', 'progress', 'seed']);
  assert.deepEqual(clean({ hive: 'apple', seed: 1, progress: 0.5, cells: 3, kind: 2, cell: 17, guard: true, s: {} }),
    { hive: 'apple', seed: 1, progress: 0.5, cells: 3, kind: 2 });
  assert.deepEqual(clean(null), {});
  // what reaches a cue: the allowed fields plus what the mixer derives from
  // them and its own play count — nothing else
  const p = createMixer().plan('uncap', { hive: 'apple', seed: 1, progress: 0.5, cells: 1, cell: 4, contents: 'G' }, 0);
  assert.deepEqual(Object.keys(p).sort(), ['cells', 'hive', 'progress', 'seed', 'step', 'variant', 'vseed']);

  // every call site in main.js passes cue({...}) with only cells and kind
  const main = code(read('main.js'));
  const calls = [...main.matchAll(/\bsfx\(/g)];
  assert.ok(calls.length >= 6, 'main.js plays its cues through sfx()');
  for (const c of calls) {
    const tail = main.slice(c.index, c.index + 200);
    const m = /^sfx\([^,]+,\s*cue\((\{[^}]*\}|[^)]*)\)\)/.exec(tail.replace(/\s+/g, ' '));
    assert.ok(m, `sfx call doesn't go through cue(): ${tail.split('\n')[0]}`);
    for (const k of m[1].matchAll(/(\w+)\s*:/g)) {
      assert.ok(['cells', 'kind'].includes(k[1]), `a call site passes "${k[1]}"`);
    }
  }
  // and the context cue() spreads in is exactly hive, seed, progress
  assert.match(main, /const cue = \(extra\) => \(\{ \.\.\.cueContext\(s\), \.\.\.extra \}\);/);
});

test('the cue context reads only what the board shows', () => {
  const s = Core.newGame('apple', 0xabc);
  const ctx = cueContext(s);
  assert.deepEqual(Object.keys(ctx).sort(), ['hive', 'progress', 'seed']);
  assert.equal(ctx.hive, 'apple');
  assert.ok(ctx.progress > 0 && ctx.progress < 1);
  // scramble everything under the caps: the context can't change
  const t = structuredClone(s);
  for (let i = 0; i < t.cells.length; i++) {
    if (t.open[i]) continue;
    t.cells[i] = (t.cells[i] + 1) % 3; t.shown[i] = 6; t.shownH[i] = 6; t.broken[i] = 1 - t.broken[i];
  }
  assert.deepEqual(cueContext(t), ctx);
  // and it climbs to 1 as the frame clears
  const w = structuredClone(s);
  w.open = w.cells.map((c) => (c === Core.EMPTY ? 1 : 0));
  assert.equal(cueContext(w).progress, 1);
});

test('audio.js is the only shipped file that touches the launcher audio', () => {
  for (const f of ['main.js', 'core.js', 'solver.js', 'hex.js', 'render.js', 'input.js', 'migrate.js', 'mixer.js', 'soundpack.js']) {
    assert.doesNotMatch(code(read(f)), /Arcade\.audio|\.audio\.(play|graph|room)\b/, `${f} touches Arcade.audio`);
  }
  assert.match(read('audio.js'), /window\.Arcade\.audio\.play\(/);
});

// ── the pack, against a stand-in element library ─────────────────────────
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function loadPack() {
  const calls = [];
  const el = (name, ret) => (ctx, dest, t, p) => { calls.push({ name, t, p }); return ret(p); };
  const S = {
    rng,
    between: (r, lo, hi) => lo + r() * (hi - lo),
    cents: (r, n) => Math.pow(2, (-n + r() * 2 * n) / 1200),
    strike: el('strike', (p) => p.dur || 0.006),
    rustle: el('rustle', (p) => p.dur || 0.3),
    droplet: el('droplet', (p) => (p.dur || 0.05) * 1.6),
    body: el('body', (p) => Math.max(...p.partials.map((x) => (x.delay || 0) + x.decay))),
    thump: el('thump', (p) => p.dur || 0.35),
    chirp: el('chirp', (p) => (p.pulses || 3) * (p.step || 0.04)),
    registerPack: (pack) => { globalThis.ArcadeSoundPack = pack; return pack; },
  };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = (kind) => ({
    kind, type: 'sine', connect() {}, start() {}, stop() {},
    frequency: param(), gain: param(), Q: param(), detune: param(), delayTime: param(), pan: param(),
  });
  const oscillators = [];
  const ctx = {
    sampleRate: 48000,
    createBiquadFilter: () => node('filter'),
    createGain: () => node('gain'),
    createDelay: () => node('delay'),
    createStereoPanner: () => node('panner'),
    createOscillator: () => { const o = node('osc'); oscillators.push(o); return o; },
  };
  const prev = { el: globalThis.ArcadeAudioElements, pack: globalThis.ArcadeSoundPack };
  globalThis.ArcadeAudioElements = S;
  (0, eval)(read('soundpack.js'));
  const pack = globalThis.ArcadeSoundPack;
  globalThis.ArcadeAudioElements = prev.el;
  globalThis.ArcadeSoundPack = prev.pack;
  return { pack, ctx, calls, oscillators };
}

test('every cue plays in every hive, with or without params, and never throws', () => {
  const { pack, ctx } = loadPack();
  const names = ['uncap', 'flood', 'mark', 'unmark', 'sting', 'won', 'nope', 'clean', 'hint', 'smoke', 'pour', 'jar'];
  assert.deepEqual(Object.keys(pack.CUES).sort(), [...names].sort());
  for (const n of names) assert.ok(typeof pack.SENDS[n] === 'number', `${n} has no room send`);
  assert.deepEqual(Object.keys(pack.HIVE), Core.HIVES.map((h) => h.id), 'one instrument per hive, keyed by id');
  for (const n of names) {
    const d0 = pack.CUES[n](ctx, {}, 0, null, rng(1));
    assert.ok(d0 > 0, `${n} with no params`);
    for (const hive of Core.HIVES.map((h) => h.id)) {
      for (const kind of [undefined, 1, 2, 'broken', 'pure', 'seal']) {
        const p = { hive, seed: 99, progress: 0.7, cells: 9, kind, step: 4, variant: 3, vseed: 1234 };
        const d = pack.CUES[n](ctx, {}, 0, p, rng(2));
        assert.ok(Number.isFinite(d) && d > 0 && d < 3, `${n} in ${hive} (${kind}) reports ${d}`);
      }
    }
  }
});

test('uncap stays under 60 ms, drops on ~60% of plays, and broken comb never drops', () => {
  const { pack, ctx, calls } = loadPack();
  let drops = 0;
  const N = 2000;
  for (let k = 1; k <= N; k++) {
    calls.length = 0;
    const d = pack.CUES.uncap(ctx, {}, 0, { hive: 'clover', step: k % 6, variant: k % 4, vseed: k }, rng(k));
    assert.ok(d <= 0.06, `uncap reports ${d}s`);
    const end = Math.max(...calls.map((c) => c.t + (c.name === 'droplet' ? c.p.dur * 1.6 : c.p.dur)));
    assert.ok(end <= 0.06, `uncap play ${k} runs to ${end}s`);
    if (calls.some((c) => c.name === 'droplet')) drops++;
  }
  assert.ok(Math.abs(drops / N - 0.6) < 0.05, `droplet on ${(100 * drops / N).toFixed(1)}% of plays`);
  for (let k = 1; k <= 200; k++) {
    calls.length = 0;
    pack.CUES.uncap(ctx, {}, 0, { hive: 'wildflowers', kind: 'broken', vseed: k }, rng(k));
    assert.ok(!calls.some((c) => c.name === 'droplet'), 'broken comb is empty: no honey drop');
  }
});

test('uncap climbs the hive ladder with progress, ±15 cents', () => {
  const { pack, ctx, calls } = loadPack();
  const f = (step, vseed) => {
    for (let v = vseed; ; v++) {
      calls.length = 0;
      pack.CUES.uncap(ctx, {}, 0, { hive: 'clover', step, vseed: v }, rng(1));
      const d = calls.find((c) => c.name === 'droplet');
      if (d) return d.p.f0;
    }
  };
  const ladder = [0, 2, 4, 7, 9, 12];
  for (let step = 0; step < 6; step++) {
    for (let k = 1; k < 40; k += 7) {
      const cents = 1200 * Math.log2(f(step, k * 31) / (523.25 * Math.pow(2, ladder[step] / 12)));
      assert.ok(Math.abs(cents) <= 15.001, `step ${step}: ${cents.toFixed(1)} cents off`);
    }
  }
});

test('the sting is a sleepy hum, not a sawtooth, and the queen\'s guard is a fifth lower', () => {
  const { pack, ctx, calls, oscillators } = loadPack();
  oscillators.length = 0;
  calls.length = 0;
  const d = pack.CUES.sting(ctx, {}, 0, { hive: 'apple', kind: 1, vseed: 5 }, rng(1));
  assert.ok(d >= 0.4 && d <= 0.5, `sting lasts ${d}s`);
  assert.ok(oscillators.length > 0 && oscillators.every((o) => o.type !== 'sawtooth'));
  const knock = calls.find((c) => c.name === 'body');
  assert.ok(knock.p.f0 > 400, 'the thump carries a knock above 400 Hz for phone speakers');
  assert.ok(!/sawtooth/.test(code(read('soundpack.js'))));
});

test('won resolves on the tonic of the ladder the frame climbed', () => {
  const { pack, ctx, calls } = loadPack();
  for (const hive of Core.HIVES.map((h) => h.id)) {
    calls.length = 0;
    pack.CUES.won(ctx, {}, 0, { hive, seed: 7, vseed: 3 }, rng(1));
    const knocks = calls.filter((c) => c.name === 'body').map((c) => c.p.f0);
    assert.equal(knocks.length, 3);
    assert.ok(knocks[0] < knocks[1] && knocks[1] < knocks[2], 'three rising knocks');
    const cents = 1200 * Math.log2(knocks[2] / pack.HIVE[hive].root);
    assert.ok(Math.abs(cents) <= 5.001, `${hive} ends ${cents.toFixed(1)} cents from its tonic`);
  }
});
