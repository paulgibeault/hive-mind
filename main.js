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
import { refused } from './juice.js';
import * as Reads from './reads.js';
import * as Hint from './hint.js';
import { honeyColour, HONEY } from './honey.js';
import * as Pantry from './pantry.js';
import * as Week from './week.js';
import * as Ghost from './ghost.js';
import { createRaceBar } from './race.js';

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
let wake = null;              // a resting loop's one more frame, for a still that ends
let input = null;
let frames = 0;               // frames drawn, for test drivers checking the loop rests
let tickTimer = null;
let reads = Reads.fresh();    // this run's { clean, lucky, hints, puffs } (#03)
let lesson = null;            // what the last sting should have taught (#04)

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
function paintClock() { $('hud-clock').textContent = fmt(elapsed()); paintRace(); }

// ── sheets ───────────────────────────────────────────────────────────────
const SHEETS = ['menu', 'paused', 'won', 'lost', 'pantry'];
function show(next) {
  if (next !== 'play') unhint();          // a hint lives only over a live frame (#07)
  mode = next;
  for (const id of SHEETS) $(id).hidden = id !== mode;
  $('rail').hidden = !s || mode === 'menu';
  runClock(mode === 'play');
  kick();
}

function kick() { if (loop) loop.kick(); }
function frame() {
  const now = performance.now();
  R.view.hold = input ? input.pressing(now) : null;
  const moving = R.draw(mode === 'menu' ? null : s, now);
  frames++;
  if (moving) loop.start(); else { loop.stop(); rest(R.view.wakeAt - now); }
}
// The loop rests as soon as nothing moves. With motion off, a still that has
// to end (an outline shown for 120 ms) asks for one more frame when it does.
function rest(ms) {
  if (wake) { wake.cancel(); wake = null; }
  if (Number.isFinite(ms)) wake = Arcade.session.setTimeout(() => { wake = null; kick(); }, Math.max(0, ms) + 1);
}

// ── the rail ─────────────────────────────────────────────────────────────
function renderHud() {
  if (!s) return;
  const hive = Core.hiveById(s.hive);
  $('hud-hive').textContent = daily ? `Daily · ${hive.name}` : hive.name;
  $('hud-reads').textContent = Reads.railLine(reads);
  $('hud-reads').classList.toggle('pure', Reads.isPure(reads));
  $('paused-code').textContent = Core.boardCode(s.hive, s.seed);
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
  if (s && (s.phase === 'play' || calmable())) {
    // a stung run kept for the smoker takes its lesson along (#08)
    Arcade.state.set('run', { s: { ...s, events: [] }, ms: elapsed(), daily, reads, lesson: s.phase === 'lost' ? lesson : null, tl: timeline });
  }
}
function dropRun() { Arcade.state.set('run', null); }

function begin(state, opts = {}) {
  s = state;
  s.events = [];
  daily = opts.daily || null;
  base = opts.ms || 0;
  reads = opts.reads || Reads.fresh();
  raceBegin(opts);                                   // #11
  clock.reset();
  clock.pause();
  lastTap = -1;
  markMode = false;
  sfxReset();
  R.reset();
  unteach();
  fit();
  renderHud();
  show(opts.paused ? 'paused' : 'play');
}

function startFrame(hiveId, seed, opts = {}) {
  begin(Core.newGame(hiveId, seed), opts);
  bump(hiveId, 'played');
  persistRun();
}

// per hive: { played, won, pure }
function bump(hiveId, field) {
  Arcade.stats.update('frames', (prev) => {
    const k = { played: 0, won: 0, pure: 0, ...(prev && prev[hiveId]) };
    return { ...prev, [hiveId]: { ...k, [field]: k[field] + 1 } };
  });
}

function newFrame() {
  startFrame(chosenHive().id, (Math.random() * 0x100000000) >>> 0);
}

// ── the daily frame ──────────────────────────────────────────────────────
// One frame a day for everyone, rolling at local midnight (Arcade.daily).
// The hive rotates with the day so each kind comes round every third day.
function today() {
  const date = Arcade.daily.dateStr();
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  const n = Core.PICKABLE.length;                    // never the hidden Queen's Frame (#10)
  const hive = Core.PICKABLE[((day % n) + n) % n].id;
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
  $('daily-note').textContent = `Daily · ${Pantry.dayDate(t.date)}`;
  $('daily-title').textContent = done ? `${hive.name} — cleared` : `Today: ${hive.name}`;
  $('daily-time').textContent = done ? fmtExact(done.ms) : '';
  $('daily').classList.toggle('done', !!done);
  const n = streak(log, t.date);
  paintComb(t.date, log, n, !!done);                 // #09
  return n;
}

// ── records ──────────────────────────────────────────────────────────────
function renderBest() {
  const hive = chosenHive();
  const best = Arcade.records.get(`time-${hive.id}`);
  const k = (Arcade.stats.getOrInit('frames', {})[hive.id]) || { played: 0, won: 0 };
  paintDaily();
  paintPantryStrip();                                // #09
  paintQueen();                                      // #10
  const bits = [];
  if (best) bits.push(`${hive.name} best ${fmtExact(best.value)}`);
  if (k.played) bits.push(`${k.won} of ${k.played} cleared`);
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
  // Pure: no lucky uncaps, no hints, no smoke (#03). Its own record and count.
  const pure = Reads.isPure(reads);
  if (pure) {
    Arcade.records.best(`pure-time-${hive.id}`, {
      value: ms, direction: 'lower', format: 'duration-ms', label: `${hive.name} — fastest Pure frame`,
    });
    bump(hive.id, 'pure');
  }
  if (daily) {
    // the day keeps its fastest clear; `pure` says whether any clear that
    // day was Pure
    const date = daily;
    Arcade.stats.update('daily', (log) => {
      const was = log && log[date];
      const best = was && was.ms <= ms ? was : { ms, hive: hive.id };
      return { ...log, [date]: { ...best, pure: pure || !!(was && was.pure) } };
    });
  }
  weeklyWin(ms, pure);                               // #10: the Queen's Frame's week
  raceFinish(ms);                                    // #11: the pace, and the ghost's line
  fillJar(ms, pure);                                 // #09: the jar, and the caption
  $('won-time').textContent = fmtExact(ms);
  $('won-best').textContent = !prev ? 'First clear' : ms < prev.value ? `New best — was ${fmtExact(prev.value)}` : `Best ${fmtExact(prev.value)}`;
  $('won-code').textContent = Core.boardCode(s.hive, s.seed);
  const total = reads.clean + reads.lucky;
  const many = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  $('won-reads').textContent = `${reads.clean} of ${total} clean · ${many(reads.hints, 'hint')} · ${many(reads.puffs, 'puff')}`;
  $('won-pure').hidden = !pure;
  $('won-help').textContent = Hint.costLine(reads.hints);   // #07
  $('won-help').hidden = !reads.hints;
}

// ── the pantry and the comb calendar (#09) ──────────────────────────────
// Every win fills a jar in Arcade.stats('pantry') (pantry.js keeps the
// shape), coloured by honey.js. The jars live on the menu's pantry strip, the
// hive buttons, the pantry sheet and the won sheet; the daily strip draws the
// month as comb. All of it is after a win or outside play: honey colour is
// never shown for a frame still being played.
const JAR_CLINK_MS = 1100;          // the won sheet's jar has filled: it clinks
const SVGNS = 'http://www.w3.org/2000/svg';
let picked = null;                  // the jar the pantry's detail card shows
let clink = null;

const pantryNow = () => Pantry.normalize(Arcade.stats.get('pantry'));
const shelfHives = () => Core.HIVES;                // every hive has a shelf, the Queen's Frame's too (#10)
const hiveName = (id) => (shelfHives().find((h) => h.id === id) || { name: id }).name;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const jarLabel = (j) => [hiveName(j.hive), Pantry.shortDate(j.date), fmt(j.ms), j.pure && 'pure'].filter(Boolean).join(', ');

/** A jar of this frame's honey: a lid, the glass and its honey, and a wax seal if Pure. */
function jarEl(hive, seed, opts = {}) {
  const el = document.createElement(opts.button ? 'button' : 'span');
  el.className = `jar${opts.cls ? ` ${opts.cls}` : ''}`;
  const c = honeyColour(hive, seed);
  el.style.setProperty('--top', c.top);
  el.style.setProperty('--bottom', c.bottom);
  el.innerHTML = '<i class="lid"></i><i class="glass"><i class="honey"></i></i>';   // our own constant markup
  if (opts.pure) { const w = document.createElement('i'); w.className = 'wax'; el.append(w); }
  if (opts.button) el.type = 'button'; else el.setAttribute('aria-hidden', 'true');
  return el;
}

/** A hive's flower swatch: a hex of its honey (Wildflowers shows three blends). */
function swatch(id) {
  const i = document.createElement('i');
  i.className = 'swatch';
  i.setAttribute('aria-hidden', 'true');
  const c = honeyColour(id, 1);
  const tones = id === 'wildflowers' ? [11, 5, 23].map((k) => honeyColour(id, k).bottom) : [c.top, c.bottom];
  i.style.background = `linear-gradient(135deg, ${tones.join(', ')})`;
  return i;
}

/* Into the pantry on a win, and the won sheet's jar fills with it. */
function fillJar(ms, pure) {
  let r = null;
  Arcade.stats.update('pantry', (prev) => {
    r = Pantry.addJar(prev, {
      hive: s.hive, seed: s.seed, ms, pure, clean: reads.clean, hints: reads.hints, puffs: reads.puffs,
      date: Arcade.daily.dateStr(), timeline,       // #11: kept only if this clear is the jar's best
    });
    return r.pantry;
  });
  const jar = jarEl(s.hive, s.seed, { cls: `big${R.view.motion ? ' fill' : ''}` });
  $('won-jar').replaceChildren(jar, $('won-pure'));
  $('won-note').textContent = [daily && 'Daily', pure && 'Pure', `jar ${r.jar.n}`,
    (HONEY[s.hive] || HONEY.clover).name].filter(Boolean).join(' · ');
  // the clink once the jar has filled; a Pure jar is pressed with its seal
  if (clink) clink.cancel();
  clink = Arcade.session.setTimeout(() => {
    clink = null;
    if (mode === 'won') sfx('jar', cue({ kind: pure ? 'seal' : undefined }));
  }, JAR_CLINK_MS);
}

// ── the menu: the comb calendar, the pantry strip, the hive buttons' jars
function paintComb(date, log, n, doneToday) {
  const m = Pantry.combMonth(date, log);
  const svg = $('month-comb');
  svg.replaceChildren();
  if (!m) return;
  const r = 13, w = Math.sqrt(3) * r, k = 0.92;
  const rows = Math.ceil((m.lead + m.days.length) / 7);
  const W = w * 7.5, H = r * 2 + 1.5 * r * (rows - 1);
  svg.setAttribute('viewBox', `0 0 ${W.toFixed(1)} ${H.toFixed(1)}`);
  const hex = (cx, cy, rr) => Array.from({ length: 6 }, (_, j) => {
    const a = Math.PI / 3 * j - Math.PI / 2;
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  for (const d of m.days) {
    const slot = m.lead + d.day - 1, x = slot % 7, y = Math.floor(slot / 7);
    const cx = w * (x + 0.5 + (y & 1 ? 0.5 : 0)), cy = r + 1.5 * r * y;
    const p = document.createElementNS(SVGNS, 'polygon');
    p.setAttribute('points', hex(cx, cy, r * k));
    p.setAttribute('class', `day ${d.state}${d.cleared ? ' cleared' : ''}`);
    svg.append(p);
    if (d.pure) {
      const c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('cx', cx.toFixed(1)); c.setAttribute('cy', cy.toFixed(1)); c.setAttribute('r', '3.6');
      c.setAttribute('class', 'seal-dot');
      svg.append(c);
    }
  }
  const past = m.days.filter((d) => d.state !== 'future').length;
  $('daily-streak').textContent = n > 1 ? `${n}-day streak.${doneToday ? '' : ' Keep it going.'}`
    : n === 1 ? `1-day streak.${doneToday ? '' : ' Keep it going.'}` : "Clear today's to start a streak.";
  svg.setAttribute('aria-label', `${m.name}: ${m.cleared} of ${plural(past, 'day')} cleared`
    + `${m.pure ? `, ${m.pure} of them Pure` : ''}. ${n ? `${n}-day streak.` : 'No streak yet.'}`);
}

function paintPantryStrip() {
  const p = pantryNow();
  const t = Pantry.totals(p);
  $('pantry-sum').textContent = t.jars ? `${plural(t.jars, 'jar')} · ${t.pure} sealed` : 'empty';
  const shelf = $('pantry-mini');
  shelf.replaceChildren();
  const jars = Pantry.recent(p, 24).reverse();       // newest first; the CSS draws it on the right
  for (const j of jars) {
    const el = jarEl(j.hive, j.seed, { cls: 'mini', pure: j.pure });
    el.style.setProperty('--h', `${38 + (j.n % 3) * 6}px`);
    shelf.append(el);
  }
  if (!jars.length) {
    const e = document.createElement('span');
    e.className = 'slot-empty mini';
    const words = document.createElement('span');
    words.className = 'empty-note';
    words.textContent = 'Clear a frame to fill your first jar.';
    shelf.append(words, e);                         // reversed by the CSS
  }
  $('pantry-open').setAttribute('aria-label',
    `The pantry: ${t.jars ? `${plural(t.jars, 'jar')}, ${t.pure} sealed Pure` : 'no jars yet'}`);
}

function paintHiveJars() {
  const p = pantryNow();
  [...$('hive').children].forEach((b, i) => {
    b.querySelector('.jars span').textContent = plural(Pantry.countsOf(p, Core.PICKABLE[i].id).jars, 'jar');
  });
}

// ── the pantry sheet ─────────────────────────────────────────────────────
function openPantry() {
  const p = pantryNow();
  const t = Pantry.totals(p);
  $('pantry-count').textContent = t.jars ? `${plural(t.jars, 'jar')} · ${t.pure} sealed Pure` : 'No jars yet';
  const shelves = $('shelves');
  shelves.replaceChildren();
  let newest = null;
  for (const h of shelfHives()) {
    const c = Pantry.countsOf(p, h.id), jars = Pantry.jarsOf(p, h.id);
    const box = document.createElement('section');
    box.className = 'shelf-box';
    const head = document.createElement('div');
    head.className = 'shelf-head';
    const title = document.createElement('h3');
    title.id = `shelf-${h.id}`;
    title.append(swatch(h.id), h.name);
    const note = document.createElement('span');
    note.textContent = `${(HONEY[h.id] || HONEY.clover).note} · ${c.jars}`;
    head.append(title, note);
    const shelf = document.createElement('div');
    shelf.className = 'shelf';
    shelf.setAttribute('role', 'group');
    shelf.setAttribute('aria-labelledby', title.id);
    if (c.older) {
      const o = document.createElement('span');
      o.className = 'older mono';
      o.textContent = `+${c.older} older`;
      shelf.append(o);
    }
    for (const j of jars) {
      const b = jarEl(j.hive, j.seed, { button: true, pure: j.pure });
      b.setAttribute('aria-label', jarLabel(j));
      b.tabIndex = -1;
      b.addEventListener('click', () => pickJar(j, b));
      shelf.append(b);
      if (!newest || j.n > newest.jar.n) newest = { jar: j, el: b };
    }
    if (jars.length) shelf.lastElementChild.tabIndex = 0;      // roving: one tab stop per shelf
    else {
      const e = document.createElement('span');
      e.className = 'slot-empty';
      const words = document.createElement('span');
      words.className = 'empty-note';
      words.textContent = h.hidden ? 'The weekly frame. Its jar waits here.' : 'No jars yet.';
      shelf.append(e, words);
    }
    box.append(head, shelf);
    shelves.append(box);
  }
  show('pantry');
  $('pantry').scrollTop = 0;
  if (newest) pickJar(newest.jar, newest.el);
  else { picked = null; $('jar-detail').hidden = true; }
  $('pantry-back').focus();
}

function pickJar(j, el) {
  picked = j;
  for (const b of $('shelves').querySelectorAll('.jar[aria-pressed="true"]')) b.setAttribute('aria-pressed', 'false');
  el.setAttribute('aria-pressed', 'true');
  for (const b of el.parentNode.querySelectorAll('.jar')) b.tabIndex = b === el ? 0 : -1;
  $('jar-detail').hidden = false;
  $('detail-jar').replaceChildren(jarEl(j.hive, j.seed, { cls: 'big', pure: j.pure }));
  $('detail-note').textContent = `${hiveName(j.hive)} · ${Pantry.shortDate(j.date)}${j.pure ? ' · Pure' : ''}`;
  $('detail-code').textContent = j.code;
  $('detail-line').textContent = [fmtExact(j.ms), `${j.clean} clean`, plural(j.hints, 'hint'), plural(j.puffs, 'puff')].join(' · ');
  $('detail-words').textContent = (j.hive === 'wildflowers' ? "This blend came from the frame's own seed. " : '')
    + (j.pure ? 'Sealed Pure: every cell read clean.' : 'Replay the code to try for the seal.');
}

/* Arrow keys walk a shelf (up and down by a row of jars); Home and End jump. */
function shelfKeys(e) {
  const el = e.target;
  if (!el.classList || !el.classList.contains('jar')) return;
  const jars = [...el.parentNode.querySelectorAll('.jar')];
  const i = jars.indexOf(el);
  const perRow = jars.filter((b) => b.offsetTop === el.offsetTop).length || 1;
  const to = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: jars.length - 1,
    ArrowUp: i - perRow, ArrowDown: i + perRow }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  const next = jars[Math.max(0, Math.min(jars.length - 1, to))];
  for (const b of jars) b.tabIndex = b === next ? 0 : -1;
  next.focus();
}

/* Send a jar's code: the share sheet, else the clipboard and a toast. */
async function sendJar(code) {
  try {
    // the SDK's share: navigator.share({ text }) standalone, the launcher's sheet when framed,
    // and the clipboard with a toast where neither can
    if (Arcade.ui && Arcade.ui.share) { await Arcade.ui.share({ text: code }); return; }
    if (navigator.share) { await navigator.share({ text: code }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try {
    await navigator.clipboard.writeText(code);
    Arcade.ui.toast(`Copied ${code}`);
  } catch { Arcade.ui.toast(`Frame code ${code}`); }
}

function bindPantry(openMenu) {
  $('pantry-open').addEventListener('click', openPantry);
  $('pantry-back').addEventListener('click', openMenu);
  $('shelves').addEventListener('keydown', shelfKeys);
  $('pantry').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); openMenu(); } });
  $('detail-replay').addEventListener('click', () => { if (picked) startFrame(picked.hive, picked.seed); });
  $('detail-send').addEventListener('click', () => { if (picked) sendJar(picked.code); });
}

// ── the Queen's Frame (#10) ─────────────────────────────────────────────
// The weekly stacked hive (core.js `queen`, hidden from the hive selector and
// the daily) opens from its own menu strip. week.js names the frame week —
// Sunday 00:00 local to the next Sunday — and its seed, from the local date,
// so the same week is the same frame on every device. Arcade.stats('weekly')
// keeps each week's best clear, { 'YYYY-Www': { ms, pure } }; the records
// (time-queen, pure-time-queen) and the royal jar come from recordWin.
const thisWeek = () => Week.thisWeek(Arcade.daily.dateStr());
const weeklyLog = () => Arcade.stats.getOrInit('weekly', {});
/** The hive the selector has picked: a pickable one, whatever prefs held. */
const chosenHive = () => Core.PICKABLE[prefs.hive] || Core.PICKABLE[0];

function paintQueen() {
  const w = thisWeek();
  const done = weeklyLog()[w.week];
  const next = Week.nextFrameWords(w.daysLeft);
  $('queen-title').textContent = done ? `Cleared · ${fmtExact(done.ms)}` : 'Open all week';
  $('queen-line').textContent = done ? (done.pure ? 'Sealed Pure.' : 'Replay it for the Pure seal.')
    : 'Both kinds of guard, on broken comb.';
  $('queen-next').textContent = next;
  $('queen-strip').classList.toggle('done', !!done);
  // its jar, once this week's is filled; an empty slot until then
  const slot = $('queen-jar');
  if (done) slot.replaceChildren(jarEl('queen', w.seed, { cls: 'mini', pure: done.pure }));
  else { const e = document.createElement('span'); e.className = 'slot-empty mini'; slot.replaceChildren(e); }
  $('queen-strip').setAttribute('aria-label', `Queen's Frame, opens Sundays. ${done
    ? `This week's is cleared in ${fmtExact(done.ms)}${done.pure ? ', sealed Pure' : ''}.` : 'Open all week.'} ${next}.`);
}

/* A Queen's Frame cleared: the week it was dealt keeps its best clear. A QU-
 * code from any other week is a frame like any other. */
function weeklyWin(ms, pure) {
  if (s.hive !== 'queen') return;
  const week = Week.weekOf(s.seed, Arcade.daily.dateStr());
  if (!week) return;
  Arcade.stats.update('weekly', (log) => {
    const was = log && log[week];
    const best = was && was.ms <= ms ? was : { ms };
    return { ...log, [week]: { ...best, pure: pure || !!(was && was.pure) } };
  });
}

function openQueen() { startFrame('queen', thisWeek().seed); }

// ── the sting lesson (#04) ──────────────────────────────────────────────
// Shown only after a sting, from what was known before the tap: the card on
// the stung sheet, and rings on the frame that stay until the sheet closes.
function teach(l, now) {
  lesson = l;
  $('lesson').hidden = !l;
  $('lesson-text').textContent = l ? l.text : '';
  R.view.rings = l ? l.rings : [];
  R.view.ringsAt = now;
  placeLesson(now);
}
function unteach() {
  lesson = null;
  R.view.rings = [];
  R.view.lift = { from: 0, to: 0, at: -1 };
  R.view.dy = 0;
  $('lost').classList.remove('top');
  stage.classList.remove('lifted');
}

/* The sheet must not cover the rings. It docks at the bottom, where spare
 * height collects; if the rings sit under it, the frame slides up (the rail
 * gets a backdrop so the comb passing beneath it stays quiet). If they span
 * too much for that, the sheet docks to the top instead. If nothing fits
 * them all (a guess's safe cell can be far from the sting), the sheet stays
 * at the bottom and the frame keeps the lesson's own rings in view — the
 * proof, or the safe cell — ahead of the red one the player just tapped. */
function placeLesson(now, sheet = $('lost')) {
  sheet.classList.remove('top');
  stage.classList.remove('lifted');
  const rings = R.view.rings;
  if (!rings.length) { R.lift(0, now); return; }
  const r = R.layout.r, pad = 8;
  const span = (list) => {
    const ys = list.map((g) => R.at(g.i).y - R.view.dy);              // where they sit unlifted
    return { hi: Math.min(...ys) - r, lo: Math.max(...ys) + r };
  };
  const { hi, lo } = span(rings);
  const railBottom = $('rail').offsetTop + $('rail').offsetHeight + pad;
  const bottomRoom = sheet.offsetTop - pad;                // offsetTop ignores the rise animation
  const up = (dy) => { R.lift(Math.min(0, dy), now); stage.classList.toggle('lifted', dy < 0); };
  if (lo <= bottomRoom) { up(0); return; }
  if (lo - hi <= bottomRoom - railBottom) { up(bottomRoom - lo); return; }
  sheet.classList.add('top');
  const topRoom = sheet.offsetTop + sheet.offsetHeight + pad;
  if (lo - hi <= R.layout.H - pad - topRoom) { R.lift(Math.max(0, topRoom - hi), now); return; }
  sheet.classList.remove('top');
  const key = rings.filter((g) => g.color !== 'red');
  const k = span(key.length ? key : rings);
  up(Math.max(bottomRoom - k.lo, railBottom - k.hi));
}

// ── the smoker (#08) ────────────────────────────────────────────────────
// One second chance, at a cost: a puff calms the guard that stung (core.calm),
// adds PUFF_MS to the clock and a puff to the run's counters, so the frame
// isn't Pure any more. A stung run with a puff left is kept, lesson and all,
// so a reload can still puff; only Same frame / New frame / Menu let it go.
const PUFF_MS = 20000;
const calmable = () => !!s && s.phase === 'lost' && s.stung >= 0 && s.puffs > 0;

/** The stung sheet, for a sting just now or a stung run brought back. */
function showStung() {
  const kind = s.cells[s.stung];
  $('lost-note').textContent = daily ? `Daily frame · ${daily}` : Core.hiveById(s.hive).name;
  $('lost-title').textContent = kind === Core.Q ? "Stung by a queen's guard" : 'Stung';
  $('lost-left').textContent = `${Core.safeLeft(s)} safe cells were still capped.`;
  const can = calmable();
  $('puff').hidden = !can;
  $('puff').textContent = `Puff the smoker · +${PUFF_MS / 1000} s · ${s.puffs} left`;
  $('retry').className = can ? 'ghost' : 'primary';    // the smoker is the primary when it's there
  show('lost');
}

function puff() {
  if (mode !== 'lost' || !calmable() || !Core.calm(s)) return;
  base += PUFF_MS;
  reads = { ...reads, puffs: reads.puffs + 1 };
  unteach();                          // the rings go with the sheet
  show('play');
  drain(null);
  persistRun();
}

// ── the bee-line hint (#07) ─────────────────────────────────────────────
// off → look → why → off. "Look" rings the clues of the smallest proof for
// one proven move (hint.js decides which); "why" lights the target, dashes
// the guards those clues imply, and says why. The cost is paid as it opens:
// +10 s on the clock and the Pure seal. The hint itself lives only in
// memory: the run is saved with the cost paid and never with a hint open, so
// a reload clears it. It closes on "Got it", H on its last step, Esc, any
// tap on the frame (which still lands, act()), and any sheet (show()).
let hint = null;              // { step: 'look' | 'why', pick } while open
let lastTap = -1;             // the cell last tapped or marked; -1 for none (never saved)

function hintStep() {
  if (mode !== 'play' || !s) return;
  const now = performance.now();
  if (!hint) {
    const pick = Hint.pickHint(s, lastTap);
    if (!pick) return;
    hint = { step: 'look', pick };
    base += Hint.PENALTY_MS;
    reads = { ...reads, hints: reads.hints + 1 };
    Arcade.stats.update('hints', (prev) => ({ ...prev, [s.hive]: ((prev && prev[s.hive]) || 0) + 1 }));
    renderHud();
    persistRun();
    paintHint(now);
    sfx('hint', cue({ kind: 1 }));            // the bee flies past...
  } else if (hint.step === 'look' && hint.pick.kind === 'move') {
    hint.step = 'why';
    paintHint(now);
    sfx('hint', cue({ kind: 2 }));            // ...and lands
  } else unhint(now);
}

function paintHint(now) {
  const { step, pick } = hint, why = step === 'why';
  const mark = (v) => (v === Core.QUEEN ? Core.MARK_Q : Core.MARK_G);
  $('hint').hidden = false;
  $('hint-btn').setAttribute('aria-expanded', 'true');
  $('hint-step').textContent = why ? 'Bee-line · why' : 'Bee-line · look here';
  $('hint-text').textContent = why ? pick.why : pick.look;
  $('hint-why').hidden = why || pick.kind !== 'move';
  $('hint-row').classList.toggle('one', $('hint-why').hidden);
  const rings = pick.clues.map((i) => ({ i, color: 'honey' }));
  const ghosts = [];
  if (why) {
    rings.push({ i: pick.target, color: 'lit' });
    for (const g of pick.ghosts) ghosts.push({ i: g.i, kind: mark(g.value) });
    if (pick.value !== Core.SAFE) ghosts.push({ i: pick.target, kind: mark(pick.value) });   // "Mark it."
  } else R.view.ringsAt = now;
  R.view.rings = rings;
  R.view.ghosts = ghosts;
  placeLesson(now, $('hint'));          // #04's placement: the card never covers the rings
  kick();
}

function unhint(now = performance.now()) {
  if (!hint) return;
  hint = null;
  $('hint').hidden = true;
  $('hint').classList.remove('top');
  $('hint-btn').setAttribute('aria-expanded', 'false');
  R.view.rings = [];
  R.view.ghosts = [];
  stage.classList.remove('lifted');
  R.lift(0, now);
  kick();
}

function bindHint() {
  $('hint-btn').addEventListener('click', hintStep);
  $('hint-why').addEventListener('click', hintStep);
  $('hint-done').addEventListener('click', () => unhint());
}

// ── the ghost race (#11) ────────────────────────────────────────────────
// A frame whose jar keeps a pace (pantry.js `g`) races it: the rail's race bar
// (race.js) fills yours as you play and the ghost's at its pace, interpolated
// at your clock. The run records its own pace as it goes (ghost.js: the
// elapsed ms at each 5% past the opening, penalties included), saves it with
// the run, and hands it to the jar on a win, which keeps it only if this clear
// is its best. Both bars read only the open cells and the clock: no tells.
// A daily shows no ghost until it has been cleared once; "Show ghost" on the
// pause sheet (prefs.ghost, on unless set false) hides the bar and the line.
let ghost = null;             // { ms, timeline } of the best run, or null
let timeline = [];            // this run's pace so far; null when it can't be known
let opening = 0;              // cells the frame's opening uncapped
let bar = null;               // the race bar (race.js)

const ghostOn = () => prefs.ghost !== false;

function raceBegin(opts) {
  opening = Ghost.openingOf(s);
  // a saved run brings its pace; one saved before #11 with moves played can't
  timeline = opts.timeline !== undefined ? Ghost.restore(opts.timeline)
    : s.moves > 0 ? null : [];
  if (timeline && s.phase === 'play') {
    const p = Ghost.progressOf(s, opening);
    timeline = Ghost.record(timeline, p.done, p.total, opts.ms || 0);
  }
  const cleared = !daily || !!dailyLog()[daily];
  ghost = cleared ? Pantry.ghostOf(Arcade.stats.get('pantry'), s.hive, s.seed) : null;
  $('ghost-pref').checked = ghostOn();
  $('ghost-pref-row').hidden = !ghost;
  $('won-ghost').hidden = true;
}

function raceNote() {
  if (!s || !timeline) return;
  const p = Ghost.progressOf(s, opening);
  timeline = Ghost.record(timeline, p.done, p.total, elapsed());
}

function raceFinish(ms) {
  timeline = timeline ? Ghost.finish(timeline, ms) : null;
  const line = $('won-ghost');
  line.hidden = !ghost || !ghostOn();
  line.textContent = ghost ? Ghost.raceLine(ms, ghost.ms) : '';
}

function paintRace() {
  if (!bar) return;
  const on = !!s && !!ghost && ghostOn();
  bar.show(on);
  if (!on) return;
  const p = Ghost.progressOf(s, opening);
  bar.set(Ghost.fraction(p.done, p.total), Ghost.ghostAt(ghost.timeline, elapsed()), { ease: R.view.motion });
}

function bindRace() {
  bar = createRaceBar($('race'), { rival: 'Ghost' });
  bar.show(false);
  $('ghost-pref').addEventListener('change', (e) => {
    prefs = { ...prefs, ghost: e.target.checked };
    Arcade.state.set('prefs', prefs);
    paintRace();
  });
}

// ── core events → everything else ────────────────────────────────────────
// Every cue hears where the frame is ({ hive, seed, progress }), never what is
// under a cap. `extra` is only ever what this action has just shown.
const cue = (extra) => ({ ...cueContext(s), ...extra });

// One action is one sound: a flood or a sweep is a single cue scaled by how
// many cells it opened, never one uncap per cell; a flood drops one droplet
// per ring of the ripple the renderer draws. A lone broken comb (shown now
// that it is open) plays hollow.
function uncapSound(events, rings) {
  const ups = events.filter((e) => e.type === 'uncap');
  const n = ups.reduce((k, e) => k + e.cells.length, 0);
  if (n > 1) sfx('flood', cue({ cells: n, rings }));
  else if (n === 1) sfx('uncap', cue(s.broken[ups[0].cells[0]] ? { cells: 1, kind: 'broken' } : { cells: 1 }));
}

function drain(pre) {
  const now = performance.now();
  const events = s.events.splice(0);
  let rings = 0;                  // the deepest ripple this action drew
  for (const e of events) {
    switch (e.type) {
      case 'uncap':
        rings = Math.max(rings, R.uncapped(e, now));
        if (e.proven) R.glint(e.cell, now);          // a clean read (#03)
        break;
      case 'mark': R.marked(e.cell, e.mark, now); sfx(e.mark ? 'mark' : 'unmark', cue({ kind: e.mark })); break;
      case 'sting':
        R.stung(e.cell, now);
        sfx('sting', cue({ kind: e.kind }));
        if (navigator.vibrate) { try { navigator.vibrate([40, 40, 80]); } catch { /* not allowed */ } }
        runClock(false);
        if (!calmable()) dropRun();       // with a puff left, act() keeps it (#08)
        showStung();
        teach(pre ? Reads.lesson(s, pre.move, pre.proven) : null, now);   // #04, from the pre-tap read
        break;
      case 'calm':                        // the smoker (#08)
        R.smoked(e.cell, now);
        R.marked(e.cell, s.mark[e.cell], now);   // the right pin drops in under the haze
        sfx('smoke', cue({ kind: e.kind }));
        break;
      case 'won':
        runClock(false);
        R.won(honeyColour(s.hive, s.seed), now);
        sfx('won', cue());
        recordWin();
        dropRun();
        show('won');
        break;
      default: break;
    }
  }
  raceNote();                     // #11: checkpoints this action reached
  uncapSound(events, rings);      // same tick as the rest: order here is inaudible
  renderHud();
  loop.start();
}

function act(fn, i) {
  if (mode !== 'play' || !s) return;
  lastTap = i;
  if (hint) unhint();                   // a tap on the frame closes the hint, and still lands (#07)
  // Clean reads (#03): name what the tap would uncap and what the clues
  // proved, both BEFORE the move. One provenNow per tap; marks skip it.
  const move = fn === Core.tap ? Reads.moveAt(s, i) : null;
  const proven = move ? Core.provenNow(s) : null;
  const sweeping = fn === Core.tap && !!s.open[i];
  if (!fn(s, i)) {
    if (sweeping && refused(s, Core.nbrsOf(s.cols, s.rows), i)) {
      // the marks round it don't add up: the number shakes and knocks
      R.refused(i, performance.now());
      sfx('nope', cue());
      kick();
    }
    return;
  }
  if (move && s.phase !== 'lost') {
    const verdict = Reads.classify(move, proven);
    reads = Reads.tally(reads, verdict);
    for (const e of s.events) if (e.type === 'uncap') e.proven = verdict === 'clean';
  }
  if (sweeping) R.swept(i, performance.now());     // before its uncaps, which follow its light
  drain(move && { move, proven });      // the same pre-tap read teaches a sting (#04)
  persistRun();
}

function pause() {
  if (mode === 'play') { persistRun(); show('paused'); }
  else if (mode === 'paused') show('play');
}

// ── sizing & settings ────────────────────────────────────────────────────
function fit() {
  const r = stage.getBoundingClientRect();
  const hive = s ? s : chosenHive();
  R.resize(Math.max(1, r.width), Math.max(1, r.height), hive.cols, hive.rows, 56);
  if (mode === 'lost' && s) placeLesson(-1);
  if (hint) placeLesson(-1, $('hint'));
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
    small.className = 'jars';
    small.append(swatch(it.id), document.createElement('span'));   // filled by paintHiveJars (#09)
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
  if (!Core.PICKABLE[prefs.hive]) prefs.hive = 0;    // only a pickable hive is ever selected (#10)
  clock = Arcade.session.start();
  clock.pause();
  loop = Arcade.loop(frame);
  applySettings();
  Arcade.onSettingsChange(() => { applySettings(); kick(); });

  const paintHive = segmented($('hive'), Core.PICKABLE, () => prefs.hive, (i) => {
    prefs.hive = i;
    Arcade.state.set('prefs', prefs);
    renderBest();
  });

  function openMenu() {
    const run = Arcade.state.get('run');
    const kept = run && run.s && run.s.v === Core.SAVE_V;
    const stung = kept && run.s.phase === 'lost' && run.s.stung >= 0 && run.s.puffs > 0;   // #08
    const live = kept && (run.s.phase === 'play' || stung);
    $('continue').hidden = !live;
    if (live) {
      const hive = Core.hiveById(run.s.hive);
      $('continue-note').textContent = `${stung ? 'Stung' : 'In the smoker'} · ${fmt(run.ms || 0)}`;
      $('continue-title').textContent = run.daily ? `Back to the daily ${hive.name}`
        : hive.hidden ? `Back to the ${hive.name}` : `Back to the ${hive.name} frame`;
    }
    paintHive(); renderBest(); paintHiveJars();
    unteach();
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
    // never straight into a live frame; saves from before #03 carry no
    // counters (Reads.restore decides what that means for Pure)
    begin(run.s, { ms: run.ms, daily: run.daily, reads: Reads.restore(run.reads, run.s), timeline: run.tl, paused: true });
    // a stung run kept for the smoker comes back to its stung sheet (#08)
    if (calmable()) { showStung(); teach(run.lesson || null, performance.now()); }
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
  $('lost-menu').addEventListener('click', () => { dropRun(); openMenu(); });
  $('puff').addEventListener('click', puff);
  bindPantry(openMenu);                              // #09
  $('queen-strip').addEventListener('click', openQueen);   // #10

  input = bindInput($('view'), {
    active: () => mode === 'play',
    onPress: kick,                                   // the hold ring starts or ends
    cellAt: (x, y) => R.cellAt(x, y),
    markMode: () => markMode,
    onTap: (i) => act(Core.tap, i),
    onMark: (i) => act(Core.mark, i),
    onPause: pause,
    onToggle: () => { markMode = !markMode; renderHud(); },
    onHint: hintStep,
    onEscape: () => !!hint && (unhint(), true),     // Esc closes the hint before it pauses
  });
  bindHint();
  bindRace();                                        // #11

  new ResizeObserver(fit).observe(stage);
  fit();

  // Hidden means smoke's out: the clock stops, and the run is written down in
  // case the frame is evicted while we're away.
  Arcade.onSuspend(() => { if (mode === 'play') show('paused'); persistRun(); });
  Arcade.onStateReplaced(() => {
    migrateStored();
    prefs = { hive: 0, ...(Arcade.state.get('prefs') || {}) };
    if (!Core.PICKABLE[prefs.hive]) prefs.hive = 0;
    openMenu();
  });

  // ?dev=1 — a handle for test drivers and the console; never for the game.
  if (new URLSearchParams(location.search).has('dev')) {
    window.__hive = {
      get s() { return s; }, get mode() { return mode; }, get elapsed() { return elapsed(); }, get reads() { return reads; }, get lesson() { return lesson; },
      get frames() { return frames; }, get running() { return loop.running(); },
      layout: R.layout, at: R.at, view: R.view, Core, today, Pantry, honeyColour, Week, thisWeek,
    };
    Object.defineProperty(window.__hive, 'race', { get: () => ({ ghost, timeline, bar: bar && bar.state }) });   // #11
    Object.defineProperties(window.__hive, { hint: { get: () => hint }, lastTap: { get: () => lastTap } });
  }

  openMenu();
}

boot();
