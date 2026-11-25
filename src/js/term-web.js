// ─────────────────────────────────────────────────────────────────────────────
// A tiny terminal inside the window.
//
// Keeps a grid of characters (like a real terminal's screen buffer) and draws
// it as text in a <pre>. The font size is chosen so the grid fits the window;
// resizing the window recalculates it, like resizing a terminal.
// Implements the "term" interface described at the top of boot.js, plus
// clickable regions (addHit) for the menu.
// ─────────────────────────────────────────────────────────────────────────────

import { COLORS, STYLES } from './palette.js';

const LINE = 1.25;   // line height as a multiple of font size (matches the KYN artwork)
const MIN_FS = 8;    // px
const MAX_FS = 22;   // px

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const esc = (s) => s.replace(/[&<>]/g, (c) => ESC_MAP[c]);

/** Add one CSS class per style from palette.js (via CSSOM, which the app's
 *  security policy allows), so colours are defined in exactly one place. */
function installStyleClasses() {
  const rules = Object.entries(STYLES).map(([name, st]) =>
    `.term .s-${name}{color:${COLORS[st.color].hex};font-weight:${st.bold ? 700 : 400}}`);
  rules.push(`.term .cursor{color:${COLORS.red.hex}}`);
  try {
    const sheet = [...document.styleSheets].find((s) => (s.href || '').endsWith('kyn.css'));
    rules.forEach((r) => sheet.insertRule(r, sheet.cssRules.length));
  } catch {
    // Stylesheet not reachable (e.g. some preview hosts): fall back to a <style> tag.
    const el = document.createElement('style');
    el.textContent = rules.join('\n');
    document.head.append(el);
  }
}

async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load('400 20px "JetBrains Mono"'),
      document.fonts.load('700 20px "JetBrains Mono"'),
    ]);
  } catch { /* fall back to the system monospace font */ }
}

export async function createWebTerminal(host, { minimums }) {
  installStyleClasses();
  await fontsReady();

  const pre = document.createElement('pre');
  pre.className = 'term';
  host.append(pre);

  // How wide one character is, per 1px of font size.
  const probe = document.createElement('span');
  probe.textContent = 'M'.repeat(200);
  probe.style.fontSize = '100px';
  pre.append(probe);
  const adv = probe.getBoundingClientRect().width / 200 / 100 || 0.6;
  probe.remove();

  const term = { cols: 0, rows: 0, fontSize: 0, cellW: 0, cellH: 0 };
  let chars = [];
  let styles = [];
  let rowEls = [];
  const dirty = new Set();
  let cur = null;
  let hits = [];
  const resizeHandlers = [];

  function fit() {
    const cs = getComputedStyle(host);
    const W = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const H = host.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    // Biggest font (in 0.25px steps) where the grid still meets one of the
    // minimum sizes. Line height is rounded to whole pixels, so check the
    // real row count rather than trusting the estimate.
    const gridAt = (f) => ({ cols: Math.floor(W / (f * adv)), rows: Math.floor(H / Math.round(f * LINE)) });
    const fits = (g) => minimums.some((m) => g.cols >= m.cols && g.rows >= m.rows);
    let fs = 0;
    for (const m of minimums) fs = Math.max(fs, Math.min(W / (m.cols * adv), H / (m.rows * LINE)));
    fs = Math.min(MAX_FS, Math.max(MIN_FS, Math.floor(fs * 4) / 4));
    while (fs > MIN_FS && !fits(gridAt(fs))) fs -= 0.25;
    const cellW = fs * adv;
    const cellH = Math.round(fs * LINE);
    const cols = Math.max(20, gridAt(fs).cols);
    const rows = Math.max(10, gridAt(fs).rows);
    Object.assign(term, { cols, rows, fontSize: fs, cellW, cellH });

    pre.style.fontSize = `${fs}px`;
    pre.style.lineHeight = `${cellH}px`;
    pre.style.setProperty('--row-h', `${cellH}px`);
    pre.style.width = `${cols * cellW}px`;
    pre.style.height = `${rows * cellH}px`;

    chars = Array.from({ length: rows }, () => Array(cols).fill(' '));
    styles = Array.from({ length: rows }, () => Array(cols).fill(''));
    pre.textContent = '';
    rowEls = Array.from({ length: rows }, () => {
      const r = document.createElement('span');
      r.className = 'r';
      pre.append(r);
      return r;
    });
    cur = null;
    hits = [];
  }

  term.clear = () => {
    for (let y = 0; y < term.rows; y++) {
      chars[y].fill(' ');
      styles[y].fill('');
      dirty.add(y);
    }
    if (cur) dirty.add(cur.y);
    cur = null;
    hits = [];
  };

  term.write = (x, y, text, style = 'text') => {
    if (y < 0 || y >= term.rows) return;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      const cx = x + i;
      if (cx < 0 || cx >= term.cols) continue;
      chars[y][cx] = s[i];
      styles[y][cx] = s[i] === ' ' ? '' : style;
    }
    dirty.add(y);
  };

  term.cursor = (x, y) => {
    if (cur) dirty.add(cur.y);
    cur = x == null ? null : { x, y };
    if (cur) dirty.add(cur.y);
  };

  term.flush = () => {
    for (const y of dirty) {
      if (y < 0 || y >= term.rows) continue;
      let html = '';
      let run = '';
      let runStyle = '';
      const push = () => {
        if (!run) return;
        html += runStyle ? `<span class="s-${runStyle}">${esc(run)}</span>` : esc(run);
        run = '';
      };
      for (let x = 0; x < term.cols; x++) {
        if (cur && cur.y === y && cur.x === x) {
          push();
          html += '<span class="cursor">_</span>';
          continue;
        }
        const st = styles[y][x];
        if (st !== runStyle) { push(); runStyle = st; }
        run += chars[y][x];
      }
      push();
      rowEls[y].innerHTML = html.replace(/\s+$/, '');
    }
    dirty.clear();
  };

  // ── clickable regions (used by the menu) ─────────────────────────────────
  term.addHit = (x, y, w, h, handlers) => hits.push({ x, y, w, h, ...handlers });
  const hitAt = (e) => {
    const rect = pre.getBoundingClientRect();
    const cx = Math.floor((e.clientX - rect.left) / term.cellW);
    const cy = Math.floor((e.clientY - rect.top) / term.cellH);
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i];
      if (cx >= h.x && cx < h.x + h.w && cy >= h.y && cy < h.y + h.h) return h;
    }
    return null;
  };
  pre.addEventListener('mousemove', (e) => {
    const h = hitAt(e);
    pre.classList.toggle('is-pointer', !!h);
    h?.hover?.();
  });
  pre.addEventListener('click', (e) => hitAt(e)?.click?.());

  // ── resizing ─────────────────────────────────────────────────────────────
  term.onResize = (fn) => resizeHandlers.push(fn);
  let timer;
  let last = '';
  new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const size = `${host.clientWidth}x${host.clientHeight}`;
      if (size === last) return;
      last = size;
      fit();
      resizeHandlers.forEach((fn) => fn());
    }, 80);
  }).observe(host);

  fit();
  last = `${host.clientWidth}x${host.clientHeight}`;
  return term;
}
