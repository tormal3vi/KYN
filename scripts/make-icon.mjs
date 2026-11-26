// Builds design/app-icon.svg from the detailed logo the app draws
// (FINE in src/js/logo.js), so the icon always matches. Run:  npm run icon
// (that also runs `tauri icon`, which makes every size macOS/Windows need).

import { writeFile, mkdir } from 'node:fs/promises';
import { FINE } from '../src/js/logo.js';
import { COLORS, TONES } from '../src/js/palette.js';

const SIZE = 1024;
const TILE = 824;           // macOS-style rounded tile with a margin around it
const T0 = (SIZE - TILE) / 2;
const RADIUS = 185;

// The fine logo covers 52×27 text cells, and text cells are 2.08× taller
// than wide, so keep that shape.
const H = 720;
const W = H * (FINE.w / (FINE.h * 2.08));
const CW = W / FINE.cols;
const CH = H / FINE.rows;
const OX = (SIZE - W) / 2 - 10;
const OY = (SIZE - H) / 2;

const r = (x, y, w, h, f) => `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${f}"/>`;

// Same shapes the app draws (see drawGlyph in src/js/term-web.js).
function glyph(g, x, y, w, h, f) {
  switch (g) {
    case 'M': { const p = w * 0.1; return r(x + p, y + p, w - 2 * p, h - 2 * p, f); }
    case '-': return r(x, y + h * 0.42, w, h * 0.18, f);
    case '=': return r(x, y + h * 0.2, w, h * 0.16, f) + r(x, y + h * 0.62, w, h * 0.16, f);
    case '|': return r(x + w * 0.4, y, w * 0.2, h, f);
    case '+': return r(x + w * 0.1, y + h * 0.42, w * 0.8, h * 0.16, f) + r(x + w * 0.42, y + h * 0.1, w * 0.16, h * 0.8, f);
    case '.': return r(x + w * 0.32, y + h * 0.32, w * 0.36, h * 0.36, f);
    case ':': return r(x + w * 0.35, y + h * 0.1, w * 0.3, h * 0.28, f) + r(x + w * 0.35, y + h * 0.62, w * 0.3, h * 0.28, f);
    default: return '';
  }
}

let shapes = '';
for (let row = 0; row < FINE.rows; row++) {
  for (let col = 0; col < FINE.cols; col++) {
    const v = FINE.cell(col, row);
    if (v) shapes += glyph(v[0], OX + col * CW, OY + row * CH, CW, CH, COLORS[TONES[v[1]]].hex);
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <clipPath id="tile"><rect x="${T0}" y="${T0}" width="${TILE}" height="${TILE}" rx="${RADIUS}"/></clipPath>
  </defs>
  <rect x="${T0}" y="${T0}" width="${TILE}" height="${TILE}" rx="${RADIUS}" fill="#000"/>
  <g clip-path="url(#tile)">${shapes}</g>
  <rect x="${T0 + 2}" y="${T0 + 2}" width="${TILE - 4}" height="${TILE - 4}" rx="${RADIUS - 2}" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="4"/>
</svg>
`;

await mkdir(new URL('../design/', import.meta.url), { recursive: true });
await writeFile(new URL('../design/app-icon.svg', import.meta.url), svg);
console.log('wrote design/app-icon.svg');
