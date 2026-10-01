/* honey.js — the colour of a frame's honey, from the flowers it came from.
 *
 * Pure: (hive, seed) in, two CSS colours out. No DOM, no clock. The same
 * colour fills the win's pour (render.js), the jar on the won sheet and in
 * the pantry (main.js), and sets the jar clink's pitch (soundpack.js keeps a
 * copy of lightness() below, since it loads as a plain script; a test holds
 * the two together).
 *
 *   hive          honey            colour
 *   clover        pale, mild       #fff0b8 → #fbe7a1, a tiny seeded lightness wobble
 *   apple         amber, fruity    #e8a846 → #dd9a38
 *   wildflowers   no two alike     two tones from the seed: hue 18–40°, lightness 24–56%
 *   queen         dark, royal      #5a2c0e → #3a1c08 (the Queen's Frame, #10)
 *
 * `queen` is the Queen's Frame, the weekly hive (#10): its jars are royal
 * honey, the same dark pair for every week.
 *
 * Colour shows only after a win: honey is what a cleared frame gives, so
 * nothing here is ever asked about a frame still in play.
 */

/** Per hive: the jar's taste note and the honey's name, for captions. */
export const HONEY = Object.freeze({
  clover: { note: 'pale, mild', name: 'clover honey' },
  apple: { note: 'amber, fruity', name: 'apple blossom honey' },
  wildflowers: { note: 'no two alike', name: 'wildflower honey' },
  queen: { note: 'dark, royal', name: 'royal honey' },
});

// The fixed hives' colours, as the table above gives them, and the mean HSL
// lightness of each pair (what the clink hears).
const FIXED = {
  clover: { top: '#fff0b8', bottom: '#fbe7a1', light: 0.8343 },
  apple: { top: '#e8a846', bottom: '#dd9a38', light: 0.5676 },
  queen: { top: '#5a2c0e', bottom: '#3a1c08', light: 0.1667 },
};
const CLOVER_WOBBLE = 0.015;      // ± this much lightness, by seed

// Wildflowers' band.
export const WILD = Object.freeze({
  hue: [18, 40],                  // amber to russet, degrees
  light: [0.24, 0.56],            // low-to-mid lightness, across both tones
  sat: [0.58, 0.8],
});

/** Two u32s → one well-mixed u32 (murmur3's finalizer). soundpack.js has a copy. */
function mix(seed, salt) {
  let h = (Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}
/** A seeded number in [0, 1). */
const unit = (seed, salt) => mix(seed, salt) / 4294967296;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const hex2 = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');

/** HSL (degrees, 0..1, 0..1) → #rrggbb. */
export function hslHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${hex2(f(0))}${hex2(f(8))}${hex2(f(4))}`;
}

/** #rrggbb → [h degrees, s, l]. */
export function hexHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h < 0 ? h + 360 : h, s, l];
}

// Wildflowers' two tones: the bottom is the darker, the top lifts it a little
// and leans a few degrees yellower, both inside the band. Dark honey keeps to
// the russet end: a yellow hue that dark reads as olive, not honey.
function blend(seed) {
  const [h0, h1] = WILD.hue, [l0, l1] = WILD.light, [s0, s1] = WILD.sat;
  const lift = 0.08 + 0.08 * unit(seed, 3);                 // 0.08..0.16
  const depth = unit(seed, 2);                              // 0 darkest .. 1 lightest
  const lo = l0 + (l1 - l0 - lift) * depth;                 // so lo + lift ≤ 0.56
  const hue = h0 + (h1 - h0 - 6) * (0.45 + 0.55 * depth) * unit(seed, 1);   // 18..34, less when dark
  const sat = s0 + (s1 - s0) * unit(seed, 4);
  const lean = 6 * unit(seed, 5);                           // top hue ≤ 40
  return { hue, lean, lo, hi: lo + lift, sat };
}

/** The clover wobble for a seed: a lightness shift in [-CLOVER_WOBBLE, CLOVER_WOBBLE]. */
const wobble = (seed) => (unit(seed, 7) * 2 - 1) * CLOVER_WOBBLE;

/**
 * The honey for a frame: { top, bottom }, two #rrggbb colours for a jar's
 * gradient (top of the jar to the bottom). Unknown hives get Clover Field's.
 */
export function honeyColour(hive, seed) {
  seed >>>= 0;
  if (hive === 'wildflowers') {
    const w = blend(seed);
    return { top: hslHex(w.hue + w.lean, w.sat, w.hi), bottom: hslHex(w.hue, w.sat, w.lo) };
  }
  const f = FIXED[hive] || FIXED.clover;
  if (f !== FIXED.clover) return { top: f.top, bottom: f.bottom };
  const dl = wobble(seed);
  const shift = (hex) => { const [h, s, l] = hexHsl(hex); return hslHex(h, s, clamp01(l + dl)); };
  return { top: shift(f.top), bottom: shift(f.bottom) };
}

/**
 * How light the honey is, 0 (dark) .. 1 (pale): the mean HSL lightness of
 * its two tones. The jar's clink rings higher for paler honey.
 */
export function lightness(hive, seed) {
  seed >>>= 0;
  if (hive === 'wildflowers') { const w = blend(seed); return (w.lo + w.hi) / 2; }
  const f = FIXED[hive] || FIXED.clover;
  return f === FIXED.clover ? f.light + wobble(seed) : f.light;
}
