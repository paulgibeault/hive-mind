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
/* Play like the solver: only ever uncap a cell the clues on screen prove. */
const provenSafe = () => H(() => { const h = window.__hive; return [...h.Core.provenNow(h.s).safe]; });
async function solverClear() {
  while ((await mode()) === 'play') {
    const [i] = await provenSafe();
    assert.ok(i !== undefined, 'something is always provable');
    await tapCell(i);
  }
  await waitMode('won');
}
const railReads = () => page.textContent('#hud-reads');
/* The sting lesson's rings sit clear of the stung sheet and the rail (#04). */
const ringsClear = () => H(() => {
  const h = window.__hive, r = h.layout.r * 0.9;
  const sheet = document.getElementById('lost'), rail = document.getElementById('rail');
  const top = sheet.classList.contains('top') ? sheet.offsetTop + sheet.offsetHeight : rail.offsetTop + rail.offsetHeight;
  const bottom = sheet.classList.contains('top') ? innerHeight : sheet.offsetTop;
  return h.view.rings.length > 0 && h.view.rings.every((g) => {
    const { y } = h.at(g.i);
    return y - r >= top - 1 && y + r <= bottom + 1;
  });
});

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
}), [3, 'apple', 13, false, null, 52100, { apple: { played: 3, won: 1 } }, 'apple']);
assert.equal(await page.textContent('#continue-title'), 'Back to the Apple Orchard frame');
// the pantry (#09) is new: an old save has none, and nothing is made up from its frame counts
assert.deepEqual(await H(() => Arcade.stats.get('pantry') || {}), {});
assert.equal(await page.textContent('#pantry-sum'), 'empty');
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
assert.equal(await page.textContent('#paused-code'), 'AP-0000ABC');   // the code lives on the pause sheet
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

// a run survives a reload, and comes back paused, its clean reads intact
const readsBefore = await H(() => window.__hive.reads);
const railBefore = await railReads();
assert.equal(readsBefore.clean + readsBefore.lucky, 1, 'the uncap was read as clean or lucky');
await page.reload();
await page.waitForFunction(() => window.__hive);
assert.equal(await page.isVisible('#continue'), true);
await page.click('#continue');
assert.equal(await mode(), 'paused');
assert.equal(await H((i) => window.__hive.s.open[i], target), 1);
assert.deepEqual(await H(() => window.__hive.reads), readsBefore, 'the counters came back with the run');
assert.equal(await railReads(), railBefore);
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

// a sting: new Clover Field frame, uncap a guard nothing proved — a guess,
// and the lesson says so and shows a cell that was safe (#04)
await page.click('#lost-menu');
await page.click('#hive button:nth-child(1)');
await page.click('#play');
await waitMode('play');
const [guard, safeBefore] = await H(() => {
  const h = window.__hive, p = h.Core.provenNow(h.s);
  return [h.s.cells.findIndex((c, i) => c === 1 && !p.guard.has(i)), [...p.safe]];
});
await tapCell(guard);
await waitMode('lost');
assert.equal(await page.textContent('#lost-title'), 'Stung');
assert.equal(await H(() => window.__hive.lesson.kind), 'guess');
assert.equal(await page.textContent('#lesson-text'), 'That was a guess, and nothing proved it either way. This cell was safe to open:');
assert.equal(await H(() => window.__hive.lesson.safeHint), safeBefore[0], 'the first cell provenNow called safe');
assert.deepEqual(await H(() => window.__hive.view.rings), [{ i: safeBefore[0], color: 'safe' }, { i: guard, color: 'red' }]);
await page.waitForTimeout(500);
assert.ok(await ringsClear(), 'the sheet does not cover the rings');
await shot('4-stung');
// with a puff left, the stung run is kept for the smoker (#08), lesson and all
assert.deepEqual(await H(() => { const r = Arcade.state.get('run'); return [r.s.phase, r.s.stung, r.s.puffs, r.lesson.kind]; }),
  ['lost', guard, 1, 'guess']);
assert.equal(await page.isVisible('#puff'), true);
assert.equal(await page.textContent('#puff'), 'Puff the smoker · +20 s · 1 left');
assert.equal(await page.getAttribute('#retry', 'class'), 'ghost', 'the smoker is the primary');
// and while it can be calmed, the stung board shows only the guard that stung
assert.equal(await H(() => {
  const h = window.__hive, { x, y } = h.at(h.s.cells.findIndex((c, i) => c === 1 && i !== h.s.stung));
  const cv = document.getElementById('view'), d = cv.width / cv.clientWidth;
  const px = cv.getContext('2d').getImageData(Math.round(x * d), Math.round((y - h.layout.r * 0.5) * d), 1, 1).data;
  return px[0] > 180 && px[1] > 110;      // honey wax, not dark open comb
}), true, 'other guards stay capped');
const seed = await H(() => window.__hive.s.seed);
await page.click('#retry');
await waitMode('play');
assert.equal(await H(() => window.__hive.s.seed), seed, 'same frame again');
assert.deepEqual(await H(() => [window.__hive.view.rings.length, window.__hive.view.dy]), [0, 0], 'the rings go with the sheet');

// a sweep over a wrong mark: mark a safe cell in place of a guard around a
// low number, sweep it, and the lesson rings the number (#04). Played down
// into the bottom third first, under where the sheet docks, so the frame
// has to make room for the rings.
const lowOne = () => H(() => {
  const { s, Core } = window.__hive, nb = Core.nbrsOf(s.cols, s.rows);
  for (let c = s.open.length - 1; c >= s.cols * Math.ceil(s.rows * 2 / 3); c--) {
    if (!s.open[c] || s.shown[c] !== 1) continue;
    const safe = nb[c].find((j) => !s.open[j] && s.cells[j] === 0);
    if (safe !== undefined) return { c, safe };
  }
  return null;
});
let wrong = await lowOne();
for (let k = 0; k < 60 && !wrong; k++) { await tapCell((await provenSafe())[0]); wrong = await lowOne(); }
assert.ok(wrong, 'a 1 in the bottom third with a capped safe neighbour');
await holdCell(wrong.safe);
await tapCell(wrong.c);
await waitMode('lost');
assert.equal(await H(() => window.__hive.lesson.kind), 'wrong-mark');
assert.equal(await page.textContent('#lesson-text'), 'A mark was on a safe cell, so the sweep trusted it.');
assert.deepEqual(await H(() => window.__hive.view.rings),
  [{ i: wrong.c, color: 'honey' }, { i: await H(() => window.__hive.s.stung), color: 'red' }]);
assert.equal(await H((i) => window.__hive.s.mark[i], wrong.safe), 1, 'the wrong mark stays, and gets its ✕');
await page.waitForTimeout(500);
assert.ok(await ringsClear(), 'the sheet does not cover the rings');
await shot('4-stung-wrong-mark');

// the pinned example (Clover Field seed 7, the canvas's mid-game state):
// tapping 49 is the proven-guard case, ringed by [48] — and with reduced
// motion the rings are simply there, no fade
// (leave the stung sheet by Menu first: a stung run with a puff left is
// kept, and the reload's suspend would write it over the one set below)
await page.click('#lost-menu');
assert.equal(await H(() => Arcade.state.get('run')), null, 'Menu lets the stung run go');
await page.emulateMedia({ reducedMotion: 'reduce' });
await H(() => {
  const PLAY_PROPOSED = 'cccwwcccwccwwcccwcccwccccccccccwwwcwccwc3cwcccwc1m22wccc11011ccc110001mcw10001cccc11001mccw101ccccm201w1cc100110cm100000';
  const s = window.__hive.Core.newGame('clover', 7);
  [...PLAY_PROPOSED].forEach((ch, i) => { if (/\d/.test(ch)) s.open[i] = 1; if (ch === 'm') s.mark[i] = 1; });
  Arcade.state.set('run', { s, ms: 83000, daily: null, reads: { clean: 14, lucky: 0, hints: 0, puffs: 0 } });
});
await page.reload();
await page.waitForFunction(() => window.__hive);
await page.click('#continue');
await page.click('#resume');
await waitMode('play');
assert.equal(await railReads(), '14 clean · pure');
assert.equal(await H(() => window.__hive.view.motion), false);
await holdCell(49);                               // lift the canvas's mark, then tap it anyway
assert.equal(await H(() => window.__hive.s.mark[49]), 0);
await tapCell(49);
await waitMode('lost');
await page.waitForTimeout(60);                    // one frame or so
assert.deepEqual(await H(() => [window.__hive.lesson.kind, window.__hive.lesson.clues]), ['proven-guard', [48]]);
assert.equal(await page.textContent('#lesson-text'), 'This 1 had just one capped neighbour, the cell you uncapped.');
assert.deepEqual(await H(() => window.__hive.view.rings), [{ i: 48, color: 'honey' }, { i: 49, color: 'red' }]);
// the honey outline is drawn at full strength straight away
const ringPx = await H(() => {
  const h = window.__hive, { x, y } = h.at(48), r = h.layout.r, cv = document.getElementById('view');
  const d = cv.width / cv.clientWidth, k = r * 0.94 - 1.25;
  const px = cv.getContext('2d').getImageData(Math.round((x - k * Math.cos(Math.PI / 6)) * d), Math.round(y * d), 1, 1).data;
  return [...px];
});
assert.ok(ringPx[0] > 200 && ringPx[1] > 140 && ringPx[2] < 120, `honey ring at full strength, got ${ringPx}`);
assert.ok(await ringsClear(), 'the sheet does not cover the rings');
await shot('4-stung-proven-guard');
await page.emulateMedia({ reducedMotion: null });
// the game reads the setting at boot; put motion back for the blocks after
// this one (the juice pass's ripple checks need it on)
await H(() => { window.__hive.view.motion = true; });
await page.click('#retry');
await waitMode('play');

// ── the bee-line hint (#07) ──
// The pinned example again: the canvas state, resumed. A tap on the open 0
// under the two 1s changes nothing but says where the player is looking.
await page.click('#pause'); await page.click('#quit');   // so the reload doesn't save over it
await H(() => {
  const PLAY_PROPOSED = 'cccwwcccwccwwcccwcccwccccccccccwwwcwccwc3cwcccwc1m22wccc11011ccc110001mcw10001cccc11001mccw101ccccm201w1cc100110cm100000';
  const s = window.__hive.Core.newGame('clover', 7);
  [...PLAY_PROPOSED].forEach((ch, i) => { if (/\d/.test(ch)) s.open[i] = 1; if (ch === 'm') s.mark[i] = 1; });
  Arcade.state.set('run', { s, ms: 83000, daily: null, reads: { clean: 14, lucky: 0, hints: 0, puffs: 0 } });
});
await page.reload();
await page.waitForFunction(() => window.__hive);
await page.click('#continue');
await page.click('#resume');
await waitMode('play');
assert.equal(await H(() => window.__hive.view.motion), true, 'motion is back on after the reload');
const hintsBefore = await H(() => (Arcade.stats.get('hints') || {}).clover || 0);
const moves0 = await H(() => window.__hive.s.moves);
await tapCell(100);
assert.deepEqual(await H(() => [window.__hive.s.moves, window.__hive.lastTap]), [moves0, 100]);
// step 1, from the H key: look here — the clues ringed, no target yet, and
// the cost paid and said up front
const t1 = await H(() => window.__hive.elapsed);
await page.keyboard.press('h');
assert.equal(await H(() => window.__hive.hint.step), 'look');
assert.deepEqual(await H(() => window.__hive.view.rings), [{ i: 93, color: 'honey' }, { i: 101, color: 'honey' }]);
assert.deepEqual(await H(() => window.__hive.view.ghosts), []);
assert.equal(await page.isVisible('#hint'), true);
assert.equal(await page.textContent('#hint-text'), 'Look at these numbers together.');
assert.equal(await page.textContent('#hint .hint-cost'), '+10 s · no Pure seal');
assert.equal(await page.getAttribute('#hint-btn', 'aria-label'), 'Bee-line hint');
assert.equal(await page.getAttribute('#hint-btn', 'aria-expanded'), 'true');
assert.ok((await H(() => window.__hive.elapsed)) - t1 >= 10000, 'the clock jumped 10 s');
assert.equal(await railReads(), '14 clean · assisted');
assert.equal(await H(() => window.__hive.reads.hints), 1);
assert.equal(await H(() => (Arcade.stats.get('hints') || {}).clover), hintsBefore + 1, 'Arcade.stats counts hints per hive');
// saved with the cost paid, never with the hint open
assert.deepEqual(await H(() => { const r = Arcade.state.get('run'); return [Object.keys(r).sort(), r.reads.hints, r.ms >= 93000]; }),
  [['daily', 'lesson', 'ms', 'reads', 's', 'tl'], 1, true]);   // tl: the run's pace (#11)
await page.waitForTimeout(500);
assert.ok(await H(() => {
  const h = window.__hive, r = h.layout.r * 0.9, sheet = document.getElementById('hint'), rail = document.getElementById('rail');
  const top = sheet.classList.contains('top') ? sheet.offsetTop + sheet.offsetHeight : rail.offsetTop + rail.offsetHeight;
  const bottom = sheet.classList.contains('top') ? innerHeight : sheet.offsetTop;
  return h.view.rings.every((g) => h.at(g.i).y - r >= top - 1 && h.at(g.i).y + r <= bottom + 1);
}), 'the hint card does not cover its rings');
await shot('13-hint-look');
// step 2, from the button: why — 94 lit, the implied guard at 102 dashed
await page.click('#hint-why');
assert.equal(await H(() => window.__hive.hint.step), 'why');
assert.deepEqual(await H(() => window.__hive.view.rings),
  [{ i: 93, color: 'honey' }, { i: 101, color: 'honey' }, { i: 94, color: 'lit' }]);
assert.deepEqual(await H(() => window.__hive.view.ghosts), [{ i: 102, kind: 1 }]);
assert.equal(await page.textContent('#hint-text'),
  "The lower 1 has one capped neighbour, so that's its guard (dashed). The same guard fills the upper 1, so the lit cell is safe.");
assert.equal(await page.isVisible('#hint-why'), false);
await page.waitForTimeout(400);
await shot('14-hint-why');
// Esc closes the hint before it pauses; a second Esc pauses
await page.keyboard.press('Escape');
assert.deepEqual(await H(() => [window.__hive.mode, window.__hive.hint, window.__hive.view.rings.length]), ['play', null, 0]);
assert.equal(await page.isVisible('#hint'), false);
await page.keyboard.press('Escape');
assert.equal(await mode(), 'paused');
await page.click('#resume');
// H goes off → look → why → off
await page.keyboard.press('h'); await page.keyboard.press('h');
assert.equal(await H(() => window.__hive.hint.step), 'why');
await page.keyboard.press('h');
assert.equal(await H(() => window.__hive.hint), null);
// a reload mid-hint clears it (the cost stays paid)
await page.keyboard.press('h');
assert.equal(await H(() => window.__hive.reads.hints), 3);
await page.reload();
await page.waitForFunction(() => window.__hive);
await page.click('#continue');
await page.click('#resume');
await waitMode('play');
assert.deepEqual(await H(() => [window.__hive.hint, window.__hive.view.rings.length, window.__hive.reads.hints]), [null, 0, 3]);
// any tap on the frame closes the hint, and still lands
await page.keyboard.press('h');
const lit = await H(() => window.__hive.hint.pick.target);
await tapCell(lit);
assert.deepEqual(await H((i) => [window.__hive.hint, window.__hive.s.open[i], window.__hive.view.dy], lit), [null, 1, 0]);
// "Got it" closes it too
await page.click('#hint-btn');
await page.click('#hint-done');
assert.equal(await H(() => window.__hive.hint), null);
// the won sheet says what the hints cost, and there's no seal
await solverClear();
assert.equal(await page.isVisible('#won-pure'), false);
assert.match(await page.textContent('#won-reads'), / · 5 hints · /);
assert.equal(await page.textContent('#won-help'), '5 bee-line hints · +50 s · no Pure seal');
assert.ok((await H(() => window.__hive.elapsed)) >= 83000 + 50000, 'the clock carries the penalty');
await page.waitForTimeout(400);
await shot('15-won-hints');
await page.click('#again');
await waitMode('play');

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
  assert.equal(id, await H((n) => window.__hive.Core.PICKABLE[n].id, k - 1));
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
assert.equal(typeof (await H((d) => Arcade.stats.get('daily')[d].pure, t.date)), 'boolean', 'the daily log says whether it was Pure');
await shot('7-menu-after-daily');

// clean reads (#03): a solver-driven clear is Pure — its own record and count
await page.click('#hive button:nth-child(1)');
const pureBefore = await H(() => (Arcade.stats.get('frames').clover || {}).pure || 0);
await page.click('#play');
await waitMode('play');
assert.equal(await railReads(), '0 clean · pure');
for (let k = 0; k < 6; k++) await tapCell((await provenSafe())[0]);
assert.equal(await railReads(), '6 clean · pure');
await page.waitForTimeout(300);
await shot('9-rail-pure');
await solverClear();
const pureReads = await H(() => window.__hive.reads);
assert.equal(pureReads.lucky, 0);
assert.equal(await page.isVisible('#won-pure'), true, 'the Pure seal');
assert.equal(await page.textContent('#won-reads'), `${pureReads.clean} of ${pureReads.clean} clean · 0 hints · 0 puffs`);
const pureRec = await H(() => Arcade.records.get('pure-time-clover'));
assert.ok(pureRec && pureRec.value > 0 && pureRec.direction === 'lower' && pureRec.format === 'duration-ms');
assert.equal(await H(() => Arcade.stats.get('frames').clover.pure), pureBefore + 1);
// the won sheet's jar (#09): this frame's honey, numbered, with its seal
assert.match(await page.textContent('#won-note'), /^Pure · jar \d+ · clover honey$/);
assert.deepEqual(await H(() => {
  const j = document.querySelector('#won-jar .jar');
  return [j.style.getPropertyValue('--top'), j.style.getPropertyValue('--bottom')];
}), await H(() => { const { s } = window.__hive, c = window.__hive.honeyColour(s.hive, s.seed); return [c.top, c.bottom]; }));
await page.waitForTimeout(1300);
await shot('10-won-pure');

// ...and one forced random uncap on the way costs the seal, quietly
await page.click('#again');
await waitMode('play');
const lucky = await H(() => {
  const h = window.__hive, s = h.s, p = h.Core.provenNow(s);
  return s.cells.findIndex((c, i) => c === 0 && !s.open[i] && !p.safe.has(i));
});
await tapCell(lucky);
assert.equal(await mode(), 'play');
assert.match(await railReads(), /^\d+ clean · assisted$/);
await page.waitForTimeout(300);
await shot('11-rail-assisted');
await solverClear();
assert.equal((await H(() => window.__hive.reads)).lucky, 1);
assert.equal(await page.isVisible('#won-pure'), false, 'no seal');
assert.match(await page.textContent('#won-reads'), /^\d+ of \d+ clean · 0 hints · 0 puffs$/);
assert.equal(await H(() => Arcade.stats.get('frames').clover.pure), pureBefore + 1, 'not counted as Pure');
await page.waitForTimeout(400);
await shot('12-won-assisted');
await page.click('#won-menu');

// ── the smoker (#08): sting → reload → puff → continue → win ──────────
// On today's daily (dailies allow it), with its records cleared so a smoked
// clear is the one to set them.
await H(() => { window.__hive.view.motion = true; });
const sm = await H(() => window.__hive.today());
const pureCount = () => H((id) => ((Arcade.stats.get('frames') || {})[id] || {}).pure || 0, sm.hive);
await H((t) => {
  Arcade.stats.update('daily', (log) => { const next = { ...log }; delete next[t.date]; return next; });
  Arcade.records.clear(`time-${t.hive}`);
  Arcade.records.clear(`pure-time-${t.hive}`);
}, sm);
const smPure = await pureCount();
await page.click('#daily');
await waitMode('play');
for (let k = 0; k < 3; k++) await tapCell((await provenSafe())[0]);
const smGuard = await H(() => {
  const h = window.__hive, p = h.Core.provenNow(h.s);
  return h.s.cells.findIndex((c, i) => c !== 0 && !p.guard.has(i) && !h.s.mark[i]);
});
await tapCell(smGuard);
await waitMode('lost');
const stungMs = await H(() => window.__hive.elapsed);
const lessonText = await page.textContent('#lesson-text');
assert.equal(await page.isVisible('#puff'), true);
await page.waitForTimeout(500);
await shot('13-stung-smoker');
// reload between the sting and the puff: the stung run comes back to its sheet
await page.reload();
await page.waitForFunction(() => window.__hive);
assert.equal(await page.isVisible('#continue'), true, 'a stung run with a puff left is resumable');
assert.match(await page.textContent('#continue-note'), /^Stung · \d+:\d\d$/);
await page.click('#continue');
assert.equal(await mode(), 'lost');
assert.equal(await H(() => window.__hive.s.stung), smGuard);
assert.equal(await page.textContent('#puff'), 'Puff the smoker · +20 s · 1 left');
assert.equal(await page.textContent('#lesson-text'), lessonText, 'the lesson came back with it');
assert.ok((await H(() => window.__hive.view.rings.length)) > 0, 'and its rings');
assert.ok(Math.abs((await H(() => window.__hive.elapsed)) - stungMs) < 50, 'the clock held');
// puff: the guard is calmed, capped and marked; +20 s; Pure is gone
await H(() => { window.__hive.view.motion = true; });
await page.click('#puff');
await waitMode('play');
assert.deepEqual(await H((g) => {
  const h = window.__hive;
  return [h.s.open[g], h.s.mark[g], h.s.puffs, h.s.stung, h.reads.puffs, h.view.rings.length, h.view.smoke && h.view.smoke.cell];
}, smGuard), [0, (await H((g) => window.__hive.s.cells[g], smGuard)), 0, -1, 1, 0, smGuard]);
assert.ok((await H(() => window.__hive.elapsed)) >= stungMs + 20000, '+20 s on the clock');
assert.match(await railReads(), /assisted$/);
await page.waitForTimeout(250);
await shot('14-smoke');
assert.deepEqual(await H(() => { const r = Arcade.state.get('run'); return [r.s.phase, r.s.puffs, r.reads.puffs, r.lesson]; }),
  ['play', 0, 1, null], 'the calmed run is saved as a run in play');
await page.waitForTimeout(1200);
assert.deepEqual(await H(() => [window.__hive.view.smoke, window.__hive.running]), [null, false], 'the haze clears and the loop rests');
await clearFrame();
const smMs = await H(() => window.__hive.elapsed);
assert.equal(await page.isVisible('#won-pure'), false, 'no seal after smoke');
assert.match(await page.textContent('#won-reads'), / · 1 puff$/);
const smRec = await H((id) => Arcade.records.get(`time-${id}`), sm.hive);
assert.ok(smRec && smRec.value >= 20000 && Math.abs(smRec.value - smMs) < 50, 'a smoked clear sets time-<hive>, penalty included');
assert.equal(await H((id) => Arcade.records.get(`pure-time-${id}`), sm.hive), null, 'but never pure-time-<hive>');
assert.equal(await pureCount(), smPure, 'and is not counted Pure');
assert.equal(await H((d) => Arcade.stats.get('daily')[d].pure, sm.date), false, 'the daily records pure: false');
await page.waitForTimeout(400);
await shot('15-won-smoked');

// with the puff spent, a second sting is the end: no smoker, run dropped
await page.click('#again');
await waitMode('play');
await tapCell(await H(() => window.__hive.s.cells.indexOf(1)));
await waitMode('lost');
// motion off, the smoke is a still: one held haze, one wake, then rest
await H(() => { window.__hive.view.motion = false; });
await page.click('#puff');
await waitMode('play');
await page.waitForTimeout(80);
assert.deepEqual(await H(() => [!!window.__hive.view.smoke, Number.isFinite(window.__hive.view.wakeAt), window.__hive.running]),
  [true, true, false], 'a still haze, asleep until it ends');
await shot('14-smoke-still');
await page.waitForTimeout(700);
assert.equal(await H(() => window.__hive.view.smoke), null, 'and then it is gone');
await H(() => { window.__hive.view.motion = true; });
await tapCell(await H(() => window.__hive.s.cells.findIndex((c, i) => c === 1 && !window.__hive.s.mark[i])));
await waitMode('lost');
assert.equal(await page.isVisible('#puff'), false, 'no puffs left: no smoker');
assert.equal(await page.getAttribute('#retry', 'class'), 'primary');
assert.equal(await H(() => Arcade.state.get('run')), null, 'and the run is let go');
await page.click('#lost-menu');

// ── the pantry (#09): win a frame, open the pantry, replay the jar ──────
await page.waitForTimeout(200);
await shot('13-menu-pantry');
assert.match(await page.textContent('#pantry-sum'), /^\d+ jars · \d+ sealed$/);
assert.ok(await page.$$eval('#pantry-mini .jar', (j) => j.length) >= 6, 'the mini shelf shows the newest jars');
assert.match(await page.$eval('#month-comb', (e) => e.getAttribute('aria-label')), /^\w+: \d+ of \d+ days? cleared/);
assert.ok(await page.$$eval('#month-comb .day', (d) => d.length) >= 28, 'the month, as comb');
assert.equal(await page.$$eval('#month-comb .day.today', (d) => d.length), 1);
assert.match(await page.textContent('#daily-streak'), /streak/);
assert.match(await page.$eval('#hive button:nth-child(1) .jars', (e) => e.textContent), /^\d+ jars?$/);
await page.click('#pantry-open');
await waitMode('pantry');
assert.equal(await page.evaluate(() => document.activeElement.id), 'pantry-back', 'focus lands in the sheet');
// a shelf per hive, and the Queen's Frame waiting with an empty slot
assert.deepEqual(await page.$$eval('.shelf-head h3', (h) => h.map((x) => x.textContent)),
  ['Clover Field', 'Apple Orchard', 'Wildflowers', "Queen's Frame"]);
assert.equal(await page.$$eval('.shelf-box:nth-child(4) .slot-empty', (e) => e.length), 1);
for (const k of [1, 2, 3]) assert.ok(await page.$$eval(`.shelf-box:nth-child(${k}) button.jar`, (j) => j.length) >= 1);
// jars are buttons with their own words
const labels = await page.$$eval('button.jar', (j) => j.map((b) => b.getAttribute('aria-label')));
for (const l of labels) assert.match(l, /^(Clover Field|Apple Orchard|Wildflowers), \d{1,2} [A-Z][a-z]{2}, \d+:\d\d(, pure)?$/);
assert.ok(labels.some((l) => l.endsWith(', pure')));
// tap the Pure clover jar
const pureJar = await page.$$eval('.shelf-box:nth-child(1) button.jar', (j) => j.findIndex((b) => b.querySelector('.wax')));
assert.ok(pureJar >= 0);
const jarSel = `.shelf-box:nth-child(1) button.jar >> nth=${pureJar}`;
await page.click(jarSel);
const jarCode = await page.textContent('#detail-code');
assert.match(jarCode, /^CL-[0-9A-Z]{7}$/);
assert.match(await page.textContent('#detail-line'), /^[\d.:s]+ · \d+ clean · 0 hints · 0 puffs$/);
await page.waitForTimeout(200);
await shot('14-pantry');
// keys: arrows walk the shelf, one tab stop per shelf
const focusAt = () => page.evaluate(() => [...document.activeElement.parentNode.querySelectorAll('.jar')].indexOf(document.activeElement));
await page.focus(jarSel);
await page.keyboard.press('Home');
assert.equal(await focusAt(), 0);
await page.keyboard.press('ArrowRight');
assert.equal(await focusAt(), 1);
assert.equal(await page.$$eval('.shelf-box:nth-child(1) button.jar', (j) => j.filter((b) => b.tabIndex === 0).length), 1);
await page.click(jarSel);
// Send copies the code when there's no share sheet
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
await H(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); });
await page.click('#detail-send');
await page.waitForTimeout(300);
assert.equal(await H(() => navigator.clipboard.readText()), jarCode, 'Send copies the code');
await page.evaluate(() => { document.getElementById('jar-detail').scrollIntoView(); });
await shot('15-jar-detail');
// Replay: the same frame loads
await page.click('#detail-replay');
await waitMode('play');
assert.equal(await H(() => window.__hive.Core.boardCode(window.__hive.s.hive, window.__hive.s.seed)), jarCode);
// cleared again, it updates its jar rather than filling another
const jarsBefore = await H(() => window.__hive.Pantry.totals(Arcade.stats.get('pantry')).jars);
await solverClear();
assert.equal(await H(() => window.__hive.Pantry.totals(Arcade.stats.get('pantry')).jars), jarsBefore, 'no duplicate jar');
await page.click('#won-menu');
// Escape leaves the pantry
await page.click('#pantry-open');
await waitMode('pantry');
await page.keyboard.press('Escape');
await waitMode('menu');

// ── the Queen's Frame (#10): open it from its strip, clear it, a royal jar ──
await H(() => { window.__hive.view.motion = true; });
await page.waitForTimeout(2500);                   // the Send toast goes, for the shots
assert.equal(await page.$$eval('#hive button', (b) => b.length), 3, 'the hive selector never offers it');
const wk = await H(() => window.__hive.thisWeek());
assert.match(wk.week, /^\d{4}-W\d\d$/);
assert.equal(await H(() => window.__hive.today().hive === 'queen'), false, 'nor does the daily');
assert.equal(await page.textContent('#queen-strip .eyebrow'), "Queen's Frame · Sundays");
assert.equal(await page.textContent('#queen-title'), 'Open all week');
assert.equal(await page.textContent('#queen-next'), await H((n) => window.__hive.Week.nextFrameWords(n), wk.daysLeft));
assert.deepEqual(await page.$$eval('#queen-jar > *', (e) => e.map((x) => x.className)), ['slot-empty mini'], 'an empty slot until it is cleared');
assert.ok((await page.$eval('#queen-strip', (b) => b.getBoundingClientRect().height)) >= 40, 'the strip is a 40 px target');
await page.$eval('#queen-strip', (b) => b.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(100);
await shot('16-queen-strip-open');
await page.click('#queen-strip');
await waitMode('play');
assert.deepEqual(await H(() => { const s = window.__hive.s; return [s.hive, s.seed, s.cols, s.rows, s.puffs]; }),
  ['queen', wk.seed, 9, 20, 2], "this week's frame, on the week's seed");
assert.equal(await page.textContent('#hud-hive'), "Queen's Frame");
// tap targets at 390 × 844: every cell is ≥ 40 px across its flats, and the
// whole frame is on screen
const geo = await H(() => {
  const h = window.__hive, r = h.layout.r, n = h.s.cols * h.s.rows;
  const pts = Array.from({ length: n }, (_, i) => h.at(i));
  return { across: Math.sqrt(3) * r, tall: 2 * r, minX: Math.min(...pts.map((p) => p.x)) - Math.sqrt(3) * r / 2,
    maxX: Math.max(...pts.map((p) => p.x)) + Math.sqrt(3) * r / 2, maxY: Math.max(...pts.map((p) => p.y)) + r, W: innerWidth, Hh: innerHeight };
});
assert.ok(geo.across >= 40, `cells are ${geo.across.toFixed(1)} px across`);
assert.ok(geo.minX >= 0 && geo.maxX <= geo.W && geo.maxY <= geo.Hh, `the frame fits: ${JSON.stringify(geo)}`);
// and the pointer agrees: a tap 19.5 px either side of a cell's centre lands on that cell
{
  const [a, b] = await provenSafe();
  for (const [i, dx] of [[a, 19.5], [b, -19.5]]) {
    if (await H((k) => window.__hive.s.open[k], i)) continue;
    const p = await xy(i);
    await page.mouse.click(p.x + dx, p.y);
    assert.equal(await H((k) => window.__hive.s.open[k], i), 1, `a tap ${dx} px off ${i}'s centre opens it`);
  }
}
for (let k = 0; k < 8; k++) await tapCell((await provenSafe())[0]);
await page.waitForTimeout(400);
await shot('17-queen-play');
await solverClear();
assert.equal(await page.isVisible('#won-pure'), true, 'a solver-driven clear is Pure');
assert.match(await page.textContent('#won-note'), /^Pure · jar \d+ · royal honey$/);
assert.deepEqual(await H(() => [...document.querySelectorAll('#won-jar .jar')].map((j) => j.style.getPropertyValue('--top'))),
  [await H(() => window.__hive.honeyColour('queen', 1).top)]);
const qRec = await H(() => [Arcade.records.get('time-queen'), Arcade.records.get('pure-time-queen')]);
assert.ok(qRec[0] && qRec[0].value > 0 && qRec[0].label === "Queen's Frame — fastest frame", 'time-queen');
assert.ok(qRec[1] && qRec[1].value === qRec[0].value, 'pure-time-queen');
assert.deepEqual(await H((w) => Arcade.stats.get('weekly')[w], wk.week), { ms: qRec[0].value, pure: true }, "the week's best clear");
await page.waitForTimeout(1300);
await shot('18-queen-won');
await page.click('#won-menu');
// the strip: cleared, its time and seal, and its jar
assert.match(await page.textContent('#queen-title'), /^Cleared · [\d.:s]+$/);
assert.equal(await page.textContent('#queen-line'), 'Sealed Pure.');
assert.equal(await page.$$eval('#queen-jar .jar .wax', (e) => e.length), 1, 'a royal jar, sealed');
assert.match(await page.getAttribute('#queen-strip', 'aria-label'), /^Queen's Frame, opens Sundays\. This week's is cleared in .+, sealed Pure\. New/);
await page.$eval('#queen-strip', (b) => b.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(100);
await shot('19-queen-strip-cleared');
// the pantry: the Queen's Frame shelf has its jar, and the empty slot is gone
await page.click('#pantry-open');
await waitMode('pantry');
assert.equal(await page.$$eval('.shelf-box:nth-child(4) .slot-empty', (e) => e.length), 0);
assert.deepEqual(await page.$$eval('.shelf-box:nth-child(4) button.jar', (j) => j.map((b) => b.getAttribute('aria-label').split(',')[0])), ["Queen's Frame"]);
assert.match(await page.textContent('#detail-note'), /^Queen's Frame · /, 'the newest jar is picked');
await page.evaluate(() => { document.querySelector('.shelf-box:nth-child(4)').scrollIntoView(); });
await page.waitForTimeout(200);
await shot('20-pantry-royal');
await page.keyboard.press('Escape');
await waitMode('menu');
// a QU- code plays the queen hive (not as the week's, unless it is the week's seed)
await H(() => { document.getElementById('code-box').open = true; });
await page.fill('#code-in', 'qu-00abc12');
await page.press('#code-in', 'Enter');
await waitMode('play');
assert.deepEqual(await H(() => [window.__hive.s.hive, window.__hive.s.seed]), ['queen', parseInt('abc12', 36)]);
await tapCell((await provenSafe())[0]);
await page.click('#pause'); await page.click('#quit');
assert.equal(await page.textContent('#continue-title'), "Back to the Queen's Frame");
assert.match(await page.textContent('#queen-title'), /^Cleared/, "a code isn't the week's frame");

// ── the ghost race (#11): clear a code, replay it against its ghost ─────
await H(() => { window.__hive.view.motion = true; });
const race = () => H(() => window.__hive.race);
const barShown = () => page.isVisible('#race');
const jarGhost = (c) => H((x) => { const h = window.__hive, k = h.Core.parseCode(x); return h.Pantry.ghostOf(Arcade.stats.get('pantry'), k.hive, k.seed); }, c);
async function openCode(c) {
  await H(() => { document.getElementById('code-box').open = true; });
  await page.fill('#code-in', c);
  await page.press('#code-in', 'Enter');
  await waitMode('play');
}
async function provenTaps(n) { for (let k = 0; k < n && (await mode()) === 'play'; k++) await tapCell((await provenSafe())[0]); }
const GHOST_CODE = 'CL-000G0ST';
// a fresh code: no jar, so no ghost, no bar, no switch on the pause sheet
assert.equal(await jarGhost(GHOST_CODE), null);
await openCode(GHOST_CODE);
assert.equal((await race()).ghost, null);
assert.equal(await barShown(), false, 'a fresh code shows no ghost');
await page.click('#pause');
assert.equal(await page.isVisible('#ghost-pref-row'), false);
await page.click('#resume');
// play half of it, take a hint (+10 s, so its pace carries the penalty), finish
const half = Math.floor((await H(() => window.__hive.Core.safeLeft(window.__hive.s))) / 2);
await provenTaps(half);
const preHint = (await race()).timeline.length;
assert.ok(preHint >= 5 && preHint < 20, `half a frame is about half the checkpoints (${preHint})`);
await page.click('#hint-btn');
await solverClear();
assert.equal(await page.isVisible('#won-ghost'), false, 'no ghost, no finish line');
const ghost1 = await jarGhost(GHOST_CODE);
const ms1 = await H(() => Math.round(window.__hive.elapsed));
assert.ok(ghost1, 'the clear left a pace in its jar');
assert.equal(ghost1.timeline.length, 20);
assert.ok(Math.abs(ghost1.ms - ms1) < 5 && ghost1.timeline[19] === ghost1.ms, 'ending at the jar time');
assert.ok(ghost1.timeline[preHint] >= 10000, 'checkpoints after the hint carry its +10 s');
assert.ok(ghost1.timeline[preHint - 1] < 10000, 'the ones before it do not');
await page.click('#won-menu');

// replay it and beat it: the bar shows both, and a reload mid-frame keeps the pace
await openCode(GHOST_CODE);
assert.deepEqual((await race()).ghost, ghost1);
assert.equal(await barShown(), true, 'replaying a cleared frame shows the ghost');
await provenTaps(Math.floor(half / 2));
await page.waitForTimeout(600);
const midRace = await race();
assert.ok(midRace.bar.you > 0 && midRace.bar.rival > 0 && midRace.bar.ease === true, `both bars fill (${JSON.stringify(midRace.bar)})`);
await shot('16-ghost-mid-race');
await page.click('#pause');
assert.equal(await page.isVisible('#ghost-pref-row'), true, 'the switch lives on the pause sheet');
assert.equal(await page.isChecked('#ghost-pref'), true, 'on by default');
await page.reload();
await page.waitForFunction(() => window.__hive);
await page.click('#continue');
await waitMode('paused');
assert.deepEqual((await race()).timeline, midRace.timeline, 'the pace came back with the run');
assert.deepEqual((await race()).ghost, ghost1);
await page.click('#resume');
// motion off: the bar still moves with each update, it just doesn't ease
await H(() => { window.__hive.view.motion = false; });
const youBefore = (await race()).bar.you;
await provenTaps(3);
await page.waitForTimeout(550);
const noEase = await race();
assert.ok(noEase.bar.you > youBefore && noEase.bar.ease === false, 'motion off: updated, no easing');
assert.equal(await page.$eval('#race', (e) => e.classList.contains('ease')), false);
await H(() => { window.__hive.view.motion = true; });
await solverClear();
const ms2 = await H(() => Math.round(window.__hive.elapsed));
assert.ok(ms2 < ghost1.ms);
assert.match(await page.textContent('#won-ghost'), /^Beat your ghost by \d+\.\d s$/);
assert.equal(await page.isVisible('#won-ghost'), true);
await page.waitForTimeout(400);
await shot('17-ghost-beaten');
const ghost2 = await jarGhost(GHOST_CODE);
assert.ok(Math.abs(ghost2.ms - ms2) < 5, 'beating the ghost updates the jar time');
assert.notDeepEqual(ghost2.timeline, ghost1.timeline, 'and its pace');
assert.ok(ghost2.timeline[19] === ghost2.ms && ghost2.timeline[preHint] < 10000, 'the new pace has no hint in it');
await page.click('#won-menu');

// replay and lose to it: two hints (+20 s); the switch hides the bar; the jar keeps the faster run
await openCode(GHOST_CODE);
await page.click('#pause');
await shot('19-ghost-switch');
await page.click('#ghost-pref-row');
assert.equal(await page.isChecked('#ghost-pref'), false);
assert.equal(await H(() => Arcade.state.get('prefs').ghost), false, 'remembered in prefs');
await page.click('#resume');
assert.equal(await barShown(), false, 'the switch hides the ghost');
await page.click('#pause');
await page.click('#ghost-pref-row');
await page.click('#resume');
assert.equal(await barShown(), true);
await page.click('#hint-btn'); await page.click('#hint-done');
await provenTaps(2);
await page.click('#hint-btn'); await page.click('#hint-done');
await solverClear();
assert.match(await page.textContent('#won-ghost'), /^Ghost won by \d+\.\d s$/);
await page.waitForTimeout(400);
await shot('18-ghost-won');
assert.deepEqual(await jarGhost(GHOST_CODE), ghost2, 'a slower clear leaves the jar and its pace alone');
await page.click('#won-menu');

// a daily: its jar has a pace (the smoked clear above), but no ghost until the day is cleared
const td = await H(() => window.__hive.today());
assert.ok(await H((t) => window.__hive.Pantry.ghostOf(Arcade.stats.get('pantry'), t.hive, t.seed), td));
const dayEntry = await H((t) => Arcade.stats.get('daily')[t.date], td);
await H((t) => Arcade.stats.update('daily', (log) => { const next = { ...log }; delete next[t.date]; return next; }), td);
await page.click('#daily');
await waitMode('play');
assert.equal((await race()).ghost, null, 'a daily not yet cleared shows no ghost');
assert.equal(await barShown(), false);
await page.click('#pause'); await page.click('#quit');
await H(([t, e]) => Arcade.stats.update('daily', (log) => ({ ...log, [t.date]: e })), [td, dayEntry]);
await page.click('#daily');
await waitMode('play');
assert.equal(await barShown(), true, 'cleared once, its ghost races');
await page.click('#pause'); await page.click('#quit');

// landscape
await page.click('#play');
await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForTimeout(300);
await shot('8-landscape');

await browser.close();
assert.deepEqual(problems, [], 'console must stay clean');
console.log('e2e: ok');
