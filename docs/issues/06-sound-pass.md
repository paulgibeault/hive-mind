# Sound pass: fun, varied, never annoyingly repetitive

**Labels:** `sound` `polish` · **Repo:** paulgibeault/hive-mind · **Touches:** `soundpack.js`, `audio.js`, `main.js`, `tests/`

## Why

The first-pass pack (`soundpack.js`, not yet auditioned) has the right bones: four materials (wax, honey, wood, bees) and one contour grammar (rising = good, falling = over). Keep both. Two things will wear on players:

1. **`uncap` fires 50–100× per frame with a single shape.** It's the most-heard sound in the game and the least varied.
2. **`sting` is a 0.7 s sawtooth drone.** It reads as an alarm. The fiction is now a *sleeping guard bee* waking up, which should be a comic surprise.

Design reference: the "Sound — fun, never samey" board on the Hive Mind design-review canvas.

## Rules (apply to every cue)

1. **Loudness follows rarity.** The more often a cue fires, the quieter and shorter it is. `uncap` sits at the bottom of the mix and stays under 60 ms. Only `won` gets a tail.
2. **Never the same twice.** Every play varies three things:
   - pitch: a scale step plus ±15 cents (`S.cents`)
   - filter centre: ±15%
   - layers: for `uncap`, the droplet sounds on ~60% of plays

   Rotate through 4 variants per frequent cue, and never repeat the last one.
3. **Progress plays a tune.** Base pitch for `uncap`/`flood` walks up the hive's pentatonic scale (the existing `LADDER`) as the frame's open fraction rises, so a whole frame is a slow climb.
4. **Merge bursts.** One flood or sweep is **one** cue scaled by size, never N uncaps. Keep at most 3 concurrent `uncap` voices, and fold any `uncap` within 40 ms of the last into the voice that's playing.
5. **Silence is a sound.** No music loop during play. Nothing ambient in this issue.
6. **No tells.** A cue may never differ based on hidden cell contents before the tap. Pitch comes from the visible open fraction only.

## Tasks

### A. Plumbing

- [ ] **Pass context to every cue.** `main.js → drain()` sends `{ hive, seed, progress }` to every `sfx()` call. `progress` = opened safe cells / total safe cells, in 0..1. `uncap`/`flood` keep `cells`, and `mark`/`sting` keep `kind`.
- [ ] **Throttle in `audio.js`.** Add a small throttle inside `sfx()`:
  - a per-cue minimum gap (`uncap` 40 ms, `nope` 300 ms)
  - a max-voices count for `uncap` (3)

  It must never throw (the input path calls it). Keep `audio.js` the only place the game touches `Arcade.audio`.
- [ ] **Variant rotation.** A per-cue counter picks from 4 variant parameter sets, skipping the last-used index. Seed the variant choice from `(seed, counter)`, so a replayed frame code sounds the same.

### B. Rework existing cues (`soundpack.js`)

| cue | change | level vs `won` |
|---|---|---|
| `uncap` | Wax tick + honey drop, pitched to `LADDER[step(progress)]`. Apply rule 2's variation. Keep it under 60 ms. | −18 dB |
| `flood` | Start the droplet run on the current scale step, not a fixed 420 Hz. Run length follows ring count, capped at 6 (already capped). | −12 dB |
| `mark` / `unmark` | Two alternating click variants. The second guard kind keeps its double click. | −20 dB |
| `sting` | **Rework.** A sleepy "mm?": a triangle hum bending *up* over ~150 ms, then a soft thump. Total ~0.45 s, lowpass near 1.2 kHz. The second guard kind is a fifth lower. Put a harmonic above 400 Hz on the thump so it survives phone speakers. Drop the sawtooth. | −6 dB |
| `won` | Keep the three rising wood knocks. Resolve to the tonic of the scale the frame climbed. | 0 dB |

- [ ] Update the header comment and cue names in `soundpack.js` to the new fiction: guards, not wasps/hornets.

### C. Per-hive instrument (one pack, one table)

- [ ] Add a `HIVE` table keyed by hive id. Each entry holds the scale root, the `body()` partials, and a room tweak. Every cue reads `p.hive`. Grammar and cue names stay identical across hives.

| hive (current id → new name) | voice | scale |
|---|---|---|
| `meadow` → Clover Field | Soft marimba wood, warm and round | Major pentatonic on C |
| `orchard` → Apple Orchard | Plucked, kalimba-like tines, a little brighter. Two guard hums a fifth apart | Pentatonic on D |
| `wild` → Wildflowers | Glassy bells | Mode picked from the seed |

> If the hive rename lands first, key the table by the new ids. Otherwise use the current ids and leave a TODO.

### D. New cues: register now, wire when their features land

Register these now; each one only plays once its feature exists.

| cue | trigger (future feature) | sound | level |
|---|---|---|---|
| `nope` | A sweep can't fire | A dull knock on the wooden frame, two notes falling. 300 ms cooldown. | −16 dB |
| `clean` | Clean-read chain milestones (5, 10, 15…) | A soft glassy shimmer a fifth above the current step. Milestones only, never every clean read. | −14 dB |
| `hint` | Bee-line hint, steps 1 and 2 | A bee flying past with a left-to-right pan. Step 2: the hum drops and stops (it lands). | −12 dB |
| `smoke` | Smoker puff after a sting | A bellows puff (filtered noise swell), then the guard hum drifting down and fading: back to sleep. Falling contour. | −10 dB |
| `pour` | Win honey pour | A rising glissando of droplets, one per row of the pour. A pure frame adds one high bell at the end. | −4 dB |
| `jar` | Jar added to the pantry | A glass clink and a cork pop. Clink pitch follows honey colour: pale is higher, dark is lower. A wax seal adds a soft press. | −8 dB |

For Wildflowers broken cells: once broken comb lands, an uncapped broken cell plays `uncap` with **no droplet** and a hollow crumble, because it's empty comb. This happens after the tap, so it's not a tell.

## Constraints

- Silent-by-design stays: if `ArcadeAudioElements` or `Arcade.audio` is missing, the game makes no sound and there is no fallback (GAME_INTEGRATION §5).
- `core.js`, `solver.js` and `hex.js` stay pure. No audio or DOM leaks into them (the repo gate enforces this).
- Respect the launcher's audio settings. Muted must be fully playable, since sound never carries information on its own.
- Don't edit vendored files (`arcade-rng.js`, `tools/verify-artifact.mjs`, `tools/inject-precache.mjs`).

## Acceptance criteria

- [ ] `npm test` passes, and new unit tests cover:
  - variant rotation never repeats the same index twice in a row
  - the throttle drops or merges an `uncap` within 40 ms, and caps concurrent voices at 3
  - scale-step selection from `progress` is monotonic and bounded
  - the same `(seed, counter)` gives the same variant (deterministic)
- [ ] No cue's parameters depend on hidden cell contents. Add a test asserting `sfx` params only include `hive`, `seed`, `progress`, `cells` and `kind`.
- [ ] Auditioned on the launcher's soundpack workbench. Attach or regenerate the audition WAVs.
- [ ] **Ten-minute test:** three frames back to back at normal volume, with no cue becoming noticeable or grating. Note any cue that was halved or given variants.
- [ ] **Phone speaker pass:** the sting and the knocks still read on a phone speaker.
- [ ] Levels roughly match the tables above (±3 dB).

## Out of scope

Background music, ambient beds, and building the features behind section D's cues (clean reads, hint, smoker, pour, pantry). Those are separate issues.
