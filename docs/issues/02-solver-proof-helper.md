# Solver: add "provable right now" and "smallest proof" queries

**Labels:** `solver` `foundation` · **Size:** M · **Depends on:** #01 (names)
**Touches:** `solver.js`, `core.js` (thin wrappers), `tests/solver.test.js`
**Unblocks:** #03 clean reads, #04 sting lesson, #07 Bee-line hint

## Why

The solver only runs at generation time. The same machinery can tell the story of every move: was this tap provable, and which clues prove it? That one helper powers three features. Build it once, test it hard, and keep it pure.

## API (pure, deterministic, no DOM, no clock)

```js
// What a careful player can know from the clues on screen *now*.
// Chains through decided cells (a known guard feeds its neighbours' clues)
// but NEVER opens a cell or reads a number the player hasn't seen.
// Ignores player marks: marks are the player's word, not knowledge.
provenNow(s) → { safe: Set<i>, guard: Map<i, kind> }   // kind: GUARD | QUEEN

// The smallest set of revealed clue cells that alone proves cell i's value
// (safe, or which guard kind). null if i isn't provable now.
minimalProof(s, i) → { value, clues: number[] } | null
```

## Tasks

- [ ] **`provenNow`.** Build `dom` from `s.open`, and pass `clueAt = open && not broken ? clueOf : null`. Call `solve()` with an `open` callback that **records but doesn't reveal**: it doesn't set `opened`, so no new clues enter. The existing loop then chains via domains only.
  - A small refactor is needed: `solve()` currently returns whether the frame finished. Have it also leave `dom` narrowed, which it already does, and let the caller read it.
- [ ] **`minimalProof`.** Candidates are the revealed clue cells within 3 rings of `i`. Search subsets by size 1..4 and return the first subset whose restricted `clueAt` proves `i`'s value. If nothing proves it within size 4, return the full clue list of `i`'s group.
  - Bound the total nodes, and return the group's clues if the budget is hit.
- [ ] **Determinism and budget.** Same state, same answer, on every device: node budget, never a clock.
  - Target **≤ 3 ms per call** for `provenNow` on a mid-game Apple Orchard (9×18) on a mid-range phone.
  - Target **≤ 10 ms** for `minimalProof`.
  - Add a micro-benchmark script under `tools/` that reports p50/p95 over 500 random mid-game states.
- [ ] **Core wrappers.** Export both from `core.js` via thin wrappers that build `nbrs` and `clueAt`, so `main.js` never touches solver internals.

## Acceptance criteria

- [ ] **Sound:** over 2,000 random mid-game states across all hives, every cell in `provenNow().safe` is truly safe, and every entry in `guard` has the true kind.
- [ ] **Complete vs brute force:** on small frames (≤ 5×5), `provenNow` equals brute-force enumeration over all assignments consistent with the visible clues.
- [ ] **No peeking:** `provenNow` never reads `s.cells` for hidden cells. Enforce it with a test that scrambles hidden `cells` and gets an identical result.
- [ ] **Minimal proofs:** `minimalProof(s, i).clues` alone proves `i`, and no smaller subset does (checked by brute force for sizes ≤ 3).
- [ ] **Pinned example** from the design canvas: Clover Field seed 7, at the mid-game state in `PlayProposed` (string in that artboard's script). Cell 94 is provably safe, with smallest proof `[93, 101]`. Cell 49 is a proven guard, with smallest proof `[48]`.
- [ ] The repo gate still passes: no DOM or clock in `solver.js`/`core.js`.
