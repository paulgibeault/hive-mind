/* tools/e2e.mjs — drive the real page in headless Chromium.
 *
 *   ./dev.sh ../hive-mind                      (from the launcher repo)
 *   node tools/e2e.mjs [url] [screenshot-dir]
 *
 * Playwright is borrowed from the launcher checkout next door (it is the
 * fleet's only browser-test dependency); set ARCADE_LAUNCHER to point at it.
 * Uses the ?dev=1 handle (window.__hive) to find cells, then plays them
 * through the same pointer paths a player uses.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';

const launcher = process.env.ARCADE_LAUNCHER || path.resolve(import.meta.dirname, '../../paulgibeault.github.io');
const { chromium } = createRequire(path.join(launcher, 'package.json'))('playwright');

const url = process.argv[2] || 'http://127.0.0.1:4791/hive-mind/?dev=1';
const shots = process.argv[3] || null;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const problems = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
const mode = () => page.evaluate(() => window.__hive.mode);
const waitMode = (m) => page.waitForFunction((x) => window.__hive.mode === x, m, { timeout: 8000 });
const H = (fn, arg) => page.evaluate(fn, arg);
const xy = (i) => H((k) => window.__hive.at(k), i);
async function tapCell(i) { const p = await xy(i); await page.mouse.click(p.x, p.y); }
async function holdCell(i) {
  const p = await xy(i);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.waitForTimeout(480); await page.mouse.up();
}
/* The safe hidden cells the solver would open next — play like a careful player. */
const hiddenSafe = () => H(() => { const s = window.__hive.s; return s.cells.map((c, i) => (!s.open[i] && c === 0 ? i : -1)).filter((i) => i >= 0); });
async function clearFrame() {
  for (const i of await hiddenSafe()) {
    if (await H((k) => window.__hive.s.open[k], i)) continue;
    await tapCell(i);
    if ((await mode()) !== 'play') break;
  }
  await waitMode('won');
}

await page.goto(url);
await page.waitForFunction(() => window.__hive);

// v1 data (before the renames: meadow / orchard / wild, wasps and cracks)
// comes across on boot: the run, the record, the stats
await H(() => {
  const { s: { guards, queens, broken, ...rest } } = { s: window.__hive.Core.newGame('apple', 0xabc) };
  const v1 = { ...rest, v: 1, hive: 'orchard', wasps: guards, hornets: queens, cracked: broken, events: [] };
  Arcade.state.set('run', { s: v1, ms: 4000, daily: null });
  Arcade.records.set('time-orchard', { value: 52100, direction: 'lower', format: 'duration-ms', label: 'Orchard — fastest frame' });
  Arcade.stats.update('frames', () => ({ orchard: { played: 3, won: 1 } }));
  Arcade.stats.update('daily', () => ({ '2026-09-01': { ms: 90000, hive: 'orchard' } }));
});
await page.reload();
await page.waitForFunction(() => window.__hive);
assert.deepEqual(await H(() => {
  const run = Arcade.state.get('run');
  return [run.s.v, run.s.hive, run.s.queens, 'hornets' in run.s, Arcade.records.get('time-orchard'),
    Arcade.records.get('time-apple').value, Arcade.stats.get('frames'), Arcade.stats.get('daily')['2026-09-01'].hive];
}), [2, 'apple', 13, false, null, 52100, { apple: { played: 3, won: 1 } }, 'apple']);
assert.equal(await page.textContent('#continue-title'), 'Back to the Apple Orchard frame');
await shot('1-menu');

// menu: three hives, Clover Field first; the daily is on offer
assert.deepEqual(await page.$$eval('#hive button', (b) => b.map((x) => x.childNodes[1].textContent)),
  ['Clover Field', 'Apple Orchard', 'Wildflowers']);
assert.match(await page.textContent('#daily-title'), /^Today: (Clover Field|Apple Orchard|Wildflowers)$/);

// a frame code opens exactly that frame — an old OR- code too, as Apple Orchard
await page.click('#code-box summary');
await page.fill('#code-in', 'or-0000abc');
await page.press('#code-in', 'Enter');
await waitMode('play');
assert.deepEqual(await H(() => [window.__hive.s.hive, window.__hive.s.seed]), ['apple', parseInt('abc', 36)]);
assert.equal(await page.textContent('#hud-code'), 'AP-0000ABC');
await page.waitForTimeout(300);
await shot('2-apple');

// long-press marks: guard, then queen's guard on a second hold
const target = (await hiddenSafe())[0];
await holdCell(target);
assert.equal(await H((i) => window.__hive.s.mark[i], target), 1);
await holdCell(target);
assert.equal(await H((i) => window.__hive.s.mark[i], target), 2);
await tapCell(target);
assert.equal(await H((i) => window.__hive.s.open[i], target), 0, 'a marked cell is protected from a tap');
await holdCell(target);
assert.equal(await H((i) => window.__hive.s.mark[i], target), 0);

// mark mode: taps mark
await page.click('#tool');
await tapCell(target);
assert.equal(await H((i) => window.__hive.s.mark[i], target), 1);
await page.click('#tool');
await holdCell(target); await holdCell(target);

// uncap a safe cell by tap
await tapCell(target);
assert.equal(await H((i) => window.__hive.s.open[i], target), 1);

// pause stops the clock
await page.click('#pause');
assert.equal(await mode(), 'paused');
const t0 = await H(() => window.__hive.elapsed);
await page.waitForTimeout(700);
assert.ok(Math.abs((await H(() => window.__hive.elapsed)) - t0) < 5, 'the clock is stopped while paused');
await page.click('#resume');

// a run survives a reload, and comes back paused
await page.reload();
await page.waitForFunction(() => window.__hive);
assert.equal(await page.isVisible('#continue'), true);
await page.click('#continue');
assert.equal(await mode(), 'paused');
assert.equal(await H((i) => window.__hive.s.open[i], target), 1);
await page.click('#resume');

// clear it: tap every safe cell (skipping ones a flood already opened)
await clearFrame();
await shot('3-won');
assert.equal(await page.textContent('#won-code'), 'AP-0000ABC');
const rec = await H(() => Arcade.records.get('time-apple'));
assert.ok(rec && rec.value > 0 && rec.direction === 'lower');

// a sting from a queen's guard says so
await page.click('#won-menu');
await page.click('#hive button:nth-child(2)');
await page.click('#play');
await waitMode('play');
await tapCell(await H(() => window.__hive.s.cells.indexOf(2)));
await waitMode('lost');
assert.equal(await page.textContent('#lost-title'), "Stung by a queen's guard");
await page.waitForTimeout(500);
await shot('4-stung-queen');

// a sting: new Clover Field frame, uncap a guard
await page.click('#lost-menu');
await page.click('#hive button:nth-child(1)');
await page.click('#play');
await waitMode('play');
const guard = await H(() => window.__hive.s.cells.indexOf(1));
await tapCell(guard);
await waitMode('lost');
assert.equal(await page.textContent('#lost-title'), 'Stung');
await page.waitForTimeout(500);
await shot('4-stung');
assert.equal(await H(() => Arcade.state.get('run')), null, 'a stung frame is not resumable');
const seed = await H(() => window.__hive.s.seed);
await page.click('#retry');
await waitMode('play');
assert.equal(await H(() => window.__hive.s.seed), seed, 'same frame again');

// Wildflowers: broken comb shows up once uncapped
await page.click('#pause'); await page.click('#quit');
await page.click('#hive button:nth-child(3)');
await page.click('#play');
await waitMode('play');
assert.equal(await H(() => window.__hive.s.hive), 'wildflowers');
// open everything safe except a few, so the broken comb is visible in the shot
const safe = await hiddenSafe();
for (const i of safe.slice(0, Math.floor(safe.length * 0.6))) {
  if (await H((k) => window.__hive.s.open[k], i)) continue;
  await tapCell(i);
}
await page.waitForTimeout(300);
await shot('5-wildflowers');

// ── the juice pass: motion never blocks, and motion off rests at once ──
async function codeFrame(code) {
  await page.click('#pause'); await page.click('#quit');
  await H(() => { document.getElementById('code-box').open = true; });
  await page.fill('#code-in', code);
  await page.press('#code-in', 'Enter');
  await waitMode('play');
}
/* The hidden zero whose flood opens the most cells, found on a copy. */
const biggestFlood = () => H(() => {
  const { s, Core } = window.__hive;
  let best = null;
  for (let i = 0; i < s.cells.length; i++) {
    if (s.open[i] || s.cells[i] !== 0 || !Core.floods(s, i)) continue;
    const t = structuredClone({ ...s, events: [] });
    Core.tap(t, i);
    if (!best || t.events[0].cells.length > best.cells.length) best = { i, cells: t.events[0].cells };
  }
  return best;
});
const FLOOD_CODE = 'CL-000000I';   // a 39-cell flood, 13 rings deep
await codeFrame(FLOOD_CODE);
const flood = await biggestFlood();
assert.ok(flood && flood.cells.length > 20, 'a frame with a real flood in it');

// a flood: core opens every cell at once, and the drawing ripples out after
await tapCell(flood.i);
const mid = await H((cells) => {
  const { s, view } = window.__hive, now = performance.now();
  const starts = cells.map((c) => view.anims.get(c));
  return {
    open: cells.every((c) => s.open[c] === 1),
    pending: cells.filter((c, k) => starts[k] > now + 20),     // still drawn capped
    end: Math.max(...starts) + 180,
    outside: s.cells.findIndex((c, i) => c === 0 && !s.open[i] && !s.mark[i]),
    moves: s.moves,
  };
}, flood.cells);
assert.ok(mid.open, 'core opened the whole flood at once');
assert.ok(mid.pending.length > 0, 'while the ripple is still drawing it');
// a tap on a cell the ripple hasn't reached is a tap on an open cell: it doesn't uncap it again
await tapCell(mid.pending[mid.pending.length - 1]);
// and a second tap elsewhere lands at once, mid-ripple
await tapCell(mid.outside);
const late = await H(([o, end]) => {
  const { s } = window.__hive;
  return { o: s.open[o], during: performance.now() < end, moves: s.moves, mode: window.__hive.mode };
}, [mid.outside, mid.end]);
assert.ok(late.during, 'the second tap came while the ripple was still running');
assert.equal(late.o, 1, 'the second tap uncapped its cell');
assert.equal(late.moves, mid.moves + 1, 'only the second tap was a move; the drawn-capped cell was already open');
await page.waitForTimeout(700);
assert.equal(await H(() => window.__hive.running), false, 'the loop rests once the ripple is drawn');

// a hold: input exposes the press's progress, the renderer draws the ring
const capped = await H(() => window.__hive.s.open.findIndex((o, i) => !o && !window.__hive.s.mark[i]));
{
  const p = await xy(capped);
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.waitForTimeout(200);
  const hold = await H(() => window.__hive.view.hold);
  assert.equal(hold.cell, capped);
  assert.ok(hold.t > 0.3 && hold.t < 1, `hold progress ${hold.t}`);
  await page.waitForTimeout(280); await page.mouse.up();
  assert.equal(await H((i) => window.__hive.s.mark[i], capped), 1);
  assert.equal(await H(() => window.__hive.view.hold), null, 'the ring goes once the mark is in');
  await holdCell(capped);   // and back off
}

// a sweep that can't fire: the number is told, nothing moves in core
const live = await H(() => {
  const { s, Core } = window.__hive, nbrs = Core.nbrsOf(s.cols, s.rows);
  return s.open.findIndex((o, i) => o && s.shown[i] > 0 && nbrs[i].some((j) => !s.open[j] && !s.mark[j]));
});
{
  const before = await H(() => window.__hive.s.moves);
  await tapCell(live);
  assert.equal(await H(() => window.__hive.view.refusal && window.__hive.view.refusal.cell), live);
  assert.equal(await H(() => window.__hive.s.moves), before);
}

// a sweep that fires: mark the number's guards through the pointer, tap it,
// and the light runs round it while its other neighbours open
const sweepable = await H(() => {
  const { s, Core } = window.__hive, nbrs = Core.nbrsOf(s.cols, s.rows);
  return s.open.findIndex((o, i) => o && s.shown[i] > 0
    && nbrs[i].some((j) => !s.open[j] && s.cells[j] === 0) && nbrs[i].every((j) => !s.mark[j]));
});
{
  const guards = await H((i) => {
    const { s, Core } = window.__hive;
    return Core.nbrsOf(s.cols, s.rows)[i].filter((j) => s.cells[j] !== 0);
  }, sweepable);
  for (const g of guards) await holdCell(g);
  await tapCell(sweepable);
  const sw = await H((i) => {
    const { s, view, Core } = window.__hive;
    return { cell: view.sweep && view.sweep.cell, order: view.sweep && view.sweep.order.length,
      done: Core.nbrsOf(s.cols, s.rows)[i].every((j) => s.open[j] || s.mark[j]) };
  }, sweepable);
  assert.equal(sw.cell, sweepable);
  assert.ok(sw.order >= 2 && sw.done, 'the sweep opened every unmarked neighbour at once');
}

// motion off (reduced motion, power saver): every moment is its still, and
// the loop sleeps as soon as it's drawn
await codeFrame(FLOOD_CODE);
await H(() => { window.__hive.view.motion = false; });
await page.waitForTimeout(100);
{
  const f0 = await H(() => window.__hive.frames);
  await tapCell(flood.i);
  await page.waitForTimeout(150);
  const st = await H(() => ({ anims: window.__hive.view.anims.size, running: window.__hive.running, frames: window.__hive.frames }));
  assert.equal(st.anims, 0, 'no ripple: the flood is drawn all at once');
  assert.equal(st.running, false, 'and the loop is asleep');
  assert.ok(st.frames - f0 <= 4, `a still flood costs a frame or two, not an animation (${st.frames - f0})`);
  // a refused sweep's still is an outline for a moment: one wake, then rest
  const n = await H(() => {
    const { s, Core } = window.__hive, nbrs = Core.nbrsOf(s.cols, s.rows);
    return s.open.findIndex((o, i) => o && s.shown[i] > 0 && nbrs[i].some((j) => !s.open[j] && !s.mark[j]));
  });
  await tapCell(n);
  await page.waitForTimeout(50);
  assert.ok(Number.isFinite(await H(() => window.__hive.view.wakeAt)), 'the outline asks for one more frame');
  await page.waitForTimeout(300);
  assert.deepEqual(await H(() => [window.__hive.view.refusal, window.__hive.running]), [null, false]);
}
await H(() => { window.__hive.view.motion = true; });

// every hive plays out: a real frame cleared on each, and each records its time
for (let k = 1; k <= 3; k++) {
  await page.click('#pause'); await page.click('#quit');
  await page.click(`#hive button:nth-child(${k})`);
  await page.click('#play');
  await waitMode('play');
  const id = await H(() => window.__hive.s.hive);
  assert.equal(id, await H((n) => window.__hive.Core.HIVES[n].id, k - 1));
  await clearFrame();
  const r = await H((c) => Arcade.records.get(c), `time-${id}`);
  assert.ok(r && r.value > 0, `time-${id}`);
  await shot(`6-won-${id}`);
  await page.click('#again');
  await waitMode('play');
}

// the daily: today's frame, and it records
await page.click('#pause'); await page.click('#quit');
await page.click('#daily');
await waitMode('play');
const t = await H(() => window.__hive.today());
assert.deepEqual(await H(() => [window.__hive.s.hive, window.__hive.s.seed]), [t.hive, t.seed]);
await clearFrame();
await page.click('#won-menu');
assert.match(await page.textContent('#daily-title'), /cleared$/);
await shot('7-menu-after-daily');

// landscape
await page.click('#play');
await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForTimeout(300);
await shot('8-landscape');

await browser.close();
assert.deepEqual(problems, [], 'console must stay clean');
console.log('e2e: ok');
