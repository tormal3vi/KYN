// ─────────────────────────────────────────────────────────────────────────────
// Module menu: a terminal-style screen drawn on the same character grid as the
// startup (see boot.js for the "term" interface).
//
// Keys: ↑/↓ (or j/k) move · 1–9 jump · Enter open · Esc back. Mouse works too.
// ─────────────────────────────────────────────────────────────────────────────

import { APP, MODULES, STATUS } from './config.js';

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

export function createMenu(term, info) {
  let index = 0;
  let open = -1;
  let visible = false;

  const hostLine = info.native
    ? `${info.hostname} · ${info.os} ${info.arch}`
    : 'browser preview · native core not running';

  function drawClock() {
    const d = new Date();
    const t = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    term.write(term.cols - X - t.length, 1, t, 'gray');
  }

  function drawHeader() {
    const word = `[ ${APP.name} ]`;
    term.write(X, 1, word, 'strong');
    term.cursor(X + word.length + 1, 1);
    term.write(X + 2, 2, APP.tagline, 'muted');
    drawClock();
    term.write(X, 4, '[+] host  ', 'gray');
    term.write(X + 10, 4, fit(hostLine, term.cols - X * 2 - 10), 'text');
    term.write(X, 5, '[+] scope ', 'gray');
    term.write(X + 10, 5, 'own devices and own network only', 'text');
  }

  function drawList(y0) {
    term.write(X, y0, '[+] modules', 'gray');
    const nameW = Math.max(...MODULES.map((m) => m.name.length)) + 2;
    const statusX = X + 6 + nameW;
    const blurbX = statusX + 10;
    const blurbW = term.cols - blurbX - X;

    MODULES.forEach((m, i) => {
      const y = y0 + 2 + i * 2;
      const sel = i === index;
      const st = STATUS[m.status];
      term.write(X + 1, y, sel ? '>' : ' ', 'red');
      term.write(X + 3, y, String(i + 1), sel ? 'strong' : 'faint');
      term.write(X + 6, y, m.name.toUpperCase(), sel ? 'strong' : 'muted');
      term.write(statusX, y, st.label, sel ? 'text' : st.style);
      if (blurbW >= 24) term.write(blurbX, y, fit(m.blurb, blurbW), sel ? 'text' : 'gray');
      term.addHit(X, y, term.cols - X * 2, 1, {
        hover: () => { if (index !== i) { index = i; draw(); } },
        click: () => openModule(i),
      });
    });
  }

  function drawModule(y0) {
    const m = MODULES[open];
    const st = STATUS[m.status];
    const width = Math.min(term.cols - X * 2, 78);
    let y = y0;

    term.write(X, y, '$ ', 'gray');
    term.write(X + 2, y, `${APP.command} ${m.cmd}`, 'text');
    y += 2;
    term.write(X, y, m.name.toUpperCase(), 'strong');
    y += 1;
    if (m.status === 'locked') {
      term.write(X, y, '[!] access denied: module locked', 'red');
    } else {
      term.write(X, y, `[${st.label}]`, st.style);
      term.write(X + st.label.length + 3, y, m.status === 'next' ? 'this is the module we build next' : 'not built yet', 'gray');
    }
    y += 2;
    for (const line of wrap(m.blurb, width)) term.write(X, y++, line, 'text');
    y += 1;
    term.write(X, y++, '[+] what it will do', 'gray');
    for (const item of m.plan) {
      wrap(item, width - 6).forEach((line, k) => {
        term.write(X + 2, y, k === 0 ? '- ' : '  ', 'faint');
        term.write(X + 4, y++, line, 'muted');
      });
    }
    y += 1;
    term.write(X, y, '[esc] back', 'text');
    term.addHit(X, y, 10, 1, { click: closeModule });
  }

  function drawFooter() {
    const y = term.rows - 2;
    const keys = open >= 0
      ? 'esc back'
      : `↑↓ select   enter open   1-${MODULES.length} jump   esc back`;
    term.write(X, y, keys, 'faint');
    const ver = `${APP.command} v${APP.version}`;
    term.write(term.cols - X - ver.length, y, ver, 'faint');
  }

  function draw() {
    term.clear();
    drawHeader();
    if (open >= 0) drawModule(7);
    else drawList(7);
    drawFooter();
    term.flush();
  }

  function openModule(i) {
    index = i;
    open = i;
    draw();
  }

  function closeModule() {
    open = -1;
    draw();
  }

  function handleKey(e) {
    const k = e.key;
    if (open >= 0) {
      if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); closeModule(); }
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
    drawClock();
    term.flush();
  }, 1000);

  return {
    show() { visible = true; draw(); },
    draw,
    handleKey,
  };
}
