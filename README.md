# Hive Mind

Uncap every safe cell of the honeycomb; leave the guards asleep. Minesweeper on
hexagons where every frame is proven solvable without a guess. A game for
[Paul's Arcade](https://paulgibeault.github.io/) — `gameId: hive-mind`.

    npm test                                   # artifact check, the rules, the solver, the repo gates
    ../paulgibeault.github.io/dev.sh .         # stage with the launcher → http://127.0.0.1:4791/hive-mind/
    node tools/e2e.mjs                         # the real page, headless (needs the dev server up)
    node tools/make-icon.mjs                   # icon.svg → icon.png

| File | What it is |
|---|---|
| `core.js` | The rules: hives, the frame generator, uncap / mark / sweep, frame codes. Seeded; no DOM, no clock. |
| `solver.js` | What a careful player can know. The generator keeps only frames it can finish. |
| `hex.js` | The comb's geometry: neighbours, centres, hit-testing. |
| `reads.js` | Clean reads: was a move proven before the tap, is the frame still Pure, and what a sting should have taught. Pure; `main.js` asks it. |
| `migrate.js` | Stored data from older versions (old hive ids, v1 saves) brought up to date. Pure; `main.js` applies it on boot. |
| `arcade-rng.js` | The fleet's seeded RNG — a vendored, byte-identical copy of the launcher's. Never edit it here. |
| `render.js` | The frame, drawn on one canvas. Reads state, never writes it. |
| `input.js` | Taps, long-presses, right-clicks and keys → cell commands. |
| `main.js` | The sheets, the clock, the daily, and the Arcade SDK contract. |
| `soundpack.js`, `audio.js`, `mixer.js` | The sound pack (WebAudio graphs, one instrument per hive), its one registration site, and the pure mixer (no-tells param filter, throttle, variant rotation, scale rung). |
| `tools/stage.mjs`, `sw.js`, `.github/workflows/pages.yml` | The fleet CI/CD standard (launcher `GAME_INTEGRATION.md` §10, §13a). `tools/verify-artifact.mjs` and `tools/inject-precache.mjs` are vendored fleet files — never edit them here. |
| `docs/design.md` | The concept, the decisions, and the paired modes still to build. |

`?dev=1` exposes `window.__hive` (state, mode, cell positions) for test drivers.
