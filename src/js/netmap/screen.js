// ─────────────────────────────────────────────────────────────────────────────
// Network Map screen.
//
// Two views of the same devices:
//   map   your router in the middle, every device around it with its icon,
//         joined by dotted lines; a light pulse runs to the selected one
//   list  one card per device
// plus a detail panel for the selected device.
//
// Keys: ←/→ (or ↑/↓) select · tab switch view · r rescan · n rename
//       k mark known / unknown · enter details (small windows) · esc back
// ─────────────────────────────────────────────────────────────────────────────

import { APP } from '../config.js';
import { NOISE_GLYPHS, frame, now, pick } from '../fx.js';
import * as api from './api.js';
import { ICON_SIZE, KIND_NAMES, iconCells } from './icons.js';

const X = 3;           // left margin
const PANEL_W = 36;    // detail panel width (wide windows)
const TOP = 8;         // first content row

const PORT_NAMES = {
  22: 'ssh', 80: 'http', 443: 'https', 445: 'smb', 548: 'afp', 554: 'rtsp', 631: 'ipp',
  1400: 'sonos', 3389: 'rdp', 5000: 'upnp', 7000: 'airplay', 8008: 'cast', 8009: 'cast',
  8080: 'http-alt', 9100: 'print', 62078: 'iphone-sync',
};

const ipNum = (ip) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);
const fit = (s, w) => (s.length <= w ? s : `${s.slice(0, Math.max(0, w - 1))}~`);
const center = (s, x) => x - Math.floor(s.length / 2);

function ago(ts) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** "Beijing Xiaomi Mobile Software" → "Xiaomi": drop city names, keep the brand. */
const CITY = /^(beijing|shenzhen|guangzhou|guangdong|hangzhou|shanghai|zhejiang|dongguan|xiamen|chongqing|nanjing|suzhou|qingdao|wuhan|fujian|jiangsu)\s+/i;
const brand = (vendor) => vendor.replace(CITY, '').split(/[\s,]+/)[0];

/** Best human name for a device: your label, else a cleaned-up announced name. */
function nameOf(d) {
  if (d.label) return d.label;
  if (d.isSelf) return 'this computer';
  const n = (d.names || []).find((x) => !/^\d+\.\d+\.\d+\.\d+$/.test(x));
  if (n) return n.replace(/\.(local|lan|home|localdomain|fritz\.box)$/i, '');
  if (d.vendor) return `${brand(d.vendor)} device`;
  return d.ip;
}

function wrap(text, width) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && `${line} ${word}`.length > width) { out.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

export function createNetmap(term, { paintHeader, onExit, calm = false }) {
  let active = false;
  let net = null;
  let error = null;
  let devices = [];
  let selId = null;
  let view = 'map';
  let mode = 'normal'; // normal | approve | rename | detail
  let input = '';
  let scanning = false;
  let progress = null;
  let lastScan = null;
  let layer = null;
  let geo = null;
  let nodes = [];
  const appeared = new Map(); // device id → time it popped in (for the assemble effect)
  let pulseStart = now();

  // ── data ────────────────────────────────────────────────────────────────
  const order = (a, b) => (b.isGateway - a.isGateway) || ipNum(a.ip) - ipNum(b.ip);
  const selIndex = () => Math.max(0, devices.findIndex((d) => d.id === selId));
  const selected = () => devices[selIndex()];

  function setDevices(list) {
    devices = [...list].sort(order);
    if (!devices.some((d) => d.id === selId)) selId = devices[0]?.id ?? null;
  }

  function upsert(dev) {
    const i = devices.findIndex((d) => d.id === dev.id);
    if (i >= 0) devices[i] = { ...devices[i], ...dev, pending: false };
    else devices.push(dev);
    setDevices(devices);
  }

  function select(i) {
    if (!devices.length) return;
    selId = devices[(i + devices.length) % devices.length].id;
    pulseStart = now();
    draw();
  }

  // ── flow ────────────────────────────────────────────────────────────────
  let session = 0;   // bumps on every open, so a slow earlier open can't overwrite a newer one
  let looping = false;

  async function open() {
    const mine = ++session;
    active = true;
    mode = 'normal';
    error = null;
    net = null;
    draw();
    if (!looping) loop();
    let info;
    try {
      info = await api.getNetwork();
    } catch (e) {
      if (mine !== session) return;
      error = String(e?.message || e);
      draw();
      return;
    }
    if (mine !== session || !active) return;
    net = info;
    if (!net.approved) { mode = 'approve'; draw(); return; }
    await begin();
  }

  async function begin() {
    setDevices(await api.remembered(net.id).catch(() => []));
    draw();
    rescan();
  }

  async function rescan() {
    if (scanning || !net?.approved) return;
    scanning = true;
    error = null;
    progress = { phase: 'sweep', done: 0, total: net.hostCount };
    setDevices(devices.map((d) => ({ ...d, pending: true })));
    draw();
    try {
      const result = await api.scan({
        onProgress: (p) => { progress = p; if (active) drawStatus(); },
        onDevice: (dev) => { appeared.set(dev.id, now()); upsert(dev); if (active) draw(); },
      });
      setDevices(result);
      lastScan = new Date();
    } catch (e) {
      error = String(e?.message || e);
    }
    scanning = false;
    progress = null;
    if (active) draw();
  }

  async function saveLabel() {
    const d = selected();
    const label = input.trim();
    mode = 'normal';
    if (d) {
      d.label = label || null;
      try { await api.setLabel(net.id, d.id, label); } catch (e) { error = String(e?.message || e); }
    }
    draw();
  }

  async function toggleKnown() {
    const d = selected();
    if (!d || d.isSelf || d.isGateway) return;
    d.known = !d.known;
    if (d.known) d.isNew = false;
    draw();
    try { await api.setKnown(net.id, d.id, d.known); } catch (e) { error = String(e?.message || e); draw(); }
  }

  function exit() {
    active = false;
    layer = null;
    onExit();
  }

  // ── layout ──────────────────────────────────────────────────────────────
  function geometry() {
    const wide = term.cols >= 100;
    const bottom = term.rows - 4;
    const h = Math.max(6, bottom - TOP + 1);
    const panel = wide ? { x: term.cols - X - PANEL_W, y: TOP, w: PANEL_W, h } : null;
    const area = { x: X, y: TOP, w: (wide ? panel.x - 3 : term.cols - X) - X, h };
    return { wide, area, panel };
  }

  /** Map positions (text cells) for the router and every device around it. */
  function mapNodes(area) {
    const cx = area.x + Math.floor(area.w / 2);
    const cy = area.y + Math.floor((area.h - 3) / 2);
    const gw = devices.find((d) => d.isGateway);
    const others = devices.filter((d) => !d.isGateway);
    const out = [{ dev: gw || null, x: cx, y: cy, hub: true }];
    const rx = Math.max(10, area.w / 2 - 9);
    const ry = Math.max(3, (area.h - 3) / 2 - 2.5);
    const twoRings = others.length > 12;
    const outer = twoRings ? Math.ceil(others.length / 2) : others.length;
    others.forEach((dev, i) => {
      const inner = twoRings && i % 2 === 1;
      const k = twoRings ? Math.floor(i / 2) : i;
      const count = inner ? others.length - outer : outer;
      const scale = inner ? 0.56 : 1;
      const a = -Math.PI / 2 + ((k + (inner ? 0.5 : 0)) / Math.max(1, count)) * Math.PI * 2;
      out.push({ dev, x: Math.round(cx + Math.cos(a) * rx * scale), y: Math.round(cy + Math.sin(a) * ry * scale) });
    });
    return out;
  }

  // ── text drawing ────────────────────────────────────────────────────────
  function drawStatus() {
    const y = 6;
    term.write(X, y, ' '.repeat(term.cols - X * 2), 'text');
    if (scanning && progress) {
      if (progress.phase === 'sweep') {
        const cells = 20;
        const filled = Math.round((progress.done / Math.max(1, progress.total)) * cells);
        term.write(X, y, `[+] sweeping ${net.scanCidr}  `, 'gray');
        const bx = X + 16 + net.scanCidr.length;
        term.write(bx, y, '█'.repeat(filled), 'text');
        term.write(bx + filled, y, '░'.repeat(cells - filled), 'faint');
        term.write(bx + cells + 1, y, `${progress.done}/${progress.total}`, 'text');
      } else {
        term.write(X, y, `[+] identifying devices  ${progress.done}/${progress.total}`, 'gray');
      }
    } else if (net?.approved) {
      const on = devices.filter((d) => d.online).length;
      const off = devices.length - on;
      const fresh = devices.filter((d) => d.isNew).length;
      let x = X;
      const put = (s, st) => { term.write(x, y, s, st); x += s.length; };
      put('[+] ', 'gray');
      put(`${on} online`, 'text');
      put(` · ${off} offline`, 'gray');
      if (fresh) put(` · ${fresh} new`, 'red');
      if (lastScan) put(` · scanned ${lastScan.toTimeString().slice(0, 5)}`, 'gray');
      if (api.isDemo) put(' · demo data (browser preview)', 'muted');
    }
    term.flush();
  }

  function paintTabs(y) {
    const tabs = [['map', ' map '], ['list', ' list ']];
    let x = term.cols - X - tabs.reduce((n, [, s]) => n + s.length + 1, 0) + 1;
    for (const [id, s] of tabs) {
      term.write(x, y, s, view === id ? 'inverse' : 'gray');
      term.addHit(x, y, s.length, 1, { click: () => { view = id; draw(); } });
      x += s.length + 1;
    }
  }

  function paintNode(n, sel) {
    const d = n.dev;
    if (!d) {
      const s = net?.scanCidr || 'network';
      term.write(center(s, n.x), n.y + 2, s, 'gray');
      return;
    }
    const name = fit(nameOf(d), 16);
    const style = sel ? 'inverse' : d.online && !d.pending ? 'text' : 'faint';
    const lx = center(name, n.x);
    term.write(lx, n.y + 2, name, style);
    if (d.isNew) term.write(lx - 2, n.y + 2, '!', 'red');
    else if (!d.known) term.write(lx + name.length + 1, n.y + 2, '?', 'muted');
    if (geo.area.h >= 18) term.write(center(d.ip, n.x), n.y + 3, d.ip, sel ? 'text' : 'faint');
    term.addHit(n.x - 4, n.y - 1, 9, 3, { hover: () => hover(d), click: () => clickDevice(d) });
    term.addHit(lx, n.y + 2, name.length, 1, { hover: () => hover(d), click: () => clickDevice(d) });
  }

  function paintList() {
    const { area } = geo;
    const per = 3;
    const visible = Math.max(1, Math.floor(area.h / per));
    const si = selIndex();
    const first = Math.min(Math.max(0, si - visible + 2), Math.max(0, devices.length - visible));
    nodes = [];
    devices.slice(first, first + visible).forEach((d, k) => {
      const y = area.y + k * per;
      const sel = d.id === selId;
      const tx = area.x + 8;
      const w = area.w - 8;
      nodes.push({ dev: d, x: area.x + 3, y: y + 1 });
      if (sel) term.write(1, y + 1, '>', 'red');
      const name = fit(nameOf(d), w - 16);
      term.write(tx, y, name, sel ? 'strong' : d.online ? 'text' : 'gray');
      if (d.isNew) term.write(tx + name.length + 1, y, '! new', 'red');
      else if (!d.known) term.write(tx + name.length + 1, y, '?', 'muted');
      const kind = KIND_NAMES[d.kind] || d.kind;
      term.write(area.x + area.w - kind.length, y, kind, sel ? 'text' : 'gray');
      term.write(tx, y + 1, fit([d.ip, d.mac, d.vendor].filter(Boolean).join(' · '), w), sel ? 'muted' : 'gray');
      term.write(tx, y + 2, d.pending ? 'checking...' : d.online ? 'online' : `offline · seen ${ago(d.lastSeen)}`, d.online && !d.pending ? 'muted' : 'faint');
      term.addHit(area.x, y, area.w, per, { hover: () => hover(d), click: () => clickDevice(d) });
    });
    if (devices.length > visible) {
      term.write(area.x + area.w - 12, area.y + area.h - 1, `${si + 1}/${devices.length}`.padStart(12), 'faint');
    }
  }

  function paintPanel(d, x, y, w) {
    if (!d) return;
    let row = y + 7; // the big icon sits above
    const line = (k, v, st = 'text') => {
      wrap(v, w - 9).forEach((part, i) => {
        if (i === 0) term.write(x, row, k, 'gray');
        term.write(x + 9, row++, part, st);
      });
    };
    term.write(x, row++, fit(nameOf(d), w), 'strong');
    term.write(x, row++, fit([KIND_NAMES[d.kind] || d.kind, d.vendor].filter(Boolean).join(' · '), w), 'muted');
    row++;
    line('status', d.pending ? 'checking...' : d.online ? 'online now' : `offline · seen ${ago(d.lastSeen)}`, d.online && !d.pending ? 'text' : 'gray');
    line('ip', d.ip);
    line('mac', d.mac ? `${d.mac}${d.randomized ? ' (private)' : ''}` : '-');
    if (d.model) line('model', d.model);
    if (d.ports?.length) line('ports', d.ports.map((p) => (PORT_NAMES[p] ? `${p} ${PORT_NAMES[p]}` : String(p))).join(', '));
    if (d.names?.length) line('names', d.names.slice(0, 3).join(', '), 'muted');
    line('first', ago(d.firstSeen), 'muted');
    line('why', d.reason || '-', 'muted');
    row++;
    if (d.isNew) term.write(x, row++, '[!] new device on your network', 'red');
    const tag = d.isSelf || d.isGateway ? 'known' : d.known ? 'known · press k to unmark' : 'unknown · press k if it is yours';
    term.write(x, row++, fit(tag, w), d.known ? 'gray' : 'muted');
  }

  function paintFooter() {
    const y = term.rows - 2;
    if (mode === 'rename') {
      const s = `rename: ${input}`;
      term.write(X, y, s, 'text');
      term.cursor(X + s.length, y);
      term.write(X + s.length + 3, y, 'enter save · esc cancel', 'faint');
      return;
    }
    const keys = mode === 'approve'
      ? 'y this is my network · esc back'
      : mode === 'detail'
        ? 'esc / enter close'
        : `←→ select   tab ${view === 'map' ? 'list' : 'map'}   r rescan   n rename   k known   esc back`;
    term.write(X, y, keys, 'faint');
  }

  function draw() {
    if (!active) return;
    geo = geometry();
    term.clear();
    paintHeader(term);
    term.cursor(null);
    term.write(X, 4, '$ ', 'gray');
    term.write(X + 2, 4, `${APP.command} netmap`, 'text');
    if (mode !== 'approve' && net) paintTabs(4);
    if (net) {
      const parts = [net.scanCidr, net.interface, net.gatewayIp && `gateway ${net.gatewayIp}`].filter(Boolean);
      term.write(X, 5, '[+] network ', 'gray');
      term.write(X + 12, 5, fit(parts.join(' · '), term.cols - X * 2 - 12), 'text');
      if (net.capped) term.write(X + 13 + parts.join(' · ').length, 5, '(your /24 only)', 'gray');
    } else if (!error) {
      term.write(X, 5, '[+] reading network...', 'gray');
    }

    nodes = [];
    layer = null;
    const { area, panel, wide } = geo;
    if (error && !devices.length) {
      term.write(X, TOP, '[!] ', 'red');
      wrap(error, term.cols - X * 2 - 4).forEach((l, i) => term.write(X + 4, TOP + i, l, 'red'));
      term.write(X, TOP + 3, 'r retry · esc back', 'faint');
    } else if (mode === 'approve') {
      paintApprove();
    } else if (net) {
      if (error) term.write(X, 7, fit(`[!] ${error}`, term.cols - X * 2), 'red');
      layer = term.image(X, TOP, term.cols - X * 2, area.h, (term.cols - X * 2) * 2, area.h * 4);
      if (mode === 'detail' || !wide) {
        if (mode === 'detail') paintPanel(selected(), X, TOP, term.cols - X * 2);
        else view === 'map' ? paintMap() : paintList();
      } else {
        view === 'map' ? paintMap() : paintList();
        paintPanel(selected(), panel.x, panel.y, panel.w);
      }
    }
    drawStatus();
    paintFooter();
    term.flush();
    drawCanvas();
  }

  function paintMap() {
    nodes = mapNodes(geo.area);
    nodes.forEach((n) => paintNode(n, n.dev && n.dev.id === selId));
  }

  function paintApprove() {
    const lines = [
      ['[!] ', 'red', 'new network', 'strong'],
      ['    ', 'text', `${net.scanCidr} · ${net.interface}${net.gatewayIp ? ` · gateway ${net.gatewayIp}` : ''}`, 'text'],
      null,
      ['    ', 'text', 'KYN will look for devices on this network: it knocks once on each', 'muted'],
      ['    ', 'text', `of its ${net.hostCount} addresses and asks the devices that answer what they are.`, 'muted'],
      ['    ', 'text', 'Only scan networks you own, or have permission to scan.', 'muted'],
      null,
      ['    ', 'text', '[y] yes, this is my network      [esc] back', 'text'],
    ];
    lines.forEach((l, i) => {
      if (!l) return;
      term.write(X, TOP + i, l[0], l[1]);
      term.write(X + 4, TOP + i, l[2], l[3]);
    });
    term.addHit(X + 4, TOP + 7, 27, 1, { click: () => approveNetwork() });
  }

  async function approveNetwork() {
    try {
      await api.approve(net.id);
      net.approved = true;
      mode = 'normal';
      await begin();
    } catch (e) {
      error = String(e?.message || e);
      draw();
    }
  }

  function hover(d) {
    if (selId === d.id || mode !== 'normal') return;
    selId = d.id;
    pulseStart = now();
    draw();
  }

  function clickDevice(d) {
    selId = d.id;
    if (!geo.wide) mode = 'detail';
    draw();
  }

  // ── canvas (icons, lines, radar, pulse): redrawn every frame ─────────────
  function drawCanvas() {
    if (!layer || !geo) return;
    const t = now();
    const L = layer;
    L.clear();
    const ox = X;
    const oy = TOP;
    // text cell (x, y) → fine-grid centre of a node's icon
    const fx = (x) => (x - ox) * 2;
    const fy = (y) => (y - oy) * 4 + 2;
    const blocked = [];

    const drawIcon = (kind, cx, cy, toneShift, popped, scale = 1) => {
      const size = ICON_SIZE * scale;
      const x0 = cx - size / 2;
      const y0 = cy - size / 2;
      blocked.push([x0 - 1, y0 - 1, x0 + size + 1, y0 + size + 1]);
      for (const [c, r, g, tone] of iconCells(kind)) {
        const noisy = popped !== null && Math.random() < popped;
        const glyph = noisy ? pick(NOISE_GLYPHS) : g;
        const tn = noisy ? 4 : Math.max(0, Math.min(4, tone + toneShift));
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) L.set(x0 + c * scale + dx, y0 + r * scale + dy, glyph, tn);
      }
    };
    const popAmount = (d) => {
      const a = appeared.get(d.id);
      if (!a || calm) return null;
      const p = (t - a) / 450;
      return p >= 1 ? null : 1 - p;
    };
    const isBlocked = (x, y) => blocked.some(([a, b, c, e]) => x >= a && x < c && y >= b && y < e);

    if (view === 'map' && mode !== 'detail' && nodes.length) {
      const hub = nodes[0];
      const hx = fx(hub.x);
      const hy = fy(hub.y);
      // icons first (so lines know where not to go)
      for (const n of nodes) {
        const d = n.dev;
        const shift = !d ? -2 : (d.online && !d.pending ? 0 : -2) + (d.id === selId ? 1 : 0);
        drawIcon(d ? d.kind : 'router', fx(n.x), fy(n.y), shift, d ? popAmount(d) : null);
        blocked.push([fx(n.x) - 18, (n.y + 2 - oy) * 4, fx(n.x) + 18, (n.y + 4 - oy) * 4]); // label rows
      }
      // dotted lines from the router to every device
      for (const n of nodes.slice(1)) {
        const x1 = fx(n.x);
        const y1 = fy(n.y);
        const len = Math.hypot(x1 - hx, y1 - hy);
        const sel = n.dev.id === selId;
        const base = n.dev.online && !n.dev.pending ? (sel ? 2 : 1) : 0;
        const pulse = sel && !calm ? (((t - pulseStart) / 1100) % 1.5) * len : -99;
        for (let s = 0; s <= len; s += 1) {
          const px = Math.round(hx + ((x1 - hx) * s) / len);
          const py = Math.round(hy + ((y1 - hy) * s) / len);
          if (isBlocked(px, py)) continue;
          const near = Math.abs(s - pulse);
          if (near < 1.2) L.set(px, py, 'M', 4);
          else if (near < 4 && s < pulse) L.set(px, py, '.', 3);
          else if (Math.round(s) % 3 === 0) L.set(px, py, '.', base);
        }
      }
      // radar sweep while scanning
      if (scanning && !calm) {
        const rx = geo.area.w;
        const ry = geo.area.h * 2;
        for (let k = 0; k < 3; k++) {
          const a = (t / 1500) * Math.PI * 2 - k * 0.09;
          for (let s = 0.12; s <= 1; s += 0.02) {
            const px = Math.round(hx + Math.cos(a) * rx * s);
            const py = Math.round(hy + Math.sin(a) * ry * s);
            if (!isBlocked(px, py)) L.set(px, py, '.', 3 - k);
          }
        }
      }
    } else if (view === 'list' && mode !== 'detail') {
      for (const n of nodes) {
        const d = n.dev;
        drawIcon(d.kind, fx(n.x), fy(n.y), (d.online && !d.pending ? 0 : -2) + (d.id === selId ? 1 : 0), popAmount(d));
      }
    }
    // big icon in the detail panel
    const d = selected();
    if (d && (geo.wide || mode === 'detail')) {
      const px = mode === 'detail' ? X + 1 : geo.panel.x;
      drawIcon(d.kind, fx(px) + 12, 12, d.online ? 0 : -2, popAmount(d), 2);
    }
    L.flush();
  }

  async function loop() {
    looping = true;
    while (active) {
      drawCanvas();
      await frame();
    }
    looping = false;
  }

  // ── keys ────────────────────────────────────────────────────────────────
  function handleKey(e) {
    const k = e.key;
    if (mode === 'approve') {
      if (k === 'y' || k === 'Y') { e.preventDefault(); approveNetwork(); }
      else if (k === 'Escape' || k === 'n') { e.preventDefault(); exit(); }
      return;
    }
    if (mode === 'rename') {
      e.preventDefault();
      if (k === 'Enter') saveLabel();
      else if (k === 'Escape') { mode = 'normal'; draw(); }
      else if (k === 'Backspace') { input = input.slice(0, -1); draw(); }
      else if (k.length === 1 && input.length < 32) { input += k; draw(); }
      return;
    }
    if (mode === 'detail') {
      if (k === 'Escape' || k === 'Enter') { e.preventDefault(); mode = 'normal'; draw(); }
      return;
    }
    if (error && !devices.length && (k === 'r' || k === 'R')) { e.preventDefault(); open(); return; }
    switch (k) {
      case 'ArrowRight': case 'ArrowDown': e.preventDefault(); select(selIndex() + 1); break;
      case 'ArrowLeft': case 'ArrowUp': e.preventDefault(); select(selIndex() - 1); break;
      case 'Tab': case 'v': e.preventDefault(); view = view === 'map' ? 'list' : 'map'; draw(); break;
      case 'r': case 'R': e.preventDefault(); rescan(); break;
      case 'n': case 'N':
        if (selected()) { e.preventDefault(); mode = 'rename'; input = selected().label || ''; draw(); }
        break;
      case 'k': case 'K': e.preventDefault(); toggleKnown(); break;
      case 'Enter': if (!geo?.wide && selected()) { e.preventDefault(); mode = 'detail'; draw(); } break;
      case 'Escape': case 'Backspace': e.preventDefault(); exit(); break;
      default: break;
    }
  }

  return { open, draw, handleKey, get active() { return active; } };
}
