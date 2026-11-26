// ─────────────────────────────────────────────────────────────────────────────
// Traffic Monitor's numbers: turns raw snapshots from Rust into
//   apps         one row per app (helper processes folded into their app)
//   servers      per app: one row per server it talks to
//   speeds       from the difference between two snapshots
// plus plain-language names for apps and ports. No drawing here.
// ─────────────────────────────────────────────────────────────────────────────

// ── names ──────────────────────────────────────────────────────────────────
const APP_NAMES = [
  [/^com\.apple\.WebKit\.Networking$/, 'Safari & web views'],
  [/^com\.apple\.Safari/, 'Safari'],
  [/^apsd$/, 'Apple push notifications'],
  [/^mDNSResponder$/, 'macOS name lookups (DNS)'],
  [/^rapportd$/, 'Apple Handoff & AirDrop'],
  [/^sharingd$/, 'Apple Handoff & AirDrop'],
  [/^nsurlsessiond$/, 'macOS background downloads'],
  [/^(cloudd|bird)$/, 'iCloud Drive'],
  [/^softwareupdated$/, 'macOS Software Update'],
  [/^identityservicesd$/, 'iMessage & FaceTime'],
  [/^IMTransferAgent$/, 'iMessage attachments'],
  [/^trustd$/, 'macOS certificate checks'],
  [/^akd$/, 'Apple Account sign-in'],
  [/^parsecd$/, 'Spotlight suggestions'],
  [/^timed$/, 'macOS clock'],
  [/^steam_osx$/, 'Steam'],
  [/^(kyn|KYN)$/, 'KYN (this app)'],
  // "Google Chrome Helper (Renderer)" → "Google Chrome"
  [/^(.+?) Helper( \(.+\))?$/, '$1'],
];

/** A friendlier name for a process ("Google Chrome Helper" → "Google Chrome"). */
export function appName(raw) {
  const name = String(raw || '').trim() || 'unknown';
  for (const [re, nice] of APP_NAMES) if (re.test(name)) return name.replace(re, nice);
  return name;
}

// short label, what it is, and whether anyone on the way can read it
const PORTS = {
  21: ['ftp', 'file transfer, NOT encrypted', true],
  22: ['ssh', 'remote login, encrypted'],
  23: ['telnet', 'remote login, NOT encrypted', true],
  25: ['smtp', 'email between servers, often not encrypted', true],
  53: ['dns', 'name lookups (which address a website has); not encrypted'],
  80: ['http', 'web traffic, NOT encrypted', true],
  110: ['pop3', 'email, NOT encrypted', true],
  123: ['ntp', 'setting the clock'],
  143: ['imap', 'email, NOT encrypted', true],
  443: ['https', 'encrypted web traffic'],
  465: ['smtps', 'sending email, encrypted'],
  587: ['smtp', 'sending email (normally encrypted)'],
  853: ['dns-tls', 'encrypted name lookups'],
  993: ['imaps', 'email, encrypted'],
  995: ['pop3s', 'email, encrypted'],
  1194: ['openvpn', 'a VPN'],
  3478: ['stun', 'calls and video (WebRTC)'],
  4070: ['spotify', 'Spotify streaming, encrypted'],
  5223: ['apns', 'Apple push notifications, encrypted'],
  5228: ['gcm', 'Google push notifications, encrypted'],
  8080: ['http', 'web traffic, probably NOT encrypted', true],
  8443: ['https', 'encrypted web traffic'],
  51820: ['wireguard', 'a VPN'],
};

/** { short, about, plain } for a remote port. plain = not encrypted. */
export function portInfo(port, proto) {
  if (port === 443 && proto === 'udp') return { short: 'quic', about: 'encrypted web traffic (HTTP/3)', plain: false };
  const p = PORTS[port];
  if (p) return { short: p[0], about: p[1], plain: !!p[2] };
  if (port >= 3478 && port <= 3497) return { short: 'stun', about: 'calls and video (WebRTC)', plain: false };
  if (port >= 19302 && port <= 19309) return { short: 'stun', about: 'calls and video (Google Meet / WebRTC)', plain: false };
  if (port >= 27015 && port <= 27050) return { short: 'steam', about: 'Steam games and downloads', plain: false };
  if (port >= 49152) return { short: `${port}`, about: 'a high port: often voice chat, games or peer-to-peer', plain: false };
  return { short: `${port}`, about: 'a less common service', plain: false };
}

// ── numbers ────────────────────────────────────────────────────────────────
export function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1000) return `${Math.round(n)} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let v = n;
  let u = -1;
  while (v >= 1000 && u < units.length - 1) { v /= 1000; u++; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

export const fmtRate = (n) => (n == null ? '' : n < 50 ? '·' : `${fmtBytes(n)}/s`);

const isLoopback = (ip) => ip.startsWith('127.') || ip === '::1' || ip.startsWith('::ffff:127.');
const isNowhere = (ip) => !ip || ip === '*' || ip === '0.0.0.0' || ip === '::';

/** Keeps the previous snapshot so it can tell speeds. */
export function createModel() {
  let prev = null; // { at, pid: Map(pid → [in, out]), conn: Map(key → [in, out]) }

  return {
    reset() { prev = null; },

    /**
     * snapshot from Rust → { apps: [...], totals, hasUsage }
     *   app:    { name, procs: [{name, pid}], servers: [...], bytesIn, bytesOut, rateIn, rateOut }
     *   server: { ip, port, proto, count, bytesIn, bytesOut, rateIn, rateOut }
     */
    update(snap) {
      const usage = snap.usage || null;
      const dt = prev ? Math.max(0.2, (snap.at - prev.at) / 1000) : 0;
      const rate = (now, before) => (dt && before != null ? Math.max(0, (now - before) / dt) : null);

      const nameOfPid = new Map();
      for (const a of usage?.apps || []) nameOfPid.set(a.pid, a.app);
      for (const c of snap.conns) if (c.pid != null && c.app) nameOfPid.set(c.pid, c.app); // lsof's full names win

      // every open connection: the system list (lsof / netstat) + nettop's
      const conns = new Map();
      const key = (pid, proto, ip, port) => `${pid}|${proto}|${ip}|${port}`;
      for (const c of snap.conns) {
        if (isLoopback(c.remoteIp) || isNowhere(c.remoteIp)) continue;
        const k = key(c.pid, c.proto, c.remoteIp, c.remotePort);
        const e = conns.get(k) || { pid: c.pid, proto: c.proto, ip: c.remoteIp, port: c.remotePort, count: 0, bytesIn: null, bytesOut: null };
        e.count++;
        conns.set(k, e);
      }
      for (const c of usage?.conns || []) {
        if (isLoopback(c.remoteIp) || isNowhere(c.remoteIp)) continue;
        const k = key(c.pid, c.proto, c.remoteIp, c.remotePort);
        const e = conns.get(k) || { pid: c.pid, proto: c.proto, ip: c.remoteIp, port: c.remotePort, count: 1, bytesIn: null, bytesOut: null };
        e.bytesIn = (e.bytesIn || 0) + c.bytesIn;
        e.bytesOut = (e.bytesOut || 0) + c.bytesOut;
        conns.set(k, e);
      }

      const next = { at: snap.at, pid: new Map(), conn: new Map() };
      const apps = new Map();
      const appFor = (pid) => {
        const raw = nameOfPid.get(pid) || 'unknown';
        const name = appName(raw);
        let a = apps.get(name);
        if (!a) { a = { name, procs: [], servers: new Map(), bytesIn: null, bytesOut: null, rateIn: null, rateOut: null }; apps.set(name, a); }
        if (pid != null && !a.procs.some((p) => p.pid === pid)) a.procs.push({ name: raw, pid });
        return a;
      };
      const add = (x, k, v) => { if (v != null) x[k] = (x[k] || 0) + v; };

      for (const [k, c] of conns) {
        const a = appFor(c.pid);
        const sk = `${c.proto}|${c.ip}|${c.port}`;
        const s = a.servers.get(sk) || { ip: c.ip, port: c.port, proto: c.proto, count: 0, bytesIn: null, bytesOut: null, rateIn: null, rateOut: null };
        s.count += c.count;
        if (c.bytesIn != null) {
          next.conn.set(k, [c.bytesIn, c.bytesOut]);
          const before = prev?.conn.get(k);
          add(s, 'bytesIn', c.bytesIn);
          add(s, 'bytesOut', c.bytesOut);
          add(s, 'rateIn', rate(c.bytesIn, before?.[0]));
          add(s, 'rateOut', rate(c.bytesOut, before?.[1]));
        }
        a.servers.set(sk, s);
      }
      // app totals: everything each process used since it started
      for (const u of usage?.apps || []) {
        next.pid.set(u.pid, [u.bytesIn, u.bytesOut]);
        const before = prev?.pid.get(u.pid);
        const rIn = rate(u.bytesIn, before?.[0]);
        const rOut = rate(u.bytesOut, before?.[1]);
        // only apps that are online right now: open connections, or data moving
        if (!apps.has(appName(nameOfPid.get(u.pid))) && !((rIn || 0) + (rOut || 0) >= 50)) continue;
        const a = appFor(u.pid);
        add(a, 'bytesIn', u.bytesIn);
        add(a, 'bytesOut', u.bytesOut);
        add(a, 'rateIn', rIn);
        add(a, 'rateOut', rOut);
      }
      prev = next;

      const list = [...apps.values()].map((a) => ({
        ...a,
        servers: [...a.servers.values()].sort((x, y) => ((y.bytesIn || 0) + (y.bytesOut || 0)) - ((x.bytesIn || 0) + (x.bytesOut || 0)) || y.count - x.count),
      }));
      list.sort((x, y) => ((y.bytesIn || 0) + (y.bytesOut || 0)) - ((x.bytesIn || 0) + (x.bytesOut || 0))
        || y.servers.length - x.servers.length || x.name.localeCompare(y.name));
      const sum = (k) => list.reduce((n, a) => n + (a[k] || 0), 0);
      return {
        apps: list,
        hasUsage: !!usage,
        totals: { conns: list.reduce((n, a) => n + a.servers.reduce((m, s) => m + s.count, 0), 0), rateIn: usage && dt ? sum('rateIn') : null, rateOut: usage && dt ? sum('rateOut') : null },
        os: snap.os,
      };
    },
  };
}
