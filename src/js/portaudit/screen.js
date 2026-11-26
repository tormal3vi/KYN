// ─────────────────────────────────────────────────────────────────────────────
// Port Audit screen.
//
//   devices   pick "this computer" or a device from your Network Map
//   results   every open port, riskiest first, with a plain-language
//             explanation of what it is, why it matters and how to fix it
//
// Keys (devices): ↑↓ select · enter quick check · f full check · esc back
// Keys (results): ↑↓ select · r check again · f full check · t devices · esc back
// While checking: esc stops.
// ─────────────────────────────────────────────────────────────────────────────

import { APP } from '../config.js';
import * as netapi from '../netmap/api.js';
import { nameOf } from '../netmap/screen.js';
import { KIND_NAMES } from '../netmap/icons.js';
import * as api from './api.js';
import { QUICK_PORTS, RISK_ORDER, explain } from './knowledge.js';

const X = 3;
const PANEL_W = 40;
const RISK_STYLE = { high: 'red', medium: 'strong', low: 'text', info: 'gray' };
const MARK = { high: '!', medium: '~', low: ' ', info: ' ' };

const fit = (s, w) => (s.length <= w ? s : `${s.slice(0, Math.max(0, w - 1))}~`);
const ipNum = (ip) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);

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

export function createPortaudit(term, { paintHeader, onExit }) {
  let active = false;
  let from = 'menu';
  let mode = 'devices'; // devices | results | detail
  let targets = [];
  let tIndex = 0;
  let hint = '';
  let target = null;
  let check = null; // { full, scanning, progress, open:Set, local, millis, cancelled, error }
  let findings = [];
  let fIndex = 0;
  const done = new Map(); // ip → finished check, so going back shows it again

  // ── devices ─────────────────────────────────────────────────────────────
  async function loadTargets(net) {
    hint = '';
    let devices = [];
    try {
      net = net || await netapi.getNetwork();
      if (net?.approved) devices = await netapi.remembered(net.id);
      else hint = 'Confirm your network in Network Map (1) to check your other devices too.';
    } catch {
      hint = 'No network found: you can still check this computer.';
    }
    const self = devices.find((d) => d.isSelf);
    const others = devices
      .filter((d) => !d.isSelf)
      .sort((a, b) => (b.online - a.online) || ipNum(a.ip) - ipNum(b.ip));
    targets = [
      { ip: net?.ip || '127.0.0.1', name: 'this computer', kind: self?.kind || 'computer', isSelf: true, online: true },
      ...others.map((d) => ({ ip: d.ip, name: nameOf(d), kind: d.kind, isSelf: false, online: d.online })),
    ];
    tIndex = Math.min(tIndex, targets.length - 1);
  }

  // ── checking ────────────────────────────────────────────────────────────
  function buildFindings() {
    const onMac = check.local?.os === 'macos';
    const byPort = new Map();
    for (const l of check.local?.listeners || []) {
      const f = byPort.get(l.port) || { port: l.port, exposed: false, apps: new Set(), pids: new Set() };
      f.exposed ||= l.exposed;
      if (l.process) f.apps.add(l.process);
      if (l.pid) f.pids.add(l.pid);
      byPort.set(l.port, f);
    }
    // Knocking on 127.0.0.1 reaches every listening port, local-only or not,
    // so a loopback check can't tell what other devices can reach. Then the
    // operating system's list (above) decides; ports only the knock found are
    // marked "can't tell". Knocking on the network address only reaches ports
    // that other devices could reach too.
    const viaLoopback = target.ip.startsWith('127.');
    for (const port of check.open) {
      let f = byPort.get(port);
      if (!f) {
        f = { port, exposed: !viaLoopback, unsure: viaLoopback, apps: new Set(), pids: new Set(), hidden: target.isSelf };
        byPort.set(port, f);
      } else if (!viaLoopback) {
        f.exposed = true;
      }
    }
    const hiddenApp = check.local?.os === 'macos'
      ? 'a system service (macOS only shows its name to admins)'
      : 'a system service (its name needs admin rights to see)';
    findings = [...byPort.values()].map((f) => {
      const localOnly = target.isSelf && !f.exposed && !f.unsure;
      const info = explain(f.port, { isSelf: target.isSelf, onMac, localOnly });
      let reach = null;
      if (target.isSelf) {
        reach = f.unsure ? 'this computer (KYN can\'t tell whether other devices can reach it)'
          : f.exposed ? 'other devices on your network' : 'only this computer';
      }
      return {
        ...info,
        app: f.apps.size ? [...f.apps].join(', ') : f.hidden ? hiddenApp : null,
        pid: f.pids.size === 1 ? [...f.pids][0] : null,
        reach,
      };
    }).sort((a, b) => (RISK_ORDER[a.risk] - RISK_ORDER[b.risk]) || a.port - b.port);
    fIndex = Math.min(fIndex, Math.max(0, findings.length - 1));
  }

  async function runCheck(full) {
    if (check?.scanning) return;
    mode = 'results';
    fIndex = 0;
    const ports = full ? null : QUICK_PORTS;
    check = {
      full, scanning: true, open: new Set(), local: null, millis: 0, cancelled: false, error: null,
      progress: { done: 0, total: ports ? ports.length : 65535, open: 0 },
    };
    findings = [];
    draw();
    try {
      const [local, res] = await Promise.all([
        target.isSelf ? api.local().catch(() => null) : Promise.resolve(null),
        api.scan(target.ip, ports, {
          onProgress: (p) => { check.progress = p; if (active) paintStatus(true); },
          onOpen: (port) => { check.open.add(port); buildFindings(); if (active) draw(); },
        }),
      ]);
      check.local = local;
      res.open.forEach((p) => check.open.add(p));
      check.millis = res.millis;
      check.cancelled = res.cancelled;
      check.progress = { done: res.scanned, total: check.progress.total, open: res.open.length };
    } catch (e) {
      check.error = String(e?.message || e);
    }
    check.scanning = false;
    buildFindings();
    done.set(target.ip, { check, findings });
    if (active) draw();
  }

  function pickTarget(i, full) {
    target = targets[i];
    if (!target) return;
    runCheck(full);
  }

  // ── drawing ─────────────────────────────────────────────────────────────
  const wide = () => term.cols >= 100;

  function paintStatus(flush = false) {
    if (mode === 'devices' || !check) return;
    const y = 6;
    term.write(X, y, ' '.repeat(term.cols - X * 2), 'text');
    const p = check.progress;
    if (check.scanning) {
      const cells = 24;
      const filled = Math.round((p.done / Math.max(1, p.total)) * cells);
      const label = `[+] checking ${check.full ? 'all ports' : 'common ports'}  `;
      term.write(X, y, label, 'gray');
      term.write(X + label.length, y, '█'.repeat(filled), 'text');
      term.write(X + label.length + filled, y, '░'.repeat(cells - filled), 'faint');
      term.write(X + label.length + cells + 1, y, `${p.done.toLocaleString('en')}/${p.total.toLocaleString('en')} · ${check.open.size} open`, 'text');
    } else if (check.error) {
      term.write(X, y, fit(`[!] ${check.error}`, term.cols - X * 2), 'red');
    } else {
      const kind = check.full ? 'full check' : 'quick check';
      const secs = (check.millis / 1000).toFixed(1);
      const stop = check.cancelled ? ' · stopped early' : '';
      term.write(X, y, '[+] ', 'gray');
      term.write(X + 4, y, `${kind} · ${p.done.toLocaleString('en')} ports · ${secs} s${stop}`, 'muted');
      if (api.isDemo) term.write(X + 4 + `${kind} · ${p.done.toLocaleString('en')} ports · ${secs} s${stop}`.length, y, ' · demo data (browser preview)', 'faint');
    }
    if (flush) term.flush();
  }

  function paintVerdict() {
    if (!check || check.scanning || check.error) return;
    const y = 7;
    const n = (r) => findings.filter((f) => f.risk === r).length;
    const high = n('high');
    const medium = n('medium');
    const plural = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`;
    let x = X;
    const put = (s, st) => { term.write(x, y, s, st); x += s.length; };
    if (!findings.length) {
      put('[+] ', 'gray');
      put(check.full ? 'no open ports at all' : 'none of the common ports are open', 'text');
    } else if (high) {
      put(`[!] ${plural(high, 'thing')} to fix`, 'red');
    } else if (medium) {
      put('[~] ', 'strong');
      put(`${plural(medium, 'thing')} to check · nothing high-risk`, 'strong');
    } else {
      put('[+] ', 'gray');
      put('nothing risky is open', 'text');
    }
    if (findings.length) put(`   ${plural(findings.length, 'open port')}`, 'gray');
    if (target.isSelf && check.local && check.local.firewall !== null) {
      const where = check.local.os === 'macos' ? 'System Settings → Network → Firewall' : 'Windows Security → Firewall';
      const long = `   · firewall off: turn it on in ${where}`;
      if (check.local.firewall) put('   · firewall on', 'gray');
      else put(x + long.length <= term.cols - X ? long : '   · firewall OFF', 'red');
    }
  }

  function paintDevices() {
    term.write(X, 5, '[+] pick a device to check', 'gray');
    if (hint) term.write(X, 6, fit(hint, term.cols - X * 2), 'muted');
    const y0 = 8;
    const visible = Math.max(1, term.rows - y0 - 4);
    const first = Math.min(Math.max(0, tIndex - visible + 2), Math.max(0, targets.length - visible));
    targets.slice(first, first + visible).forEach((t, k) => {
      const i = first + k;
      const y = y0 + k;
      const sel = i === tIndex;
      if (sel) term.write(X - 2, y, '>', 'red');
      term.write(X, y, fit(t.name, 26), sel ? 'strong' : t.online ? 'text' : 'gray');
      term.write(X + 28, y, t.ip, sel ? 'text' : 'gray');
      term.write(X + 46, y, KIND_NAMES[t.kind] || t.kind || '', 'gray');
      const prev = done.get(t.ip);
      if (prev && !prev.check.error) {
        const high = prev.findings.filter((f) => f.risk === 'high').length;
        const summary = high ? `${high} to fix` : `${prev.findings.length} open, nothing high-risk`;
        term.write(X + 64, y, fit(`checked: ${summary}`, term.cols - X - 64 - X), high ? 'red' : 'faint');
      } else if (!t.online) {
        term.write(X + 64, y, 'offline', 'faint');
      }
      term.addHit(X, y, term.cols - X * 2, 1, {
        hover: () => { if (tIndex !== i) { tIndex = i; draw(); } },
        click: () => { tIndex = i; pickTarget(i, false); },
      });
    });
  }

  function paintFindings(x0, w) {
    const y0 = 9;
    if (check.scanning && !findings.length) {
      term.write(x0, y0, 'knocking...', 'faint');
      return;
    }
    term.write(x0, y0 - 1, fit(target.isSelf ? '   risk    port   what                      app' : '   risk    port   what', w), 'faint');
    const visible = Math.max(1, term.rows - y0 - 4);
    const first = Math.min(Math.max(0, fIndex - visible + 2), Math.max(0, findings.length - visible));
    findings.slice(first, first + visible).forEach((f, k) => {
      const i = first + k;
      const y = y0 + k;
      const sel = i === fIndex;
      if (sel) term.write(x0 - 2, y, '>', 'red');
      term.write(x0, y, MARK[f.risk], f.risk === 'high' ? 'red' : 'strong');
      term.write(x0 + 3, y, f.risk, RISK_STYLE[f.risk]);
      term.write(x0 + 11, y, String(f.port), sel ? 'strong' : 'text');
      const nameW = target.isSelf ? 24 : w - 19;
      term.write(x0 + 18, y, fit(f.name, nameW), sel ? 'strong' : 'muted');
      if (target.isSelf) {
        const app = f.app || '';
        term.write(x0 + 44, y, fit(app + (f.reach === 'only this computer' ? ' (local)' : ''), Math.max(0, w - 44)), 'gray');
      }
      term.addHit(x0, y, w, 1, {
        hover: () => { if (fIndex !== i) { fIndex = i; draw(); } },
        click: () => { fIndex = i; if (!wide()) mode = 'detail'; draw(); },
      });
    });
    if (findings.length > visible) {
      term.write(x0 + 3, y0 + visible, `${findings.length - visible} more · ↑↓ or scroll`, 'faint');
    }
  }

  function paintPanel(f, x, y, w) {
    if (!f) return;
    let row = y;
    const line = (k, v, st = 'text') => {
      if (!v) return;
      wrap(v, w - 9).forEach((part, i) => {
        if (i === 0) term.write(x, row, k, 'gray');
        term.write(x + 9, row++, part, st);
      });
      row++;
    };
    term.write(x, row++, fit(`PORT ${f.port} · ${f.name.toUpperCase()}`, w), 'strong');
    row++;
    line('risk', f.risk, RISK_STYLE[f.risk]);
    if (f.app) line('app', f.pid ? `${f.app} (pid ${f.pid})` : f.app);
    if (f.reach) line('reach', f.reach, f.reach === 'only this computer' ? 'gray' : 'text');
    line('what', f.what);
    line('why', f.why, 'muted');
    line('fix', f.fix);
  }

  function paintFooter() {
    const y = term.rows - 2;
    let keys;
    if (mode === 'devices') keys = '↑↓ select   enter quick check   f full check (all 65,535 ports)   esc back';
    else if (mode === 'detail') keys = 'esc / enter close';
    else if (check?.scanning) keys = 'esc stop';
    else keys = `↑↓ select   r check again   f full check   t devices   esc ${from === 'netmap' ? 'back to map' : 'back'}`;
    term.write(X, y, fit(keys, term.cols - X * 2), 'faint');
  }

  function draw() {
    if (!active) return;
    term.clear();
    paintHeader(term);
    term.cursor(null);
    term.write(X, 4, '$ ', 'gray');
    term.write(X + 2, 4, `${APP.command} portaudit${target && mode !== 'devices' ? ` ${target.ip}` : ''}`, 'text');
    if (mode === 'devices') {
      paintDevices();
    } else {
      term.write(X, 5, '[+] device  ', 'gray');
      const desc = [target.name, KIND_NAMES[target.kind] || target.kind, target.isSelf ? null : target.ip].filter(Boolean).join(' · ');
      term.write(X + 12, 5, fit(desc, term.cols - X * 2 - 12), 'text');
      paintStatus();
      paintVerdict();
      if (mode === 'detail') {
        paintPanel(findings[fIndex], X, 9, term.cols - X * 2);
      } else if (wide()) {
        const listW = term.cols - X * 2 - PANEL_W - 4;
        paintFindings(X, listW);
        if (!check.scanning || findings.length) paintPanel(findings[fIndex], term.cols - X - PANEL_W, 8, PANEL_W);
      } else {
        paintFindings(X, term.cols - X * 2);
      }
    }
    paintFooter();
    term.flush();
  }

  // ── flow ────────────────────────────────────────────────────────────────
  /** open({ from: 'menu' }) or open({ from: 'netmap', target: device, net }) */
  async function open(opts = {}) {
    active = true;
    from = opts.from || 'menu';
    if (opts.target) {
      const d = opts.target;
      await loadTargets(opts.net);
      target = targets.find((t) => t.ip === d.ip) || { ip: d.ip, name: nameOf(d), kind: d.kind, isSelf: d.isSelf, online: d.online };
      if (d.isSelf) target = targets[0];
      const prev = done.get(target.ip);
      if (prev) { check = prev.check; findings = prev.findings; mode = 'results'; draw(); }
      else runCheck(false);
      return;
    }
    mode = 'devices';
    draw();
    await loadTargets();
    if (active) draw();
  }

  function exit() {
    active = false;
    onExit(from);
  }

  function backToDevices() {
    mode = 'devices';
    tIndex = Math.max(0, targets.findIndex((t) => t.ip === target?.ip));
    loadTargets().then(() => { if (active) draw(); });
    draw();
  }

  function handleKey(e) {
    const k = e.key;
    if (mode === 'detail') {
      if (k === 'Escape' || k === 'Enter') { e.preventDefault(); mode = 'results'; draw(); }
      return;
    }
    if (mode === 'devices') {
      if (k === 'ArrowDown' || k === 'j') { e.preventDefault(); tIndex = (tIndex + 1) % targets.length; draw(); }
      else if (k === 'ArrowUp' || k === 'k') { e.preventDefault(); tIndex = (tIndex - 1 + targets.length) % targets.length; draw(); }
      else if (k === 'Enter') { e.preventDefault(); pickTarget(tIndex, false); }
      else if (k === 'f' || k === 'F') { e.preventDefault(); pickTarget(tIndex, true); }
      else if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); exit(); }
      return;
    }
    // results
    if (check?.scanning) {
      if (k === 'Escape') { e.preventDefault(); api.cancel(); }
      return;
    }
    const n = findings.length;
    if ((k === 'ArrowDown' || k === 'j') && n) { e.preventDefault(); fIndex = (fIndex + 1) % n; draw(); }
    else if ((k === 'ArrowUp' || k === 'k') && n) { e.preventDefault(); fIndex = (fIndex - 1 + n) % n; draw(); }
    else if (k === 'r' || k === 'R') { e.preventDefault(); runCheck(check?.full || false); }
    else if (k === 'f' || k === 'F') { e.preventDefault(); runCheck(true); }
    else if (k === 't' || k === 'T') { e.preventDefault(); backToDevices(); }
    else if (k === 'Enter' && !wide() && n) { e.preventDefault(); mode = 'detail'; draw(); }
    else if (k === 'Escape' || k === 'Backspace') {
      e.preventDefault();
      if (from === 'netmap') exit();
      else backToDevices();
    }
  }

  term.onWheel?.((dir) => {
    if (!active) return;
    if (mode === 'devices' && targets.length) {
      const to = Math.max(0, Math.min(targets.length - 1, tIndex + dir));
      if (to !== tIndex) { tIndex = to; draw(); }
    } else if (mode === 'results' && findings.length) {
      const to = Math.max(0, Math.min(findings.length - 1, fIndex + dir));
      if (to !== fIndex) { fIndex = to; draw(); }
    }
  });

  return { open, draw, handleKey, get active() { return active; } };
}
