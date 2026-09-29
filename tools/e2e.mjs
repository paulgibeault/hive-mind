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

await page.goto(url);
await page.waitForFunction(() => window.__hive);
await shot('1-menu');

// menu: three hives, meadow first; the daily is on offer
assert.equal(await page.$$eval('#hive button', (b) => b.length), 3);
assert.match(await page.textContent('#daily-title'), /^Today: (Meadow|Orchard|Wild)$/);

// a frame code opens exactly that frame
await page.click('#code-box summary');
await page.fill('#code-in', 'or-0000abc');
await page.press('#code-in', 'Enter');
await waitMode('play');
assert.deepEqual(await H(() => [window.__hive.s.hive, window.__hive.s.seed]), ['orchard', parseInt('abc', 36)]);
assert.equal(await page.textContent('#hud-code'), 'OR-0000ABC');
await page.waitForTimeout(300);
await shot('2-orchard');

// long-press marks: wasp, then hornet on a second hold
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
for (const i of await hiddenSafe()) {
  if (await H((k) => window.__hive.s.open[k], i)) continue;
  await tapCell(i);
  if ((await mode()) !== 'play') break;
}
await waitMode('won');
await shot('3-won');
assert.equal(await page.textContent('#won-code'), 'OR-0000ABC');
const rec = await H(() => Arcade.records.get('time-orchard'));
assert.ok(rec && rec.value > 0 && rec.direction === 'lower');

// a sting: new meadow frame, uncap a wasp
await page.click('#won-menu');
await page.click('#hive button:nth-child(1)');
await page.click('#play');
await waitMode('play');
const wasp = await H(() => window.__hive.s.cells.indexOf(1));
await tapCell(wasp);
await waitMode('lost');
await page.waitForTimeout(500);
await shot('4-stung');
assert.equal(await H(() => Arcade.state.get('run')), null, 'a stung frame is not resumable');
const seed = await H(() => window.__hive.s.seed);
await page.click('#retry');
await waitMode('play');
assert.equal(await H(() => window.__hive.s.seed), seed, 'same frame again');

// wild: the cracked cells show up
await page.click('#pause'); await page.click('#quit');
await page.click('#hive button:nth-child(3)');
await page.click('#play');
await waitMode('play');
// open everything safe except a few, so the cracks are visible in the shot
const safe = await hiddenSafe();
for (const i of safe.slice(0, Math.floor(safe.length * 0.6))) {
  if (await H((k) => window.__hive.s.open[k], i)) continue;
  await tapCell(i);
}
await page.waitForTimeout(300);
await shot('5-wild');

// the daily: today's frame, and it records
await page.click('#pause'); await page.click('#quit');
await page.click('#daily');
await waitMode('play');
const t = await H(() => window.__hive.today());
assert.deepEqual(await H(() => [window.__hive.s.hive, window.__hive.s.seed]), [t.hive, t.seed]);
for (const i of await hiddenSafe()) {
  if (await H((k) => window.__hive.s.open[k], i)) continue;
  await tapCell(i);
  if ((await mode()) !== 'play') break;
}
await waitMode('won');
await page.click('#won-menu');
assert.match(await page.textContent('#daily-title'), /cleared$/);
await shot('6-menu-after-daily');

// landscape
await page.click('#play');
await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForTimeout(300);
await shot('7-landscape');

await browser.close();
assert.deepEqual(problems, [], 'console must stay clean');
console.log('e2e: ok');
