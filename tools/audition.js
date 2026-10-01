// Hive Mind — the audition timeline for the launcher's soundpack workbench.
// Test material: never shipped (tools/ is dev-only).
//
//   # from the launcher checkout next door
//   node tools/soundpack/render.mjs  --config ../hive-mind/tools/soundpack.config.json
//   node tools/soundpack/analyze.mjs ../hive-mind/audio-out/hive-mind-full.manifest.json
//
// Params are what audio.js would hand a cue in play: the frame context, plus
// the rung, the variant and the per-play seed the mixer derives.

(function (global) {
  const A = global.ArcadeAudition;
  const HIVES = ['clover', 'apple', 'wildflowers', 'queen', 'sunflower'];
  const P = (o) => Object.assign({ hive: 'clover', seed: 1, progress: 0.4, step: 2, variant: 0, vseed: 101 }, o);
  const one = (cue, label, params) => A.play(cue, { label, params: P(params) });
  const fire = (ctx, bus, cue, t, r, params) => A.fire(ctx, bus, cue, t, r, P(params));

  // An uncap run the way the mixer would play it: variants rotate (never the
  // same twice), each play its own seed, the rung climbing with progress.
  function run(label, n, spacing, opts) {
    const o = opts || {};
    return A.custom(label, n * spacing + 0.8, (ctx, bus, t, r) => {
      let last = -1;
      for (let k = 0; k < n; k++) {
        const v = (last + 1 + (k * 7) % 3) % 4;
        last = v;
        const step = o.climb ? Math.min(5, Math.floor((6 * k) / n)) : (o.step || 0);
        fire(ctx, bus, 'uncap', t + k * spacing, r, { hive: o.hive || 'clover', step, variant: v, vseed: 1000 + k * 17 });
      }
    });
  }

  A.publish({
    gap: 0.6, tail: 1.6,
    sections: [
      A.section('A · Grammar — the pairs that must not blur', 'Seconds apart in play.', [
        A.scene('uncap · sting — a cap, then a guard', 2.0, [
          { cue: 'uncap', at: 0, params: P({}) }, { cue: 'sting', at: 0.9, params: P({ kind: 1 }) },
        ]),
        A.scene('won · sting — over, either way', 3.2, [
          { cue: 'won', at: 0, params: P({}) }, { cue: 'sting', at: 1.8, params: P({ kind: 1 }) },
        ]),
        A.scene('mark · unmark', 1.4, [
          { cue: 'mark', at: 0, params: P({ kind: 1 }) }, { cue: 'unmark', at: 0.6, params: P({ variant: 1 }) },
        ]),
        A.scene('flood · nope', 1.8, [
          { cue: 'flood', at: 0, params: P({ cells: 12 }) }, { cue: 'nope', at: 1.0, params: P({}) },
        ]),
      ]),

      A.section('B · Every cue, as it plays', 'One of each, mid-frame, Clover Field.', [
        one('uncap', 'uncap', {}),
        one('uncap', 'uncap — broken comb (hollow, no drop)', { hive: 'wildflowers', kind: 'broken' }),
        one('flood', 'flood — 4 cells', { cells: 4 }),
        one('flood', 'flood — 40 cells', { cells: 40 }),
        one('mark', 'mark — guard', { kind: 1 }),
        one('mark', 'mark — queen\'s guard', { hive: 'apple', kind: 2, variant: 1 }),
        one('unmark', 'unmark', { kind: 0 }),
        one('sting', 'sting — guard', { kind: 1 }),
        one('sting', 'sting — queen\'s guard', { hive: 'apple', kind: 2 }),
        one('won', 'won', {}),
        one('nope', 'nope', {}),
        one('nope', 'nope — the other variant', { variant: 1 }),
        one('clean', 'clean', {}),
        one('hint', 'hint — step 1, flying past', { kind: 1 }),
        one('hint', 'hint — step 2, landing', { kind: 2 }),
        one('smoke', 'smoke', { kind: 1 }),
        one('pour', 'pour — 15 rows', { cells: 15 }),
        one('pour', 'pour — a pure frame', { cells: 15, kind: 'pure' }),
        one('jar', 'jar — clover (pale)', {}),
        one('jar', 'jar — wildflowers, sealed', { hive: 'wildflowers', seed: 90, kind: 'seal' }),
      ]),

      A.section('C · Never samey', 'The most-heard cue at play pace. Listen for any one play standing out.', [
        run('uncap ×16 — 0.35 s apart, one rung', 16, 0.35),
        run('uncap ×24 — 0.18 s apart, a quick hand', 24, 0.18),
        A.custom('mark ×8 — alternating', 8 * 0.4 + 0.6, (ctx, bus, t, r) => {
          for (let k = 0; k < 8; k++) fire(ctx, bus, 'mark', t + k * 0.4, r, { kind: 1, variant: k & 1, vseed: 300 + k });
        }),
      ]),

      A.section('D · The climb, hive by hive', 'A whole frame is a slow climb up the hive\'s ladder; each hive is its own instrument.',
        HIVES.flatMap((hive) => [
          run(`${hive} — uncaps, rung 0 → 5`, 18, 0.3, { hive, climb: true }),
          A.custom(`${hive} — floods from rungs 0, 3, 5`, 3.4, (ctx, bus, t, r) => {
            [0, 3, 5].forEach((step, k) => fire(ctx, bus, 'flood', t + k * 1.0, r, { hive, step, cells: 20, variant: k, vseed: 50 + k }));
          }),
          one('won', `${hive} — won, resolving to its tonic`, { hive }),
          A.custom(`${hive} — sting, guard then queen's guard`, 1.6, (ctx, bus, t, r) => {
            fire(ctx, bus, 'sting', t, r, { hive, kind: 1 });
            fire(ctx, bus, 'sting', t + 0.8, r, { hive, kind: 2 });
          }),
        ])),

      A.section('E · Wildflowers modes', 'The mode comes from the seed: five frames, five ladders.', [0, 1, 2, 3, 4].map((seed) =>
        A.custom(`wildflowers seed ${seed} — climb and win`, 3.2, (ctx, bus, t, r) => {
          for (let k = 0; k < 6; k++) fire(ctx, bus, 'uncap', t + k * 0.2, r, { hive: 'wildflowers', seed, step: k, vseed: 7 + k });
          fire(ctx, bus, 'won', t + 1.5, r, { hive: 'wildflowers', seed });
        }))),

      A.section('F · Scenes', 'How it actually plays.', [
        A.custom('a frame, middle to end — taps, a flood, pins, a sweep, the win', 9.0, (ctx, bus, t, r) => {
          const taps = [0, 0.7, 1.2, 2.0, 2.4, 3.3, 3.8, 4.6, 5.1, 5.9];
          taps.forEach((at, k) => fire(ctx, bus, 'uncap', t + at, r, { step: 3 + Math.floor(k / 4), variant: k % 4, vseed: 900 + k }));
          fire(ctx, bus, 'flood', t + 2.9, r, { step: 3, cells: 14, variant: 2 });
          fire(ctx, bus, 'mark', t + 4.2, r, { kind: 1 });
          fire(ctx, bus, 'nope', t + 6.4, r, { step: 5 });
          fire(ctx, bus, 'mark', t + 6.9, r, { kind: 1, variant: 1 });
          fire(ctx, bus, 'flood', t + 7.3, r, { step: 5, cells: 5, variant: 1 });
          fire(ctx, bus, 'won', t + 7.6, r, { step: 5 });
        }),
        A.custom('the mistake — taps, then a guard wakes, then the smoker', 4.4, (ctx, bus, t, r) => {
          [0, 0.5, 1.0].forEach((at, k) => fire(ctx, bus, 'uncap', t + at, r, { variant: k, vseed: 40 + k }));
          fire(ctx, bus, 'sting', t + 1.5, r, { kind: 1 });
          fire(ctx, bus, 'smoke', t + 2.6, r, { kind: 1 });
        }),
        A.custom('the win, with the pour and the jar', 4.6, (ctx, bus, t, r) => {
          fire(ctx, bus, 'won', t, r, { step: 5 });
          fire(ctx, bus, 'pour', t + 1.2, r, { cells: 15, kind: 'pure' });
          fire(ctx, bus, 'jar', t + 3.4, r, { kind: 'seal' });
        }),
      ]),
    ],
  });
})(typeof window !== 'undefined' ? window : globalThis);
