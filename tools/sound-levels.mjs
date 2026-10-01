/* tools/sound-levels.mjs — how loud each cue is next to `won` (#06's tables).
 *
 *   node tools/sound-levels.mjs
 *
 * Renders every cue on its own, in the room it plays in, through the
 * launcher's own arcade-audio.js in headless Chromium's OfflineAudioContext —
 * many plays each (every variant, many seeds, all three hives) — and reports
 * the loudest 50 ms of each play (short-term RMS) and its peak, averaged in
 * energy, relative to `won`. The target is the issue's table, ±3 dB.
 * Playwright and arcade-audio.js come from the launcher checkout next door;
 * set ARCADE_LAUNCHER to point elsewhere.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const launcher = process.env.ARCADE_LAUNCHER || path.resolve(ROOT, '../paulgibeault.github.io');
const { chromium } = createRequire(path.join(launcher, 'package.json'))('playwright');

// dB relative to won, from the issue
export const TARGETS = {
  won: 0, pour: -4, sting: -6, jar: -8, smoke: -10, flood: -12, hint: -12,
  clean: -14, nope: -16, uncap: -18, mark: -20, unmark: -20,
};
// what a typical play of each cue is handed
const PARAMS = {
  uncap: { cells: 1 }, flood: { cells: 12 }, mark: { kind: 1 }, unmark: { kind: 0 }, sting: { kind: 1 },
  hint: { kind: 1 }, smoke: { kind: 1 }, pour: { cells: 15 }, jar: {},
};

const browser = await chromium.launch();
const page = await browser.newPage();
await page.evaluate((src) => { (0, eval)(src); }, fs.readFileSync(path.join(launcher, 'arcade-audio.js'), 'utf8'));
await page.evaluate((src) => { (0, eval)(src); }, fs.readFileSync(path.join(ROOT, 'soundpack.js'), 'utf8'));

const rows = await page.evaluate(async ({ TARGETS, PARAMS }) => {
  const S = globalThis.ArcadeAudioElements;
  const P = globalThis.ArcadeSoundPack;
  const SR = 48000, LEAD = 0.3, SPAN = 2.4, WIN = Math.round(0.05 * SR);
  const out = {};
  for (const name of Object.keys(TARGETS)) {
    let eRms = 0, ePeak = 0, n = 0;
    for (const hive of ['clover', 'apple', 'wildflowers', 'sunflower']) {
      for (let k = 0; k < 8; k++) {
        const ctx = new OfflineAudioContext(2, Math.ceil((LEAD + SPAN) * SR), SR);
        const bus = S.createBus(ctx, ctx.destination, P.ROOM);
        const params = { hive, seed: 11 + k, progress: k / 8, step: k % 6, variant: k % 4, vseed: 500 + k * 37, ...PARAMS[name] };
        P.CUES[name](ctx, S.out(bus, P.SENDS[name]), LEAD, params, S.rng(k + 1));
        const buf = await ctx.startRendering();
        const L = buf.getChannelData(0), R = buf.getChannelData(1);
        let peak = 0, best = 0, acc = 0;
        const sq = (i) => (L[i] * L[i] + R[i] * R[i]) / 2;
        for (let i = 0; i < buf.length; i++) {
          peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
          acc += sq(i);
          if (i >= WIN) acc -= sq(i - WIN);
          if (i >= WIN - 1) best = Math.max(best, acc / WIN);
        }
        eRms += best; ePeak += peak * peak; n++;
      }
    }
    out[name] = { rms: 10 * Math.log10(eRms / n), peak: 10 * Math.log10(ePeak / n) };
  }
  return out;
}, { TARGETS, PARAMS });
await browser.close();

const ref = rows.won;
let bad = 0;
console.log('cue       target   rms50ms  (abs dBFS)   peak     off');
for (const [name, want] of Object.entries(TARGETS)) {
  const r = rows[name];
  const rel = r.rms - ref.rms, pk = r.peak - ref.peak, off = rel - want;
  const ok = Math.abs(off) <= 3;
  if (!ok) bad++;
  const f = (x) => (x >= 0 ? '+' : '') + x.toFixed(1);
  console.log(`${name.padEnd(9)} ${f(want).padStart(6)}   ${f(rel).padStart(6)}  (${r.rms.toFixed(1).padStart(6)})   ${f(pk).padStart(6)}  ${f(off).padStart(5)} ${ok ? 'ok' : '<-- off'}`);
}
process.exitCode = bad ? 1 : 0;
