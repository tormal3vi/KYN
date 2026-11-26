// ─────────────────────────────────────────────────────────────────────────────
// Module menu: a terminal-style screen drawn on the same character grid as the
// startup (see boot.js for the "term" interface).
//
// Keys: ↑/↓ (or j/k) move · 1–9 jump · Enter open · Esc back. Mouse works too.
// Screens reveal themselves line by line (fx.js); any key finishes instantly.
// ─────────────────────────────────────────────────────────────────────────────

import { APP, MODULES, STATUS } from './config.js';
import { revealScreen } from './fx.js';

const X = 3; // left margin, same as the boot log

/** Split text into lines no longer than `width`. */
function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && (line + ' ' + word).length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const fit = (text, width) => (text.length <= width ? text : `${text.slice(0, Math.max(0, width - 3))}...`);
const pad2 = (n) => String(n).padStart(2, '0');
const clock = () => {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

export function createMenu(term, info) {
  let index = 0;
  let open = -1;
  let visible = false;
  let animate = true;
  let token = 0; // bumps on every redraw, so a running reveal knows to stop

  const hostLine = info.native
    ? `${info.hostname} · ${info.os} ${info.arch}`
    : 'browser preview · native core not running';

  // ── painting (into `t`: the real terminal, or a recorder during reveals) ──
  function paintHeader(t) {
    const word = `[ ${APP.name} ]`;
    t.write(X, 1, word, 'strong');
    t.cursor(X + word.length + 1, 1);
    t.write(X + 2, 2, APP.tagline, 'muted');
    t.write(t.cols - X - 8, 1, clock(), 'gray');
    t.write(X, 4, '[+] host  ', 'gray');
    t.write(X + 10, 4, fit(hostLine, t.cols - X * 2 - 10), 'text');
    t.write(X, 5, '[+] scope ', 'gray');
    t.write(X + 10, 5, 'own devices and own network only', 'text');
  }

  function paintList(t, y0) {
    t.write(X, y0, '[+] modules', 'gray');
    const nameW = Math.max(...MODULES.map((m) => m.name.length)) + 2;
    const statusX = X + 6 + nameW;
    const blurbX = statusX + 10;
    const blurbW = t.cols - blurbX - X;

    MODULES.forEach((m, i) => {
      const y = y0 + 2 + i * 2;
      const sel = i === index;
      const st = STATUS[m.status];
      if (sel) t.write(X + 1, y, '>', 'red');
      t.write(X + 3, y, String(i + 1), sel ? 'strong' : 'faint');
      t.write(X + 6, y, m.name.toUpperCase(), sel ? 'strong' : 'muted');
      t.write(statusX, y, st.label, sel ? 'text' : st.style);
      if (blurbW >= 24) t.write(blurbX, y, fit(m.blurb, blurbW), sel ? 'text' : 'gray');
      t.addHit(X, y, t.cols - X * 2, 1, {
        hover: () => { if (index !== i) { index = i; draw(); } },
        click: () => openModule(i),
      });
    });
  }

  function paintModule(t, y0) {
    const m = MODULES[open];
    const st = STATUS[m.status];
    const width = Math.min(t.cols - X * 2, 78);
    let y = y0;

    t.write(X, y, '$ ', 'gray');
    t.write(X + 2, y, `${APP.command} ${m.cmd}`, 'text');
    y += 2;
    t.write(X, y, m.name.toUpperCase(), 'strong');
    y += 1;
    if (m.status === 'locked') {
      t.write(X, y, '[!] access denied: module locked', 'red');
    } else {
      t.write(X, y, `[${st.label}]`, st.style);
      t.write(X + st.label.length + 3, y, m.status === 'next' ? 'this is the module we build next' : 'not built yet', 'gray');
    }
    y += 2;
    for (const line of wrap(m.blurb, width)) t.write(X, y++, line, 'text');
    y += 1;
    t.write(X, y++, '[+] what it will do', 'gray');
    for (const item of m.plan) {
      wrap(item, width - 6).forEach((line, k) => {
        if (k === 0) t.write(X + 2, y, '- ', 'faint');
        t.write(X + 4, y++, line, 'muted');
      });
    }
    y += 1;
    t.write(X, y, '[esc] back', 'text');
    t.addHit(X, y, 10, 1, { click: closeModule });
  }

  function paintFooter(t) {
    const y = t.rows - 2;
    const keys = open >= 0 ? 'esc back' : `↑↓ select   enter open   1-${MODULES.length} jump   esc back`;
    t.write(X, y, keys, 'faint');
    const ver = `${APP.command} v${APP.version}`;
    t.write(t.cols - X - ver.length, y, ver, 'faint');
  }

  function paint(t) {
    paintHeader(t);
    if (open >= 0) paintModule(t, 7);
    else paintList(t, 7);
    paintFooter(t);
  }

  /** Redraw instantly (navigation, resize). */
  function draw() {
    token++;
    term.clear();
    paint(term);
    term.flush();
  }

  /** Redraw with the line-by-line reveal (entering the menu, opening a page). */
  async function reveal() {
    if (!animate) { draw(); return; }
    const mine = ++token;
    await revealScreen(term, paint, { isCancelled: () => token !== mine });
    if (token === mine) draw();
  }

  function openModule(i) {
    index = i;
    open = i;
    reveal();
  }

  function closeModule() {
    open = -1;
    reveal();
  }

  function handleKey(e) {
    const k = e.key;
    if (open >= 0) {
      if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); closeModule(); }
      else draw(); // any other key finishes a running reveal
      return;
    }
    const move = (to) => { e.preventDefault(); index = (to + MODULES.length) % MODULES.length; draw(); };
    if (k === 'ArrowDown' || k === 'j') move(index + 1);
    else if (k === 'ArrowUp' || k === 'k') move(index - 1);
    else if (k === 'Home') move(0);
    else if (k === 'End') move(MODULES.length - 1);
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); openModule(index); }
    else if (/^[1-9]$/.test(k) && Number(k) <= MODULES.length) { e.preventDefault(); openModule(Number(k) - 1); }
  }

  setInterval(() => {
    if (!visible) return;
    term.write(term.cols - X - 8, 1, clock(), 'gray');
    term.flush();
  }, 1000);

  return {
    async show(opts = {}) {
      visible = true;
      animate = opts.animate !== false;
      await reveal();
    },
    draw,
    handleKey,
  };
}
