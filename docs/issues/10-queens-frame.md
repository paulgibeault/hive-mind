# The Queen's Frame: a weekly stacked hive

**Labels:** `content` `daily` · **Size:** S–M · **Depends on:** #01 (broken comb), #09 (the royal jar). #08 is nice to have (2 puffs).
**Touches:** `core.js` (hive entry), `main.js` (week logic), `index.html`, `tests/`

## Why

The daily rotates through three hives, and by week three you've seen them all. A weekly event that stacks two ideas gives a reason to come back on Sunday, and the design doc already calls a stacked hive "easy".

## Rules

- **Hive `queen`:** Apple Orchard's two guard kinds **on broken comb**, larger.
  - Start at **9 × 20**, not 10 × 20. The frame is width-bound, and 10 columns drops cells below the ~40 px tap target on a 390 px phone.
  - Measure densities: begin around 19% guards (~22 guards + 12 queens) and ~10 broken cells, then tune with the tries test.
- **Hidden from the hive selector.** It appears as its own menu strip: "Queen's Frame · Sundays".
- **Schedule:** one seed per ISO week, playable from Sunday 00:00 local until the next Sunday. The strip shows "in N days" outside that window, or "open all week", whichever Paul prefers; the canvas shows "Sundays".
- **Seed:** derived deterministically from the ISO week string (e.g. `makeRng(hash('queen-2026-W40'))`), so everyone gets the same frame.
- **Smoker:** 2 puffs. **Records:** `time-queen` and `pure-time-queen`. **Reward:** a jar of dark royal honey (#09).

## Tasks

- [ ] Add `queen` to `HIVES` with a `hidden: true` flag. The selector filters hidden hives out, and codes still work (`QU-…`).
- [ ] Week logic in `main.js`, reusing `Arcade.daily.dateStr()` for local dates. Add a pure `isoWeek(dateStr)` helper with tests at year boundaries.
- [ ] A menu strip with its state: open, cleared (time and seal), or counting down.
- [ ] Solver and generator: no new rules are needed, since both clue types and `null` clues already work. Add a tries-budget test for the chosen size and densities.

## Acceptance criteria

- [ ] Same week, same frame, on any device. The week changes on Sunday at local midnight.
- [ ] Tries: median ≤ 20 and max < `MAX_TRIES` over 1,000 seeds, with generation under ~50 ms on a phone.
- [ ] Tap targets ≥ 40 px at a 390 × 844 viewport. Verify with `e2e.mjs`.

Design reference: canvas boards "Menu" and "Keeping play fresh".
