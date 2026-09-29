# Juice pass: every verb gets a moment

**Labels:** `feel` `render` · **Size:** M (v1) + S (v2) · **Depends on:** #01 (sealed guards and honey colour). The glint needs #03's hook.
**Touches:** `render.js`, `input.js` (hold progress), `main.js` (wiring)

## Why

The comb is a still life: a 200 ms cap fade, floods that pop all at once, and a win that's just a sheet. The sound pack already has a rising flood ladder, and the visuals should follow it.

## Hard rules

- **Motion never blocks.** `core.js` applies state instantly; only the *drawing* is staggered. A tap during any animation acts at once.
- **No tells.** Nothing animated may depend on hidden contents.
- **Reduced motion and power saver** (`R.view.motion === false`) get the static end state listed per item.
- The loop rests when nothing moves. `draw()` returns `moving` exactly as it does today.

## v1 checklist

- [ ] **Flood ripple.** Opened cells reveal in rings by BFS distance from the tapped cell, 28 ms per ring. Compute distance over the `cells` list of the uncap event using `nbrsOf`. Sync with #06's flood cue, one droplet per ring.
  - Still: everything at once.
- [ ] **Uncap.** The cap cracks, then 3–4 wax flecks fall about 12 px and fade, and a honey glint crosses the open cell once. 180 ms total.
  - Still: an instant swap.
- [ ] **Finished numbers dim.** A number with no *unmarked capped* neighbour draws at 35% ink. It uses only open cells and the player's own marks.
  - Still: same, since it's a state.
- [ ] **Hold ring for long-press.** `input.js` exposes the current press progress (0..1 over `HOLD_MS`), and the renderer draws a filling ring around the pressed cell, so long-press can be learned.
  - Still: the ring appears at full.
- [ ] **Win: seal and pour.**
  - Guard cells seal under dark wax; on a win they are **not** drawn as bees.
  - Honey then fills the open comb row by row, 20 ms per row, in the **hive's honey colour**: Clover Field pale gold, Apple Orchard amber, and for Wildflowers the seeded blend from #09's `honeyColour(hive, seed)`, or a placeholder until #09 lands.
  - Numbers stay legible: dark ink on the honey fill.
  - Still: the final filled frame.
- [ ] **Glint** for clean reads (#03's hook): a warm spark rises from the cell toward the rail counter, 300 ms.
  - Still: none; the counter still updates.

## v2 checklist

- [ ] **Sweep wave.** The number lifts, and a light runs clockwise round its six neighbours. Unmarked cells open in that order, 30 ms apart.
  - Still: the ring shows for 120 ms.
- [ ] **Sweep can't fire.** The number shakes once (±3 px, 160 ms) and plays #06's `nope`.
  - Still: a brief outline flash.
- [ ] **Pin a mark.** The pin drops in at 125% and settles with one bounce.
  - Still: no bounce.
- [ ] **Sting.** The guard's wings flicker for three frames and the frame shakes 6 px twice, on top of the existing red flash.
  - Still: the flash only.

## Acceptance criteria

- [ ] **No input lag.** A scripted `e2e` run that taps during a flood ripple lands the second tap on the correct, already-updated state.
- [ ] With motion off, every item renders its still, and the loop sleeps immediately.
- [ ] **Performance.** 60 fps on a mid-range phone during the biggest flood of a Wildflowers frame. Keep using sprite caching (`build()`); no per-frame gradient creation in hot paths.
- [ ] Before/after screen recordings attached to the PR.

Design reference: canvas board "Juice pass — every verb gets a moment".
