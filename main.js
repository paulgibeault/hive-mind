/* main.js — Hive Mind: the shed around the frame.
 *
 * core.js is the game; this file is everything that touches a browser: the
 * Arcade SDK contract (ready → state, suspend/resume, records, save-import),
 * the sheets, the clock, and handing core events to the renderer and the
 * sound pack.
 */

import * as Core from './core.js';
import { migrate, recordKeys } from './migrate.js';
import { createRenderer } from './render.js';
import { bindInput } from './input.js';
import { initAudio, sfx, sfxReset, cueContext } from './audio.js';

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const R = createRenderer($('view'));

const NOTES = {
  clover: 'Plain comb, one kind of guard. Where every hive starts.',
  apple: "Guards and the queen's guards. Every cell counts each kind separately.",
  wildflowers: 'Some comb is broken: safe, but it tells you nothing.',
};
const MARKS = {
  clover: '<i></i>',
  apple: '<i></i><i class="q"></i>',
  wildflowers: '<i></i><i class="b"></i>',
};

let s = null;                 // the core state, or null in the menu
let mode = 'menu';            // menu | play | paused | won | lost
let prefs = { hive: 0 };
let daily = null;             // the date string when this frame is the daily
let markMode = false;
let base = 0;                 // ms on the clock from before this session
let clock = null;             // Arcade.session tracker for the live stretch
let loop = null;
let tickTimer = null;

// ── time ─────────────────────────────────────────────────────────────────
const elapsed = () => base + (clock ? clock.elapsedMs() : 0);
function fmt(ms) {
  const t = Math.floor(ms / 1000);
  const m = Math.floor(t / 60), sec = t % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function fmtExact(ms) {
  const t = ms / 1000;
  return t < 60 ? `${t.toFixed(1)}s` : fmt(ms);
}
function runClock(on) {
  if (on) { clock.resume(); if (!tickTimer) tickTimer = Arcade.session.setInterval(paintClock, 500); }
  else { clock.pause(); if (tickTimer) { tickTimer.cancel(); tickTimer = null; } }
}
function paintClock() { $('hud-clock').textContent = fmt(elapsed()); }

// ── sheets ───────────────────────────────────────────────────────────────
const SHEETS = ['menu', 'paused', 'won', 'lost'];
function show(next) {
  mode = next;
  for (const id of SHEETS) $(id).hidden = id !== mode;
  $('rail').hidden = !s || mode === 'menu';
  runClock(mode === 'play');
  kick();
}

function kick() { if (loop) loop.kick(); }
function frame() {
  const moving = R.draw(mode === 'menu' ? null : s, performance.now());
  if (moving) loop.start(); else loop.stop();
}

// ── the rail ─────────────────────────────────────────────────────────────
function renderHud() {
  if (!s) return;
  const hive = Core.hiveById(s.hive);
  $('hud-hive').textContent = daily ? `Daily · ${hive.name}` : hive.name;
  $('hud-code').textContent = Core.boardCode(s.hive, s.seed);
  const count = $('hud-count');
  count.textContent = '';
  const pill = (left, cls) => {
    const n = document.createElement('span');
    n.className = 'n';
    const dot = document.createElement('i');
    dot.className = `dot${cls ? ` ${cls}` : ''}`;
    n.append(dot, String(left));
    count.append(n);
  };
  if (s.queens > 0) {
    pill(s.guards - Core.marksOf(s, Core.MARK_G));
    pill(s.queens - Core.marksOf(s, Core.MARK_Q), 'q');
  } else {
    pill(s.guards - Core.marksOf(s, Core.MARK_G) - Core.marksOf(s, Core.MARK_Q));
  }
  count.setAttribute('aria-label', `${count.textContent} left unmarked`);
  paintClock();
  $('tool').setAttribute('aria-pressed', String(markMode));
}

// ── runs ─────────────────────────────────────────────────────────────────
function persistRun() {
  if (s && s.phase === 'play') {
    Arcade.state.set('run', { s: { ...s, events: [] }, ms: elapsed(), daily });
  }
}
function dropRun() { Arcade.state.set('run', null); }

function begin(state, opts = {}) {
  s = state;
  s.events = [];
  daily = opts.daily || null;
  base = opts.ms || 0;
  clock.reset();
  clock.pause();
  markMode = false;
  sfxReset();
  R.view.fades.clear();
  R.view.flashAt = -1;
  fit();
  renderHud();
  show(opts.paused ? 'paused' : 'play');
}

function startFrame(hiveId, seed, opts = {}) {
  begin(Core.newGame(hiveId, seed), opts);
  bump(hiveId, 'played');
  persistRun();
}

// per hive: { played, won }
function bump(hiveId, field) {
  Arcade.stats.update('frames', (prev) => {
    const k = { played: 0, won: 0, ...(prev && prev[hiveId]) };
    return { ...prev, [hiveId]: { ...k, [field]: k[field] + 1 } };
  });
}

function newFrame() {
  startFrame(Core.HIVES[prefs.hive].id, (Math.random() * 0x100000000) >>> 0);
}

// ── the daily frame ──────────────────────────────────────────────────────
// One frame a day for everyone, rolling at local midnight (Arcade.daily).
// The hive rotates with the day so each kind comes round every third day.
function today() {
  const date = Arcade.daily.dateStr();
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  const hive = Core.HIVES[((day % 3) + 3) % 3].id;
  const seed = Arcade.daily.seed().int(0, 0xfffffffe) >>> 0;
  return { date, hive, seed };
}
function dailyLog() { return Arcade.stats.getOrInit('daily', {}); }
function streak(log, date) {
  let n = 0;
  const d = new Date(`${date}T12:00:00`);
  if (!log[Arcade.daily.dateStr(d)]) d.setDate(d.getDate() - 1);   // today not done yet
  while (log[Arcade.daily.dateStr(d)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function paintDaily() {
  const t = today();
  const log = dailyLog();
  const done = log[t.date];
  const hive = Core.hiveById(t.hive);
  $('daily-note').textContent = `Daily frame · ${t.date}`;
  $('daily-title').textContent = done ? `${hive.name} — cleared` : `Today: ${hive.name}`;
  $('daily-time').textContent = done ? fmtExact(done.ms) : '';
  $('daily').classList.toggle('done', !!done);
  return streak(log, t.date);
}

// ── records ──────────────────────────────────────────────────────────────
function renderBest() {
  const hive = Core.HIVES[prefs.hive];
  const best = Arcade.records.get(`time-${hive.id}`);
  const k = (Arcade.stats.getOrInit('frames', {})[hive.id]) || { played: 0, won: 0 };
  const n = paintDaily();
  const bits = [];
  if (best) bits.push(`${hive.name} best ${fmtExact(best.value)}`);
  if (k.played) bits.push(`${k.won} of ${k.played} cleared`);
  if (n > 1) bits.push(`${n}-day streak`);
  $('best').textContent = bits.join(' · ');
}

function recordWin() {
  const ms = Math.round(elapsed());
  const hive = Core.hiveById(s.hive);
  const prev = Arcade.records.get(`time-${hive.id}`);
  Arcade.records.best(`time-${hive.id}`, {
    value: ms, direction: 'lower', format: 'duration-ms', label: `${hive.name} — fastest frame`,
  });
  bump(hive.id, 'won');
  let note = '';
  if (daily) {
    const date = daily;
    Arcade.stats.update('daily', (log) => (log && log[date] && log[date].ms <= ms
      ? log : { ...log, [date]: { ms, hive: hive.id } }));
    note = `Daily frame · ${daily}`;
  } else note = hive.name;
  $('won-note').textContent = note;
  $('won-time').textContent = fmtExact(ms);
  $('won-best').textContent = !prev ? 'First clear' : ms < prev.value ? `New best — was ${fmtExact(prev.value)}` : `Best ${fmtExact(prev.value)}`;
  $('won-code').textContent = Core.boardCode(s.hive, s.seed);
}

// ── core events → everything else ────────────────────────────────────────
// Every cue hears where the frame is ({ hive, seed, progress }), never what is
// under a cap. `extra` is only ever what this action has just shown.
const cue = (extra) => ({ ...cueContext(s), ...extra });

// One action is one sound: a flood or a sweep is a single cue scaled by how
// many cells it opened, never one uncap per cell. A lone broken comb (shown
// now that it is open) plays hollow.
function uncapSound(events) {
  const ups = events.filter((e) => e.type === 'uncap');
  const n = ups.reduce((k, e) => k + e.cells.length, 0);
  if (n > 1) sfx('flood', cue({ cells: n }));
  else if (n === 1) sfx('uncap', cue(s.broken[ups[0].cells[0]] ? { cells: 1, kind: 'broken' } : { cells: 1 }));
}

function drain() {
  const now = performance.now();
  const events = s.events.splice(0);
  uncapSound(events);
  for (const e of events) {
    switch (e.type) {
      case 'uncap':
        R.uncapped(e.cells, now);
        break;
      case 'mark': sfx(e.mark ? 'mark' : 'unmark', cue({ kind: e.mark })); break;
      case 'sting':
        R.view.flashAt = now;
        sfx('sting', cue({ kind: e.kind }));
        if (navigator.vibrate) { try { navigator.vibrate([40, 40, 80]); } catch { /* not allowed */ } }
        runClock(false);
        dropRun();
        $('lost-note').textContent = daily ? `Daily frame · ${daily}` : Core.hiveById(s.hive).name;
        $('lost-title').textContent = e.kind === Core.Q ? "Stung by a queen's guard" : 'Stung';
        $('lost-left').textContent = `${Core.safeLeft(s)} safe cells were still capped.`;
        show('lost');
        break;
      case 'won':
        runClock(false);
        sfx('won', cue());
        recordWin();
        dropRun();
        show('won');
        break;
      default: break;
    }
  }
  renderHud();
  loop.start();
}

function act(fn, i) {
  if (mode !== 'play' || !s) return;
  if (fn(s, i)) { drain(); persistRun(); }
  else if (fn === Core.tap && sweepRefused(i)) sfx('nope', cue());
}

// A tap on an uncapped number that has capped, unpinned neighbours but whose
// pins don't add up: the sweep can't fire. Reads only what the board shows.
function sweepRefused(i) {
  if (!s.open[i] || s.broken[i] || !(s.shown[i] + s.shownH[i])) return false;
  return Core.nbrsOf(s.cols, s.rows)[i].some((j) => !s.open[j] && s.mark[j] === Core.NONE);
}

function pause() {
  if (mode === 'play') { persistRun(); show('paused'); }
  else if (mode === 'paused') show('play');
}

// ── sizing & settings ────────────────────────────────────────────────────
function fit() {
  const r = stage.getBoundingClientRect();
  const hive = s ? s : Core.HIVES[prefs.hive];
  R.resize(Math.max(1, r.width), Math.max(1, r.height), hive.cols, hive.rows, 56);
  kick();
}

function applySettings() {
  const saving = Arcade.settings.powerSaver ? Arcade.settings.powerSaver() : false;
  R.view.motion = !Arcade.settings.reducedMotion() && !saving;
}

function segmented(el, items, get, set) {
  el.textContent = '';
  items.forEach((it, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    const marks = document.createElement('span');
    marks.className = 'marks';
    marks.innerHTML = MARKS[it.id];                 // our own constant markup
    const small = document.createElement('small');
    small.textContent = `${it.cols * it.rows} cells`;
    b.append(marks, it.name, small);
    b.addEventListener('click', () => { set(i); paint(); });
    el.append(b);
  });
  const paint = () => {
    [...el.children].forEach((b, i) => b.setAttribute('aria-checked', String(i === get())));
    $('hive-note').textContent = NOTES[items[get()].id];
  };
  paint();
  return paint;
}

// ── stored data from older versions ──────────────────────────────────────
// migrate.js decides; this only reads the stores and writes back what moved.
// Safe to run on every boot and after every save import: a second pass finds
// nothing to do.
function migrateStored() {
  const m = migrate({
    run: Arcade.state.get('run'),
    records: Object.fromEntries(recordKeys().map((k) => [k, Arcade.records.get(k)])),
    frames: Arcade.stats.get('frames'),
    daily: Arcade.stats.get('daily'),
  });
  if (m.run !== undefined) Arcade.state.set('run', m.run);
  for (const [k, rec] of Object.entries(m.records)) Arcade.records.set(k, rec);
  for (const k of m.dropRecords) Arcade.records.clear(k);
  if (m.frames) Arcade.stats.update('frames', () => m.frames);
  if (m.daily) Arcade.stats.update('daily', () => m.daily);
}

// ── boot ─────────────────────────────────────────────────────────────────
async function boot() {
  await Arcade.ready;
  initAudio();
  migrateStored();

  prefs = { ...prefs, ...(Arcade.state.get('prefs') || {}) };
  clock = Arcade.session.start();
  clock.pause();
  loop = Arcade.loop(frame);
  applySettings();
  Arcade.onSettingsChange(() => { applySettings(); kick(); });

  const paintHive = segmented($('hive'), Core.HIVES, () => prefs.hive, (i) => {
    prefs.hive = i;
    Arcade.state.set('prefs', prefs);
    renderBest();
  });

  function openMenu() {
    const run = Arcade.state.get('run');
    const live = run && run.s && run.s.v === Core.SAVE_V && run.s.phase === 'play';
    $('continue').hidden = !live;
    if (live) {
      const hive = Core.hiveById(run.s.hive);
      $('continue-note').textContent = `In the smoker · ${fmt(run.ms || 0)}`;
      $('continue-title').textContent = run.daily ? `Back to the daily ${hive.name}` : `Back to the ${hive.name} frame`;
    }
    paintHive(); renderBest();
    s = null;
    show('menu');
  }

  $('play').addEventListener('click', newFrame);
  $('daily').addEventListener('click', () => {
    const t = today();
    startFrame(t.hive, t.seed, { daily: t.date });
  });
  $('continue').addEventListener('click', () => {
    const run = Arcade.state.get('run');
    if (!run || !run.s) return openMenu();
    begin(run.s, { ms: run.ms, daily: run.daily, paused: true });   // never straight into a live frame
  });
  $('code-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = Core.parseCode($('code-in').value);
    if (!code) { Arcade.ui.toast('That is not a frame code', { kind: 'error' }); return; }
    $('code-in').value = '';
    $('code-in').blur();
    startFrame(code.hive, code.seed);
  });
  $('pause').addEventListener('click', pause);
  $('resume').addEventListener('click', pause);
  $('quit').addEventListener('click', () => { persistRun(); openMenu(); });
  $('tool').addEventListener('click', () => { markMode = !markMode; renderHud(); });
  $('again').addEventListener('click', newFrame);
  $('won-menu').addEventListener('click', openMenu);
  $('retry').addEventListener('click', () => startFrame(s.hive, s.seed, { daily }));
  $('lost-new').addEventListener('click', newFrame);
  $('lost-menu').addEventListener('click', openMenu);

  bindInput($('view'), {
    active: () => mode === 'play',
    cellAt: (x, y) => R.cellAt(x, y),
    markMode: () => markMode,
    onTap: (i) => act(Core.tap, i),
    onMark: (i) => act(Core.mark, i),
    onPause: pause,
    onToggle: () => { markMode = !markMode; renderHud(); },
  });

  new ResizeObserver(fit).observe(stage);
  fit();

  // Hidden means smoke's out: the clock stops, and the run is written down in
  // case the frame is evicted while we're away.
  Arcade.onSuspend(() => { if (mode === 'play') show('paused'); persistRun(); });
  Arcade.onStateReplaced(() => {
    migrateStored();
    prefs = { hive: 0, ...(Arcade.state.get('prefs') || {}) };
    openMenu();
  });

  // ?dev=1 — a handle for test drivers and the console; never for the game.
  if (new URLSearchParams(location.search).has('dev')) {
    window.__hive = {
      get s() { return s; }, get mode() { return mode; }, get elapsed() { return elapsed(); },
      layout: R.layout, at: R.at, Core, today,
    };
  }

  openMenu();
}

boot();
