# Split sight (P2): the ping gesture

**Labels:** `paired-play` `later` · **Size:** S · **Depends on:** P2 Split sight existing (see `docs/design.md → Next — paired play`)
**Touches:** `main.js` (peer messages), `render.js`, `input.js`

## Why

In Split sight, each phone sees only half the numbers, and the mode's whole point is making players talk. When they aren't on a call or in the same room, a ping gives that talk a gesture: "read me this one".

## Behaviour

- Tap an uncapped **blank** cell (one your partner can read) to ping it.
  - That cell glows honey on your partner's phone for 2 s, with a soft `hint`-style chirp.
  - Your own phone shows a faint outline, so you know it was sent.
- Pinging a cell you can read, or a capped cell, does nothing. A capped tap still uncaps as normal.
- Rate limit: one ping per 500 ms, and at most 3 live pings at once.

## Tasks

- [ ] Peer message `{ t: 'ping', i }`. It never changes game state, so it needs no ordering guarantees.
- [ ] Input: a tap on a partner-only blank cell becomes a ping in P2 mode, never an uncap or sweep.
- [ ] Renderer: incoming glow and outgoing outline, with a still version for motion off.

## Acceptance criteria

- [ ] Two-browser e2e: a ping on phone A shows on phone B within 300 ms on a LAN.
- [ ] Pings never leak hidden information. They only point at cells that are already uncapped.

Design reference: canvas board "Keeping play fresh → Split sight: the ping".
