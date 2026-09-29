// Hive Mind sound pack — first pass, NOT yet auditioned on the workbench.
//
// Loaded as a plain script after /arcade-audio.js; audio.js registers it with
// Arcade.audio, and the launcher's tools/soundpack renderer can load this same
// file to produce audition WAVs.
//
// ── a wooden hive box, a frame lifted out ───────────────────────────────
// The materials are WAX (a cap breaking: a small dry crack), HONEY (what an
// opening sounds like: soft drops), WOOD (the frame, knocked — the only
// pitched thing here) and the WASPS (a buzz; the one thing that is alarming).
//
// Contour grammar follows the fleet: rising is good, falling is over.
//
//   uncap    one cell opened              a wax crack and a drop
//   flood    an opening spreads           cracks, and drops rising with its size
//   mark     a pin goes in                a tiny click, higher for a hornet
//   unmark   the pin comes out            a softer, lower click
//   sting    you uncapped a wasp          a buzz swelling, and a thud
//   won      the frame is cleared         the frame knocked, three rising notes

(function (global) {
  const S = global.ArcadeAudioElements;
  if (!S) return;

  const ROOM = { dur: 0.6, decay: 0.28, preDelay: 0.006, wet: 0.22, shelfHz: 4400, shelfDb: -3, seed: 4217 };

  const SENDS = {
    'uncap': 0.06, 'flood': 0.12, 'mark': 0.04, 'unmark': 0.03, 'sting': 0.18, 'won': 0.3,
  };

  const LADDER = [0, 2, 4, 7, 9, 12];   // major pentatonic, in semitones
  const seed = (r) => (r() * 1e6) | 0;

  const wood = (ctx, o, t, f, gain, r) => {
    S.strike(ctx, o, t, { dur: 0.003, hp: 2600, gain: gain * 0.5, seed: seed(r) });
    S.body(ctx, o, t, {
      f0: f * S.cents(r, 5), gain,
      partials: [
        { ratio: 1.0, gain: 1.0, decay: 0.32 },
        { ratio: 2.76, gain: 0.3, decay: 0.12 },
        { ratio: 5.4, gain: 0.12, decay: 0.05 },
      ],
    });
  };

  const CUES = {
    'uncap': function (ctx, o, t, p, r) {
      S.strike(ctx, o, t, { dur: 0.004, hp: 3800, gain: 0.07, seed: seed(r) });
      S.rustle(ctx, o, t, { dur: 0.04, f0: 2600, f1: 3400, Q: 1.3, gain: 0.05, attack: 0.003, seed: seed(r) });
      return S.droplet(ctx, o, t + 0.02, { f0: S.between(r, 520, 600), f1: S.between(r, 1500, 1800), dur: 0.05, gain: 0.08, seed: seed(r) });
    },
    'flood': function (ctx, o, t, p, r) {
      const n = Math.min(6, 2 + Math.floor(Math.log2(Math.max(2, (p && p.cells) || 2))));
      S.strike(ctx, o, t, { dur: 0.004, hp: 3600, gain: 0.08, seed: seed(r) });
      S.rustle(ctx, o, t, { dur: 0.12, f0: 2400, f1: 4200, Q: 1.0, gain: 0.07, attack: 0.006, seed: seed(r) });
      for (let k = 0; k < n; k++) {
        S.droplet(ctx, o, t + 0.03 + k * S.between(r, 0.035, 0.05), {
          f0: 420 * Math.pow(2, LADDER[k] / 12), f1: 1400 * Math.pow(2, LADDER[k] / 12),
          dur: 0.05, gain: 0.09, seed: seed(r),
        });
      }
      return 0.12 + n * 0.05;
    },
    'mark': function (ctx, o, t, p, r) {
      const hornet = p && p.kind === 2;
      return S.chirp(ctx, o, t, { f: hornet ? 2900 : 2300, pulses: hornet ? 2 : 1, step: 0.035, gain: 0.05 });
    },
    'unmark': function (ctx, o, t, p, r) {
      return S.rustle(ctx, o, t, { dur: 0.035, f0: 1500, f1: 1100, Q: 1.4, gain: 0.04, attack: 0.004, seed: seed(r) });
    },
    'sting': function (ctx, o, t, p, r) {
      const hornet = p && p.kind === 2;
      S.drone(ctx, o, t, 0.7, { f: hornet ? 150 : 210, detune: 60, type: 'sawtooth', lp: 1800, fade: 0.12, gain: 0.07 });
      S.drone(ctx, o, t + 0.05, 0.6, { f: hornet ? 301 : 421, detune: 40, type: 'sawtooth', lp: 2600, fade: 0.1, gain: 0.03 });
      S.thump(ctx, o, t + 0.12, { f0: 110, f1: 45, dur: 0.35, attack: 0.01, gain: 0.2, seed: seed(r) });
      return 0.8;
    },
    'won': function (ctx, o, t, p, r) {
      [0, 4, 7].forEach((st, k) => wood(ctx, o, t + 0.1 + k * 0.13, 520 * Math.pow(2, st / 12), 0.16, r));
      S.droplet(ctx, o, t + 0.5, { f0: 700, f1: 2100, dur: 0.07, gain: 0.08, seed: seed(r) });
      return 1.4;
    },
  };

  S.registerPack({ name: 'hive-mind', ROOM, SENDS, CUES });
})(typeof window !== 'undefined' ? window : globalThis);
