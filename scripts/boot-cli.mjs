// Plays the KYN startup in your real terminal, using the exact same code as the
// app (src/js/boot.js). Run:  npm run boot:cli    (any key exits)
//
// It uses standard ANSI escape codes: move the cursor to a row/column, pick one
// of the 256 terminal colours, print. Make the terminal window big (full
// screen, around 110×45 or more) to see the logo; smaller shows text only.

import { runBoot } from '../src/js/boot.js';
import { COLORS, STYLES } from '../src/js/palette.js';

const out = process.stdout;
const input = process.stdin;
if (!out.isTTY || !input.isTTY) {
  console.error('Run this directly in a terminal window.');
  process.exit(1);
}

const CSI = '\x1b[';
const BLACK_BG = `${CSI}48;5;16m`; // colour 16 = pure black, like the app
const sgr = (name) => {
  const s = STYLES[name] || STYLES.text;
  return `${CSI}0;${s.bold ? '1;' : ''}38;5;${COLORS[s.color].ansi}m${BLACK_BG}`;
};
const at = (x, y) => `${CSI}${y + 1};${x + 1}H`;

// A screen buffer, so the blinking cursor can put back whatever it covered.
let chars = [];
let styles = [];
let cur = null;
let blinkOn = true;

const term = {
  cols: out.columns,
  rows: out.rows,
  clear() {
    chars = Array.from({ length: term.rows }, () => Array(term.cols).fill(' '));
    styles = Array.from({ length: term.rows }, () => Array(term.cols).fill('text'));
    cur = null;
    out.write(`${CSI}0m${BLACK_BG}${CSI}2J${CSI}H`);
  },
  write(x, y, text, style = 'text') {
    if (y < 0 || y >= term.rows) return;
    let s = String(text);
    if (x < 0) { s = s.slice(-x); x = 0; }
    s = s.slice(0, Math.max(0, term.cols - x));
    if (!s) return;
    for (let i = 0; i < s.length; i++) { chars[y][x + i] = s[i]; styles[y][x + i] = style; }
    out.write(at(x, y) + sgr(style) + s);
  },
  cursor(x, y) {
    if (cur) restoreCell(cur.x, cur.y);
    cur = x == null ? null : { x, y };
    blinkOn = true;
    drawCursor();
  },
  flush() {},
};

function restoreCell(x, y) {
  if (y < 0 || y >= term.rows || x < 0 || x >= term.cols) return;
  out.write(at(x, y) + sgr(styles[y][x]) + chars[y][x]);
}
function drawCursor() {
  if (!cur || cur.y >= term.rows || cur.x >= term.cols) return;
  if (blinkOn) out.write(at(cur.x, cur.y) + sgr('red') + '_');
  else restoreCell(cur.x, cur.y);
}
const blink = setInterval(() => { blinkOn = !blinkOn; drawCursor(); }, 530);

// Alternate screen + hidden system cursor; put everything back on exit.
out.write(`${CSI}?1049h${CSI}?25l`);
const restore = () => {
  clearInterval(blink);
  out.write(`${CSI}0m${CSI}?25h${CSI}?1049l`);
};
process.on('exit', restore);

input.setRawMode(true);
input.resume();

const ctrl = { fast: false };
let done = false;
input.on('data', (key) => {
  if (key[0] === 3 || done) process.exit(0); // Ctrl+C, or any key once finished
  ctrl.fast = true;                           // any key during startup = finish now
});

out.on('resize', () => {
  term.cols = out.columns;
  term.rows = out.rows;
  if (done) runBoot(term, { fast: true }, { hint: 'press any key to exit' });
  else ctrl.fast = true;
});

await runBoot(term, ctrl, { hint: 'press any key to exit' });
if (ctrl.fast) await runBoot(term, { fast: true }, { hint: 'press any key to exit' });
done = true;
