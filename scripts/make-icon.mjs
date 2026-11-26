// Builds design/app-icon.svg from the detailed logo the app draws
// (FINE in src/js/logo.js), so the icon always matches. Run:  npm run icon
// (that also runs `tauri icon`, which makes every size macOS/Windows need).
//
// The icon is drawn bolder and brighter than the on-screen logo: in the Dock
// it's shown at 32–128 pixels, where hairline shapes and mid-grays vanish.

import { writeFile, mkdir } from 'node:fs/promises';
import { FINE } from '../src/js/logo.js';
import { COLORS } from '../src/js/palette.js';

const SIZE = 1024;
const TILE = 824;           // macOS-style rounded tile with a margin around it
const T0 = (SIZE - TILE) / 2;
const RADIUS = 185;
const ACCENT = process.env.KYN_ICON_ACCENT !== '0'; // the red "_" cursor in the corner

// Brightness levels 0–3 of the logo, lifted toward white for small sizes.
const ICON_TONES = ['#8e8e8e', '#c6c6c6', '#ededed', '#ffffff'];

// The fine logo covers 52×27 text cells, and text cells are 2.08× taller
// than wide, so keep that shape. The solid part of the mask (around column
// 72) sits in the middle; the dissolving streaks run off the left edge.
const H = 790;
const W = H * (FINE.w / (FINE.h * 2.08));
const CW = W / FINE.cols;
const CH = H / FINE.rows;
const OX = SIZE * 0.5 - 72 * CW;
const OY = (SIZE - H) / 2 + 6;

const r = (x, y, w, h, f) => `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${f}"/>`;

// The app's shapes (drawGlyph in src/js/term-web.js), drawn heavier.
function glyph(g, x, y, w, h, f) {
  switch (g) {
    case 'M': { const p = w * 0.05; return r(x + p, y + p, w - 2 * p, h - 2 * p, f); }
    case '-': return r(x, y + h * 0.3, w, h * 0.4, f);
    case '=': return r(x, y + h * 0.1, w, h * 0.32, f) + r(x, y + h * 0.58, w, h * 0.32, f);
    case '|': return r(x + w * 0.3, y, w * 0.4, h, f);
    case '+': return r(x, y + h * 0.33, w, h * 0.34, f) + r(x + w * 0.33, y, w * 0.34, h, f);
    case '.': return r(x + w * 0.22, y + h * 0.22, w * 0.56, h * 0.56, f);
    case ':': return r(x + w * 0.25, y + h * 0.04, w * 0.5, h * 0.4, f) + r(x + w * 0.25, y + h * 0.56, w * 0.5, h * 0.4, f);
    default: return '';
  }
}

let shapes = '';
for (let row = 0; row < FINE.rows; row++) {
  for (let col = 0; col < FINE.cols; col++) {
    const v = FINE.cell(col, row);
    if (v) shapes += glyph(v[0], OX + col * CW, OY + row * CH, CW, CH, ICON_TONES[v[1]]);
  }
}

const accent = ACCENT
  ? r(T0 + TILE - 214, T0 + TILE - 132, 96, 22, COLORS.red.hex)
  : '';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <clipPath id="tile"><rect x="${T0}" y="${T0}" width="${TILE}" height="${TILE}" rx="${RADIUS}"/></clipPath>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b1b1e"/>
      <stop offset="1" stop-color="#050506"/>
    </linearGradient>
  </defs>
  <rect x="${T0}" y="${T0}" width="${TILE}" height="${TILE}" rx="${RADIUS}" fill="url(#ground)"/>
  <g clip-path="url(#tile)">${shapes}${accent}</g>
  <rect x="${T0 + 2}" y="${T0 + 2}" width="${TILE - 4}" height="${TILE - 4}" rx="${RADIUS - 2}" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="4"/>
</svg>
`;

await mkdir(new URL('../design/', import.meta.url), { recursive: true });
await writeFile(new URL('../design/app-icon.svg', import.meta.url), svg);
console.log('wrote design/app-icon.svg');
