# "What gave it away": turn a sting into a lesson

**Labels:** `feel` `onboarding` · **Size:** S · **Depends on:** #02 (uses the same pre-tap `provenNow` as #03)
**Touches:** `main.js`, `render.js`, `index.html`, `style.css`

## Why

A sting late in a three-minute frame is a cliff, and the sheet only says "N safe cells were still capped". Every frame is provably fair, so every sting has a lesson. Show it.

## Behaviour (decided from the state *before* the fatal tap)

| case | stung sheet says | frame shows |
|---|---|---|
| The tapped cell was a **proven guard** | "What gave it away: this 1 had just one capped neighbour, the cell you uncapped." Or generically: "These numbers proved a guard was sleeping there." | The `minimalProof` clues ringed in honey; the stung cell ringed red |
| The tapped cell was **not provable** (a guess) | "That was a guess, and nothing proved it either way. This cell was safe to open:" | One proven-safe cell (the first in `provenNow().safe`) glowing |
| Stung by a **sweep over a wrong mark** | "A mark was on a safe cell, so the sweep trusted it." | The wrong mark gets its existing ✕; the sweep's source number is ringed |

## Tasks

- [ ] **Keep the pre-tap proof.** In `act()`, keep the pre-tap `provenNow` result (already computed for #03). On a `sting` event, build `lesson = { kind, clues, stung, safeHint }` using `minimalProof` when needed.
- [ ] **Renderer rings.** Add `view.rings = [{ i, color }]`, drawn as a 2–3 px hex outline under the cell sprite (the canvas mockup draws a larger honey hex behind the cell). The rings stay until the sheet closes.
- [ ] **Lost sheet.** Add a "What gave it away" card above the buttons. Keep "Same frame again", "New frame" and "Menu", and leave room for the smoker button (#08).
- [ ] **Readability.** The sheet must not cover the ringed cells. If the proof sits in the bottom third, scroll or offset the frame up while the dock is open, or dock the sheet to the top instead.
- [ ] **Specific sentences.** Use a specific sentence only for the one-clue cases: a clue with exactly `n` hidden neighbours and `n` guards, or one with `0` guards remaining. Everything else gets the generic line. Don't try to write general proofs in English.

## Acceptance criteria

- [ ] Pinned example: Clover Field seed 7, the mid-game state from the canvas. Tapping cell 49 gives the proven-guard case, with ring `[48]`.
- [ ] A forced guess that stings shows the guess message and a cell from `provenNow().safe`.
- [ ] The wrong-mark sweep case is covered in `e2e.mjs`.
- [ ] Reduced motion: the rings appear without animation.

Design reference: canvas board "Stung".
