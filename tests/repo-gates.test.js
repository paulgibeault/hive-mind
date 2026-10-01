/* Source-level gates: the floor every fleet app meets (GAME_INTEGRATION §13a),
 * plus the service-worker shape fleet CI's version rewrite depends on (§10).
 *
 * Deliberately about the SOURCE. What the published artifact must contain is
 * tools/verify-artifact.mjs's job, and it checks the staged output rather than
 * the checkout — the only way to catch a staging rule that drops a file the
 * game needs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PRECACHE_EXCLUDE, isDevOnly } from '../tools/stage.mjs';

const tracked = execSync('git ls-files -z', { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean);

test('every tracked JS file parses', () => {
  for (const f of tracked.filter((f) => /\.(js|mjs)$/.test(f))) {
    const r = spawnSync(process.execPath, ['--check', f], { cwd: ROOT });
    assert.equal(r.status, 0, `node --check ${f} failed:\n${r.stderr}`);
  }
});

test('every tracked JSON file parses', () => {
  for (const f of tracked.filter((f) => f.endsWith('.json'))) {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')), `${f} is not valid JSON`);
  }
});

test('the rules import under node with no Arcade global and no DOM in sight', async () => {
  // The rules decide what frame a seed makes. If they ever reach for a
  // browser or a clock, the daily frame, shared codes and racing all break:
  // two phones would stop agreeing on the same seed.
  assert.equal(typeof globalThis.Arcade, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  // (mixer.js too: the sound decisions are replayable, so they take `now` as an argument)
  for (const f of ['core.js', 'solver.js', 'hex.js', 'migrate.js', 'mixer.js', 'juice.js', 'reads.js', 'hint.js', 'honey.js', 'pantry.js']) {
    await assert.doesNotReject(() => import(`../${f}`));
    // code only: the header comment names the very things it forbids
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /Math\.random|Date\.now|performance\.now|\bdocument\b|\bwindow\b/,
      `${f} must stay deterministic: seeded RNG, no clock, no DOM`);
  }
});

test('one identity everywhere: Arcade.init, manifest scope, sw.js', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.match(html, /Arcade\.init\(\{ gameId: 'hive-mind' \}\)/);
  assert.match(html, /register\('sw\.js', \{ scope: '\/hive-mind\/' \}\)/);
  assert.equal(manifest.scope, '/hive-mind/');
  assert.equal(manifest.start_url, '/hive-mind/');
});

// ── sw.js — the shape fleet CI rewrites, and the rules of a shared origin ──
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

test("sw.js declares APP_VERSION in the exact form fleet-ci's sed targets", () => {
  // A shape check, not equality with package.json — that false-fails any PR
  // left open across a deploy (§10).
  assert.match(sw, /^const APP_VERSION = '[^']*';$/m);
  assert.match(sw, /^const GAME_ID = 'hive-mind';/m, 'GAME_ID must match Arcade.init({ gameId })');
  assert.match(sw, /^const CACHE_NAME = `\$\{GAME_ID\}-v\$\{APP_VERSION\}`;$/m,
    'CACHE_NAME must derive from APP_VERSION, never hardcode one');
});

test('sw.js carries the generated precache region inject-precache fills at stage time', () => {
  const begin = sw.indexOf('// arcade:precache-begin');
  const end = sw.indexOf('// arcade:precache-end');
  assert.ok(begin !== -1 && end > begin, 'missing arcade:precache-begin/-end markers');
});

test('sw.js never precaches launcher-owned files', () => {
  assert.doesNotMatch(sw, /['"][^'"]*arcade-(?:sdk|audio)\.js['"]/);
});

test('sw.js cleans up only its own caches and never activates unannounced', () => {
  assert.match(sw, /\.filter\(\((\w+)\) => \1\.startsWith\(`\$\{GAME_ID\}-`\) && \1 !== CACHE_NAME\)/,
    "activate-time cleanup must be filtered to this game's prefix");
  assert.ok(sw.includes("'arcade:sw.skipWaiting'"), "the launcher's update control needs this message");
  assert.doesNotMatch(sw, /^\s*self\.skipWaiting\(\);/m, 'no unconditional skipWaiting() on install');
  assert.match(sw, /if \(!url\.pathname\.startsWith\(SCOPE\)\) return;/, 'the scope guard is the load-bearing line');
});

// ── staging declaration ──────────────────────────────────────────────────
test('stage.mjs publishes what the page and manifest name, and drops the dev set', () => {
  for (const f of ['index.html', 'main.js', 'core.js', 'hex.js', 'solver.js', 'migrate.js', 'juice.js', 'reads.js', 'hint.js', 'honey.js', 'pantry.js', 'arcade-rng.js', 'render.js',
    'input.js', 'audio.js', 'mixer.js', 'soundpack.js', 'style.css', 'manifest.json', 'sw.js', 'icon.svg', 'icon.png']) {
    assert.ok(tracked.includes(f), `${f} is not tracked`);
    assert.ok(!isDevOnly(f), `${f} would be dropped from the deploy`);
  }
  for (const f of ['README.md', 'package.json', '.gitignore', 'docs/design.md', 'tools/stage.mjs',
    'tools/e2e.mjs', 'tests/core.test.js', 'tests/solver.test.js', 'tests/migrate.test.js', 'tests/reads.test.js', 'tests/honey.test.js', 'tests/pantry.test.js',
    'tests/sound.test.js', 'tests/audio.test.js', 'tools/audition.js', 'tools/soundpack.config.json', 'tools/sound-levels.mjs', '.github/workflows/pages.yml']) {
    assert.ok(isDevOnly(f), `${f} would ship to the public site`);
  }
  assert.deepEqual(PRECACHE_EXCLUDE, ['LICENSE'], 'the exclusion list is meant to stay minimal');
});

// ── words ──────────────────────────────────────────────────────────────────
// 2026-09-28: no wasps. The hazard is a sleeping guard bee, and the hives were
// renamed. What ships (everything stage.mjs doesn't drop) must say so.
const shipped = tracked.filter((f) => !isDevOnly(f) && !/\.(png|jpe?g|gif|webp|ico|woff2?)$/i.test(f));

test('no wasps or hornets in anything that ships', () => {
  for (const f of shipped) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const hit = /wasp|hornet/i.exec(src);
    assert.equal(hit, null, `${f} still says "${hit && src.slice(Math.max(0, hit.index - 30), hit.index + 30)}"`);
  }
});

test('the old hive ids live only in the alias map and the migration', () => {
  // migrate.js reads them from core.js's OLD_IDS; nothing else names them
  const old = /\b(meadow|orchard|wild)\b/;
  for (const f of shipped.filter((f) => f !== 'core.js')) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), old, `${f} names an old hive id`);
  }
  const lines = fs.readFileSync(path.join(ROOT, 'core.js'), 'utf8').split('\n').filter((l) => old.test(l));
  assert.deepEqual(lines, [
    "export const OLD_IDS = Object.freeze({ meadow: 'clover', orchard: 'apple', wild: 'wildflowers' });",
  ]);
});

/* The two vendored fleet files (GAME_INTEGRATION §13a): never edit the copy —
 * change the canonical file in the launcher repo and re-copy. To update after
 * a legitimate re-copy:
 *   shasum -a 256 tools/verify-artifact.mjs tools/inject-precache.mjs
 */
const VENDORED = {
  'arcade-rng.js': '385a78da7c74007b621545334bb14e00fbcd3d1a5c79d6d47682ec7277d03cb2',
  'tools/verify-artifact.mjs': '0733b94f5d3cc908f04efd9e3d1d8098181227a77fe342a154d75e245ff55a75',
  'tools/inject-precache.mjs': '7a8371071220cbfe8c281a67ff44b5685c7b2e8afb8c829137c70884fb9808e3',
};

test('the vendored fleet files have not been edited in place', () => {
  for (const [local, want] of Object.entries(VENDORED)) {
    const got = createHash('sha256').update(fs.readFileSync(path.join(ROOT, local))).digest('hex');
    assert.equal(got, want, `${local} has been edited. It is fleet property: change the canonical `
      + 'file in the launcher repo, re-copy it here, and update the digest in tests/repo-gates.test.js.');
  }
});

test('the vendored fleet files match the canonical copies, when those are reachable', () => {
  // Opt-in through ARCADE_FLEET_ROOT (a launcher checkout). Absent — CI, a
  // fresh clone — the digest gate above is the floor.
  const root = process.env.ARCADE_FLEET_ROOT;
  if (!root || !fs.existsSync(root)) return;
  for (const local of Object.keys(VENDORED)) {
    const src = path.join(root, local);
    if (!fs.existsSync(src)) continue;
    assert.equal(fs.readFileSync(path.join(ROOT, local), 'utf8'), fs.readFileSync(src, 'utf8'),
      `${local} has drifted from ${src}`);
  }
});
