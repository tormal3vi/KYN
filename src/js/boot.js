// ─────────────────────────────────────────────────────────────────────────────
// The startup sequence, written as a terminal program.
//
// It only ever does what a real terminal can do: put characters at a column
// and row, in one of the colours from palette.js, and move a blinking cursor.
// The same function runs inside the app (term-web.js draws it in the window)
// and in your real terminal (npm run boot:cli), so both look identical.
//
// A "term" is anything with:
//   term.cols, term.rows               grid size in characters
//   term.clear()                       blank the screen
//   term.write(x, y, text, style)      print text at column x, row y
//   term.cursor(x, y) / cursor(null)   show the red blinking "_" / hide it
//   term.flush()                       push changes to the screen
// ─────────────────────────────────────────────────────────────────────────────

import { APP, BOOT_LINES } from './config.js';
import { ART, TONE, LOGO_WIDTH, LOGO_HEIGHT } from './logo.js';
import { logoStyle } from './palette.js';

// Smallest grids the splash is designed for. The app picks a font size so the
// window is at least one of these: wide (logo with name beside it) or tall
// (name under the logo).
export const GRID_MINIMUMS = [
  { cols: 104, rows: 44 },
  { cols: 74, rows: 50 },
];

const wordmark = () => `[ ${APP.name} ]`;

/** Where everything goes for a given grid size. */
export function bootLayout(cols, rows) {
  const word = wordmark();
  const sideW = Math.max(word.length + 2, APP.tagline.length + 2);
  const bootH = BOOT_LINES.length;
  const boot = { x: 3, y: 1 };
  const hint = { x: 3, y: rows - 2 };

  // Wide: logo, with the name to its right at 60% of its height.
  if (cols >= LOGO_WIDTH + 1 + sideW + 6 && rows >= bootH + LOGO_HEIGHT + 4) {
    const lx = Math.max(3, Math.floor((cols - (LOGO_WIDTH + 1 + sideW)) / 2));
    const ly = Math.max(bootH + 2, Math.floor((rows - LOGO_HEIGHT) / 2));
    const wy = ly + Math.round(LOGO_HEIGHT * 0.61);
    return {
      boot, hint,
      logo: { x: lx, y: ly },
      word: { x: lx + LOGO_WIDTH + 1, y: wy },
      tag: { x: lx + LOGO_WIDTH + 3, y: wy + 1 },
    };
  }

  // Tall: logo centred, name centred underneath.
  if (cols >= LOGO_WIDTH + 4 && rows >= bootH + LOGO_HEIGHT + 7) {
    const spare = rows - (bootH + LOGO_HEIGHT + 7);
    const ly = bootH + 2 + Math.floor(spare / 2);
    const wy = ly + LOGO_HEIGHT + 1;
    return {
      boot, hint,
      logo: { x: Math.floor((cols - LOGO_WIDTH) / 2), y: ly },
      word: { x: Math.floor((cols - word.length - 2) / 2), y: wy },
      tag: { x: Math.floor((cols - APP.tagline.length) / 2), y: wy + 1 },
    };
  }

  // Too small for the logo: text only.
  return { boot, hint, logo: null, word: { x: 3, y: bootH + 2 }, tag: { x: 5, y: bootH + 3 } };
}

/** Draw one row of the logo, skipping spaces so nothing behind gets erased. */
function drawLogoRow(term, x, y, r) {
  const row = ART[r];
  let c = 0;
  while (c < row.length) {
    if (row[c] === ' ') { c++; continue; }
    const style = logoStyle(row[c], TONE[r][c]);
    let end = c + 1;
    while (end < row.length && row[end] !== ' ' && logoStyle(row[end], TONE[r][end]) === style) end++;
    term.write(x + c, y, row.slice(c, end), style);
    c = end;
  }
}

/**
 * Play the startup. ctrl.fast = finish instantly (any key, or redrawing after
 * a resize). ctrl.skip = same, and the caller jumps straight to the menu.
 * `hint` is the text shown at the bottom once it's done.
 */
export async function runBoot(term, ctrl = {}, { hint = 'press any key' } = {}) {
  const wait = (ms) => (ctrl.fast || ctrl.skip ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
  const L = bootLayout(term.cols, term.rows);

  term.clear();
  term.cursor(L.boot.x, L.boot.y);
  term.flush();
  await wait(600);

  // 1. status lines: "[+] text" appears, then its "..." ticks in one dot at a time
  for (let i = 0; i < BOOT_LINES.length; i++) {
    const line = BOOT_LINES[i];
    const last = i === BOOT_LINES.length - 1;
    const style = last ? 'text' : 'gray';
    const working = line.endsWith('...');
    const head = working ? line.slice(0, -3) : line;
    const y = L.boot.y + i;
    term.write(L.boot.x, y, `[+] ${head}`, style);
    let x = L.boot.x + 4 + head.length;
    term.cursor(x, y);
    term.flush();
    if (working) {
      for (let d = 0; d < 3; d++) {
        await wait(220);
        term.write(x, y, '.', style);
        x += 1;
        term.cursor(x, y);
        term.flush();
      }
    }
    await wait(last ? 380 : 240);
  }

  // 2. logo, printed top to bottom
  term.cursor(null);
  if (L.logo) {
    for (let r = 0; r < LOGO_HEIGHT; r++) {
      drawLogoRow(term, L.logo.x, L.logo.y + r, r);
      term.flush();
      await wait(24);
    }
    await wait(320);
  }

  // 3. name + cursor, then the tagline types out
  const word = wordmark();
  term.write(L.word.x, L.word.y, word, 'strong');
  term.cursor(L.word.x + word.length + 1, L.word.y);
  term.flush();
  await wait(450);
  for (let i = 1; i <= APP.tagline.length; i++) {
    term.write(L.tag.x, L.tag.y, APP.tagline.slice(0, i), 'muted');
    term.flush();
    await wait(28);
  }

  await wait(700);
  if (hint) {
    term.write(L.hint.x, L.hint.y, hint, 'faint');
    term.flush();
  }
}
