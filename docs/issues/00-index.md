# Hive Mind: design-review issues

From the 2026-09-28 design review (Hive Mind design-review canvas: https://claude.ai/artifact/YXHWfp8ZPtGJTDjtQGzZSV). There are thirteen issues, each small enough for one PR. Build them in this order.

Filed on GitHub as [#1](https://github.com/paulgibeault/hive-mind/issues/1)–[#13](https://github.com/paulgibeault/hive-mind/issues/13), with this index as tracking issue [#14](https://github.com/paulgibeault/hive-mind/issues/14). Issue numbers match file numbers: `#02` here is `docs/issues/02-*.md` and GitHub issue #2. The GitHub issues are the live copies; these files are the original snapshot.

| # | Issue | Size | Depends on | Phase |
|---|---|---|---|---|
| 01 | Rename hives, guards not wasps, broken comb | S–M | — | **Now** |
| 02 | Solver: provable-now and smallest-proof queries | M | 01 | **Now** |
| 03 | Clean reads and the Pure seal | S | 02 | **Now** |
| 04 | "What gave it away" sting lesson | S | 02 | **Now** |
| 05 | Juice pass (v1 now, v2 next) | M+S | 01 (03 for the glint) | **Now** / Next |
| 06 | Sound pass | M | 01 (D-cues wait on 03/05/07/08/09) | **Now** |
| 07 | Bee-line hint | M | 02, 03 | Next |
| 08 | The smoker | M | 01, 04 | Next |
| 09 | Pantry and comb calendar | M | 01, 03 | Next |
| 10 | Queen's Frame (weekly) | S–M | 01, 09 (08 nice to have) | Later |
| 11 | Ghost race | S | 09 | Later |
| 12 | Scout cells (fourth-hive idea) | L | 02 | Later |
| 13 | Split-sight ping | S | P2 | Later |

```
01 ─┬─ 02 ─┬─ 03 ─┬─ 07
    │      │      └─ 09 ─┬─ 10
    │      ├─ 04 ── 08   └─ 11
    │      └─ 12
    ├─ 05
    └─ 06
P2 ── 13
```

## Rules every issue inherits

- **The promise:** every frame can be finished by logic alone. Anything that changes a clue ships with solver support and a brute-force test.
- **Pure rules:** `core.js`, `solver.js` and `hex.js` stay pure: no DOM, no clock. The repo gate enforces it.
- **Seeded:** anything that shapes a frame is a pure function of (hive, seed).
- **No tells:** nothing that moves, sounds or glows may depend on hidden contents before the tap.
- **Motion never blocks input.** Reduced motion and power saver get a static equivalent.
- **Help is honest:** hints and smoke cost time or purity, and say so.
- **Vendored files:** never edit `arcade-rng.js`, `tools/verify-artifact.mjs` or `tools/inject-precache.mjs`.
- **Tests:** `npm test` and `node tools/e2e.mjs` pass on every PR.
- **Workflow:** gitflow, with a branch per issue and a PR; Paul reviews and merges.

## Handing an issue to Claude Code

> Implement `docs/issues/0N-….md`. Read `docs/design.md` and the files listed under **Touches** first. Work on a branch named `feature/0N-<slug>`, keep the PR to this issue's scope, and check off the acceptance criteria in the PR description.
