// ─────────────────────────────────────────────────────────────────────────────
// Module menu: a terminal-style screen drawn on the same character grid as the
// startup (see boot.js for the "term" interface).
//
// Keys: ↑/↓ (or j/k) move · 1–9 jump · Enter open · Esc back. Mouse works too.
// Screens reveal themselves line by line (fx.js); any key finishes instantly.
// ─────────────────────────────────────────────────────────────────────────────

import { APP, MODULES, STATUS } from './config.js';
import { revealScreen } from './fx.js';
import { createNetmap } from './netmap/screen.js';
import { createPortaudit } from './portaudit/screen.js';
import { createTraffic } from './traffic/screen.js';
import { checkForUpdate, installUpdate } from './updates.js';

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
  let update = null; // see updates.js; plus 'downloading' / 'installing' / 'failed'
  let checked = false;

  const hostLine = info.native
    ? `${info.hostname} · ${info.os} ${info.arch}`
    : 'browser preview · native core not running';

  // ── painting (into `t`: the real terminal, or a recorder during reveals) ──
  /** "[ KYN ] _", the tagline and the clock: shared by every screen. */
  function paintTop(t) {
    const word = `[ ${APP.name} ]`;
    t.write(X, 1, word, 'strong');
    t.cursor(X + word.length + 1, 1);
    t.write(X + 2, 2, APP.tagline, 'muted');
    t.write(t.cols - X - 8, 1, clock(), 'gray');
  }

  function paintHeader(t) {
    paintTop(t);
    t.write(X, 4, '[+] host  ', 'gray');
    t.write(X + 10, 4, fit(hostLine, t.cols - X * 2 - 10), 'text');
    t.write(X, 5, '[+] scope ', 'gray');
    t.write(X + 10, 5, 'own devices and own network only', 'text');
    paintUpdate(t);
  }

  /** Row 6: a new version is ready / downloading / failed. Quiet otherwise. */
  function paintUpdate(t) {
    if (!update) return;
    const y = 6;
    const label = '[+] update  ';
    const vx = X + label.length;
    if (update.state === 'failed') {
      t.write(X, y, fit(`[!] update failed: ${update.message}`, t.cols - X * 2), 'red');
      return;
    }
    t.write(X, y, label, 'gray');
    if (update.state === 'available') {
      t.write(vx, y, `v${update.version} is ready · press u to install`, 'text');
      t.addHit(X, y, 50, 1, { click: startUpdate });
    } else if (update.state === 'downloading') {
      const cells = 20;
      const pct = update.total ? Math.min(100, Math.round((update.downloaded / update.total) * 100)) : 0;
      const filled = Math.round((pct / 100) * cells);
      const text = `downloading v${update.version}  `;
      t.write(vx, y, text, 'text');
      t.write(vx + text.length, y, '█'.repeat(filled), 'text');
      t.write(vx + text.length + filled, y, '░'.repeat(cells - filled), 'faint');
      t.write(vx + text.length + cells + 1, y, `${pct}%`, 'text');
    } else if (update.state === 'installing') {
      t.write(vx, y, 'installing... KYN will restart by itself', 'text');
    }
  }

  async function startUpdate() {
    if (update?.state !== 'available') return;
    const version = update.version;
    update = { state: 'downloading', version, downloaded: 0, total: 0 };
    draw();
    try {
      await installUpdate((p) => {
        update = p.installing ? { state: 'installing', version } : { state: 'downloading', version, ...p };
        if (!inModule()) draw();
      });
    } catch (e) {
      update = { state: 'failed', message: String(e?.message || e) };
      if (!inModule()) draw();
    }
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
    if (netmap.active) { netmap.draw(); return; }
    if (portaudit.active) { portaudit.draw(); return; }
    if (traffic.active) { traffic.draw(); return; }
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
    if (MODULES[i].id === 'netmap' && MODULES[i].status === 'ready') {
      token++; // stop any running reveal
      netmap.open();
      return;
    }
    if (MODULES[i].id === 'portaudit' && MODULES[i].status === 'ready') {
      token++;
      portaudit.open({ from: 'menu' });
      return;
    }
    if (MODULES[i].id === 'traffic' && MODULES[i].status === 'ready') {
      token++;
      traffic.open();
      return;
    }
    open = i;
    reveal();
  }

  function closeModule() {
    open = -1;
    reveal();
  }

  function handleKey(e) {
    if (netmap.active) { netmap.handleKey(e); return; }
    if (portaudit.active) { portaudit.handleKey(e); return; }
    if (traffic.active) { traffic.handleKey(e); return; }
    const k = e.key;
    if (open >= 0) {
      if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); closeModule(); }
      else draw(); // any other key finishes a running reveal
      return;
    }
    if ((k === 'u' || k === 'U') && update?.state === 'available') { e.preventDefault(); startUpdate(); return; }
    const move = (to) => { e.preventDefault(); index = (to + MODULES.length) % MODULES.length; draw(); };
    if (k === 'ArrowDown' || k === 'j') move(index + 1);
    else if (k === 'ArrowUp' || k === 'k') move(index - 1);
    else if (k === 'Home') move(0);
    else if (k === 'End') move(MODULES.length - 1);
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); openModule(index); }
    else if (/^[1-9]$/.test(k) && Number(k) <= MODULES.length) { e.preventDefault(); openModule(Number(k) - 1); }
  }

  const inModule = () => netmap.active || portaudit.active || traffic.active;

  const portaudit = createPortaudit(term, {
    paintHeader: paintTop,
    // opened from Network Map (p) → back to the map; from the menu → menu
    onExit: (from) => (from === 'netmap' ? netmap.resume() : reveal()),
  });

  const traffic = createTraffic(term, { paintHeader: paintTop, onExit: () => reveal() });

  const netmap = createNetmap(term, {
    paintHeader: paintTop,
    onExit: () => reveal(),
    onAudit: (device, net) => portaudit.open({ from: 'netmap', target: device, net }),
    calm: !animate,
  });

  setInterval(() => {
    if (!visible) return;
    term.write(term.cols - X - 8, 1, clock(), 'gray');
    term.flush();
  }, 1000);

  return {
    async show(opts = {}) {
      visible = true;
      animate = opts.animate !== false;
      if (!checked) {
        checked = true;
        // Ask GitHub (via Rust) whether a newer version exists; quiet if not.
        checkForUpdate().then((s) => {
          if (s?.state !== 'available') return;
          update = s;
          if (visible && !inModule()) draw();
        });
      }
      await reveal();
    },
    draw,
    handleKey,
  };
}
