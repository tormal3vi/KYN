// ─────────────────────────────────────────────────────────────────────────────
// Network Map ↔ Rust bridge (src-tauri/src/netmap/).
//
// In the app, every call goes to Rust. In a plain browser (npm run preview,
// the online preview) there is no Rust, so a small DEMO network is played
// instead. The screen labels it as demo data.
// ─────────────────────────────────────────────────────────────────────────────

const tauri = window.__TAURI__;
export const isDemo = !tauri?.core?.invoke;

const invoke = (cmd, args) => tauri.core.invoke(cmd, args);

// ── demo data: a believable home network ───────────────────────────────────
const H = 3600;
const now = () => Math.floor(Date.now() / 1000);
const DEMO_NET = {
  id: 'demo', interface: 'Wi-Fi (en0)', ip: '192.168.1.20', prefix: 24,
  scanCidr: '192.168.1.0/24', hostCount: 254, capped: false,
  gatewayIp: '192.168.1.1', gatewayMac: 'a4:2b:b0:12:34:56', ownMac: 'f0:d1:a9:aa:bb:cc', approved: false,
};
const d = (ip, kind, o) => ({
  id: o.mac || `ip:${ip}`, ip, kind, mac: null, vendor: null, randomized: false, names: [], model: null,
  services: [], ports: [], reason: '', isGateway: false, isSelf: false, online: true, label: null,
  known: true, firstSeen: now() - 40 * 24 * H, lastSeen: now(), isNew: false, ...o,
});
const DEMO_DEVICES = [
  d('192.168.1.1', 'router', { mac: 'a4:2b:b0:12:34:56', vendor: 'TP-LINK TECHNOLOGIES', names: ['archer-ax55.lan'], ports: [80, 443], isGateway: true, reason: 'it is your default gateway' }),
  d('192.168.1.20', 'laptop', { mac: 'f0:d1:a9:aa:bb:cc', vendor: 'Apple', names: ['levente-mbp.local'], model: 'MacBookPro18,3', isSelf: true, reason: 'this is the computer running KYN' }),
  d('192.168.1.23', 'phone', { mac: '5a:11:22:33:44:55', randomized: true, names: ['Levente-iPhone.local'], ports: [62078], label: 'my iPhone', reason: 'its name "Levente-iPhone.local"' }),
  d('192.168.1.31', 'tv', { mac: '28:ec:95:10:20:30', vendor: 'Apple', names: ['Living Room', 'Living-Room.local'], model: 'AppleTV11,1', services: ['_airplay._tcp', '_raop._tcp'], ports: [7000], reason: 'announces model "AppleTV11,1"' }),
  d('192.168.1.42', 'printer', { mac: '7c:4d:8f:01:02:03', vendor: 'HP', names: ['HP OfficeJet 8020', 'HP8020.local'], services: ['_ipp._tcp'], ports: [80, 443, 631, 9100], reason: 'offers a printing service' }),
  d('192.168.1.50', 'smarthome', { mac: '00:17:88:aa:01:02', vendor: 'Philips Lighting', names: ['Philips Hue'], services: ['_hue._tcp', '_hap._tcp'], ports: [80, 443], reason: 'offers a smart-home service (HomeKit / Hue / Matter)' }),
  d('192.168.1.61', 'board', { mac: '24:a1:60:0a:0b:0c', vendor: 'Espressif', names: ['esp32-garage.local'], services: ['_esphomelib._tcp'], ports: [80], reason: 'announces itself as an ESPHome / Arduino board' }),
  d('192.168.1.77', 'speaker', { mac: '5c:aa:fd:33:44:55', vendor: 'Sonos', names: ['Kitchen'], services: ['_sonos._tcp', '_spotify-connect._tcp'], ports: [1400], reason: 'offers a speaker service' }),
  d('192.168.1.88', 'console', { mac: '00:d9:d1:66:77:88', vendor: 'Sony Interactive Entertainment', names: ['PS5-4F21'], reason: 'its name "PS5-4F21"' }),
  d('192.168.1.104', 'unknown', { mac: '64:90:c1:9a:8b:7c', vendor: 'Beijing Xiaomi Mobile Software', known: false, isNew: true, firstSeen: now(), reason: 'made by Beijing Xiaomi Mobile Software, but nothing more specific' }),
  d('192.168.1.110', 'board', { mac: 'dc:a6:32:11:22:33', vendor: 'Raspberry Pi Trading', names: ['pihole.lan'], ports: [22, 80], label: 'pi-hole', reason: 'made by Raspberry Pi Trading' }),
  d('192.168.1.36', 'tablet', { mac: 'b2:44:55:66:77:88', randomized: true, names: ['iPad.local'], online: false, lastSeen: now() - 2 * 24 * H, reason: 'remembered from an earlier scan' }),
];
const demoState = { approved: false, labels: {}, known: {} };
const withEdits = (dev) => ({
  ...dev,
  label: demoState.labels[dev.id] !== undefined ? demoState.labels[dev.id] : dev.label,
  known: demoState.known[dev.id] !== undefined ? demoState.known[dev.id] : dev.known,
});

// ── API ────────────────────────────────────────────────────────────────────
export async function getNetwork() {
  if (isDemo) return { ...DEMO_NET, approved: demoState.approved };
  return invoke('netmap_network');
}

export async function approve(id) {
  if (isDemo) { demoState.approved = true; return; }
  return invoke('netmap_approve', { id });
}

export async function remembered(network) {
  if (isDemo) return demoState.approved ? DEMO_DEVICES.map((x) => ({ ...withEdits(x), online: false })) : [];
  return invoke('netmap_devices', { network });
}

/** Run a scan. onProgress({phase, done, total}), onDevice(device) stream in. */
export async function scan({ onProgress, onDevice }) {
  if (isDemo) return demoScan(onProgress, onDevice);
  const offs = await Promise.all([
    tauri.event.listen('netmap:progress', (e) => onProgress(e.payload)),
    tauri.event.listen('netmap:device', (e) => onDevice(e.payload)),
  ]);
  try {
    return await invoke('netmap_scan');
  } finally {
    offs.forEach((off) => off());
  }
}

export async function setLabel(network, id, label) {
  if (isDemo) { demoState.labels[id] = label || null; return; }
  return invoke('netmap_set_label', { network, id, label: label || null });
}

export async function setKnown(network, id, known) {
  if (isDemo) { demoState.known[id] = known; return; }
  return invoke('netmap_set_known', { network, id, known });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function demoScan(onProgress, onDevice) {
  const total = 253;
  for (let done = 0; done <= total; done += 11) {
    onProgress({ phase: 'sweep', done: Math.min(done, total), total });
    await sleep(110);
  }
  const online = DEMO_DEVICES.filter((x) => x.online);
  for (let i = 0; i < online.length; i++) {
    onProgress({ phase: 'identify', done: i + 1, total: online.length });
    onDevice({ ...withEdits(online[i]), lastSeen: now() });
    await sleep(170 + Math.random() * 200);
  }
  return DEMO_DEVICES.map(withEdits);
}
