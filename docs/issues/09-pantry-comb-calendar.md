# The pantry and the comb calendar

**Labels:** `progression` `ui` · **Size:** M · **Depends on:** #01 (names), #03 (the Pure flag). #11 builds on it.
**Touches:** new `honey.js` (pure), `main.js`, `index.html`, `style.css`, `tests/`

## Why

Progress today is one line of text. Paul likes the pantry: every cleared frame becomes a jar of honey whose **colour comes from the flowers** it was gathered from. Jars are a collection you can see grow, and each jar is also a saved frame code you can replay or send.

## Honey colour (pure and deterministic)

New module `honey.js` exporting `honeyColour(hive, seed) → { top, bottom }` (two CSS colours for the jar gradient):

| hive | honey | colour |
|---|---|---|
| Clover Field | pale, mild | `#fff0b8 → #fbe7a1`, with a tiny seeded lightness wobble |
| Apple Orchard | amber, fruity | `#e8a846 → #dd9a38` |
| Wildflowers | **no two alike** | two tones picked from the seed within an amber-to-russet band: hue 18–40°, low-to-mid lightness |
| Queen's Frame (#10) | dark, royal | `#5a2c0e → #3a1c08` |

The same colour is used by the win pour (#05) and the jar clink pitch (#06): paler honey gives a higher clink.

## Tasks

- [ ] **`honey.js`** with unit tests: deterministic, Wildflowers colours spread (no two of 100 seeds are identical), and all colours stay in their band.
- [ ] **Jar records.** Each win appends a jar to `Arcade.stats('pantry')`:

  ```js
  { code, hive, seed, ms, pure, clean, hints, puffs, date }
  ```

  - Per hive, keep the 200 most recent jars in full and collapse older ones into counts.
  - A replayed code *updates* its jar (best time, and pure once earned) rather than adding a duplicate.
- [ ] **Pantry sheet** (new `<section class="sheet">`), per the canvas "Pantry" board:
  - one shelf per hive, with a flower swatch and taste note; jars with a wax seal if pure
  - an empty dashed slot for the Queen's Frame until the first one is cleared
  - reached from the menu's pantry strip, which shows a mini shelf and counts
- [ ] **Jar detail.** Tapping a jar shows hive, date, code, time, clean/hints/puffs, and two buttons:
  - **Replay frame:** `startFrame(hive, seed)`
  - **Send to a friend:** `navigator.share({ text: code })`, falling back to copy-to-clipboard with a toast
- [ ] **Won sheet:** the jar fills in the honey colour, with the caption `Pure · jar 16 · clover honey`.
- [ ] **Menu hive buttons:** show a flower swatch and a jar count per hive.
- [ ] **Comb calendar.** Replace the daily strip's text with the current month drawn as hex comb, Monday first:
  - cleared days in honey, pure days with a seal dot
  - today outlined, missed days dark wax, future days faint
  - the streak line below
  - store `pure` in the daily log (#03)

## Acceptance criteria

- [ ] Accessibility: jars are real `<button>`s with labels ("Wildflowers, 21 Sep, 3:48, pure"), and the calendar has a text alternative for the streak.
- [ ] Importing an old save with no pantry backfills nothing and shows an empty shelf. Don't invent jars from the old `frames` counts.
- [ ] Storage stays under ~50 KB for 600 jars.
- [ ] `e2e.mjs`: win a frame, open the pantry, replay the jar, and the same frame loads.

Design reference: canvas boards "Menu", "The pantry", "Won".
