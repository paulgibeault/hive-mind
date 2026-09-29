# Hive Mind — design

*2026-09-28. "I want to add a variant of minesweeper to the fleet. How can we
make it our own?" Paul picked all of the proposal: hex grid, rule twists, no
forced guesses, a daily frame, and paired play (race, split sight, minelayer
duel).*

Design stance, in one paragraph: classic minesweeper's flaw is the forced
guess, the 50/50 at the end that makes a loss feel like bad luck rather than
a mistake. So the one promise here is **every frame can be finished by logic
alone**. Everything else hangs off that promise. Hexes change the deductions.
Each hive adds exactly one idea. Because the promise needs a solver, and the
solver needs frames that are the same on every device, one seed means one
frame everywhere. That gives the Daily Frame, shared codes, and every paired
mode.

## The translation

| Classic | Here |
|---|---|
| board | a **frame** of honeycomb, pointy-top hexes in odd-r offset rows |
| mine | a **wasp** (and, in the Orchard, a **hornet**) |
| hidden cell | a honey-gold **cap**; uncapped comb is dark and holds its number |
| flag | a **mark**: an amber disc (wasp) or a red square (hornet). The two differ in shape as well as colour |
| first-click safety | the **opening**: every frame ships with a zero near the middle already uncapped |
| chord | **sweep**: tap an uncapped number whose marks are placed to uncap the rest |
| lose | **stung** |

## Hives: one idea each

| Hive | Frame | Hazards | The idea |
|---|---|---|---|
| Meadow | 8 × 15 | 23 wasps | hexes: six neighbours, not eight |
| Orchard | 9 × 18 | 18 wasps + 13 hornets | two kinds, each counted separately. A cell reads e.g. amber **2** and a red boxed **1**. You mark the kind, and a sweep only trusts marks of the right kind |
| Wild | 9 × 18 | 31 wasps, 20 cracked cells | a **cracked** cell's number is off by exactly one, up or down. The crack is drawn, so the lie is fair. A crack never reads 0 (that could only mean 1), and cracked cells can't be swept |

Sizes fill a portrait phone: the frame is width-bound at 8–9 cells across,
which keeps each cell about 40 px, a comfortable tap target. Densities (about
19%) are **first guesses to tune by playtest**. Stacking the ideas, such as a
cracked Orchard, is an easy later hive: the solver already handles both clue
types together.

## Fairness: how "no guessing" is kept

`solver.js` is the promise. Every hidden cell carries a **domain**: the set of
things it might still be, out of {safe, wasp, hornet}. The solver groups the
hidden cells that share clues and enumerates every assignment consistent with
those clues. Whatever holds in every assignment is known. A proven-safe cell
is uncapped, flood included, exactly as the player would, and the loop runs
again until nothing more follows.

- Enumeration is capped by a **node budget, not a clock**. Being stuck is
  therefore a property of the frame, and every device reaches the same
  verdict.
- `generate(hive, seed)` draws candidate frames from one seeded stream and
  keeps the first one the solver can finish. Today that takes about 3–10
  tries and 1–2 ms. A frame is a pure function of (hive, seed).
- The solver is deliberately **stronger than a casual player**: it does full
  local enumeration, but ignores the global hazard count. "Solvable" means a
  careful player can always find the next move, not that it is obvious.
- Tests hold the solver to the truth: it never opens a hazard, never rules
  out a cell's real contents, matches brute force on a small frame, and stays
  sound on dense random frames it cannot finish.

## Decisions — 2026-09-28

1. **Name: Hive Mind.** It is honeycomb, and "hive mind" is exactly what
   split-sight co-op asks of two players. `gameId: hive-mind`, repo
   `~/work/hive-mind`.
2. **Solo first, built so paired play needs no rules change.** The rules
   (`core.js`, `solver.js`, `hex.js`) are pure and seeded, with no DOM and no
   clock. A repo gate enforces that.
3. **The opening ships uncapped**, rather than being built around the first
   tap. The first tap then can't choose the frame, which a daily or a race
   requires.
4. **Marks are the player's word.** A sweep over wrong marks stings, as in
   the classic. There is no separate penalty for a wrong-kind mark: the sweep
   is where it costs you.
5. **The Daily Frame** rolls at local midnight (`Arcade.daily`), and the hive
   rotates by day number, so each hive comes round every third day. The best
   clear per date goes in `Arcade.stats('daily')`, and the menu shows a
   streak.
6. **Records**: `time-<hive>`, the fastest clear per hive (`duration-ms`,
   lower is better), which the launcher's Records sheet renders. Played/won
   counts go in `Arcade.stats('frames')`.
7. **Frame codes** (`OR-0000ABC`): the hive plus the seed in base 36, shown on
   the rail and on the win sheet, and typed into the menu. This is racing
   before the network exists: say the code aloud and both start.

## Controls

Tap uncaps, or sweeps a number. Long-press (380 ms) or right-click marks,
cycling none → wasp (→ hornet in the Orchard) → none. The flag button on the
rail makes taps mark, for anyone who finds long-press awkward. A press that
drifts more than 12 px is dropped as a mis-touch. Keys: P / Esc to pause,
M to switch mark mode.

## Built (v0.0.x, 2026-09-28)

The rules and solver with unit tests (hex geometry, determinism, a pinned
frame, honest readings, solvability, marks, sweep, codes, save round-trip,
solver-vs-brute-force). Also: a canvas renderer; touch, mouse and keys;
menu, pause, won and stung sheets; the run saved on suspend and resumed
*paused*, with its clock (`Arcade.session`); records, stats, the daily and
its streak; frame codes; a first-pass sound pack (not auditioned); reduced
motion and power saver gating the cap fade and sting flash; fleet CI/CD; and
`tools/e2e.mjs`, which plays real frames through the pointer paths.

## Next — paired play (`Arcade.peer`)

All three modes start from the same place: both phones agree on (hive, seed)
through a small lobby frame, then each runs its own `core.js`. Every mode
stays optional: `status()` gates the menu row, and solo never waits on it.

### P1 — Race
Same frame on both phones, and first to clear wins. Messages are tiny:
`{ t: 'go', hive, seed, at }`, per-uncap progress (`{ t: 'p', left }`), and
`{ t: 'done', ms }` or `{ t: 'stung' }`. The rail shows the opponent's
cells-left as a thin comb bar. A sting doesn't end your race: you go again
on the same frame with the clock still running (a time penalty, not a loss),
which keeps both players in it. This follows sowduku's ready-gate pattern.

### P2 — Split sight (the headline mode)
One shared frame, two players. **Each phone shows the numbers of only half
the uncapped cells.** The partition is a seeded hash of the cell, so it is
the same on both phones and needs no messages. The other half shows as
uncapped but blank ("your partner can read this one"). Uncaps and marks are
shared (`{ t: 'u', i }`, `{ t: 'm', i, m }`) and applied through the same
`core.js` on both phones. A sting ends it for both.

- **Generation changes, and only there**: keep a frame only if the solver
  can finish it with the *pooled* clues AND cannot finish it with *either
  half alone*. The second condition is what makes talking mandatory rather
  than polite. The solver already takes `clueAt(i)`, so a half is just a
  masked `clueAt`.
- Conflict rule: uncaps are idempotent and the frame is deterministic, so
  message order can't split the state. Marks use last-writer-wins per cell.
- Voice is out of scope: players sit together or use a call. The game's job
  is to make them need it.

### P3 — Minelayer duel
Each player lays hazards on the other's frame, then both sweep at once.
Laying uses a budget, with the opening fixed by the game. The solver runs
live while laying and refuses a placement that would force a guess (the
"Laid" button stays disabled with a reason), so every duel frame is still
fair. The frame travels as `{ cells }` (under 200 bytes). Fastest clear wins,
and a sting costs time as in Race.

### Other owed work
- **Playtest tuning**: densities per hive, long-press timing, whether Wild
  needs fewer cracks.
- **Sound**: audition the pack on the launcher's soundpack workbench before
  deciding it's done (see the fleet sound-pack notes).
- **Juice, optional**: a sting could collapse the frame into sand with the
  `Arcade.sim.sand` kernel. It's decoration and waits until the modes exist.
- **A stacked hive** (cracked Orchard) and a **"hint" that explains** the
  next deduction, since the solver can already name the clues that prove a
  cell.
