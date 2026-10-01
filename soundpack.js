// Hive Mind sound pack — the sound pass (#06). Auditioned on the launcher's
// soundpack workbench: tools/soundpack.config.json and tools/audition.js.
//
// Loaded as a plain script after /arcade-audio.js; audio.js registers it with
// the launcher's audio, and the launcher's tools/soundpack renderer can load
// this same file to produce audition WAVs.
//
// ── a wooden hive box, a frame lifted out ───────────────────────────────
// The materials are WAX (a cap breaking: a small dry crack), HONEY (what an
// opening sounds like: soft drops), WOOD (the frame, knocked) and the GUARDS
// (sleeping bees; waking one is a comic surprise, not an alarm).
//
// Contour grammar follows the fleet: rising is good, falling is over.
//
//   uncap    one cell opened              a wax tick and (mostly) a drop, on the climb
//   flood    an opening spreads           a tick, and drops climbing from the current rung
//   mark     a pin goes in                a tiny click; a queen's guard pin clicks twice
//   unmark   the pin comes out            a softer, lower brush
//   sting    you woke a guard             a sleepy "mm?" bending up, then a soft thump
//   won      the frame is cleared         the frame knocked, three rising notes to the tonic
//   nope     a sweep can't fire           a dull knock on the frame, two notes falling
//   clean    a clean-read milestone       a glassy shimmer a fifth above the rung
//   hint     the bee-line hint            a bee flying past, left to right; step 2 lands
//   smoke    the smoker after a sting     a bellows puff, the guard drifting back to sleep
//   pour     the win's honey pour         drops rising, one per row; a pure frame adds a bell
//   jar      a jar into the pantry        a glass clink and a cork pop; a seal adds a press
//
// ── what a cue is told ──────────────────────────────────────────────────
// p = { hive, seed, progress, cells, kind } from the game (see mixer.js for
// what each may carry — never a hidden cell), plus from audio.js:
//   step     the rung on the hive's ladder, from progress (0..5)
//   variant  which variant set plays (never the last one)
//   vseed    this play's seed, from (frame seed, play count): a replayed
//            frame code plays the same sounds
// Every field is optional: the audition passes what it wants to hear.

(function (global) {
  const S = global.ArcadeAudioElements;
  if (!S) return;

  const ROOM = { dur: 0.6, decay: 0.28, preDelay: 0.006, wet: 0.22, shelfHz: 4400, shelfDb: -3, seed: 4217 };

  // Distance, really: the frequent cues sit dry and close, the rare ones further into the box.
  const SENDS = {
    'uncap': 0.06, 'flood': 0.12, 'mark': 0.04, 'unmark': 0.03, 'sting': 0.18, 'won': 0.3,
    'nope': 0.06, 'clean': 0.22, 'hint': 0.16, 'smoke': 0.2, 'pour': 0.26, 'jar': 0.14,
  };

  // ── one pack, one table: each hive is an instrument ───────────────────
  // root     the tonic every climb starts from and every win resolves to
  // ladder   six rungs, an octave, the climb a frame makes (rung 5 = octave)
  // modes    Wildflowers picks its ladder from the frame seed instead
  // partials the hive's struck body (wood knocks, the sting's thump, bells)
  // tone     the room tweak: how dark the hive's box is (a lowpass on its voice)
  // echo     the room tweak: one early reflection off the hive's walls
  // drop     the droplet's brightness
  const PENTA = [0, 2, 4, 7, 9, 12];
  const HIVE = {
    // soft marimba wood, warm and round — major pentatonic on C
    'clover': {
      root: 523.25, ladder: PENTA, tone: 2600, echo: null, drop: 2600,
      partials: [
        { ratio: 1.0, gain: 1.0, decay: 0.34 },
        { ratio: 3.93, gain: 0.22, decay: 0.07 },
        { ratio: 9.2, gain: 0.05, decay: 0.025 },
      ],
    },
    // plucked kalimba tines, a little brighter — pentatonic on D
    'apple': {
      root: 587.33, ladder: PENTA, tone: 4200, echo: { at: 0.045, gain: 0.16 }, drop: 3200,
      partials: [
        { ratio: 1.0, gain: 1.0, decay: 0.42 },
        { ratio: 5.95, gain: 0.3, decay: 0.05 },
        { ratio: 2.0, gain: 0.1, decay: 0.12 },
      ],
    },
    // glassy bells — the mode comes from the seed
    'wildflowers': {
      root: 659.25, tone: 6000, echo: { at: 0.07, gain: 0.22 }, drop: 3600,
      modes: [
        PENTA,                    // major pentatonic
        [0, 3, 5, 7, 10, 12],     // minor pentatonic
        [0, 2, 5, 7, 9, 12],      // yo
        [0, 2, 5, 7, 10, 12],     // suspended
        [0, 1, 5, 7, 10, 12],     // in
      ],
      partials: [
        { ratio: 1.0, gain: 1.0, decay: 0.5 },
        { ratio: 2.76, gain: 0.4, decay: 0.22 },
        { ratio: 5.4, gain: 0.2, decay: 0.1 },
        { ratio: 8.93, gain: 0.08, decay: 0.05 },
      ],
    },
  };

  const hiveOf = (p) => HIVE[p.hive] || HIVE.clover;
  const ladderOf = (h, p) => h.modes ? h.modes[(p.seed >>> 0) % h.modes.length] : h.ladder;
  // Past the octave the ladder repeats on its first five rungs, an octave up.
  const degree = (lad, i) => { const k = Math.max(0, i | 0); return lad[k % 5] + 12 * Math.floor(k / 5); };
  const hz = (h, semis) => h.root * Math.pow(2, semis / 12);
  const rungOf = (p) => Math.max(0, Math.min(5, p.step | 0));
  const rnd = (p, r) => (p.vseed ? S.rng(p.vseed) : r);
  const seed = (r) => (r() * 1e6) | 0;

  // The hive's room tweak: its voice, darkened to the box, with one reflection.
  function voice(ctx, o, h) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = h.tone;
    lp.connect(o);
    if (h.echo) {
      const d = ctx.createDelay(0.2);
      d.delayTime.value = h.echo.at;
      const g = ctx.createGain();
      g.gain.value = h.echo.gain;
      lp.connect(d); d.connect(g); g.connect(o);
    }
    return lp;
  }

  // The hive's body, struck: a contact click, then its partials.
  function knock(ctx, o, t, f, gain, r, h, opts) {
    const q = opts || {};
    S.strike(ctx, o, t, { dur: 0.003, hp: q.hp || 2600, gain: gain * 0.5, seed: seed(r) });
    S.body(ctx, o, t, {
      f0: f * S.cents(r, 5), gain,
      partials: h.partials.map((pt) => ({ ...pt, decay: pt.decay * (q.ring || 1) })),
    });
  }

  // A guard's hum: two triangles a few cents apart, gliding f0 → f1, through
  // a lowpass, with a wing flutter on the amplitude. The sting, the hint and
  // the smoker are all this one bee.
  function hum(ctx, dest, t, q) {
    const FLOOR = 0.0001;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = q.lp || 1200;
    lp.Q.value = 0.7;
    const am = ctx.createGain();
    am.gain.value = 1 - (q.flutter || 0.25);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = q.rate || 26;
    const depth = ctx.createGain();
    depth.gain.value = q.flutter || 0.25;
    lfo.connect(depth); depth.connect(am.gain);
    const g = ctx.createGain();
    const attack = q.attack || 0.04, release = q.release || 0.12, end = t + q.dur;
    g.gain.value = FLOOR;
    g.gain.setValueAtTime(FLOOR, t);
    g.gain.exponentialRampToValueAtTime(q.gain, t + attack);
    g.gain.setValueAtTime(q.gain, Math.max(t + attack, end - release));
    g.gain.exponentialRampToValueAtTime(FLOOR, end);
    for (const side of [-1, 1]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.detune.value = side * (q.detune || 7);
      o.frequency.setValueAtTime(q.f0, t);
      o.frequency.exponentialRampToValueAtTime(q.f1 || q.f0, t + (q.glide || q.dur));
      o.connect(lp);
      o.start(t); o.stop(end + 0.05);
    }
    lp.connect(am); am.connect(g); g.connect(dest);
    lfo.start(t); lfo.stop(end + 0.05);
    return q.dur;
  }

  // Broken comb: empty, so no honey drop — a dry, hollow give.
  function crumble(ctx, o, t, h, r) {
    for (let k = 0; k < 3; k++) {
      S.strike(ctx, o, t + 0.008 + k * S.between(r, 0.008, 0.015), { dur: 0.003, hp: S.between(r, 1200, 2200), gain: 0.05, seed: seed(r) });
    }
    S.rustle(ctx, o, t + 0.006, { dur: 0.045, f0: 1400, f1: 700, Q: 0.9, gain: 0.05, attack: 0.004, lp: 2600, seed: seed(r) });
    S.body(ctx, o, t + 0.004, {
      f0: (h.root / 2) * S.cents(r, 15), gain: 0.07,
      partials: [{ ratio: 1.0, gain: 1.0, decay: 0.045 }, { ratio: 1.51, gain: 0.5, decay: 0.03 }],
    });
    return 0.058;
  }

  // Four variant sets for the most-heard cues. Each play also moves pitch
  // ±15 cents and the filter centre ±15%.
  const UNCAP_V = [
    { hp: 3800, band: 2600, rise: 2.8, tick: 0.07 },
    { hp: 4400, band: 3000, rise: 2.4, tick: 0.06 },
    { hp: 3300, band: 2300, rise: 3.1, tick: 0.075 },
    { hp: 4000, band: 2800, rise: 2.6, tick: 0.065 },
  ];
  const FLOOD_V = [
    { lo: 0.035, hi: 0.05, rise: 3.2, band: 2400 },
    { lo: 0.03, hi: 0.042, rise: 3.0, band: 2700 },
    { lo: 0.04, hi: 0.055, rise: 3.5, band: 2200 },
    { lo: 0.033, hi: 0.047, rise: 2.8, band: 2550 },
  ];

  // Honey colour → clink pitch: pale honey rings higher. Clover is pale,
  // apple amber, wildflowers anywhere from amber to dark, by seed (#09's
  // honeyColour(hive, seed) should agree when it lands).
  const lightness = (p) => p.hive === 'apple' ? 0.6
    : p.hive === 'wildflowers' ? 0.25 + 0.4 * (((p.seed >>> 0) % 97) / 96) : 0.85;

  const CUES = {
    'uncap': function (ctx, o, t, p0, r0) {
      const p = p0 || {}, r = rnd(p, r0), h = hiveOf(p);
      const v = UNCAP_V[(p.variant | 0) % 4];
      const fc = S.between(r, 0.85, 1.15);
      S.strike(ctx, o, t, { dur: 0.004, hp: v.hp * fc, gain: v.tick, seed: seed(r) });
      S.rustle(ctx, o, t, { dur: 0.03, f0: v.band * fc, f1: v.band * 1.3 * fc, Q: 1.3, gain: 0.045, attack: 0.003, seed: seed(r) });
      if (p.kind === 'broken') return crumble(ctx, o, t, h, r);
      if (r() < 0.6) {
        const f = hz(h, degree(ladderOf(h, p), rungOf(p))) * S.cents(r, 15);
        S.droplet(ctx, o, t + S.between(r, 0.006, 0.014), {
          f0: f, f1: f * v.rise, dur: 0.028, gain: 0.08, tone: h.drop * fc, seed: seed(r),
        });
      }
      return 0.058;
    },
    'flood': function (ctx, o, t, p0, r0) {
      const p = p0 || {}, r = rnd(p, r0), h = hiveOf(p), lad = ladderOf(h, p);
      const v = FLOOD_V[(p.variant | 0) % 4];
      const fc = S.between(r, 0.85, 1.15);
      // one droplet per ring of the ripple when the game says how deep it ran,
      // else a run that grows with the flood's size
      const n = p.rings > 0 ? Math.min(6, Math.max(2, p.rings | 0))
        : Math.min(6, 2 + Math.floor(Math.log2(Math.max(2, p.cells || 2))));
      S.strike(ctx, o, t, { dur: 0.004, hp: 3600 * fc, gain: 0.08, seed: seed(r) });
      S.rustle(ctx, o, t, { dur: 0.1, f0: v.band * fc, f1: v.band * 1.7 * fc, Q: 1.0, gain: 0.06, attack: 0.006, seed: seed(r) });
      // from the current rung, an octave under the single uncap so a big
      // flood climbs without shrieking
      const s0 = rungOf(p);
      let at = t + 0.03;
      for (let k = 0; k < n; k++) {
        const f = hz(h, degree(lad, s0 + k) - 12) * S.cents(r, 15);
        S.droplet(ctx, o, at, { f0: f, f1: f * v.rise, dur: 0.045, gain: 0.085, tone: h.drop * fc, seed: seed(r) });
        at += S.between(r, v.lo, v.hi);
      }
      return 0.12 + n * 0.05;
    },
    'mark': function (ctx, o, t, p0, r0) {
      const p = p0 || {}, r = rnd(p, r0);
      const b = (p.variant | 0) & 1;
      const queen = p.kind === 2;
      S.strike(ctx, o, t, { dur: 0.003, hp: b ? 4400 : 3600, gain: 0.05, seed: seed(r) });
      return S.chirp(ctx, o, t, {
        f: (queen ? 2900 : 2300) * (b ? 1.06 : 1) * S.cents(r, 15),
        pulses: queen ? 2 : 1, step: 0.035, pulse: b ? 0.014 : 0.018, gain: 0.095,
      });
    },
    'unmark': function (ctx, o, t, p0, r0) {
      const p = p0 || {}, r = rnd(p, r0);
      const b = (p.variant | 0) & 1;
      const fc = S.between(r, 0.85, 1.15);
      return S.rustle(ctx, o, t, {
        dur: 0.035, f0: (b ? 1300 : 1500) * fc, f1: (b ? 950 : 1100) * fc, Q: 1.4, gain: 0.074, attack: 0.004, seed: seed(r),
      });
    },
    'sting': function (ctx, o, t, p0, r0) {
      const p = p0 || {}, r = rnd(p, r0), h = hiveOf(p);
      const queen = p.kind === 2;
      const f = (queen ? 220 / 1.5 : 220) * S.cents(r, 15);   // the queen's guard, a fifth lower
      // "mm?" — a sleepy hum bending up a fourth
      hum(ctx, o, t, { f0: f, f1: f * 1.335, glide: 0.15, dur: 0.3, attack: 0.05, release: 0.1, gain: 0.065, lp: 1200, rate: 24 });
      // then a soft thump, with a knock above 400 Hz so it survives a phone speaker
      S.thump(ctx, o, t + 0.27, { f0: 140, f1: 60, dur: 0.18, attack: 0.006, gain: 0.1, seed: seed(r) });
      knock(ctx, voice(ctx, o, h), t + 0.27, (queen ? 880 / 1.5 : 880) * S.cents(r, 10), 0.025, r, h, { hp: 1800, ring: 0.35 });
      return 0.45;
    },
    'won': function (ctx, o, t, p0, r0) {
      const p = p0 || {}, r = rnd(p, r0), h = hiveOf(p), lad = ladderOf(h, p);
      const out = voice(ctx, o, h);
      // three rising knocks that resolve on the tonic of the ladder the frame climbed
      [lad[3] - 12, lad[4] - 12, 0].forEach((st, k) => {
        knock(ctx, out, t + 0.1 + k * 0.13, hz(h, st), k === 2 ? 0.19 : 0.15, r, h, { ring: k === 2 ? 1.6 : 1 });
      });
      S.droplet(ctx, o, t + 0.5, { f0: hz(h, 7), f1: hz(h, 7) * 2.9, dur: 0.07, gain: 0.07, seed: seed(r) });
      return 1.4;
    },

    // ── registered now, played once their features land ───────────────
    'nope': function (ctx, o, t, p0, r0) {
      const p = p0 || {}, r = rnd(p, r0), h = hiveOf(p), lad = ladderOf(h, p);
      const b = (p.variant | 0) & 1;
      // the frame is plain wood whatever the hive: dull, short, falling
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      lp.connect(o);
      const frame = { partials: [{ ratio: 1.0, gain: 1.0, decay: 0.08 }, { ratio: 2.76, gain: 0.18, decay: 0.03 }] };
      [b ? lad[3] : lad[2], b ? lad[1] : 0].forEach((st, k) => {
        knock(ctx, lp, t + k * 0.09, hz(h, st - 12) * S.cents(r, 15), 0.063, r, frame, { hp: 900 });
      });
      return 0.24;
    },
    'clean': function (ctx, o, t, p0, r0) {
      const p = p0 || {}, r = rnd(p, r0), h = hiveOf(p), lad = ladderOf(h, p);
      const f = hz(h, degree(lad, rungOf(p)) + 7) * S.cents(r, 10);   // a fifth above the rung
      const shimmer = (at, ff, gain) => S.body(ctx, o, at, {
        f0: ff, gain,
        partials: [
          { ratio: 1.0, gain: 1.0, decay: 0.55, attack: 0.012, detune: 9 },
          { ratio: 2.76, gain: 0.3, decay: 0.2, attack: 0.01, detune: 14 },
        ],
      });
      shimmer(t, f, 0.05);
      shimmer(t + 0.06, f * 2, 0.025);
      shimmer(t + 0.11, f * 1.5, 0.018);
      return 0.75;
    },
    'hint': function (ctx, o, t, p0, r0) {
      const p = p0 || {}, r = rnd(p, r0);
      const land = p.kind === 2;   // step 2: the bee lands
      const dur = land ? 0.6 : 0.9;
      const f = 230 * S.cents(r, 15);
      let dest = o;
      if (ctx.createStereoPanner) {
        dest = ctx.createStereoPanner();
        dest.pan.setValueAtTime(land ? 0.1 : -0.9, t);
        dest.pan.linearRampToValueAtTime(land ? 0.5 : 0.9, t + dur);
        dest.connect(o);
      }
      if (land) hum(ctx, dest, t, { f0: f, f1: f * 0.66, glide: dur * 0.85, dur, attack: 0.08, release: 0.04, gain: 0.056, lp: 2000, rate: 38, flutter: 0.35 });
      // passing by: a touch sharp coming in, flat going away
      else hum(ctx, dest, t, { f0: f * 1.05, f1: f * 0.94, dur, attack: dur * 0.45, release: dur * 0.5, gain: 0.056, lp: 2000, rate: 40, flutter: 0.35 });
      return dur;
    },
    'smoke': function (ctx, o, t, p0, r0) {
      const p = p0 || {}, r = rnd(p, r0);
      const queen = p.kind === 2;
      // the bellows
      S.rustle(ctx, o, t, { dur: 0.35, f0: 500, f1: 900, Q: 0.8, gain: 0.042, attack: 0.18, lp: 1800, seed: seed(r) });
      // the guard, drifting down and fading: back to sleep
      const f = (queen ? 220 / 1.5 : 220) * S.cents(r, 15);
      hum(ctx, o, t + 0.3, { f0: f, f1: f * 0.75, dur: 0.9, attack: 0.06, release: 0.6, gain: 0.042, lp: 1000, rate: 20 });
      return 1.25;
    },
    'pour': function (ctx, o, t, p0, r0) {
      const p = p0 || {}, r = rnd(p, r0), h = hiveOf(p), lad = ladderOf(h, p);
      const rows = Math.max(4, Math.min(24, p.cells || 12));   // one drop per row of the pour
      for (let k = 0; k < rows; k++) {
        const f = hz(h, degree(lad, Math.round((k * 8) / (rows - 1))) - 12) * S.cents(r, 15);
        S.droplet(ctx, o, t + k * 0.06, { f0: f, f1: f * 2.8, dur: 0.05, gain: 0.26, tone: h.drop, seed: seed(r) });
      }
      let end = t + rows * 0.06;
      if (p.kind === 'pure') {
        knock(ctx, voice(ctx, o, HIVE.wildflowers), end + 0.05, hz(h, 12), 0.12, r, HIVE.wildflowers, { ring: 2 });
        end += 1.2;
      }
      return end - t + 0.3;
    },
    'jar': function (ctx, o, t, p0, r0) {
      const p = p0 || {}, r = rnd(p, r0);
      const f = (1400 + 1600 * lightness(p)) * S.cents(r, 10);
      // the clink
      S.strike(ctx, o, t, { dur: 0.003, hp: 3000, gain: 0.08, seed: seed(r) });
      S.body(ctx, o, t, {
        f0: f, gain: 0.12,
        partials: [{ ratio: 1.0, gain: 1.0, decay: 0.28 }, { ratio: 2.32, gain: 0.35, decay: 0.12 }, { ratio: 4.1, gain: 0.12, decay: 0.05 }],
      });
      // the cork
      S.droplet(ctx, o, t + 0.2, { f0: 260, f1: 820, dur: 0.03, gain: 0.16, tone: 1600, seed: seed(r) });
      if (p.kind === 'seal') {
        S.rustle(ctx, o, t + 0.36, { dur: 0.14, f0: 420, f1: 300, Q: 0.9, gain: 0.08, attack: 0.05, lp: 900, seed: seed(r) });
        return 0.6;
      }
      return 0.4;
    },
  };

  S.registerPack({ name: 'hive-mind', ROOM, SENDS, CUES, HIVE });
})(typeof window !== 'undefined' ? window : globalThis);
