// Builds design/app-icon.svg from the same pixel ghost the app uses, so the
// icon always matches the logo. Run:  npm run icon
// (that also runs `tauri icon`, which makes every size macOS/Windows need).

import { writeFile, mkdir } from 'node:fs/promises';
import { MARK } from '../src/js/pixel.js';

const SIZE = 1024;
const TILE = 824;                 // macOS-style: rounded tile with a margin
const T0 = (SIZE - TILE) / 2;
const RADIUS = 185;

// Keep the ghost plus one heartbeat blip on each side.
const grid = MARK.map((row) => row.slice(5, row.length - 5));
const P = 28;                     // pixel size
const W = grid[0].length * P;
const H = grid.length * P;
const OX = (SIZE - W) / 2;
const OY = (SIZE - H) / 2 + 10;
const GAP = 0.16 * P;

function layer(color, dx, opacity, accent) {
  let rects = '';
  grid.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    const fill = accent && ch !== '#' ? accent : color;
    const op = ch === '-' ? 0.35 : 1;
    rects += `<rect x="${x * P}" y="${y * P}" width="${P - GAP}" height="${P - GAP}" fill="${fill}" fill-opacity="${op}"/>`;
  }));
  return `<g transform="translate(${OX + dx} ${OY})" opacity="${opacity}">${rects}</g>`;
}

const scan = Array.from({ length: Math.ceil(TILE / 6) }, (_, i) =>
  `<rect x="${T0}" y="${T0 + i * 6}" width="${TILE}" height="2" fill="#000" fill-opacity="0.28"/>`).join('');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="46%" r="58%">
      <stop offset="0" stop-color="#00f5d4" stop-opacity="0.24"/>
      <stop offset="1" stop-color="#00f5d4" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="tile"><rect x="${T0}" y="${T0}" width="${TILE}" height="${TILE}" rx="${RADIUS}"/></clipPath>
  </defs>
  <rect x="${T0}" y="${T0}" width="${TILE}" height="${TILE}" rx="${RADIUS}" fill="#04070a"/>
  <g clip-path="url(#tile)">
    <rect x="${T0}" y="${T0}" width="${TILE}" height="${TILE}" fill="url(#glow)"/>
    ${layer('#ff2fd6', -9, 0.9)}
    ${layer('#ffe94d', 9, 0.75)}
    ${layer('#00f5d4', 0, 1, '#ffe94d')}
    ${scan}
  </g>
  <rect x="${T0 + 3}" y="${T0 + 3}" width="${TILE - 6}" height="${TILE - 6}" rx="${RADIUS - 3}" fill="none" stroke="#00f5d4" stroke-opacity="0.35" stroke-width="6"/>
</svg>
`;

await mkdir(new URL('../design/', import.meta.url), { recursive: true });
await writeFile(new URL('../design/app-icon.svg', import.meta.url), svg);
console.log('wrote design/app-icon.svg');
