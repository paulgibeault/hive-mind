/* hex.js — the comb's geometry. No DOM, no Arcade.
 *
 * A frame is a rectangle of pointy-top hexagons in "odd-r" offset layout:
 * odd rows sit half a cell to the right. Cells are numbered row-major,
 * i = y * cols + x. Every cell has up to six neighbours, and up to eighteen
 * cells within two steps (a Scout's range, #12).
 */

const EVEN = [[-1, -1], [0, -1], [-1, 0], [1, 0], [-1, 1], [0, 1]];
const ODD = [[0, -1], [1, -1], [-1, 0], [1, 0], [0, 1], [1, 1]];

/** Neighbour lists for a cols × rows frame, as an array of index arrays. */
export function neighbours(cols, rows) {
  const out = new Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    const d = y & 1 ? ODD : EVEN;
    for (let x = 0; x < cols; x++) {
      const list = [];
      for (const [dx, dy] of d) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) list.push(ny * cols + nx);
      }
      out[y * cols + x] = list;
    }
  }
  return out;
}

/** Every cell's RANGE: the cells at hex distance 1 or 2 (up to 18), ascending.
 *  The neighbours and their neighbours, less the cell itself. */
export function ring2(cols, rows) {
  const nb = neighbours(cols, rows);
  return nb.map((list, i) => {
    const out = new Set(list);
    for (const j of list) for (const k of nb[j]) if (k !== i) out.add(k);
    return [...out].sort((a, b) => a - b);
  });
}

/** Centre of cell i for circumradius r, with the frame's top-left at 0,0. */
export function centre(i, cols, r) {
  const x = i % cols, y = (i / cols) | 0;
  const w = Math.sqrt(3) * r;
  return { x: w * (x + 0.5 + (y & 1 ? 0.5 : 0)), y: r + 1.5 * r * y };
}

/** The frame's pixel size for circumradius r. */
export function extent(cols, rows, r) {
  return { w: Math.sqrt(3) * r * (cols + 0.5), h: r * (1.5 * rows + 0.5) };
}

/** The cell under a point (frame coordinates), or -1 outside the comb. */
export function cellAt(px, py, cols, rows, r) {
  const row = Math.floor((py - r * 0.5) / (1.5 * r));
  let best = -1, bestD = Infinity;
  for (let y = row - 1; y <= row + 1; y++) {
    if (y < 0 || y >= rows) continue;
    const approx = Math.round(px / (Math.sqrt(3) * r) - 0.5 - (y & 1 ? 0.5 : 0));
    for (let x = approx - 1; x <= approx + 1; x++) {
      if (x < 0 || x >= cols) continue;
      const c = centre(y * cols + x, cols, r);
      const d = (c.x - px) ** 2 + (c.y - py) ** 2;
      if (d < bestD) { bestD = d; best = y * cols + x; }
    }
  }
  // inside the hexagon ≈ within the inscribed circle, generously
  return bestD <= (r * 0.98) ** 2 ? best : -1;
}
