// Builds design/app-icon.svg from the same logo text the app prints
// (src/js/logo.js), so the icon always matches. Run:  npm run icon
// (that also runs `tauri icon`, which makes every size macOS/Windows need).
//
// Each character is drawn as simple shapes instead of with a font, so the
// icon looks the same on every computer:
//   #  → two mesh squares    =  → two bars    -  → one bar
//   +  → a cross            |  → a post      .  :  → dots

import { writeFile, mkdir } from 'node:fs/promises';
import { ART, TONE, LOGO_WIDTH, LOGO_HEIGHT } from '../src/js/logo.js';
import { COLORS } from '../src/js/palette.js';

const SIZE = 1024;
const TILE = 824;           // macOS-style rounded tile with a margin around it
const T0 = (SIZE - TILE) / 2;
const RADIUS = 185;

// Cells are twice as tall as wide, like terminal characters.
const CH = 20.5;            // cell height
const CW = CH / 2.08;       // cell width
const OX = (SIZE - LOGO_WIDTH * CW) / 2 - 14;
const OY = (SIZE - LOGO_HEIGHT * CH) / 2;

const fill = (tone, ch) => {
  if (ch === '.' || ch === ':') return COLORS.faint.hex;
  return tone === 'b' ? COLORS.bright.hex : tone === 'd' ? COLORS.dim.hex : COLORS.logo.hex;
};
const r = (x, y, w, h, f) => `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${f}"/>`;

function glyph(ch, x, y, f) {
  const bar = CH * 0.1;
  switch (ch) {
    case '#': return r(x + CW * 0.08, y + CH * 0.1, CW * 0.84, CH * 0.36, f) + r(x + CW * 0.08, y + CH * 0.54, CW * 0.84, CH * 0.36, f);
    case '=': return r(x, y + CH * 0.36, CW, bar, f) + r(x, y + CH * 0.56, CW, bar, f);
    case '-': return r(x, y + CH * 0.46, CW, bar, f);
    case '+': return r(x + CW * 0.1, y + CH * 0.46, CW * 0.8, bar, f) + r(x + CW * 0.4, y + CH * 0.28, CW * 0.2, CH * 0.46, f);
    case '|': return r(x + CW * 0.4, y, CW * 0.2, CH, f);
    case '.': return r(x + CW * 0.35, y + CH * 0.68, CW * 0.3, CH * 0.14, f);
    case ':': return r(x + CW * 0.35, y + CH * 0.3, CW * 0.3, CH * 0.14, f) + r(x + CW * 0.35, y + CH * 0.68, CW * 0.3, CH * 0.14, f);
    default: return '';
  }
}

let shapes = '';
ART.forEach((row, ry) => {
  [...row].forEach((ch, cx) => {
    if (ch !== ' ') shapes += glyph(ch, OX + cx * CW, OY + ry * CH, fill(TONE[ry][cx], ch));
  });
});

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
