// ─────────────────────────────────────────────────────────────────────────────
// OPS ↔ Rust bridge (src-tauri/src/ops/). In a plain browser there is no
// Rust, so a believable DEMO Mac answers instead (labelled as demo data).
// ─────────────────────────────────────────────────────────────────────────────

const tauri = window.__TAURI__;
export const isDemo = !tauri?.core?.invoke;
const invoke = (cmd, args) => tauri.core.invoke(cmd, args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Built-in protections: { os, osVersion, firewall, stealth, diskEncryption, gatekeeper, sip, autoSecurityUpdates, antivirus } (null = couldn't tell) */
export async function posture() {
  if (isDemo) { await sleep(500); return DEMO.posture; }
  return invoke('ops_posture');
}

/** The network in use: { interface, kind, vpn, gateway, dnsServers } */
export async function network() {
  if (isDemo) return DEMO.network;
  return invoke('ops_network');
}

/** { state: 'open' | 'portal' | 'offline', detail } */
export async function captive() {
  if (isDemo) { await sleep(400); return { state: 'open', detail: null }; }
  return invoke('ops_captive');
}

/** { answered, honest, wrong: ['name → address'], madeUpAnswered } */
export async function dns() {
  if (isDemo) { await sleep(700); return { answered: 3, honest: 3, wrong: [], madeUpAnswered: null }; }
  return invoke('ops_dns');
}

/** [{ host, system: 'ok'|'cert'|'error', public: same, detail }] */
export async function tls() {
  if (isDemo) {
    await sleep(900);
    return ['github.com', 'www.apple.com', 'www.wikipedia.org'].map((host) => ({ host, system: 'ok', public: 'ok', detail: null }));
  }
  return invoke('ops_tls');
}

/** { lists: [{ name, entries, updatedAt, error }], checked, hits: [{ ip, list, what }] } */
export async function threats(ips) {
  if (isDemo) {
    await sleep(800);
    const bad = ips.filter((ip) => ip === '203.0.113.66');
    return {
      checked: ips.filter((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)).length,
      lists: [
        { name: 'abuse.ch Feodo Tracker', entries: 512, updatedAt: Date.now() - 2 * 3600e3, error: null },
        { name: 'Spamhaus DROP', entries: 1398, updatedAt: Date.now() - 2 * 3600e3, error: null },
        { name: 'Emerging Threats', entries: 1702, updatedAt: Date.now() - 2 * 3600e3, error: null },
      ],
      hits: bad.map((ip) => ({ ip, list: 'abuse.ch Feodo Tracker', what: 'a control server for botnet / banking-trojan malware' })),
    };
  }
  return invoke('ops_threats', { ips });
}

let demoHistory = {};

/** Past runs and what each op remembered: { runs: { op: [...] }, memory: { op: {...} } } */
export async function loadHistory() {
  if (isDemo) return demoHistory;
  return invoke('ops_history_load');
}

export async function saveHistory(data) {
  if (isDemo) { demoHistory = data; return; }
  return invoke('ops_history_save', { data });
}

const DEMO = {
  posture: {
    os: 'macos', osVersion: '15.5', firewall: false, stealth: false, diskEncryption: true,
    gatekeeper: true, sip: true, autoSecurityUpdates: true, antivirus: null,
  },
  network: { interface: 'Wi-Fi (en0)', kind: 'Wi-Fi', vpn: false, gateway: '192.168.1.1', dnsServers: ['192.168.1.1'] },
};
