# Rename the hives, replace wasps with sleeping guards, and make Wildflowers broken comb

**Labels:** `design-decision` `breaking` · **Size:** S–M · **Depends on:** nothing. Do this first, because every other issue uses the new names.
**Touches:** `core.js`, `solver.js`, `render.js`, `main.js`, `index.html`, `style.css`, `soundpack.js`, `docs/design.md`, `README.md`, `tests/`

## Decisions (Paul, 2026-09-28)

1. **Hive names:** Meadow → **Clover Field**, Orchard → **Apple Orchard**, Wild → **Wildflowers**.
2. **No wasps.** The hazard is a **sleeping guard bee**, and Apple Orchard's second kind is the **queen's guard**. Tagline: *"Uncap every safe cell. Leave the guards asleep."* "Stung" stays.
3. **No lying cells.** Wildflowers' cracked cells become **broken comb**: safe, with **no number**, no ±1 and no ± glyph.

## Tasks

### Names and ids

- [ ] **`HIVES`** in `core.js`: ids `clover`, `apple`, `wildflowers`, names `Clover Field`, `Apple Orchard`, `Wildflowers`. Rename the fields `wasps`/`hornets` to `guards`/`queens`.
- [ ] **Old ids alias to new ones.** `hiveById()` maps old ids (`meadow → clover`, `orchard → apple`, `wild → wildflowers`) before looking up. It must **not** silently fall back to `HIVES[0]` for a known old id, or a saved Orchard run would load as Clover Field.
- [ ] **Frame codes.** `boardCode()` → `CL-`, `AP-`, `WI-`. `parseCode()` also accepts the old `ME-` and `OR-` prefixes. `WI-` is the same prefix old and new.
  - Frame generation doesn't use the hive id in the RNG, so old Clover Field and Apple Orchard codes still give the same frames.
  - Old `WI-` codes **will** give different frames after the broken-comb change. That's acceptable before 1.0; call it out in the PR.
- [ ] **Stored data migration** on boot, in `main.js`, idempotent:
  - `Arcade.state` `run.s.hive` and `run.s` field names; bump the save `v` to 2 and migrate v1
  - `prefs.hive` stays an index
  - records `time-meadow` → `time-clover`, and so on
  - `Arcade.stats('frames')` keys
  - `Arcade.stats('daily')` entries' `hive`

  Keep the best value when both old and new keys exist.

### Guards, not wasps

- [ ] **Identifiers in code and tests.** `W`/`H` → `G`/`Q`, `MARK_W`/`MARK_H` → `MARK_G`/`MARK_Q`. In `solver.js`, `WASP`/`HORNET` → `GUARD`/`QUEEN`. Keep the numeric values, so saves only need the field-name migration.
- [ ] **Copy.** Update the menu lede, "How it works" (`index.html`), `NOTES` in `main.js`, the lost title ("Stung by a queen's guard"), `aria-label`s, and the `soundpack.js` header comments.
- [ ] **`render.js` `bug()`** draws a round, fuzzy, sleepy guard bee instead of a striped wasp. The queen's guard is the same bee in the hornet red with a small crown notch.
  - Marks keep their shapes: amber disc for a guard, red square for the queen's guard.
  - On a **win**, guard cells seal under dark wax instead of showing bugs (see the juice-pass issue). On a **loss**, show the bees.

### Broken comb (Wildflowers)

- [ ] **`candidate()`:** keep `cracked[]` (rename it `broken[]`) but stop altering `shown`. Drop the "never show a cracked 0" rule.
- [ ] **`clueOf(f, i)`** returns `null` for a broken cell. **`floods()`** returns `false` for one.
- [ ] **`solver.js`:** remove the `{ total }` clue branch. `clueAt(i) → null` already means "no clue here".
- [ ] **`render.js`:** an uncapped broken cell draws the crack and **no reading**. Delete the ± glyph code. A **capped** broken cell looks exactly like any other cap, or the crack would give away a free safe cell.
- [ ] **`sweep()`** still refuses broken cells.
- [ ] **Retune the broken count.** A blank gives less information than the old crack, so 20 broken cells at 31 guards may push generator tries up. Start near **12** and measure: log `tries` over 1,000 seeds in a test and keep the median at 10 or below and the max well under `MAX_TRIES`.

### Docs

- [ ] Update `docs/design.md`: the translation table, the hives table (Wildflowers' idea is now "some comb is broken: safe, but it tells you nothing"), and a new decisions entry dated 2026-09-28. Update the README file table if names change.

## Acceptance criteria

- [ ] `npm test` passes. Tests are updated to the new names, and the cracked-clue solver test is replaced with a broken-cell test (`clueAt → null` for that cell; the solver still finishes).
- [ ] A frame-code test: `ME-…`/`OR-…` parse to `clover`/`apple` with the same seed, and `generate()` gives the identical frame for old and new codes on those two hives.
- [ ] A migration test: a v1 save with `hive: 'orchard'` and `time-orchard` records loads as `apple` with its best time intact.
- [ ] A generation-budget test for Wildflowers at the chosen broken count.
- [ ] No string "wasp" or "hornet" remains in the shipped files (`grep -ri` in CI or a repo-gate test). Old ids appear only in the alias map and migration.
- [ ] `node tools/e2e.mjs` still plays real frames on all three hives.

Design reference: Hive Mind design-review canvas, boards "Review", "Keeping play fresh" and "Roadmap".
