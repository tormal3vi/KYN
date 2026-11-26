// ─────────────────────────────────────────────────────────────────────────────
// A tiny terminal inside the window.
//
// Keeps a grid of characters (like a real terminal's screen buffer) and draws
// it as text in a <pre>. The font size is chosen so the grid fits the window;
// resizing the window recalculates it, like resizing a terminal.
//
// Implements the "term" interface described at the top of boot.js, plus:
//   term.image(...)  a finer grid of character-sized shapes laid over some
//                    text cells (used for the detailed logo)
//   term.addHit(...) clickable regions (used by the menu)
// ─────────────────────────────────────────────────────────────────────────────

import { COLORS, STYLES, TONES } from './palette.js';

const LINE = 1.25;   // line height as a multiple of font size (matches the KYN artwork)
const MIN_FS = 8;    // px
const MAX_FS = 24;   // px

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const esc = (s) => s.replace(/[&<>]/g, (c) => ESC_MAP[c]);

/** Add one CSS class per style from palette.js (via CSSOM, which the app's
 *  security policy allows), so colours are defined in exactly one place. */
function installStyleClasses() {
  const rules = Object.entries(STYLES).map(([name, st]) => {
    const fg = st.inverse ? COLORS.black.hex : COLORS[st.color].hex;
    const bg = st.inverse ? `background:${COLORS[st.color].hex};` : '';
    return `.term .s-${name}{color:${fg};${bg}font-weight:${st.bold ? 700 : 400}}`;
  });
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

/** Draw one logo cell as a small shape, in the style of the KYN artwork. */
function drawGlyph(ctx, g, x, y, w, h) {
  switch (g) {
    case 'M': { const p = Math.max(0.6, w * 0.1); ctx.fillRect(x + p, y + p, w - 2 * p, h - 2 * p); break; }
    case '-': ctx.fillRect(x, y + h * 0.42, w, Math.max(1, h * 0.18)); break;
    case '=': ctx.fillRect(x, y + h * 0.2, w, Math.max(1, h * 0.16)); ctx.fillRect(x, y + h * 0.62, w, Math.max(1, h * 0.16)); break;
    case '|': ctx.fillRect(x + w * 0.4, y, Math.max(1, w * 0.2), h); break;
    case '+': ctx.fillRect(x + w * 0.1, y + h * 0.42, w * 0.8, Math.max(1, h * 0.16)); ctx.fillRect(x + w * 0.42, y + h * 0.1, Math.max(1, w * 0.16), h * 0.8); break;
    case '.': ctx.fillRect(x + w * 0.32, y + h * 0.32, w * 0.36, h * 0.36); break;
    case ':': ctx.fillRect(x + w * 0.35, y + h * 0.1, w * 0.3, h * 0.28); ctx.fillRect(x + w * 0.35, y + h * 0.62, w * 0.3, h * 0.28); break;
    default: break;
  }
}

export async function createWebTerminal(host, { minimums }) {
  installStyleClasses();
  await fontsReady();

  const screen = document.createElement('div');
  screen.className = 'screen';
  const pre = document.createElement('pre');
  pre.className = 'term';
  screen.append(pre);
  host.append(screen);

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
  let layers = [];
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
    screen.style.width = `${cols * cellW}px`;
    screen.style.height = `${rows * cellH}px`;

    chars = Array.from({ length: rows }, () => Array(cols).fill(' '));
    styles = Array.from({ length: rows }, () => Array(cols).fill(''));
    pre.textContent = '';
    rowEls = Array.from({ length: rows }, () => {
      const r = document.createElement('span');
      r.className = 'r';
      pre.append(r);
      return r;
    });
    layers.forEach((l) => l.remove());
    layers = [];
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
    layers.forEach((l) => l.remove());
    layers = [];
  };

  term.write = (x, y, text, style = 'text') => {
    if (y < 0 || y >= term.rows) return;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      const cx = x + i;
      if (cx < 0 || cx >= term.cols) continue;
      chars[y][cx] = s[i];
      styles[y][cx] = s[i] === ' ' && style !== 'inverse' ? '' : style;
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

  // ── fine image layer: a cols×rows grid of shapes over w×h text cells ─────
  term.image = (x, y, w, h, cols, rows) => {
    const canvas = document.createElement('canvas');
    canvas.className = 'layer';
    const dpr = window.devicePixelRatio || 1;
    const pxW = w * term.cellW;
    const pxH = h * term.cellH;
    canvas.width = Math.round(pxW * dpr);
    canvas.height = Math.round(pxH * dpr);
    canvas.style.left = `${x * term.cellW}px`;
    canvas.style.top = `${y * term.cellH}px`;
    canvas.style.width = `${pxW}px`;
    canvas.style.height = `${pxH}px`;
    screen.append(canvas);
    layers.push(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const cw = pxW / cols;
    const ch = pxH / rows;
    const glyph = new Array(cols * rows).fill(' ');
    const tone = new Uint8Array(cols * rows);
    const colors = TONES.map((name) => COLORS[name].hex);
    let changed = false;
    return {
      cols,
      rows,
      set(c, r, g, t) {
        if (c < 0 || r < 0 || c >= cols || r >= rows) return;
        const i = r * cols + c;
        if (glyph[i] === g && tone[i] === t) return;
        glyph[i] = g;
        tone[i] = t;
        changed = true;
      },
      clear() {
        glyph.fill(' ');
        changed = true;
      },
      flush() {
        if (!changed || !canvas.isConnected) return;
        changed = false;
        ctx.clearRect(0, 0, pxW, pxH);
        // one pass to bucket lit cells by brightness, then one colour at a time
        const buckets = colors.map(() => []);
        for (let i = 0; i < glyph.length; i++) if (glyph[i] !== ' ') buckets[tone[i]]?.push(i);
        buckets.forEach((cells, t) => {
          if (!cells.length) return;
          ctx.fillStyle = colors[t];
          for (const i of cells) drawGlyph(ctx, glyph[i], (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
        });
      },
    };
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
  screen.addEventListener('mousemove', (e) => {
    const h = hitAt(e);
    screen.classList.toggle('is-pointer', !!h);
    h?.hover?.();
  });
  screen.addEventListener('click', (e) => hitAt(e)?.click?.());

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
