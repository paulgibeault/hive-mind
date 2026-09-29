/* render.js — the frame, drawn on one canvas. Reads state, never writes it.
 *
 * Capped cells are bright honey wax; an uncapped cell is dark, empty comb
 * with its reading in it. Nothing moves unless something just happened: an
 * uncap fades its caps out, a sting flashes, and then the loop rests.
 */

import { centre, extent, cellAt as hexAt } from './hex.js';
import { EMPTY, W, H, MARK_W, MARK_H } from './core.js';

const C = {
  cap: '#f2b33d', capDeep: '#c9801a', capHi: '#ffd978',
  wax: '#3b2b19', waxEdge: '#2a1e11',
  ink: '#f6ead2', wasp: '#f5c542', hornet: '#ec5b45', dark: '#2a1d10',
};
const FADE_MS = 200;
const FONT = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, sans-serif';

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
    fades: new Map(),            // cell → time its cap started to go
    flashAt: -1,
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
    sprites = { cap: sprite(cap), open: sprite(open) };
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

  // ── the marks and the wasps ─────────────────────────────────────────
  function bug(x, y, r, kind) {
    const s = r * 0.42;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.5);
    // wings
    ctx.fillStyle = 'rgba(246,234,210,0.55)';
    ctx.beginPath(); ctx.ellipse(-s * 0.35, -s * 0.55, s * 0.45, s * 0.25, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s * 0.35, -s * 0.55, s * 0.45, s * 0.25, 0.6, 0, Math.PI * 2); ctx.fill();
    // body, striped
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.95, s * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = kind === H ? C.hornet : C.wasp;
    ctx.fill();
    ctx.save(); ctx.clip();
    ctx.fillStyle = C.dark;
    for (const dx of [-0.35, 0.15, 0.62]) ctx.fillRect(s * dx - s * 0.12, -s, s * 0.22, 2 * s);
    ctx.restore();
    ctx.beginPath(); ctx.arc(-s * 1.0, 0, s * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = kind === H ? '#6b1d12' : C.dark;
    ctx.fill();
    ctx.restore();
  }

  function markGlyph(x, y, r, m) {
    // a pin pushed into the wax: amber disc (wasp) or red square (hornet),
    // shaped differently so the colours are never the only difference
    const s = r * 0.3;
    ctx.save();
    ctx.shadowColor = 'rgba(42,29,16,0.5)';
    ctx.shadowBlur = r * 0.15;
    ctx.shadowOffsetY = r * 0.06;
    ctx.fillStyle = m === MARK_H ? C.hornet : C.dark;
    ctx.beginPath();
    if (m === MARK_H) ctx.rect(x - s, y - s, 2 * s, 2 * s);
    else ctx.arc(x, y, s * 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = m === MARK_H ? C.dark : C.wasp;
    ctx.beginPath();
    if (m === MARK_H) ctx.rect(x - s * 0.35, y - s * 0.35, s * 0.7, s * 0.7);
    else ctx.arc(x, y, s * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  function crack(x, y, r, i) {
    // a jagged line across the cell, its shape fixed per cell
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
    ctx.strokeStyle = 'rgba(12,8,4,0.85)';
    ctx.lineWidth = Math.max(1.2, r * 0.07);
    ctx.stroke();
  }

  function reading(s, i, x, y, r) {
    const w = s.shown[i], h = s.shownH[i];
    const big = Math.round(r * 0.95);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (s.cracked[i]) {
      crack(x, y, r, i);
      ctx.font = `800 ${big}px ${FONT}`;
      ctx.fillStyle = C.ink;
      ctx.fillText(String(w), x - r * 0.12, y + r * 0.04);
      ctx.font = `700 ${Math.round(r * 0.5)}px ${FONT}`;
      ctx.fillStyle = C.cap;
      ctx.fillText('±', x + r * 0.42, y - r * 0.32);
      return;
    }
    if (s.hornets > 0) {
      const both = w > 0 && h > 0;
      const size = both ? Math.round(r * 0.72) : big;
      ctx.font = `800 ${size}px ${FONT}`;
      if (w > 0) {
        ctx.fillStyle = C.wasp;
        ctx.fillText(String(w), both ? x - r * 0.33 : x, y + r * 0.04);
      }
      if (h > 0) {
        const hx = both ? x + r * 0.33 : x;
        const b = size * 0.62;
        ctx.strokeStyle = C.hornet;
        ctx.lineWidth = Math.max(1.2, r * 0.07);
        ctx.strokeRect(hx - b, y - b + r * 0.02, 2 * b, 2 * b);
        ctx.fillStyle = C.hornet;
        ctx.fillText(String(h), hx, y + r * 0.04);
      }
      return;
    }
    if (w > 0) {
      ctx.font = `800 ${big}px ${FONT}`;
      ctx.fillStyle = C.ink;
      ctx.fillText(String(w), x, y + r * 0.04);
    }
  }

  /** Draw; returns true while something is still moving. */
  function draw(s, now) {
    const d = layout.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, layout.W, layout.H);
    if (!s || !sprites) return false;
    let moving = false;
    const r = layout.r;
    const over = s.phase !== 'play';
    const n = s.cols * s.rows;
    for (let i = 0; i < n; i++) {
      const { x, y } = at(i);
      if (s.open[i] && s.cells[i] === EMPTY) {
        blit(sprites.open, x, y);
        reading(s, i, x, y, r);
        const f = view.fades.get(i);
        if (f != null) {
          const t = view.motion ? (now - f) / FADE_MS : 1;
          if (t < 1) {
            ctx.globalAlpha = 1 - t;
            const k = 1 + t * 0.12;
            const img = sprites.cap, sz = img.width / d * k;
            ctx.drawImage(img, x - sz / 2, y - sz / 2, sz, sz);
            ctx.globalAlpha = 1;
            moving = true;
          } else view.fades.delete(i);
        }
        continue;
      }
      const hazard = s.cells[i] !== EMPTY;
      if (over && hazard) {
        // the end of a frame shows where everything was
        blit(sprites.open, x, y);
        if (i === s.stung) {
          hexPath(ctx, x, y, r * 0.9);
          ctx.fillStyle = 'rgba(236,91,69,0.55)';
          ctx.fill();
        }
        bug(x, y, r, s.cells[i]);
        continue;
      }
      blit(sprites.cap, x, y);
      if (s.mark[i]) {
        markGlyph(x, y, r, s.mark[i]);
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
    if (view.flashAt >= 0 && view.motion) {
      const t = (now - view.flashAt) / 420;
      if (t < 1) {
        ctx.fillStyle = `rgba(236,91,69,${0.28 * (1 - t)})`;
        ctx.fillRect(0, 0, layout.W, layout.H);
        moving = true;
      } else view.flashAt = -1;
    }
    return moving;
  }

  function uncapped(cells, now) { for (const c of cells) view.fades.set(c, now); }

  return { resize, draw, cellAt, at, layout, view, uncapped };
}
