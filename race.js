/* race.js — the race rail: two thin bars under the rail, yours (the honey
 * level) and a rival's (a comb bar of 20 cells, one per 5%).
 *
 * A self-contained component. The ghost race (#11) drives it with your best
 * run's pace; P1 Race will drive the same element with the other phone's
 * progress. It knows nothing of frames or clocks: it is handed two fractions
 * and draws them.
 *
 *   const bar = createRaceBar(el, { rival: 'Ghost' });
 *   bar.show(true);                         // hidden until there is a race
 *   bar.set(0.42, 0.55, { ease: true });    // you, rival (0..1); ease off = jump
 *   bar.rival('Rival');                     // the rival's name, for its label
 *   bar.state                               // { shown, you, rival, ease } for test drivers
 *
 * Motion off (reduced motion, power saver) still updates — the bars are
 * information — it just doesn't ease between updates.
 */

const clamp = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const pct = (x) => Math.round(x * 100);

export function createRaceBar(el, opts = {}) {
  let name = opts.rival || 'Ghost';
  const state = { shown: false, you: 0, rival: 0, ease: false };

  el.classList.add('race');
  el.setAttribute('role', 'img');
  el.replaceChildren();
  const lane = (cls) => {
    const l = document.createElement('span');
    l.className = `race-lane ${cls}`;
    const fill = document.createElement('i');
    l.append(fill);
    el.append(l);
    return fill;
  };
  const you = lane('you'), rival = lane('rival');

  function paint() {
    el.classList.toggle('ease', state.ease);
    you.style.transform = `scaleX(${state.you})`;
    rival.style.transform = `scaleX(${state.rival})`;
    el.classList.toggle('behind', state.rival > state.you);
    el.setAttribute('aria-label', `You ${pct(state.you)}%, ${name.toLowerCase()} ${pct(state.rival)}%`);
  }

  return {
    el,
    get state() { return { ...state }; },
    show(on) { state.shown = !!on; el.hidden = !on; },
    set(y, r, o = {}) {
      state.you = clamp(y);
      state.rival = clamp(r);
      state.ease = !!o.ease;
      paint();
    },
    rival(n) { name = n || 'Ghost'; paint(); },
  };
}
