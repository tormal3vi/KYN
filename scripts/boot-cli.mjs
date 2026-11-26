// Plays the KYN startup in your real terminal, using the exact same code as the
// app (src/js/boot.js): startup → idle loop → any key dissolves and exits.
// Run:  npm run boot:cli
//
// It uses standard ANSI escape codes: move the cursor to a row/column, pick one
// of the 256 terminal colours, print. A terminal has one character size, so it
// shows the 68×36 text version of the logo (the app draws the finer one).
// Make the window big (full screen, around 110×45 or more) to see the logo.

import { runBoot, startIdle, runExit } from '../src/js/boot.js';
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
  return `${CSI}0;${s.bold ? '1;' : ''}${s.inverse ? '7;' : ''}38;5;${COLORS[s.color].ansi}m${BLACK_BG}`;
};
const at = (x, y) => `${CSI}${y + 1};${x + 1}H`;

// A screen buffer, so the blinking cursor can put back whatever it covered.
let chars = [];
let styles = [];
let cur = null;
let blinkOn = true;
let pending = '';
const emit = (s) => { pending += s; };

const term = {
  cols: out.columns,
  rows: out.rows,
  clear() {
    chars = Array.from({ length: term.rows }, () => Array(term.cols).fill(' '));
    styles = Array.from({ length: term.rows }, () => Array(term.cols).fill('text'));
    cur = null;
    emit(`${CSI}0m${BLACK_BG}${CSI}2J${CSI}H`);
  },
  write(x, y, text, style = 'text') {
    if (y < 0 || y >= term.rows) return;
    let s = String(text);
    if (x < 0) { s = s.slice(-x); x = 0; }
    s = s.slice(0, Math.max(0, term.cols - x));
    if (!s) return;
    for (let i = 0; i < s.length; i++) { chars[y][x + i] = s[i]; styles[y][x + i] = style; }
    emit(at(x, y) + sgr(style) + s);
  },
  cursor(x, y) {
    if (cur) restoreCell(cur.x, cur.y);
    cur = x == null ? null : { x, y };
    blinkOn = true;
    drawCursor();
  },
  flush() {
    if (pending) out.write(pending);
    pending = '';
  },
};

function restoreCell(x, y) {
  if (y < 0 || y >= term.rows || x < 0 || x >= term.cols) return;
  emit(at(x, y) + sgr(styles[y][x]) + chars[y][x]);
}
function drawCursor() {
  if (!cur || cur.y >= term.rows || cur.x >= term.cols) return;
  if (blinkOn) emit(at(cur.x, cur.y) + sgr('red') + '_');
  else restoreCell(cur.x, cur.y);
}
const blink = setInterval(() => { blinkOn = !blinkOn; drawCursor(); term.flush(); }, 530);

// Alternate screen + hidden system cursor; put everything back on exit.
out.write(`${CSI}?1049h${CSI}?25l`);
process.on('exit', () => {
  clearInterval(blink);
  out.write(`${CSI}0m${CSI}?25h${CSI}?1049l`);
});

input.setRawMode(true);
input.resume();

const HINT = { hint: 'press any key to exit' };
const ctrl = { fast: false };
let state = 'boot';
let scene = null;
let stopIdle = () => {};
let leave = null;

input.on('data', (key) => {
  if (key[0] === 3) process.exit(0);   // Ctrl+C always quits
  if (state === 'boot') ctrl.fast = true;
  else if (state === 'idle') leave?.();
});

out.on('resize', async () => {
  term.cols = out.columns;
  term.rows = out.rows;
  if (state === 'boot') { ctrl.fast = true; return; }
  if (state === 'idle') {
    stopIdle();
    scene = await runBoot(term, { fast: true }, HINT);
    stopIdle = startIdle(scene);
  }
});

scene = await runBoot(term, ctrl, HINT);
if (ctrl.fast) scene = await runBoot(term, { fast: true }, HINT);
state = 'idle';
stopIdle = startIdle(scene);
await new Promise((resolve) => { leave = resolve; });
state = 'leaving';
stopIdle();
await runExit(term, scene);
process.exit(0);
