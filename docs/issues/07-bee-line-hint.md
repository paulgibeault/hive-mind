# Bee-line hint: show where to look, then why

**Labels:** `feel` `accessibility` · **Size:** M · **Depends on:** #02, #03 (a hint clears Pure)
**Touches:** `main.js`, `render.js`, `index.html`, `style.css`, `input.js` (H key)

## Why

"If you're stuck, there's something you haven't noticed." True, but nothing helps you notice. The solver can name the proof, so a hint can teach instead of just giving the answer away.

## Behaviour

- A rail button with a dotted bee-flight icon and `aria-label="Bee-line hint"`, plus the **H** key.
- **Step 1, "Look here":** ring the `minimalProof` clue cells for one proven move. No target is shown yet. Sheet copy: "Look at these numbers together."
- **Step 2, "Why":** tapping the hint again lights the target cell and explains.
  - It shows a specific sentence for the simple cases in #04's list, plus the one two-clue case in the canvas mockup: *"The lower 1 has one capped neighbour, so that's its guard (dashed). The same guard fills the upper 1, so the lit cell is safe."*
  - Otherwise: "Together these numbers leave only one possibility for the lit cell."
  - Implied guards used by the proof draw as a **dashed** mark.
- **Cost:** +10 s on the clock (`base += 10_000`), and Pure is lost. The sheet says so up front ("+10 s · no Pure seal").
- **Which move:** prefer a proven move nearest the player's last tap, then the one with the smallest proof. Deterministic.
- **Dismiss:** "Got it", or any tap on the frame, which also performs the tap.
- **Proven safe cells before proven guards.** If the only proven moves are guards, step 2 says "Mark it."

## Tasks

- [ ] Hint state machine in `main.js`: `off → look → why → off`. It's never saved mid-hint; a reload clears it.
- [ ] Renderer: rings (reuse #04), a target glow, and a dashed ghost mark.
- [ ] Hint dock sheet, following the canvas "Play — proposed" board.
- [ ] Count hints in run meta (#03). `Arcade.stats` gains a `hints` total per hive.
- [ ] Fallback: if `provenNow` hits the budget with nothing proven (extremely rare), step 1 rings the undecided group's clues and says "Try around here", still costing the time.

## Acceptance criteria

- [ ] Pinned example: Clover Field seed 7 at the canvas state. Step 1 rings `[93, 101]`; step 2 lights 94 and dashes 102.
- [ ] The hint never lights a cell that isn't provable (test over random mid-game states).
- [ ] The clock penalty and loss of Pure show on the won sheet.
- [ ] Keyboard: H works, and Esc closes the hint before it pauses.

Design reference: canvas board "Play — proposed, hint in progress".
