/* input.js — touches, clicks and keys → cell commands.
 *
 *   tap           uncap (or sweep a number); marks instead in mark mode
 *   long-press    the bubble turns slowly through the marks a cell can take
 *                 (core.holdChoices, starting with what a tap-mark would
 *                 set); letting go places the one showing
 *   swipe         a sideways drag picks a mark at once: right a guard, left
 *                 a queen's guard (or clear, where there are no queens) —
 *                 core.swipeMark. Let go short of SWIPE_PX and nothing happens
 *   right-click   mark (cycles none → guard (→ queen's guard) → none)
 *   P / Escape    pause;  M  toggles mark mode
 *   H             the bee-line hint: open, then why, then close (#07).
 *                 Escape closes an open hint before it pauses
 *
 * A press that drifts up or down more than a finger's width is abandoned:
 * the only gesture on this board is sideways.
 *
 * pressing() tells the renderer how far a press has got — toward a long-
 * press, round the hold's choices, or along a swipe — so it can draw it;
 * h.onPress() fires whenever that changes, so a resting loop can wake.
 */

export const HOLD_MS = 380;
export const CYCLE_MS = 850;     // a held bubble shows each choice this long
export const SWIPE_PX = 34;      // a sideways drag this far picks a mark
const SLOP = 12;

/** The choice showing `ms` into a hold, of a list from core.holdChoices. */
export function cycleAt(choices, ms) {
  return choices[Math.floor(Math.max(0, ms) / CYCLE_MS) % choices.length];
}

const buzz = (ms) => { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* not allowed */ } } };

export function bindInput(el, h) {
  let press = null;
  const changed = () => { if (h.onPress) h.onPress(); };

  const cancel = () => {
    if (!press) return;
    clearTimeout(press.timer);
    clearInterval(press.tick);
    press = null;
    changed();
  };

  el.addEventListener('pointerdown', (e) => {
    if (!h.active()) return;
    if (e.button === 2) return;                   // contextmenu handles it
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    cancel();
    const cell = h.cellAt(e.offsetX, e.offsetY);
    if (cell < 0) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, cell, kind: 'press', dx: 0, since: performance.now(), heldAt: 0 };
    // a swipe from an edge cell runs off the canvas: keep the pointer
    try { el.setPointerCapture(e.pointerId); } catch { /* gone already */ }
    press.timer = setTimeout(() => {
      if (!press || press.kind !== 'press') return;
      press.kind = 'hold';
      press.heldAt = performance.now();
      buzz(12);
      press.tick = setInterval(() => buzz(6), CYCLE_MS);   // a tick as each choice turns up
      changed();
    }, HOLD_MS);
    changed();
  });

  el.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const dx = e.clientX - press.x, dy = e.clientY - press.y;
    if (press.kind === 'swipe') {
      press.dx = dx;
      changed();
      return;
    }
    if (Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy)) {
      // sideways: a swipe, from a press or out of a hold
      clearTimeout(press.timer);
      clearInterval(press.tick);
      press.kind = 'swipe';
      press.dx = dx;
      changed();
    } else if (Math.abs(dy) > SLOP * (press.kind === 'hold' ? 2 : 1)) cancel();
  });

  el.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const p = press, now = performance.now();
    cancel();
    if (!h.active()) return;
    if (p.kind === 'hold') h.onHold(p.cell, now - p.heldAt);
    else if (p.kind === 'swipe') { if (Math.abs(p.dx) >= SWIPE_PX) h.onSwipe(p.cell, Math.sign(p.dx)); }
    else if (h.markMode()) h.onMark(p.cell); else h.onTap(p.cell);
  });

  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!h.active()) return;
    cancel();
    const cell = h.cellAt(e.offsetX, e.offsetY);
    if (cell >= 0) h.onMark(cell);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'Escape' && h.onEscape && h.onEscape()) e.preventDefault();
    else if ((e.key === 'h' || e.key === 'H') && h.onHint && h.active()) { h.onHint(); e.preventDefault(); }
    else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { h.onPause(); e.preventDefault(); }
    else if ((e.key === 'm' || e.key === 'M') && h.active()) { h.onToggle(); e.preventDefault(); }
  });

  /** The press under way, or null:
   *  { cell, since, kind: 'press' | 'hold' | 'swipe', t, held, dx }
   *  t 0..1 toward a long-press; held ms since it became one; dx the swipe. */
  function pressing(now = performance.now()) {
    if (!press) return null;
    return {
      cell: press.cell, since: press.since, kind: press.kind,
      t: press.kind === 'press' ? Math.min(1, (now - press.since) / HOLD_MS) : 1,
      held: press.kind === 'hold' ? now - press.heldAt : 0,
      dx: press.dx,
    };
  }

  return { cancel, pressing };
}
