// ─────────────────────────────────────────────────────────────────────────────
// Traffic Monitor ↔ Rust bridge (src-tauri/src/traffic/).
// In a plain browser there is no Rust, so a believable DEMO computer is played
// instead (the screen labels it as demo data). The demo's places and owners
// are real answers from the same database the app downloads.
// ─────────────────────────────────────────────────────────────────────────────

const tauri = window.__TAURI__;
export const isDemo = !tauri?.core?.invoke;
const invoke = (cmd, args) => tauri.core.invoke(cmd, args);

/**
 * This computer's connections right now:
 * { conns: [{app, pid, proto, remoteIp, remotePort}],
 *   usage: { apps: [{app, pid, bytesIn, bytesOut}], conns: [{pid, proto, remoteIp, remotePort, bytesIn, bytesOut}] } | null,
 *   at: ms, os }
 */
export async function snapshot() {
  if (isDemo) return demoSnapshot();
  return invoke('traffic_snapshot');
}

/** { ready, downloading, meta: { cityVersion, asnVersion, downloadedAt } | null } */
export async function geoStatus() {
  if (isDemo) return { ready: demo.geoReady, downloading: false, meta: demo.geoReady ? DEMO_META : null };
  return invoke('traffic_geo_status');
}

/** One-time download of the location database. onProgress({part, done, total}). */
export async function geoDownload(onProgress) {
  if (isDemo) return demoDownload(onProgress);
  const off = await tauri.event.listen('traffic:geo-progress', (e) => onProgress(e.payload));
  try {
    return await invoke('traffic_geo_download');
  } finally {
    off();
  }
}

/**
 * Place + owner (+ server name when names is true) for each address:
 * [{ ip, scope: 'public'|'local'|'invalid', level: 'city'|'region'|'country'|'unknown',
 *    lat, lon, radiusKm, city, region, country, org, asn, host }]
 */
export async function lookup(ips, { names = false } = {}) {
  if (isDemo) return ips.map((ip) => demoGeo(ip, names));
  return invoke('traffic_geo_lookup', { ips, names });
}

// ── demo: a Mac in Budapest with the usual apps open ───────────────────────
const DEMO_META = { cityVersion: '2.3.2026061719', asnVersion: '2.3.2026061719', downloadedAt: Date.now() };

// ip → [level, city, region, country, lat, lon, org, asn, host]
const PLACES = {
  '17.253.144.10': ['country', null, null, 'US', 37.751, -97.822, 'Apple Inc.', 714, 'usdal2-vip-bx-010.aaplimg.com'],
  '17.57.146.20': ['country', null, null, 'US', 37.751, -97.822, 'Apple Inc.', 714, null],
  '151.101.1.69': ['country', null, null, 'US', 37.751, -97.822, 'Fastly, Inc.', 54113, null],
  '140.82.121.4': ['city', 'Frankfurt am Main', 'Hesse', 'DE', 50.117, 8.684, 'GitHub, Inc.', 36459, 'lb-140-82-121-4-fra.github.com'],
  '212.58.244.20': ['country', null, null, 'GB', 51.496, -0.122, 'BBC', 2818, null],
  '35.186.224.25': ['city', 'Kansas City', 'Missouri', 'US', 39.103, -94.578, 'Google LLC', 15169, '25.224.186.35.bc.googleusercontent.com'],
  '104.199.65.124': ['country', null, null, 'US', 37.751, -97.822, 'Google LLC', 15169, '124.65.199.104.bc.googleusercontent.com'],
  '162.159.130.234': ['unknown', null, null, null, null, null, 'Cloudflare, Inc.', 13335, null],
  '66.22.196.20': ['city', 'Rotterdam', 'South Holland', 'NL', 51.928, 4.422, 'i3D.net B.V', 49544, null],
  '142.250.185.78': ['country', null, null, 'US', 37.751, -97.822, 'Google LLC', 15169, 'fra16s52-in-f14.1e100.net'],
  '157.240.30.35': ['city', 'Prague', 'Prague', 'CZ', 50.088, 14.412, 'Facebook, Inc.', 32934, 'edge-star-mini-shv-01-prg1.facebook.com'],
  '88.221.0.1': ['city', 'Sao Paulo', 'Sao Paulo', 'BR', -23.548, -46.636, 'Akamai International B.V.', 20940, null],
  '20.190.159.0': ['city', 'Dublin', 'Leinster', 'IE', 53.335, -6.252, 'Microsoft Corporation', 8075, null],
  '51.105.71.137': ['city', 'London', 'England', 'GB', 51.508, -0.128, 'Microsoft Corporation', 8075, null],
  '155.133.248.36': ['city', 'Amsterdam', 'North Holland', 'NL', 52.296, 4.955, 'Valve Corporation', 32590, null],
  '149.154.167.51': ['city', 'Amsterdam', 'North Holland', 'NL', 52.372, 4.888, 'Telegram Messenger Inc', 62041, null],
  '195.228.252.133': ['city', 'Telki', 'Pest County', 'HU', 47.551, 18.833, 'Magyar Telekom plc.', 5483, 'mail.t-online.hu'],
  '93.184.215.14': ['country', null, null, 'US', 37.751, -97.822, null, null, null],
};

// [app, pid, proto, ip, port, MB so far (in), MB so far (out), kB/s in, kB/s out]
const CONNS = [
  ['com.apple.WebKit.Networking', 880, 'tcp', '17.253.144.10', 443, 4.1, 0.3, 2, 0.4],
  ['com.apple.WebKit.Networking', 880, 'tcp', '151.101.1.69', 443, 12.6, 0.5, 30, 1],
  ['com.apple.WebKit.Networking', 880, 'tcp', '140.82.121.4', 443, 3.2, 0.9, 6, 2],
  ['com.apple.WebKit.Networking', 880, 'tcp', '212.58.244.20', 443, 21.0, 0.4, 140, 2],
  ['Spotify', 4567, 'tcp', '35.186.224.25', 443, 126.0, 7.1, 310, 5],
  ['Spotify', 4567, 'tcp', '104.199.65.124', 4070, 2.2, 0.8, 0.5, 0.2],
  ['Discord', 3120, 'tcp', '162.159.130.234', 443, 8.4, 1.1, 1, 0.5],
  ['Discord', 3120, 'udp', '66.22.196.20', 50003, 41.0, 39.0, 9, 8],
  ['Google Chrome Helper', 2210, 'udp', '142.250.185.78', 443, 233.0, 5.2, 900, 18],
  ['Google Chrome Helper', 2210, 'tcp', '157.240.30.35', 443, 18.0, 2.0, 4, 1],
  ['Google Chrome Helper', 2210, 'tcp', '88.221.0.1', 443, 1.1, 0.1, 0, 0],
  ['apsd', 120, 'tcp', '17.57.146.20', 5223, 0.2, 0.1, 0.05, 0.02],
  ['Microsoft Teams', 5020, 'tcp', '20.190.159.0', 443, 6.5, 2.0, 3, 1],
  ['Microsoft Teams', 5020, 'tcp', '51.105.71.137', 443, 3.8, 1.4, 0.4, 0.3],
  ['steam_osx', 6100, 'udp', '155.133.248.36', 27024, 54.0, 0.6, 0, 0],
  ['Telegram', 7001, 'tcp', '149.154.167.51', 443, 2.9, 0.4, 0.2, 0.1],
  ['Mail', 650, 'tcp', '195.228.252.133', 993, 9.4, 0.7, 0, 0],
  ['curl', 9001, 'tcp', '93.184.215.14', 80, 0.01, 0.001, 0, 0],
  ['mDNSResponder', 300, 'udp', '192.168.1.1', 53, 0.8, 0.3, 0.1, 0.1],
  ['rapportd', 431, 'tcp', '192.168.1.31', 49152, 0.1, 0.05, 0, 0],
];

const demo = { geoReady: false, started: Date.now() };

function demoSnapshot() {
  const t = (Date.now() - demo.started) / 1000;
  const wobble = (i) => 0.6 + 0.4 * Math.abs(Math.sin(t / 3 + i));
  const conns = CONNS.map(([app, pid, proto, ip, port]) => ({ app, pid, proto, remoteIp: ip, remotePort: port }));
  const usageConns = CONNS.map(([, pid, proto, ip, port, mbIn, mbOut, kIn, kOut], i) => ({
    pid, proto, remoteIp: ip, remotePort: port,
    bytesIn: Math.round(mbIn * 1e6 + kIn * 1e3 * t * wobble(i)),
    bytesOut: Math.round(mbOut * 1e6 + kOut * 1e3 * t * wobble(i)),
  }));
  const apps = new Map();
  CONNS.forEach(([app, pid], i) => {
    const a = apps.get(pid) || { app, pid, bytesIn: 0, bytesOut: 0 };
    a.bytesIn += usageConns[i].bytesIn;
    a.bytesOut += usageConns[i].bytesOut;
    apps.set(pid, a);
  });
  return { conns, usage: { apps: [...apps.values()], conns: usageConns }, at: Date.now(), os: 'macos' };
}

function demoGeo(ip, names) {
  if (/^(10|127|192\.168)\./.test(ip)) return { ip, scope: 'local', level: 'unknown' };
  const p = PLACES[ip];
  if (!p || !demo.geoReady) return { ip, scope: 'public', level: 'unknown', host: names ? p?.[8] || null : null };
  const [level, city, region, country, lat, lon, org, asn, host] = p;
  return {
    ip, scope: 'public', level, city, region, country, lat, lon, org, asn,
    radiusKm: level === 'city' ? 50 : level === 'region' ? 200 : null,
    host: names ? host : null,
  };
}

async function demoDownload(onProgress) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const [part, total] of [['city', 24779056], ['asn', 12021582]]) {
    for (let s = 1; s <= 10; s++) {
      onProgress({ part, done: Math.round((total * s) / 10), total });
      await sleep(90);
    }
  }
  demo.geoReady = true;
  return geoStatus();
}
