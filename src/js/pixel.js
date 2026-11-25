// ─────────────────────────────────────────────────────────────────────────────
// Pixel art: a 5×7 font, the ghost logo mark and small module icons.
//
// Everything is drawn from text grids: '#' (or any letter) is a lit pixel,
// '.' is empty. pixelSvg() turns a grid into an SVG made of little squares,
// which is what gives the logo its LED-panel look.
// ─────────────────────────────────────────────────────────────────────────────

// 5×7 font. Each glyph is 7 rows of 5 characters, separated by spaces.
const FONT_SRC = {
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '###.. #..#. #...# #...# #...# #..#. ###..',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  0: '.###. #...# #..## #.#.# ##..# #...# .###.',
  1: '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  2: '.###. #...# ....# ...#. ..#.. .#... #####',
  3: '##### ...#. ..#.. ...#. ....# #...# .###.',
  4: '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  5: '##### #.... ####. ....# ....# #...# .###.',
  6: '..##. .#... #.... ####. #...# #...# .###.',
  7: '##### ....# ...#. ..#.. .#... .#... .#...',
  8: '.###. #...# #...# .###. #...# #...# .###.',
  9: '.###. #...# #...# .#### ....# ...#. .##..',
  ' ': '..... ..... ..... ..... ..... ..... .....',
  '-': '..... ..... ..... ##### ..... ..... .....',
  '.': '..... ..... ..... ..... ..... .##.. .##..',
  _: '..... ..... ..... ..... ..... ..... #####',
  '/': '....# ....# ...#. ..#.. .#... #.... #....',
  ':': '..... .##.. .##.. ..... .##.. .##.. .....',
  '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
};
const FONT = Object.fromEntries(
  Object.entries(FONT_SRC).map(([ch, rows]) => [ch, rows.split(' ')]),
);

/** Turn a string into pixel rows (7 rows high, 1 empty column between letters). */
export function textRows(text) {
  const glyphs = [...String(text).toUpperCase()].map((ch) => FONT[ch] || FONT['?']);
  return Array.from({ length: 7 }, (_, y) => glyphs.map((g) => g[y]).join('.'));
}

// The logo mark: an original pixel ghost with a pulse line running through its
// eyes. '#' = body, '+' = the pulse line (drawn in an accent colour).
const GHOST = [
  '.....#####.....',
  '...#########...',
  '..###########..',
  '.#############.',
  '.#############.',
  '###...###...###',
  '###+++###+++###',
  '###...###...###',
  '###############',
  '###############',
  '###############',
  '###############',
  '###############',
  '###.###.###.###',
  '.#...#...#...#.',
];

function buildMark() {
  const side = 12;                      // pulse-line length on each side
  const w = GHOST[0].length + side * 2; // 39
  const grid = GHOST.map((row) => '.'.repeat(side) + row + '.'.repeat(side));
  const set = (x, y, ch) => {
    grid[y] = grid[y].slice(0, x) + ch + grid[y].slice(x + 1);
  };
  // One side of the pulse, counted outward from the ghost (0 = next to it):
  // flat, a heartbeat blip (small dip, tall spike, deep drop), flat, then
  // fading pixels ('-') at the far end.
  const PULSE = [
    [0, [6]], [1, [6]], [2, [7]], [3, [5, 6, 7, 8]], [4, [2, 3, 4]], [5, [5]],
    [6, [6]], [7, [6]], [8, [6]],
  ];
  const FADE = [9, 11]; // gaps at 10 make the end look like it is breaking up
  for (const [d, ys] of PULSE) {
    ys.forEach((y) => {
      set(side - 1 - d, y, '+');            // left side
      set(w - side + d, y, '+');            // right side (mirror)
    });
  }
  FADE.forEach((d) => {
    set(side - 1 - d, 6, '-');
    set(w - side + d, 6, '-');
  });
  return grid;
}
export const MARK = buildMark();

// 9×9 icons for the module menu.
export const ICONS = {
  netmap: [
    '##.....##',
    '##.....##',
    '..#...#..',
    '...#.#...',
    '....#....',
    '...#.#...',
    '..#...#..',
    '##.....##',
    '##.....##',
  ],
  port: [
    '#########',
    '#.......#',
    '#.##.##.#',
    '#.##.##.#',
    '#.......#',
    '#..###..#',
    '#..###..#',
    '#.......#',
    '#########',
  ],
  pulse: [
    '.........',
    '....#....',
    '...#.#...',
    '...#.#...',
    '###...#.#',
    '......#.#',
    '.......#.',
    '.........',
    '.........',
  ],
  game: [
    '.........',
    '.#######.',
    '#.......#',
    '#.#...#.#',
    '###.#.###',
    '#.#...#.#',
    '#.......#',
    '.##...##.',
    '.........',
  ],
  chip: [
    '.#.#.#.#.',
    '#########',
    '.#.....#.',
    '##.###.##',
    '.#.###.#.',
    '##.###.##',
    '.#.....#.',
    '#########',
    '.#.#.#.#.',
  ],
};

/**
 * Render a pixel grid as an SVG string.
 * Pixels marked '+' get class "acc" (and '-' gets "acc dim") so CSS can
 * colour them differently.
 */
export function pixelSvg(rows, { gap = 0.16, label = '' } = {}) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const s = (1 - gap).toFixed(2);
  let rects = '';
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.' || ch === ' ') return;
      const cls = ch === '+' ? ' class="acc"' : ch === '-' ? ' class="acc dim"' : '';
      rects += `<rect x="${x}" y="${y}" width="${s}" height="${s}"${cls}/>`;
    });
  });
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg viewBox="0 0 ${w - gap} ${h - gap}" fill="currentColor" ${a11y}>${rects}</svg>`;
}
