// ─────────────────────────────────────────────────────────────────────────────
// Device icons, drawn in the same mesh style as the KYN logo.
//
// Each icon is 12×12 cells on the fine grid (= 6 text columns × 3 text rows):
//   M  bright mesh square    m  dimmer mesh square
//   -  dash   =  double dash   +  cross   |  post   .  dot   (space) empty
// ─────────────────────────────────────────────────────────────────────────────

export const ICON_SIZE = 12;

export const ICONS = {
  router: [
    '            ',
    '  |      |  ',
    '  |      |  ',
    '  |      |  ',
    'MMMMMMMMMMMM',
    'M          M',
    'M + + +  --M',
    'M          M',
    'MMMMMMMMMMMM',
    ' mm      mm ',
    '            ',
    '            ',
  ],
  network: [
    '            ',
    '            ',
    '  |      |  ',
    '  |      |  ',
    'MMMMMMMMMMMM',
    'M          M',
    'M mm mm mm M',
    'M          M',
    'MMMMMMMMMMMM',
    '            ',
    '            ',
    '            ',
  ],
  laptop: [
    '            ',
    '            ',
    ' MMMMMMMMMM ',
    ' M        M ',
    ' M ...... M ',
    ' M ...... M ',
    ' M        M ',
    ' MMMMMMMMMM ',
    'mmmmmmmmmmmm',
    ' mmmmmmmmmm ',
    '            ',
    '            ',
  ],
  computer: [
    '            ',
    'MMMMMMMMMMMM',
    'M          M',
    'M ........ M',
    'M ........ M',
    'M ........ M',
    'M          M',
    'MMMMMMMMMMMM',
    '     mm     ',
    '     mm     ',
    '   mmmmmm   ',
    '            ',
  ],
  phone: [
    '   MMMMMM   ',
    '   M -- M   ',
    '   M    M   ',
    '   M .. M   ',
    '   M .. M   ',
    '   M .. M   ',
    '   M    M   ',
    '   M    M   ',
    '   M ++ M   ',
    '   MMMMMM   ',
    '            ',
    '            ',
  ],
  tablet: [
    '            ',
    ' MMMMMMMMMM ',
    ' M        M ',
    ' M ...... M ',
    ' M ...... M ',
    ' M ...... M ',
    ' M ...... M ',
    ' M        M ',
    ' M   ++   M ',
    ' MMMMMMMMMM ',
    '            ',
    '            ',
  ],
  tv: [
    '            ',
    'MMMMMMMMMMMM',
    'M          M',
    'M ........ M',
    'M ........ M',
    'M ........ M',
    'M ........ M',
    'M          M',
    'MMMMMMMMMMMM',
    '  mm    mm  ',
    '            ',
    '            ',
  ],
  speaker: [
    '  MMMMMMMM  ',
    '  M  mm  M  ',
    '  M      M  ',
    '  M .mm. M  ',
    '  M mMMm M  ',
    '  M mMMm M  ',
    '  M .mm. M  ',
    '  M      M  ',
    '  MMMMMMMM  ',
    '            ',
    '            ',
    '            ',
  ],
  printer: [
    '   MMMMMM   ',
    '   M -- M   ',
    '   M -- M   ',
    ' MMMMMMMMMM ',
    'MM        MM',
    'MM      + MM',
    'MMMMMMMMMMMM',
    ' M ------ M ',
    ' MMMMMMMMMM ',
    '            ',
    '            ',
    '            ',
  ],
  console: [
    '            ',
    '            ',
    '  MMMMMMMM  ',
    ' MM      MM ',
    'MM +    . MM',
    'M +++  . . M',
    'MM +    . MM',
    'MMM  MM  MMM',
    'MM        MM',
    '            ',
    '            ',
    '            ',
  ],
  camera: [
    '            ',
    '            ',
    ' MMMMMMMM   ',
    ' M      MM M',
    ' M  ..  MMMM',
    ' M .MM. MMMM',
    ' M  ..  MM M',
    ' MMMMMMMM   ',
    '    mm      ',
    '   mmmm     ',
    '            ',
    '            ',
  ],
  smarthome: [
    '   .MMMM.   ',
    '  MM    MM  ',
    ' M  .  .  M ',
    ' M   ..   M ',
    ' M   ..   M ',
    '  MM ++ MM  ',
    '   M    M   ',
    '   mmmmmm   ',
    '   mmmmmm   ',
    '    mmmm    ',
    '            ',
    '            ',
  ],
  server: [
    '            ',
    ' MMMMMMMMMM ',
    ' M +   -- M ',
    ' MMMMMMMMMM ',
    ' M +   -- M ',
    ' MMMMMMMMMM ',
    ' M +   -- M ',
    ' MMMMMMMMMM ',
    '  mm    mm  ',
    '            ',
    '            ',
    '            ',
  ],
  board: [
    '  | | | |   ',
    ' MMMMMMMMMM ',
    '-M        M-',
    ' M  mmmm  M ',
    '-M  mmmm  M-',
    ' M  mmmm  M ',
    '-M        M-',
    ' MMMMMMMMMM ',
    '  | | | |   ',
    '            ',
    '            ',
    '            ',
  ],
  watch: [
    '    mmmm    ',
    '    mmmm    ',
    '  MMMMMMMM  ',
    '  M  ..  M  ',
    '  M  ..  M  ',
    '  M      M  ',
    '  MMMMMMMM  ',
    '    mmmm    ',
    '    mmmm    ',
    '            ',
    '            ',
    '            ',
  ],
  unknown: [
    '   MMMMMM   ',
    '  MM    MM  ',
    '        MM  ',
    '       MM   ',
    '     MMM    ',
    '     MM     ',
    '     MM     ',
    '            ',
    '     MM     ',
    '            ',
    '            ',
    '            ',
  ],
};

// Human names for each kind, shown in the UI.
export const KIND_NAMES = {
  router: 'router', network: 'network gear', laptop: 'laptop', computer: 'computer',
  phone: 'phone', tablet: 'tablet', tv: 'tv / streamer', speaker: 'speaker', printer: 'printer',
  console: 'game console', camera: 'camera', smarthome: 'smart home', server: 'server / nas',
  board: 'dev board', watch: 'watch', unknown: 'unknown',
};

/**
 * Each icon's cells as [col, row, glyph, tone], with the icon's empty rows
 * trimmed off so it sits vertically centred in its 12×12 box.
 */
const cache = new Map();
export function iconCells(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const rows = ICONS[kind] || ICONS.unknown;
  const used = rows.map((r, i) => (r.trim() ? i : -1)).filter((i) => i >= 0);
  const top = used[0];
  const height = used[used.length - 1] - top + 1;
  const offset = Math.floor((ICON_SIZE - height) / 2) - top;
  const cells = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => {
    if (ch === ' ') return;
    const glyph = ch === 'm' ? 'M' : ch;
    const tone = ch === 'M' ? 3 : ch === '.' ? 1 : 2;
    cells.push([c, r + offset, glyph, tone]);
  }));
  cache.set(kind, cells);
  return cells;
}
