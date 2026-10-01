/* honey.js (#09): the colour of a frame's honey is a pure function of
 * (hive, seed), stays in its hive's band, and the jar's clink agrees with it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { honeyColour, lightness, hexHsl, hslHex, HONEY, WILD } from '../honey.js';
import * as Core from '../core.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEX = /^#[0-9a-f]{6}$/;
const SEEDS = Array.from({ length: 100 }, (_, k) => k + 1);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
// RGB distance, 0..441
const dist = (a, b) => {
  const p = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const [x, y] = [p(a), p(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
};

test('deterministic: the same (hive, seed) always gives the same honey', () => {
  for (const hive of ['clover', 'apple', 'wildflowers', 'queen', 'sunflower']) {
    for (const seed of [0, 1, 7, 0xabc, 0xffffffff, 123456789]) {
      const a = honeyColour(hive, seed), b = honeyColour(hive, seed);
      assert.deepEqual(a, b);
      assert.match(a.top, HEX); assert.match(a.bottom, HEX);
      assert.equal(lightness(hive, seed), lightness(hive, seed));
    }
  }
  // the seed is read as a u32, like a frame code's
  assert.deepEqual(honeyColour('wildflowers', -1), honeyColour('wildflowers', 0xffffffff));
});

test('Wildflowers: no two of 100 seeds alike', () => {
  const seen = new Set(SEEDS.map((s) => { const c = honeyColour('wildflowers', s); return `${c.top}${c.bottom}`; }));
  assert.equal(seen.size, 100);
  // and not just different by a bit: the blends really spread
  const tops = SEEDS.map((s) => hexHsl(honeyColour('wildflowers', s).bottom));
  const hues = tops.map((x) => x[0]), lights = tops.map((x) => x[2]);
  assert.ok(Math.max(...hues) - Math.min(...hues) > 12, 'hues spread across the band');
  assert.ok(Math.max(...lights) - Math.min(...lights) > 0.2, 'lightness spreads too');
});

test('Wildflowers stays amber to russet: hue 18–40°, low-to-mid lightness', () => {
  for (let seed = 0; seed < 2000; seed++) {
    const c = honeyColour('wildflowers', seed * 2654435761);
    for (const tone of [c.top, c.bottom]) {
      const [h, s, l] = hexHsl(tone);
      // a hex rounds each channel to 1/255, which can nudge hue by a fraction of a degree
      assert.ok(h >= WILD.hue[0] - 1 && h <= WILD.hue[1] + 1, `hue ${h.toFixed(1)} for seed ${seed}`);
      assert.ok(l >= WILD.light[0] - 0.005 && l <= WILD.light[1] + 0.005, `lightness ${l.toFixed(3)} for seed ${seed}`);
      assert.ok(s > 0.5, 'honey, not mud');
    }
    assert.ok(hexHsl(c.top)[2] > hexHsl(c.bottom)[2], 'the top of the jar is the lighter tone');
  }
});

test('the fixed hives sit on their table colours; Clover only wobbles a little', () => {
  assert.deepEqual(honeyColour('apple', 5), { top: '#e8a846', bottom: '#dd9a38' });
  assert.deepEqual(honeyColour('apple', 99), honeyColour('apple', 5));
  assert.deepEqual(honeyColour('queen', 5), { top: '#5a2c0e', bottom: '#3a1c08' });
  const clovers = SEEDS.map((s) => honeyColour('clover', s));
  for (const c of clovers) {
    assert.ok(dist(c.top, '#fff0b8') < 12, `clover top ${c.top}`);
    assert.ok(dist(c.bottom, '#fbe7a1') < 12, `clover bottom ${c.bottom}`);
    assert.ok(near(hexHsl(c.top)[2], hexHsl('#fff0b8')[2], 0.017));
  }
  assert.ok(new Set(clovers.map((c) => c.bottom)).size > 3, 'but it does wobble');
  // Sunflower Field (#12): golden, bright, with a wobble of its own
  const suns = SEEDS.map((s) => honeyColour('sunflower', s));
  for (const c of suns) {
    assert.ok(dist(c.top, '#f7c548') < 12, `sunflower top ${c.top}`);
    assert.ok(dist(c.bottom, '#eaa92b') < 12, `sunflower bottom ${c.bottom}`);
  }
  assert.ok(new Set(suns.map((c) => c.bottom)).size > 3, 'sunflower wobbles too');
  assert.notDeepEqual(SEEDS.map((s) => lightness('sunflower', s) - 0.5843), SEEDS.map((s) => lightness('clover', s) - 0.8343),
    'by its own salt, not in step with clover');
  // an unknown hive falls back to clover rather than throwing
  assert.match(honeyColour('somewhere', 3).top, HEX);
});

test('lightness is the honey\'s own: the mean HSL lightness of its two tones', () => {
  for (const hive of ['clover', 'apple', 'wildflowers', 'queen', 'sunflower']) {
    for (const seed of SEEDS) {
      const c = honeyColour(hive, seed);
      const l = (hexHsl(c.top)[2] + hexHsl(c.bottom)[2]) / 2;
      assert.ok(near(lightness(hive, seed), l, 0.006), `${hive} ${seed}: ${lightness(hive, seed)} vs ${l}`);
    }
  }
  // pale clover, amber apple, dark royal
  assert.ok(lightness('clover', 1) > lightness('apple', 1));
  assert.ok(lightness('apple', 1) > lightness('queen', 1));
});

test('hsl and hex round-trip', () => {
  for (const hex of ['#fff0b8', '#e8a846', '#5a2c0e', '#c46a24', '#000000', '#ffffff']) {
    const [h, s, l] = hexHsl(hex);
    assert.equal(hslHex(h, s, l), hex);
  }
});

test('every hive (and #10\'s Queen\'s Frame) has a taste note and a honey name', () => {
  for (const id of [...Core.HIVES.map((h) => h.id), 'queen']) {
    assert.ok(HONEY[id] && HONEY[id].note && /honey$/.test(HONEY[id].name), id);
  }
  assert.equal(HONEY.clover.name, 'clover honey');
});

// ── the jar's clink agrees with honey.js ─────────────────────────────────
function loadPack() {
  const calls = [];
  const el = (name) => (ctx, dest, t, p) => { calls.push({ name, p }); return 0.1; };
  const S = {
    rng: () => () => 0.5,
    between: (r, lo, hi) => lo + r() * (hi - lo),
    cents: () => 1,
    strike: el('strike'), rustle: el('rustle'), droplet: el('droplet'), body: el('body'),
    thump: el('thump'), chirp: el('chirp'),
    registerPack: (pack) => { globalThis.ArcadeSoundPack = pack; return pack; },
  };
  const prev = { el: globalThis.ArcadeAudioElements, pack: globalThis.ArcadeSoundPack };
  globalThis.ArcadeAudioElements = S;
  (0, eval)(fs.readFileSync(path.join(ROOT, 'soundpack.js'), 'utf8'));
  const pack = globalThis.ArcadeSoundPack;
  globalThis.ArcadeAudioElements = prev.el;
  globalThis.ArcadeSoundPack = prev.pack;
  return { pack, calls };
}

test('the jar clink pitch follows honey.js: paler honey rings higher', () => {
  const { pack, calls } = loadPack();
  const clink = (hive, seed) => {
    calls.length = 0;
    pack.CUES.jar({}, {}, 0, { hive, seed, vseed: 1 }, () => 0.5);
    return calls.find((c) => c.name === 'body').p.f0;
  };
  for (const hive of ['clover', 'apple', 'wildflowers', 'queen', 'sunflower']) {
    for (const seed of [...SEEDS, 0xffffffff]) {
      const want = 1400 + 1600 * lightness(hive, seed);
      assert.ok(near(clink(hive, seed), want, 0.5), `${hive} ${seed}: ${clink(hive, seed)} Hz, want ${want}`);
    }
  }
  assert.ok(clink('clover', 1) > clink('apple', 1) && clink('apple', 1) > clink('queen', 1));
});
