# A fourth hive idea: Scout cells (long-range clues)

**Labels:** `solver` `content` `later` · **Size:** L · **Depends on:** #02 (test harness patterns)
**Touches:** `solver.js`, `core.js`, `render.js`, `tests/`

## Why

"Each hive adds exactly one idea." A Scout cell is a new idea that stays true to the no-guess promise: its number counts guards **two rings out** (up to 18 cells, not 6). That opens up long-range deductions a local read can't make.

A follow-up, *Swarm numbers* (a bar under a number means its guards all touch each other), is noted at the end. Ship one idea at a time.

## Rules

- A Scout cell is a safe cell with a double rim once uncapped. Its reading counts guards (all kinds summed) among cells at hex distance 1–2.
- **Capped Scouts look like any cap**, so there's no free safe cell.
- Scouts don't flood, and they can be swept only if every capped cell in their range is resolved. Simpler: Scouts can't be swept. Decide in the PR.
- The hive name is Paul's call, e.g. a flower field that fits the honey theme. It gets its own honey colour in `honey.js`.

## Tasks

- [ ] **Generalise the solver's clue scope.** Today a clue at `c` covers `nbrs[c]`. Let `clueAt(i)` return `{ ..., over: number[] }` (defaulting to `nbrs[i]`), and use `over` in `groups()` and `enumerate()` wherever `nbrs[c]` is read for clue slots.
  - Keep the node budget, and watch group sizes: radius-2 clues merge groups aggressively.
- [ ] **`core.js`:** add a `scout[]` array, `ring2` neighbour lists (cached like `nbrsOf`), a count function, and `clueOf` returning `over`.
- [ ] **Render:** double rim, and the number in a distinct weight. Include a legend line in "How it works".
- [ ] **Generator:** start with ~6 Scouts per 9×18 frame and measure tries.

## Acceptance criteria

- [ ] Solver soundness and completeness vs brute force on small frames containing Scouts (the same harness as the existing brute-force test).
- [ ] Budget: `provenNow` still meets #02's p95 on Scout frames. If it doesn't, cap Scouts per frame.
- [ ] Every generated Scout frame is solvable from its opening (the existing invariant).

## Follow-up (separate issue): Swarm numbers

A plain number with an underbar means "my guards form one connected group". With no bar, they don't touch. The solver needs one extra check in `ok()` when a clue's slots are all assigned. Only take this on after Scouts ship and playtests ask for more.

Design reference: canvas board "Keeping play fresh".
