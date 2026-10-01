# Clean reads and the Pure seal: credit the deduction

**Labels:** `feel` `progression` · **Size:** S · **Depends on:** #02
**Touches:** `main.js`, `index.html`, `style.css`, `render.js` (glint hook), `tests/`

## Why

Today a proven move and a lucky guess look and sound identical. The game promises "no guessing needed" but never notices when you honour it. Crediting the deduction is the cheapest, biggest engagement win in the review.

## Behaviour

- **Clean read:** an uncap whose cell was in `provenNow(s).safe` *before* the tap. For a sweep, it's clean only if every target was proven safe.
- **Lucky:** an uncap that succeeded but wasn't provable. No penalty and no scolding, but the frame loses **Pure**.
- **Pure frame:** cleared with 0 lucky moves, 0 hints (#07) and 0 smoke (#08).

## Tasks

- [ ] **Classify before applying.** In `main.js → act()`, call `provenNow(s)` once *before* applying `Core.tap`. Classify the move as clean or lucky, and pass `proven` on the uncap event to `drain()`, the renderer and `sfx`.
- [ ] **Run counters.** Keep `{ clean, lucky, hints, puffs }` in main-side run meta, persisted with the run in `Arcade.state('run')`. `core.js` stays rules-only.
- [ ] **Rail.** The second line under the hive name reads `31 clean · pure`, or `· assisted` once Pure is lost. The frame code moves to the pause sheet (it's still on the won sheet).
- [ ] **Won sheet:** show clean/total, hints and puffs, plus a **Pure** label and seal when it applies. See the "Won" board.
- [ ] **Records.** Add `pure-time-<hive>` via `Arcade.records.best` (lower is better, `duration-ms`), and a `pure` count in `Arcade.stats('frames')[hive]`. The daily log entry gains `pure: bool`.
- [ ] **Glint.** When a move is clean, call a renderer hook `R.glint(i)`. The animation itself lives in the juice-pass issue (#05); a no-op stub is fine here.
- [ ] **Cost.** One `provenNow` per tap. If profiling shows jank, compute it right after the previous move settles and cache it until the state changes.

## Acceptance criteria

- [ ] Unit tests (via a pure helper) for:
  - tapping a proven-safe cell counts as clean
  - tapping an unproven safe cell counts as lucky and clears Pure
  - a sweep with one unproven target counts as lucky
- [ ] Resuming a saved run keeps its counters.
- [ ] `e2e.mjs`: a solver-driven playthrough ends with a Pure clear, and a playthrough with one forced random uncap ends not Pure.
- [ ] No added input latency you can feel (p95 of `provenNow` within #02's budget).

Design reference: canvas boards "Play — proposed", "Won", "Juice pass → Clean read".
