// ─────────────────────────────────────────────────────────────────────────────
// Port Audit ↔ Rust bridge (src-tauri/src/portaudit/).
// In a plain browser there is no Rust, so believable DEMO results are played
// instead (the screen labels them as demo data).
// ─────────────────────────────────────────────────────────────────────────────

const tauri = window.__TAURI__;
export const isDemo = !tauri?.core?.invoke;

/**
 * Knock on `ports` (or all 65,535 when ports is null) of `ip`.
 * onProgress({done, total, open}) and onOpen(port) stream in.
 * Resolves to { ip, open: [ports], scanned, millis, cancelled }.
 */
export async function scan(ip, ports, { onProgress, onOpen }) {
  if (isDemo) return demoScan(ip, ports, onProgress, onOpen);
  const offs = await Promise.all([
    tauri.event.listen('portaudit:progress', (e) => onProgress(e.payload)),
    tauri.event.listen('portaudit:open', (e) => onOpen(e.payload)),
  ]);
  try {
    return await tauri.core.invoke('portaudit_scan', { ip, ports });
  } finally {
    offs.forEach((off) => off());
  }
}

export async function cancel() {
  if (isDemo) { demoCancel = true; return; }
  return tauri.core.invoke('portaudit_cancel');
}

/** This computer: { listeners: [{port, address, exposed, process, pid}], firewall, os } */
export async function local() {
  if (isDemo) return DEMO_LOCAL;
  return tauri.core.invoke('portaudit_local');
}

// ── demo data ──────────────────────────────────────────────────────────────
const DEMO_OPEN = {
  '192.168.1.1': [23, 53, 80, 443, 1900, 7547],
  '192.168.1.20': [5000, 7000, 49152],
  '192.168.1.23': [62078],
  '192.168.1.31': [7000, 7100, 49152],
  '192.168.1.42': [80, 443, 631, 9100],
  '192.168.1.50': [80, 443],
  '192.168.1.61': [80, 1883],
  '192.168.1.77': [1400, 1443],
  '192.168.1.88': [],
  '192.168.1.104': [80, 554, 8554, 2323],
  '192.168.1.110': [22, 53, 80, 443],
};
const DEMO_LOCAL = {
  os: 'macos',
  firewall: false,
  listeners: [
    { port: 5000, address: '*', exposed: true, process: 'ControlCenter', pid: 512 },
    { port: 7000, address: '*', exposed: true, process: 'ControlCenter', pid: 512 },
    { port: 49152, address: '*', exposed: true, process: 'rapportd', pid: 431 },
    { port: 5173, address: '127.0.0.1', exposed: false, process: 'node', pid: 9120 },
    { port: 6379, address: '127.0.0.1', exposed: false, process: 'redis-server', pid: 700 },
    { port: 3306, address: '*', exposed: true, process: 'mysqld', pid: 702 },
  ],
};

let demoCancel = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function demoScan(ip, ports, onProgress, onOpen) {
  demoCancel = false;
  const list = ports || Array.from({ length: 65535 }, (_, i) => i + 1);
  const open = (DEMO_OPEN[ip] || [80]).filter((p) => list.includes(p));
  const steps = ports ? 12 : 40;
  const found = [];
  let done = 0;
  for (let s = 1; s <= steps; s++) {
    if (demoCancel) break;
    done = Math.round((s / steps) * list.length);
    for (const p of open) {
      if (!found.includes(p) && list.indexOf(p) < done) { found.push(p); onOpen(p); }
    }
    onProgress({ done, total: list.length, open: found.length });
    await sleep(ports ? 70 : 90);
  }
  return { ip, open: found.sort((a, b) => a - b), scanned: done, millis: ports ? 900 : 3600, cancelled: demoCancel };
}
