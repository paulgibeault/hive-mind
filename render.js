/* render.js — the frame, drawn on one canvas. Reads state, never writes it.
 *
 * Capped cells are bright honey wax; an uncapped cell is dark, empty comb
 * with its reading in it. Nothing moves unless something just happened, and
 * every verb gets its moment:
 *
 *   uncap    the cap cracks, wax flecks fall, a glint crosses the open cell;
 *            a flood does it ring by ring out from the tapped cell
 *   sweep    the number lifts and a light runs clockwise round it; the cells
 *            open as it passes. A sweep that can't fire shakes its number
 *   mark     the pin drops in large and settles with one bounce
 *   hold     a ring fills round the pressed cell, so long-press can be learned
 *   sting    the guard's wings flicker and the frame shakes, under the flash
 *   won      the guards seal under dark wax, and honey pours down the comb
 *
 * Then the loop rests. Motion never blocks: core.js has already applied the
 * move, so only the drawing is staggered — a cell still drawn capped mid-
 * ripple is open to the next tap. With motion off (reduced motion, power
 * saver) each moment draws its still instead; a still that has to end (a
 * brief outline, the hold ring's delay) sets view.wakeAt, and main.js wakes
 * the resting loop once for it.
 *
 * No tells: a capped cell is drawn from the cap sprite and the player's mark
 * alone, never from what it hides — broken comb included. A ripple covers
 * only the cells its uncap opened; a dimmed number reads only open cells and
 * marks (juice.js).
 */

import { centre, extent, cellAt as hexAt } from './hex.js';
import { EMPTY, Q, MARK_Q, nbrsOf } from './core.js';
import {
  RING_MS, SWEEP_MS, POUR_ROW_MS, rings, clockwise, showsNumber, finished,
  clamp01, easeOut, easeIn, pinScale, shake,
} from './juice.js';

const C = {
  cap: '#f2b33d', capDeep: '#c9801a', capHi: '#ffd978',
  wax: '#3b2b19', waxEdge: '#2a1e11', sealHi: '#5a4128', sealDeep: '#1c140b',
  ink: '#f6ead2', guard: '#f5c542', queen: '#ec5b45', dark: '#2a1d10',
  queenInk: '#8e2414',           // the queen's red, deep enough to read on honey
};
const UNCAP_MS = 180;            // crack, flecks and glint, per cell
const CRACK = 0.28;              // …of which the cap cracking takes this much
const PIN_MS = 240;
const LIFT_MS = 260, LIGHT_MS = 110, SWEEP_STILL_MS = 120;
const NOPE_MS = 160;
const SHAKE_MS = 240, WING_MS = 40, FLASH_MS = 420, FLASH_STILL_MS = 300;
const HOLD_SHOW = 120;           // a press younger than this is likely a tap: no ring yet
const POUR_CELL_MS = 160;
const GLINT_MS = 300;
const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, sans-serif';

/* A small fixed stream per cell, for shapes that must look the same from
 * frame to frame (a crack, where the flecks fall). From the index alone. */
function cellRng(i, salt) {
  let h = (Math.imul(i + 1, 2654435761) ^ salt) >>> 0;
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296);
}

function hexPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = Math.PI / 180 * (60 * k - 90);
    const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
    if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const layout = { W: 1, H: 1, r: 20, ox: 0, oy: 0, cols: 8, rows: 12, dpr: 1, top: 56 };
  const view = {
    motion: true,
    anims: new Map(),            // cell → when its uncap starts (ripple-delayed)
    sweep: null,                 // { cell, at, order }: the light running round
    refusal: null,               // { cell, at }: a sweep that couldn't fire
    pins: new Map(),             // cell → when its pin went in
    sting: null,                 // { cell, at }
    pour: null,                  // { at, honey }: the win's honey
    glints: [],                  // { cell, at, to }: sparks rising to the rail
    hold: null,                  // the press under way (input.js pressing()), set before each draw
    wakeAt: Infinity,            // motion off: when the showing still ends
    mode: 'play',                // tints the stung / won board
  };
  let sprites = null;

  function sprite(draw) {
    const r = layout.r, d = layout.dpr;
    const size = Math.ceil(2 * r * d) + 2;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.scale(d, d);
    draw(g, size / d / 2, size / d / 2, r);
    return c;
  }

  function build() {
    const inner = (r) => r * 0.94;
    const cap = (g, x, y, r) => {
      hexPath(g, x, y, inner(r));
      const grad = g.createLinearGradient(x, y - r, x, y + r);
      grad.addColorStop(0, C.capHi);
      grad.addColorStop(0.45, C.cap);
      grad.addColorStop(1, C.capDeep);
      g.fillStyle = grad;
      g.fill();
      // a soft dome highlight
      g.save();
      hexPath(g, x, y, inner(r));
      g.clip();
      const hi = g.createRadialGradient(x - r * 0.25, y - r * 0.35, 0, x - r * 0.25, y - r * 0.35, r * 0.8);
      hi.addColorStop(0, 'rgba(255,245,200,0.55)');
      hi.addColorStop(1, 'rgba(255,245,200,0)');
      g.fillStyle = hi;
      g.fillRect(x - r, y - r, 2 * r, 2 * r);
      g.restore();
    };
    const open = (g, x, y, r) => {
      hexPath(g, x, y, inner(r));
      g.fillStyle = C.wax;
      g.fill();
      hexPath(g, x, y, inner(r) * 0.84);
      g.strokeStyle = C.waxEdge;
      g.lineWidth = Math.max(1, r * 0.1);
      g.stroke();
    };
    // a won frame's guards, sealed over in dark wax: shaped like a cap, so the
    // frame reads as finished comb rather than a map of where they slept
    const sealed = (g, x, y, r) => {
      hexPath(g, x, y, inner(r));
      const grad = g.createLinearGradient(x, y - r, x, y + r);
      grad.addColorStop(0, C.sealHi);
      grad.addColorStop(0.5, C.wax);
      grad.addColorStop(1, C.sealDeep);
      g.fillStyle = grad;
      g.fill();
      g.save();
      hexPath(g, x, y, inner(r));
      g.clip();
      const hi = g.createRadialGradient(x - r * 0.25, y - r * 0.35, 0, x - r * 0.25, y - r * 0.35, r * 0.8);
      hi.addColorStop(0, 'rgba(255,220,160,0.22)');
      hi.addColorStop(1, 'rgba(255,220,160,0)');
      g.fillStyle = hi;
      g.fillRect(x - r, y - r, 2 * r, 2 * r);
      g.restore();
      hexPath(g, x, y, inner(r));
      g.strokeStyle = 'rgba(242,179,61,0.3)';
      g.lineWidth = Math.max(1, r * 0.05);
      g.stroke();
    };
    // a warm spark, for a clean read's glint
    const spark = (g, x, y, r) => {
      const sg = g.createRadialGradient(x, y, 0, x, y, r * 0.4);
      sg.addColorStop(0, 'rgba(255,248,214,1)');
      sg.addColorStop(0.35, 'rgba(255,205,96,0.8)');
      sg.addColorStop(1, 'rgba(242,150,40,0)');
      g.fillStyle = sg;
      g.fillRect(x - r, y - r, 2 * r, 2 * r);
    };
    sprites = {
      cap: sprite(cap), open: sprite(open), sealed: sprite(sealed), spark: sprite(spark), band: band(),
      honey: view.pour ? honeySprite(view.pour.honey) : null,
    };
  }

  // the light that crosses a fresh cell: a soft vertical band, skewed as it's drawn
  function band() {
    const r = layout.r, d = layout.dpr;
    const c = document.createElement('canvas');
    c.width = Math.ceil(r * 0.9 * d) + 2;
    c.height = Math.ceil(2 * r * d) + 2;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, c.width, 0);
    grad.addColorStop(0, 'rgba(255,226,150,0)');
    grad.addColorStop(0.5, 'rgba(255,236,176,0.5)');
    grad.addColorStop(1, 'rgba(255,226,150,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // the win's honey, in the hive's colour: built once per pour, never per frame
  function honeySprite(honey) {
    return sprite((g, x, y, r) => {
      hexPath(g, x, y, r * 0.86);
      const grad = g.createLinearGradient(x, y - r, x, y + r);
      grad.addColorStop(0, honey.top);
      grad.addColorStop(1, honey.bottom);
      g.fillStyle = grad;
      g.fill();
      g.save();
      hexPath(g, x, y, r * 0.86);
      g.clip();
      g.fillStyle = 'rgba(255,255,240,0.28)';
      g.beginPath(); g.ellipse(x - r * 0.22, y - r * 0.38, r * 0.42, r * 0.16, -0.35, 0, Math.PI * 2); g.fill();
      g.restore();
    });
  }

  function resize(w, h, cols, rows, top) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const pad = 10;
    const availW = w - pad * 2, availH = h - top - pad * 2;
    const r = Math.max(8, Math.min(availW / (Math.sqrt(3) * (cols + 0.5)), availH / (1.5 * rows + 0.5)));
    const e = extent(cols, rows, r);
    Object.assign(layout, {
      W: w, H: h, r, cols, rows, dpr, top,
      // hung just under the rail: spare height collects at the bottom, where
      // the end-of-frame sheet docks, so it covers as little comb as it can
      ox: (w - e.w) / 2, oy: top + pad + Math.max(0, Math.min((availH - e.h) / 2, 12)),
    });
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    build();
    return layout;
  }

  const at = (i) => {
    const c = centre(i, layout.cols, layout.r);
    return { x: layout.ox + c.x, y: layout.oy + c.y };
  };

  function cellAt(x, y) {
    return hexAt(x - layout.ox, y - layout.oy, layout.cols, layout.rows, layout.r);
  }

  function blit(img, x, y) {
    const s = img.width / layout.dpr;
    ctx.drawImage(img, x - s / 2, y - s / 2, s, s);
  }

  // ── the marks and the guards ────────────────────────────────────────
  function bug(x, y, r, kind, startled = false) {
    // a round, fuzzy guard bee, asleep; the queen's guard is the same bee in
    // red with a small crown. Startled (it just stung), its wings flick up.
    const s = r * 0.42;
    const queen = kind === Q;
    const body = queen ? C.queen : C.guard;
    ctx.save();
    ctx.translate(x, y);
    // wings, folded back — or flicked up and out
    ctx.fillStyle = startled ? 'rgba(255,248,230,0.85)' : 'rgba(246,234,210,0.6)';
    const [wx, wy, wa] = startled ? [0.8, -0.95, 1.05] : [0.55, -0.72, 0.5];
    ctx.beginPath(); ctx.ellipse(-s * wx, s * wy, s * 0.42, s * 0.26, -wa, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s * wx, s * wy, s * 0.42, s * 0.26, wa, 0, Math.PI * 2); ctx.fill();
    // fuzz: a ring of soft tufts just outside the body
    ctx.fillStyle = body;
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(Math.cos(a) * s * 0.86, Math.sin(a) * s * 0.8, s * 0.16, 0, Math.PI * 2); ctx.fill();
    }
    // body, round, with two soft bands
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.9, s * 0.84, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = 'rgba(42,29,16,0.75)';
    for (const dy of [0.12, 0.52]) ctx.fillRect(-s, s * dy, 2 * s, s * 0.18);
    ctx.restore();
    // closed eyes: two sleepy arcs
    ctx.strokeStyle = C.dark;
    ctx.lineWidth = Math.max(1, r * 0.055);
    ctx.lineCap = 'round';
    for (const ex of [-0.32, 0.32]) {
      ctx.beginPath(); ctx.arc(s * ex, -s * 0.22, s * 0.16, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    }
    if (queen) {
      // the crown: a notched band on top of the head
      const cy = -s * 0.86, w = s * 0.34;
      ctx.fillStyle = C.capHi;
      ctx.beginPath();
      ctx.moveTo(-w, cy + s * 0.12);
      ctx.lineTo(-w, cy - s * 0.2);
      ctx.lineTo(-w * 0.5, cy - s * 0.04);
      ctx.lineTo(0, cy - s * 0.26);
      ctx.lineTo(w * 0.5, cy - s * 0.04);
      ctx.lineTo(w, cy - s * 0.2);
      ctx.lineTo(w, cy + s * 0.12);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function markGlyph(x, y, r, m) {
    // a pin pushed into the wax: amber disc (guard) or red square (queen's guard),
    // shaped differently so the colours are never the only difference
    const s = r * 0.3;
    ctx.save();
    ctx.shadowColor = 'rgba(42,29,16,0.5)';
    ctx.shadowBlur = r * 0.15;
    ctx.shadowOffsetY = r * 0.06;
    ctx.fillStyle = m === MARK_Q ? C.queen : C.dark;
    ctx.beginPath();
    if (m === MARK_Q) ctx.rect(x - s, y - s, 2 * s, 2 * s);
    else ctx.arc(x, y, s * 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = m === MARK_Q ? C.dark : C.guard;
    ctx.beginPath();
    if (m === MARK_Q) ctx.rect(x - s * 0.35, y - s * 0.35, s * 0.7, s * 0.7);
    else ctx.arc(x, y, s * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  function crack(x, y, r, i) {
    // a jagged break across the cell, its shape fixed per cell: a dark split
    // with a honey-lit edge, so it can't be mistaken for an empty zero
    let h = (i * 2654435761) >>> 0;
    const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) / 4294967296);
    const a = rnd() * Math.PI;
    const dx = Math.cos(a), dy = Math.sin(a);
    ctx.beginPath();
    for (let k = 0; k <= 5; k++) {
      const t = -0.8 + 1.6 * (k / 5);
      const j = (rnd() - 0.5) * r * 0.28;
      const px = x + dx * t * r - dy * j, py = y + dy * t * r + dx * j;
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(12,8,4,0.9)';
    ctx.lineWidth = Math.max(2, r * 0.13);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(242,179,61,0.55)';
    ctx.lineWidth = Math.max(1, r * 0.045);
    ctx.stroke();
  }

  /* ink: 'dim' for a finished number (35%), 'honey' for dark ink on the
   * win's honey, or nothing for the plain reading */
  function reading(s, i, x, y, r, ink) {
    const w = s.shown[i], h = s.shownH[i];
    const big = Math.round(r * 0.95);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (s.broken[i]) {
      // broken comb: safe, and it reads nothing
      crack(x, y, r, i);
      return;
    }
    const honey = ink === 'honey';
    if (ink === 'dim') ctx.globalAlpha = 0.35;
    if (s.queens > 0) {
      const both = w > 0 && h > 0;
      const size = both ? Math.round(r * 0.72) : big;
      ctx.font = `800 ${size}px ${FONT}`;
      if (w > 0) {
        ctx.fillStyle = honey ? C.dark : C.guard;
        ctx.fillText(String(w), both ? x - r * 0.33 : x, y + r * 0.04);
      }
      if (h > 0) {
        const hx = both ? x + r * 0.33 : x;
        const b = size * 0.62;
        ctx.strokeStyle = ctx.fillStyle = honey ? C.queenInk : C.queen;
        ctx.lineWidth = Math.max(1.2, r * 0.07);
        ctx.strokeRect(hx - b, y - b + r * 0.02, 2 * b, 2 * b);
        ctx.fillText(String(h), hx, y + r * 0.04);
      }
    } else if (w > 0) {
      ctx.font = `800 ${big}px ${FONT}`;
      ctx.fillStyle = honey ? C.dark : C.ink;
      ctx.fillText(String(w), x, y + r * 0.04);
    }
    ctx.globalAlpha = 1;
  }

  // ── the moments ─────────────────────────────────────────────────────
  function capCrack(x, y, r, i, p) {
    // three splits running out from near the middle, growing with p
    const rnd = cellRng(i, 0x5eed);
    const cx = x + (rnd() - 0.5) * r * 0.3, cy = y + (rnd() - 0.5) * r * 0.3;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = (k / 3 + rnd() * 0.2) * Math.PI * 2;
      const len = r * (0.45 + rnd() * 0.3) * easeOut(p);
      const bend = (rnd() - 0.5) * 0.6;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * len * 0.5, cy + Math.sin(a) * len * 0.5);
      ctx.lineTo(cx + Math.cos(a + bend) * len, cy + Math.sin(a + bend) * len);
    }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(110,62,12,0.85)';
    ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.stroke();
  }

  function flecks(x, y, r, i, u) {
    // 3–4 bits of wax fall about 12 px and fade
    const rnd = cellRng(i, 0xf1ec);
    const n = rnd() < 0.5 ? 4 : 3;
    ctx.globalAlpha = 1 - u;
    for (let k = 0; k < n; k++) {
      const ox = (rnd() - 0.5) * r * 0.9, oy = (rnd() - 0.6) * r * 0.6;
      const sz = r * (0.1 + rnd() * 0.07), spin = (rnd() - 0.5) * 4;
      ctx.save();
      ctx.translate(x + ox * (1 + 0.25 * u), y + oy + 12 * easeIn(u));
      ctx.rotate(spin * u + k);
      ctx.fillStyle = k & 1 ? C.capDeep : C.cap;
      ctx.fillRect(-sz / 2, -sz * 0.35, sz, sz * 0.7);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function glintAcross(x, y, r, g) {
    // the honey light crosses the fresh cell once, left to right
    const img = sprites.band, bw = img.width / layout.dpr, bh = img.height / layout.dpr;
    ctx.save();
    hexPath(ctx, x, y, r * 0.86);
    ctx.clip();
    ctx.globalAlpha = Math.sin(Math.PI * g);
    ctx.transform(1, 0, -0.4, 1, 0.4 * y, 0);
    ctx.drawImage(img, x - r * 1.3 + 2.6 * r * g - bw / 2, y - bh / 2, bw, bh);
    ctx.restore();
  }

  /* An uncapped cell: open comb and its reading, with whatever moment it is
   * in on top. Returns true while it moves. */
  function openCell(s, nbrs, i, x, y, r, now) {
    const a = view.anims.get(i);
    let u = -1;
    if (a != null) {
      const t = (now - a) / UNCAP_MS;
      if (!view.motion || t >= 1) view.anims.delete(i);
      else if (t < 0) { blit(sprites.cap, x, y); return true; }   // the ripple isn't here yet
      else if (t < CRACK) { blit(sprites.cap, x, y); capCrack(x, y, r, i, t / CRACK); return true; }
      else u = (t - CRACK) / (1 - CRACK);
    }
    blit(sprites.open, x, y);
    let ink = null, moving = u >= 0;
    if (view.pour && sprites.honey && !s.broken[i]) {
      // the win: honey fills the comb row by row, and the numbers go dark on it
      const row = (i / s.cols) | 0;
      const t = view.motion ? (now - view.pour.at - row * POUR_ROW_MS) / POUR_CELL_MS : 1;
      if (t > 0) {
        const k = easeOut(clamp01(t)), img = sprites.honey, sz = img.width / layout.dpr * (0.8 + 0.2 * k);
        ctx.globalAlpha = k;
        ctx.drawImage(img, x - sz / 2, y - sz / 2, sz, sz);
        ctx.globalAlpha = 1;
        if (t >= 0.5) ink = 'honey';
      }
      if (t < 1) moving = true;
    } else if (s.phase !== 'won' && showsNumber(s, i) && finished(s, nbrs, i)) ink = 'dim';
    reading(s, i, x, y, r, ink);
    if (u >= 0) {
      if (u < 0.35) {
        // the last of the cap, going
        ctx.globalAlpha = 1 - u / 0.35;
        const img = sprites.cap, sz = img.width / layout.dpr * (1 + u * 0.15);
        ctx.drawImage(img, x - sz / 2, y - sz / 2, sz, sz);
        ctx.globalAlpha = 1;
      }
      flecks(x, y, r, i, u);
      if (u > 0.15) glintAcross(x, y, r, (u - 0.15) / 0.85);
    }
    return moving;
  }

  // a light round a sweep's neighbour
  function ring(j, a) {
    const { x, y } = at(j), r = layout.r;
    hexPath(ctx, x, y, r * 0.9);
    ctx.strokeStyle = `rgba(255,217,120,${a})`;
    ctx.lineWidth = Math.max(2, r * 0.13);
    ctx.stroke();
  }

  /** Draw; returns true while something is still moving. */
  function draw(s, now) {
    const d = layout.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, layout.W, layout.H);
    view.wakeAt = Infinity;
    if (!s || !sprites) return false;
    let moving = false;
    const still = !view.motion;
    // a still that has to end: true while it shows, and the loop wakes when it's over
    const stillUntil = (end) => {
      if (now >= end) return false;
      view.wakeAt = Math.min(view.wakeAt, end);
      return true;
    };
    const r = layout.r;
    const over = s.phase !== 'play';
    const n = s.cols * s.rows;
    const nbrs = nbrsOf(s.cols, s.rows);

    // the sting shakes the whole frame, twice
    const st = view.sting;
    let dx = 0;
    if (st && !still) {
      const t = (now - st.at) / SHAKE_MS;
      if (t < 1) { dx = shake(t, 6, 2); moving = true; }
    }
    ctx.setTransform(d, 0, 0, d, dx * d, 0);

    // a lifted or shaking number is drawn last, on top, so its slot waits
    const sw = view.sweep, lift = sw && !still ? (now - sw.at) / LIFT_MS : 1;
    const nope = view.refusal, nopeT = nope && !still ? (now - nope.at) / NOPE_MS : 1;
    const later = (i) => (lift < 1 && i === sw.cell) || (nopeT < 1 && i === nope.cell);

    for (let i = 0; i < n; i++) {
      const { x, y } = at(i);
      if (s.open[i] && s.cells[i] === EMPTY) {
        if (!later(i) && openCell(s, nbrs, i, x, y, r, now)) moving = true;
        continue;
      }
      const hazard = s.cells[i] !== EMPTY;
      if (over && hazard && s.phase === 'won') {
        // a won frame seals its guards in; they sleep on
        blit(sprites.sealed, x, y);
        continue;
      }
      if (over && hazard) {
        // a stung frame shows where every guard was
        blit(sprites.open, x, y);
        let startled = false;
        if (i === s.stung) {
          hexPath(ctx, x, y, r * 0.9);
          ctx.fillStyle = 'rgba(236,91,69,0.55)';
          ctx.fill();
          if (st && st.cell === i && !still) {
            // three frames of wings: flick, fold, flick
            const f = Math.floor((now - st.at) / WING_MS);
            if (f < 3) { startled = f !== 1; moving = true; }
          }
        }
        bug(x, y, r, s.cells[i], startled);
        continue;
      }
      blit(sprites.cap, x, y);
      if (s.mark[i]) {
        let k = 1;
        const p = view.pins.get(i);
        if (p != null) {
          const t = (now - p) / PIN_MS;
          if (still || t >= 1) view.pins.delete(i);
          else { k = pinScale(t); ctx.globalAlpha = clamp01(t / 0.12); moving = true; }
        }
        markGlyph(x, y, r * k, s.mark[i]);
        ctx.globalAlpha = 1;
        if (over && s.phase === 'lost') {
          // a mark on a safe cell was wrong
          ctx.strokeStyle = C.dark;
          ctx.lineWidth = Math.max(2, r * 0.12);
          ctx.beginPath();
          ctx.moveTo(x - r * 0.4, y - r * 0.4); ctx.lineTo(x + r * 0.4, y + r * 0.4);
          ctx.moveTo(x + r * 0.4, y - r * 0.4); ctx.lineTo(x - r * 0.4, y + r * 0.4);
          ctx.stroke();
        }
      }
    }

    // sweep: the number lifts, and a light runs clockwise round it
    if (sw) {
      const el = now - sw.at;
      if (still) {
        if (stillUntil(sw.at + SWEEP_STILL_MS)) for (const j of sw.order) ring(j, 0.85);
        else view.sweep = null;
      } else if (el < Math.max(LIFT_MS, SWEEP_MS * sw.order.length + LIGHT_MS)) {
        moving = true;
        sw.order.forEach((j, k) => {
          const t = (el - k * SWEEP_MS) / LIGHT_MS;
          if (t >= 0 && t < 1) ring(j, 1 - t);
        });
        if (lift < 1) {
          const { x, y } = at(sw.cell), h = Math.sin(Math.PI * clamp01(lift));
          hexPath(ctx, x, y + r * 0.08, r * 0.92);
          ctx.fillStyle = `rgba(12,8,4,${0.35 * h})`;
          ctx.fill();
          ctx.save();
          ctx.translate(x, y - r * 0.1 * h);
          ctx.scale(1 + 0.12 * h, 1 + 0.12 * h);
          ctx.translate(-x, -y);
          openCell(s, nbrs, sw.cell, x, y, r, now);
          ctx.restore();
        }
      } else view.sweep = null;
    }

    // a sweep that can't fire: the number shakes once; still, its outline flashes
    if (nope) {
      const { x, y } = at(nope.cell);
      if (still) {
        if (stillUntil(nope.at + NOPE_MS)) {
          hexPath(ctx, x, y, r * 0.88);
          ctx.strokeStyle = 'rgba(236,91,69,0.9)';
          ctx.lineWidth = Math.max(1.5, r * 0.1);
          ctx.stroke();
        } else view.refusal = null;
      } else if (nopeT < 1) {
        openCell(s, nbrs, nope.cell, x + shake(nopeT, 3, 1), y, r, now);
        moving = true;
      } else view.refusal = null;
    }

    // the hold ring: it fills as a press becomes a long-press
    const hold = view.hold;
    if (hold && s.phase === 'play') {
      const el = now - hold.since;
      let show;
      if (still) show = !stillUntil(hold.since + HOLD_SHOW);   // then at full until let go
      else { show = el >= HOLD_SHOW / 2; moving = true; }
      if (show) {
        const { x, y } = at(hold.cell);
        ctx.globalAlpha = still ? 1 : clamp01((el - HOLD_SHOW / 2) / HOLD_SHOW);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(x, y, r * 0.98, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(28,20,11,0.55)';
        ctx.lineWidth = Math.max(3, r * 0.2);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, r * 0.98, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (still ? 1 : hold.t));
        ctx.strokeStyle = C.capHi;
        ctx.lineWidth = Math.max(2, r * 0.12);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // clean reads' glints: a warm spark rising to the rail counter
    if (view.glints.length) {
      view.glints = view.glints.filter((g) => now - g.at < GLINT_MS);
      for (const g of view.glints) {
        const t = clamp01((now - g.at) / GLINT_MS), e = easeOut(t);
        const from = at(g.cell);
        const x = from.x + (g.to.x - dx - from.x) * e;
        const y = from.y + (g.to.y - from.y) * e - Math.sin(Math.PI * t) * r * 0.8;
        const img = sprites.spark, sz = img.width / d * (1 - 0.4 * t);
        ctx.globalAlpha = 1 - t * t;
        ctx.drawImage(img, x - sz / 2, y - sz / 2, sz, sz);
        ctx.globalAlpha = 1;
        moving = true;
      }
    }

    ctx.setTransform(d, 0, 0, d, 0, 0);
    if (st) {
      if (still) {
        // the flash, held still and brief
        if (stillUntil(st.at + FLASH_STILL_MS)) {
          ctx.fillStyle = 'rgba(236,91,69,0.18)';
          ctx.fillRect(0, 0, layout.W, layout.H);
        }
      } else {
        const t = (now - st.at) / FLASH_MS;
        if (t < 1) {
          ctx.fillStyle = `rgba(236,91,69,${0.28 * (1 - t)})`;
          ctx.fillRect(0, 0, layout.W, layout.H);
          moving = true;
        }
      }
    }
    return moving;
  }

  // ── what main.js tells the renderer happened ─────────────────────────
  // Each of these only notes a start time: core state has already moved.

  /** A new frame, or a resumed one: nothing is mid-moment. */
  function reset() {
    view.anims.clear(); view.pins.clear();
    view.sweep = view.refusal = view.sting = view.pour = view.hold = null;
    view.glints = [];
    if (sprites) sprites.honey = null;
  }

  /** An uncap event: its cells open ring by ring from the tapped cell (in a
   *  sweep, from when the light reaches it). Returns the ring count. */
  function uncapped(e, now) {
    const { ring: dist, count } = rings(e.cell, e.cells, nbrsOf(layout.cols, layout.rows));
    if (!view.motion) return count;
    let start = now;
    const k = view.sweep ? view.sweep.order.indexOf(e.cell) : -1;
    if (k >= 0) start = view.sweep.at + k * SWEEP_MS;
    for (const c of e.cells) view.anims.set(c, start + dist.get(c) * RING_MS);
    return count;
  }

  /** A sweep fired from cell i. Tell it before handing over its uncaps. */
  function swept(i, now) {
    view.sweep = { cell: i, at: now, order: clockwise(i, nbrsOf(layout.cols, layout.rows), layout.cols) };
  }

  /** A sweep on cell i couldn't fire. */
  function refused(i, now) { view.refusal = { cell: i, at: now }; }

  function marked(i, m, now) {
    if (m && view.motion) view.pins.set(i, now); else view.pins.delete(i);
  }

  function stung(i, now) { view.sting = { cell: i, at: now }; }

  /** The frame is won: honey { top, bottom } pours once the last cap is off. */
  function won(honey, now) {
    let start = now;
    if (view.motion) for (const a of view.anims.values()) start = Math.max(start, a + UNCAP_MS);
    view.pour = { at: start, honey };
    if (sprites) sprites.honey = honeySprite(honey);
  }

  /** A clean read on cell i: a spark rises to `to` (canvas px; the rail
   *  counter). Motion only — still, the counter updating is all of it. */
  function glint(i, now, to = { x: layout.W / 2, y: layout.top / 2 }) {
    if (view.motion) view.glints.push({ cell: i, at: now, to });
  }

  return {
    resize, draw, cellAt, at, layout, view,
    reset, uncapped, swept, refused, marked, stung, won, glint,
  };
}
