/* input.js — touches, clicks and keys → cell commands.
 *
 *   tap           uncap (or sweep a number); marks instead in mark mode
 *   long-press    mark — cycles none → guard (→ queen's guard) → none
 *   right-click   mark
 *   P / Escape    pause;  M  toggles mark mode
 *   H             the bee-line hint: open, then why, then close (#07).
 *                 Escape closes an open hint before it pauses
 *
 * A press that drifts more than a finger's width is abandoned: nothing on
 * this board is dragged, so a drift is a mis-touch, not a gesture.
 *
 * pressing() tells the renderer how far a press has got toward a long-press,
 * so it can draw the hold ring; h.onPress() fires whenever that changes
 * between "a press" and "none", so a resting loop can wake to draw it.
 */

export const HOLD_MS = 380;
const SLOP = 12;

export function bindInput(el, h) {
  let press = null;

  const cancel = () => {
    if (!press) return;
    clearTimeout(press.timer);
    press = null;
    if (h.onPress) h.onPress();
  };

  el.addEventListener('pointerdown', (e) => {
    if (!h.active()) return;
    if (e.button === 2) return;                   // contextmenu handles it
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    cancel();
    const cell = h.cellAt(e.offsetX, e.offsetY);
    if (cell < 0) return;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, cell, held: false, since: performance.now() };
    press.timer = setTimeout(() => {
      if (!press) return;
      press.held = true;
      if (h.onPress) h.onPress();
      h.onMark(press.cell);
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch { /* not allowed */ } }
    }, HOLD_MS);
    if (h.onPress) h.onPress();
  });

  el.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) cancel();
  });

  el.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    cancel();
    if (p.held || !h.active()) return;
    if (h.markMode()) h.onMark(p.cell); else h.onTap(p.cell);
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

  /** The press under way: { cell, since, t } with t 0..1 over HOLD_MS, or null. */
  function pressing(now = performance.now()) {
    if (!press || press.held) return null;
    return { cell: press.cell, since: press.since, t: Math.min(1, (now - press.since) / HOLD_MS) };
  }

  return { cancel, pressing };
}
