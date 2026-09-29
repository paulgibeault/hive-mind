# The smoker: one second chance, at a cost

**Labels:** `rules` `feel` · **Size:** M · **Depends on:** #01, #04 (shares the stung sheet)
**Touches:** `core.js`, `main.js`, `index.html`, `tests/core.test.js`

## Why

One sting erases a long frame. A single puff of smoke lets the player recover, at a visible cost, and matches paired play's P1 Race rule, where a sting costs time rather than the race.

## Rules

- Each frame starts with `puffs` from the hive config: **1** for all three hives, **2** for the Queen's Frame (#10).
- **After a sting:**
  - with puffs left, the lost sheet offers **"Puff the smoker · +20 s · N left"**
  - puffing calms the guard: its cell goes back to capped, it's auto-marked with the right kind, the clock gets +20 s, `puffs--`, Pure is lost, and play continues
- **Sweep stings:** the sweep stopped at the first sting (as it does today). The remaining targets stay capped, and the wrong mark that caused it stays for the player to fix.
- **Dailies allow the smoker.** They record `pure: false`.

## Tasks

- [ ] **`core.js`:** add `s.puffs` in `newGame` and `calm(s)`. `calm` is valid only when `phase === 'lost' && s.stung >= 0 && s.puffs > 0`. It:
  - sets `open[stung] = 0` and `mark[stung]` to the right kind
  - sets `phase = 'play'`, `stung = -1`, `puffs--`
  - emits `{ type: 'calm', cell, kind }`
- [ ] **Keep the run.** Don't `dropRun()` on a sting while puffs remain. Persist the lost state so a reload can still puff. Only "Same frame" / "New frame" / "Menu" drop it.
- [ ] **Save format.** If #01 already bumped to v2, go to **v3** here; otherwise v2 (v1 migrates with `puffs = 1`).
- [ ] **Main side:** +20 s to `base`, `puffs` counted in run meta (#03), and the lost sheet gets the primary button (canvas "Stung" board).
- [ ] **Hooks for #05 and #06:** the smoke visual (grey haze over the cell) and the `smoke` cue.

## Acceptance criteria

- [ ] Core tests:
  - `calm` restores play
  - `calm` marks the cell with the right kind
  - `calm` refuses when there are no puffs or the phase is play
  - `calm` after a sweep-sting leaves the other targets capped
  - a win after `calm` still works
- [ ] A save and reload between the sting and the puff works.
- [ ] Records: a smoked clear can set `time-<hive>` (with the penalty included) but never `pure-time-<hive>`.

Design reference: canvas board "Stung".
