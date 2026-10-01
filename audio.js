/* audio.js — the one place the game touches sound.
 *
 * The pack (soundpack.js) IS the sound. If the element library or Arcade.audio
 * is missing — a stale cached page, some non-launcher embed — the game is
 * silent by design; there is no chiptune fallback (GAME_INTEGRATION §5).
 *
 * Every play goes through the mixer (mixer.js): params are cut down to what a
 * cue may hear, the throttle folds bursts, and the variant and scale rung are
 * picked here so the pack only has to sound them.
 */

import { createMixer, cueContext } from './mixer.js';

export { cueContext };

let ready = false;
const mixer = createMixer();
const clock = () => (typeof performance !== 'undefined' ? performance.now() : 0);

export function initAudio() {
  try {
    const a = window.Arcade && window.Arcade.audio;
    const p = window.ArcadeSoundPack;
    if (!a || !p || typeof a.graph !== 'function' || typeof a.room !== 'function') return;
    a.room(p.ROOM);
    for (const name of Object.keys(p.CUES)) a.graph(name, p.CUES[name], { send: p.SENDS[name] });
    ready = true;
  } catch { ready = false; }
}

// Called from the input path: must never throw.
export function sfx(name, params) {
  if (!ready) return;
  try {
    const p = mixer.plan(name, params, clock());
    if (p) window.Arcade.audio.play(name, p);
  } catch { /* silence is fine */ }
}

/** A new frame starts its variant rotation from the top, so a replayed code sounds the same. */
export function sfxReset() {
  try { mixer.reset(); } catch { /* silence is fine */ }
}
