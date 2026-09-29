# Ghost race: race your own best run on a frame code

**Labels:** `replayability` · **Size:** S · **Depends on:** #09 (jars store the run). Its rail element is reused by P1 Race.
**Touches:** `main.js`, `index.html`, `style.css`

## Why

Frame codes already let people race by reading a code aloud. Replaying a cleared code against your own best gives the same thrill solo, and it builds the exact rail element that P1 Race needs later.

## Behaviour

- When a frame starts whose code has a jar (#09), a thin **ghost comb bar** appears under the honey level (canvas "Play — proposed").
  - It fills at the best run's pace; yours fills as you play.
  - When you finish, the sheet shows "Beat your ghost by 12.4 s" or "Ghost won by 3.1 s".
- The best run's pace is stored as a compact progress timeline: the elapsed ms at each 5% of safe cells opened. That's 20 integers per jar, saved only when a run sets the jar's best time.

## Tasks

- [ ] Record the timeline during play in main-side run meta, and persist it with the run.
- [ ] Save the timeline into the jar on a new best.
- [ ] Rail bar: interpolate the ghost's progress at the current elapsed time. Hide the bar in dailies until they're cleared once, so a first play isn't cluttered.
- [ ] Add a settings toggle, "Show ghost", defaulting to on, and remember it in `prefs`.

## Acceptance criteria

- [ ] Replaying a cleared frame shows the ghost. A fresh code shows none.
- [ ] Beating the ghost updates the jar's timeline and time.
- [ ] Motion off: the bar still updates (it's information), without easing.

Design reference: canvas board "Keeping play fresh → Racing your own ghost".
