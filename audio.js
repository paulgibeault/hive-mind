/* audio.js — the one place the game touches sound.
 *
 * The pack (soundpack.js) IS the sound. If the element library or Arcade.audio
 * is missing — a stale cached page, some non-launcher embed — the game is
 * silent by design; there is no chiptune fallback (GAME_INTEGRATION §5).
 */

let ready = false;

export function initAudio() {
  const a = window.Arcade && window.Arcade.audio;
  const p = window.ArcadeSoundPack;
  if (!a || !p || typeof a.graph !== 'function' || typeof a.room !== 'function') return;
  a.room(p.ROOM);
  for (const name of Object.keys(p.CUES)) a.graph(name, p.CUES[name], { send: p.SENDS[name] });
  ready = true;
}

// Called from the input path: must never throw.
export function sfx(name, params) {
  if (!ready) return;
  try { window.Arcade.audio.play(name, params); } catch { /* silence is fine */ }
}
