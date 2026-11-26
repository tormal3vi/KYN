// ─────────────────────────────────────────────────────────────────────────────
// The OPS catalogue: one op per situation. Each op is a list of steps; each
// step runs one check and answers with
//
//   { status, text, details?, fix?, stop? }
//     status  ok    fine
//             note  worth knowing, nothing to do
//             warn  something to fix
//             fail  something wrong right now
//             skip  couldn't check (with why)
//     fix     one plain-language fix, collected into the op's to-do list
//     stop    end the op here (a later step would make no sense)
//
// A step marked `key: true` is what the op is really about: if it couldn't
// run, the verdict is UNSURE rather than CLEAR.
//     goto    { key, label, module }: offer a jump to another module instead
//             of the op's own one (e.g. "confirm your network first")
//
// Steps get a `ctx`: ctx.onMac / ctx.os, ctx.memory (what this op remembered
// last run), ctx.remember(obj), ctx.progress(text) for long steps and
// ctx.cache (shared between the steps of one run).
//
// Adding an op = adding an entry here. The building blocks are the other
// modules' calls (Network Map, Port Audit, Traffic Monitor) plus ops/api.js.
// Every check looks at your own computer, its own traffic, or devices on the
// network you confirmed as yours in Network Map. Nothing targets anyone else.
// ─────────────────────────────────────────────────────────────────────────────

import * as netapi from '../netmap/api.js';
import { nameOf } from '../netmap/screen.js';
import { KIND_NAMES } from '../netmap/icons.js';
import * as portapi from '../portaudit/api.js';
import { QUICK_PORTS, explain } from '../portaudit/knowledge.js';
import * as trafficapi from '../traffic/api.js';
import { createModel, portInfo } from '../traffic/model.js';
import * as api from './api.js';

const ok = (text, extra = {}) => ({ status: 'ok', text, ...extra });
const note = (text, extra = {}) => ({ status: 'note', text, ...extra });
const warn = (text, extra = {}) => ({ status: 'warn', text, ...extra });
const fail = (text, extra = {}) => ({ status: 'fail', text, ...extra });
const skip = (text, extra = {}) => ({ status: 'skip', text, ...extra });

const TO_NETMAP = { key: 'm', label: 'open Network Map', module: 'netmap' };
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 1.5) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

// ── shared pieces ──────────────────────────────────────────────────────────
const once = (ctx, key, load) => (ctx.cache[key] ||= load());
const posture = (ctx) => once(ctx, 'posture', () => api.posture());
const local = (ctx) => once(ctx, 'local', () => portapi.local().catch(() => null));
const myNetwork = (ctx) => once(ctx, 'net', () => netapi.getNetwork().catch(() => null));

const SETTINGS = {
  firewall: {
    macos: 'System Settings → Network → Firewall → turn it on.',
    windows: 'Windows Security → Firewall & network protection → turn it on for every network.',
    other: 'Turn on the system firewall (for example ufw on Ubuntu).',
  },
  disk: {
    macos: 'System Settings → Privacy & Security → FileVault → Turn On. Keep the recovery key somewhere safe.',
    windows: 'Settings → Privacy & security → Device encryption (or search for BitLocker) → turn it on.',
  },
  stealth: { macos: 'System Settings → Network → Firewall → Options → turn on stealth mode.' },
  gatekeeper: { macos: 'System Settings → Privacy & Security → Allow applications from → "App Store & Known Developers".' },
  sip: { macos: 'Restart into Recovery (hold the power button), open Terminal there, run "csrutil enable", restart.' },
  updates: { macos: 'System Settings → General → Software Update → ⓘ next to Automatic updates → turn on "Install Security Responses and system files".' },
  antivirus: { windows: 'Windows Security → Virus & threat protection → Manage settings → turn on Real-time protection.' },
};
const how = (ctx, key) => SETTINGS[key][ctx.os] || SETTINGS[key].other || null;

// remote-access "doors" on this computer, and how to close each on a Mac / PC
const REMOTE = {
  22: ['Remote Login (SSH)', 'System Settings → General → Sharing → turn off Remote Login.'],
  3283: ['Remote Management', 'System Settings → General → Sharing → turn off Remote Management.'],
  5900: ['Screen Sharing', 'System Settings → General → Sharing → turn off Screen Sharing.'],
  445: ['File Sharing', 'System Settings → General → Sharing → turn off File Sharing (or limit it to people you trust).'],
  548: ['old Apple file sharing (AFP)', 'System Settings → General → Sharing → turn off File Sharing.'],
  3389: ['Remote Desktop', 'Settings → System → Remote Desktop → turn it off.'],
};

function firewallStep(ctx, p, onForeignNetwork) {
  if (p.firewall === true) return ok('on');
  if (p.firewall === false) {
    return warn(onForeignNetwork ? 'OFF: other people on this network can reach whatever this computer offers' : 'OFF: devices on your network can reach whatever this computer offers', { fix: `Turn on the firewall. ${how(ctx, 'firewall')}` });
  }
  return skip('KYN can\'t read the firewall setting on this system');
}

/** Steps shared by SAFEHOUSE and CHECKPOINT: are name lookups honest? */
async function dnsStep() {
  const d = await api.dns();
  if (!d.answered) return skip('couldn\'t look any name up (no internet yet?)');
  if (d.wrong.length) {
    return fail('the network gave FALSE answers for names that never change (DNS hijacking)', {
      details: d.wrong,
      fix: 'Don\'t log in to anything on this network. Disconnect, or use a VPN you trust, or set your DNS to 1.1.1.1.',
    });
  }
  if (d.madeUpAnswered) {
    return warn('the network invents answers for names that don\'t exist (ad redirection or worse)', {
      details: [`a made-up name pointed to ${d.madeUpAnswered}`],
      fix: 'Use a trusted DNS service (1.1.1.1 or 9.9.9.9) or a VPN on this network.',
    });
  }
  return ok(`honest: ${d.honest}/${d.answered} known names came back right, made-up names don't exist`);
}

// ── the ops ────────────────────────────────────────────────────────────────
export const OPS = [
  {
    id: 'safehouse',
    code: 'SAFEHOUSE',
    title: 'Is this Wi-Fi safe to use?',
    when: 'You just joined a café, hotel, airport, school or work network.',
    checks: 'That the network gives honest answers, that nobody is reading your encrypted traffic, and that nothing on this computer is open to strangers on it.',
    touches: 'Only this computer and its own traffic. It opens three well-known websites. It doesn\'t scan anyone else on the network.',
    takes: 'about 15 seconds',
    steps: [
      {
        id: 'network', label: 'network',
        async run(ctx) {
          const [n, mine] = await Promise.all([api.network(), myNetwork(ctx)]);
          ctx.cache.foreign = !mine?.approved;
          const where = [n.interface, n.kind !== 'Wi-Fi' && n.kind, n.gateway && `gateway ${n.gateway}`].filter(Boolean).join(' · ');
          if (!n.interface) return skip('no network connection');
          return mine?.approved
            ? ok(`${where} · your own network (confirmed in Network Map)`)
            : note(`${where} · not one of your networks: treat it as public`);
        },
      },
      {
        id: 'login', label: 'login page',
        async run() {
          const c = await api.captive();
          if (c.state === 'open') return ok('none: straight to the internet');
          if (c.state === 'portal') return note('a login page is in the way. Finish it in the browser, then run SAFEHOUSE again', { details: c.detail ? [`it points to ${c.detail}`] : [] });
          return skip('no internet answer at all');
        },
      },
      { id: 'dns', label: 'dns', run: dnsStep },
      {
        id: 'tls', label: 'encryption', key: true,
        async run(ctx) {
          const probes = await api.tls();
          const reached = probes.filter((p) => p.system !== 'error' || p.public !== 'error');
          if (!reached.length) return skip('couldn\'t reach the test sites');
          const network = reached.filter((p) => p.system === 'cert');
          const onThisMac = reached.filter((p) => p.system === 'ok' && p.public === 'cert');
          if (network.length) {
            return fail('someone on this network is intercepting encrypted (HTTPS) traffic', {
              details: network.map((p) => `${p.host}: its certificate was replaced`),
              fix: 'Disconnect from this network now and use mobile data. Don\'t type passwords here.',
            });
          }
          if (onThisMac.length) {
            return warn(`an extra certificate authority installed on this ${ctx.onMac ? 'Mac' : 'computer'} can read your encrypted traffic`, {
              details: [
                `${onThisMac.map((p) => p.host).join(', ')}: trusted by this computer, but not by Mozilla's public list.`,
                'Antivirus "web shields", work or school device management and some VPNs do this on purpose. Malware does it too.',
              ],
              fix: {
                macos: 'If you don\'t know why: check System Settings → General → Device Management for profiles, and Keychain Access → System for certificates you didn\'t add.',
                windows: 'If you don\'t know why: check your antivirus\'s HTTPS scanning, and certmgr.msc → Trusted Root Certification Authorities for certificates you didn\'t add.',
              }[ctx.os] || 'If you don\'t know why: check your proxy settings and the certificates your system trusts (for example /usr/local/share/ca-certificates).',
            });
          }
          return ok(`nobody is reading your HTTPS (${reached.length}/${probes.length} test sites checked)`);
        },
      },
      {
        id: 'vpn', label: 'vpn',
        async run(ctx) {
          const n = await api.network();
          if (n.vpn) return ok('on: the network only sees encrypted VPN traffic');
          if (n.vpn === false && ctx.cache.foreign) return note('off. Websites are still encrypted, but on public Wi-Fi a VPN also hides which sites you visit');
          if (n.vpn === false) return ok('off (fine on your own network)');
          return skip('couldn\'t tell');
        },
      },
      {
        id: 'firewall', label: 'firewall',
        async run(ctx) { return firewallStep(ctx, await posture(ctx), ctx.cache.foreign); },
      },
      {
        id: 'exposed', label: 'open to others',
        async run(ctx) {
          const l = await local(ctx);
          if (!l) return skip('couldn\'t list what this computer offers');
          const open = [...new Map(l.listeners.filter((x) => x.exposed).map((x) => [x.port, x])).values()];
          if (!open.length) return ok('nothing on this computer is waiting for connections from the network');
          const found = open.map((x) => ({ ...explain(x.port, { isSelf: true, onMac: ctx.onMac }), app: x.process }));
          const risky = found.filter((f) => f.risk === 'high' || f.risk === 'medium');
          const details = found.slice(0, 6).map((f) => `${f.port} ${f.name}${f.app ? ` (${f.app})` : ''} · ${f.risk}`);
          if (risky.length) {
            return warn(`${plural(risky.length, 'risky service')} can be reached by anyone on this network`, { details, fix: risky[0].fix });
          }
          return note(`${plural(found.length, 'service')} can be reached on this network, none of them risky`, { details });
        },
      },
    ],
  },

  {
    id: 'lockdown',
    code: 'LOCKDOWN',
    title: 'Is this computer locked down?',
    when: 'Once a month, after a big system update, or before you travel with your laptop.',
    checks: 'Disk encryption, firewall, app checks, system protection, automatic security fixes and remote-access doors.',
    touches: 'Only reads this computer\'s settings. Changes nothing.',
    takes: 'about 5 seconds',
    steps: [
      {
        id: 'system', label: 'system',
        async run(ctx) {
          const p = await posture(ctx);
          const name = { macos: 'macOS', windows: 'Windows', linux: 'Linux' }[p.os] || p.os;
          return note(`${name} ${p.osVersion || ''}`.trim() + '. Keep it on the newest version: most attacks use holes that are already fixed');
        },
      },
      {
        id: 'disk', label: 'disk lock', key: true,
        async run(ctx) {
          const p = await posture(ctx);
          const what = p.os === 'windows' ? 'BitLocker' : 'FileVault';
          if (p.diskEncryption === true) return ok(`${what} is on: a stolen laptop's files stay unreadable`);
          if (p.diskEncryption === false) return fail(`${what} is OFF: anyone who gets this laptop can read every file on it`, { fix: `Turn on disk encryption. ${how(ctx, 'disk')}` });
          return skip('KYN can\'t read the disk encryption setting on this system');
        },
      },
      { id: 'firewall', label: 'firewall', async run(ctx) { return firewallStep(ctx, await posture(ctx), false); } },
      {
        id: 'stealth', label: 'stealth',
        async run(ctx) {
          const p = await posture(ctx);
          if (p.stealth === true) return ok('on: this computer ignores probes from the network');
          if (p.stealth === false) return note('off: this computer answers pings and probes, so scanners can see it exists', { fix: how(ctx, 'stealth') && `Optional: turn on stealth mode. ${how(ctx, 'stealth')}` });
          return skip(ctx.onMac ? 'couldn\'t read it' : 'a macOS setting');
        },
      },
      {
        id: 'apps', label: 'app checks',
        async run(ctx) {
          const p = await posture(ctx);
          if (p.os === 'windows') {
            if (p.antivirus === true) return ok('Microsoft Defender real-time protection is on');
            if (p.antivirus === false) return warn('Microsoft Defender real-time protection is OFF', { fix: how(ctx, 'antivirus') });
            return skip('couldn\'t read Defender\'s status');
          }
          if (p.gatekeeper === true) return ok('Gatekeeper is on: apps are checked before they run');
          if (p.gatekeeper === false) return warn('Gatekeeper is OFF: any app from anywhere runs without a check', { fix: how(ctx, 'gatekeeper') });
          return skip(ctx.onMac ? 'couldn\'t read Gatekeeper' : 'not available on this system');
        },
      },
      {
        id: 'sip', label: 'system lock',
        async run(ctx) {
          const p = await posture(ctx);
          if (p.sip === true) return ok('System Integrity Protection is on: malware can\'t change macOS itself');
          if (p.sip === false) return warn('System Integrity Protection is OFF', { fix: how(ctx, 'sip') });
          return skip(ctx.onMac ? 'couldn\'t read it (custom configuration?)' : 'a macOS feature');
        },
      },
      {
        id: 'updates', label: 'auto fixes',
        async run(ctx) {
          const p = await posture(ctx);
          if (p.autoSecurityUpdates === true) return ok('security fixes install by themselves');
          if (p.autoSecurityUpdates === false) return warn('security fixes do NOT install by themselves', { fix: how(ctx, 'updates') });
          return skip(ctx.onMac ? 'couldn\'t read it' : 'check your system\'s update settings by hand');
        },
      },
      {
        id: 'doors', label: 'remote doors',
        async run(ctx) {
          const l = await local(ctx);
          if (!l) return skip('couldn\'t list what this computer offers');
          const doors = [...new Set(l.listeners.filter((x) => x.exposed && REMOTE[x.port]).map((x) => x.port))];
          if (!doors.length) return ok('no remote login, screen sharing or file sharing is open');
          return warn(`${plural(doors.length, 'remote-access door')} open: ${doors.map((p) => REMOTE[p][0]).join(', ')}`, {
            details: ['Fine if you use them on purpose. Otherwise each one is a way in.'],
            fix: doors.map((p) => (ctx.os === 'windows' && p !== 3389 ? `Turn off ${REMOTE[p][0]}.` : REMOTE[p][1])).join(' '),
          });
        },
      },
    ],
  },

  {
    id: 'headcount',
    code: 'HEADCOUNT',
    title: 'Who is on my Wi-Fi?',
    when: 'Your internet feels slow, you gave guests the password, or once a week.',
    checks: 'Every device on your home network, which ones are new since last time, and which ones you haven\'t marked as yours.',
    touches: 'Your own network, confirmed in Network Map. Same knock as a Network Map scan.',
    takes: 'about 30 seconds',
    goto: TO_NETMAP,
    steps: [
      {
        id: 'network', label: 'network',
        async run(ctx) {
          const net = await myNetwork(ctx);
          if (!net) return skip('no network found', { stop: true, fix: 'Connect to your home network, then run HEADCOUNT again.' });
          if (!net.approved) return skip('this network isn\'t confirmed as yours yet', { stop: true, goto: TO_NETMAP, fix: 'Press m to open Network Map and confirm the network is yours (y). Then run HEADCOUNT again.' });
          return ok(`${net.scanCidr} · ${net.interface}`);
        },
      },
      {
        id: 'sweep', label: 'sweep', key: true,
        async run(ctx) {
          const seen = new Map();
          const all = await netapi.scan({
            onProgress: (p) => ctx.progress(p.phase === 'sweep' ? `knocking on ${p.total} addresses · ${Math.round((p.done / Math.max(1, p.total)) * 100)}%` : `asking devices what they are · ${p.done}/${p.total}`),
            onDevice: (d) => { seen.set(d.id, d); ctx.progress(`${plural(seen.size, 'device')} found`); },
          });
          const online = (all || []).filter((d) => d.online);
          ctx.cache.devices = all || [];
          ctx.cache.online = online;
          return ok(`${plural(online.length, 'device')} online right now`);
        },
      },
      {
        id: 'new', label: 'newcomers',
        async run(ctx) {
          const online = ctx.cache.online;
          const before = new Set(ctx.memory?.seen || []);
          const since = ctx.memory?.at;
          ctx.remember({ seen: [...new Set([...before, ...ctx.cache.devices.map((d) => d.id)])], at: Date.now() });
          if (!since) return note(`first headcount: ${plural(online.length, 'device')} remembered for next time`);
          const fresh = online.filter((d) => !d.isSelf && !before.has(d.id));
          if (!fresh.length) return ok(`nobody new since the last headcount (${ago(since)})`);
          return warn(`${plural(fresh.length, 'device')} joined since the last headcount (${ago(since)})`, {
            details: fresh.map((d) => `${d.ip}  ${nameOf(d)} · ${KIND_NAMES[d.kind] || d.kind}${d.vendor ? ` · ${d.vendor}` : ''}`),
            fix: 'Check the new devices in Network Map (m). If one isn\'t yours or a guest\'s, change your Wi-Fi password.',
          });
        },
      },
      {
        id: 'unknown', label: 'not yours',
        async run(ctx) {
          const strangers = ctx.cache.online.filter((d) => !d.isSelf && !d.isGateway && !d.known);
          if (!strangers.length) return ok('every device online is one you marked as yours');
          return warn(`${plural(strangers.length, 'device')} you haven't marked as yours`, {
            details: strangers.slice(0, 8).map((d) => `${d.ip}  ${nameOf(d)} · ${KIND_NAMES[d.kind] || d.kind}${d.vendor ? ` · ${d.vendor}` : ''}`),
            fix: 'In Network Map, select each one and press k if it\'s yours. If you can\'t place one, change your Wi-Fi password and turn on WPA3 in the router.',
          });
        },
      },
    ],
  },

  {
    id: 'checkpoint',
    code: 'CHECKPOINT',
    title: 'Is my router OK?',
    when: 'You got a new router, changed its settings, or every few months.',
    checks: 'Which doors the router has open on your network, risky ones like Telnet and UPnP, whether its settings page is encrypted, and which DNS servers it hands out.',
    touches: 'Your router only (on the network you confirmed in Network Map).',
    takes: 'about 20 seconds',
    goto: { key: 'p', label: 'open Port Audit', module: 'portaudit' },
    steps: [
      {
        id: 'router', label: 'router',
        async run(ctx) {
          const net = await myNetwork(ctx);
          if (!net?.gatewayIp) return skip('no router found', { stop: true, fix: 'Connect to your home network, then run CHECKPOINT again.' });
          if (!net.approved) return skip('this network isn\'t confirmed as yours yet', { stop: true, goto: TO_NETMAP, fix: 'Press m to open Network Map and confirm the network is yours (y). Then run CHECKPOINT again.' });
          const known = (await netapi.remembered(net.id).catch(() => [])).find((d) => d.ip === net.gatewayIp);
          ctx.cache.router = net.gatewayIp;
          return ok([known ? nameOf(known) : null, known?.vendor, net.gatewayIp].filter(Boolean).join(' · '));
        },
      },
      {
        id: 'doors', label: 'open doors', key: true,
        async run(ctx) {
          const res = await portapi.scan(ctx.cache.router, QUICK_PORTS, {
            onProgress: (p) => ctx.progress(`knocking · ${p.done}/${p.total}`),
            onOpen: () => {},
          });
          const t = res.tally;
          if (t && !res.open.length && t.blocked >= (t.closed + t.silent + t.blocked) / 2) {
            return skip('this computer couldn\'t reach the router', { details: ctx.onMac ? ['macOS may be blocking KYN: System Settings → Privacy & Security → Local Network → KYN on.'] : [] });
          }
          ctx.cache.open = new Set(res.open);
          const found = res.open.map((p) => explain(p, { isSelf: false }));
          const high = found.filter((f) => f.risk === 'high');
          const medium = found.filter((f) => f.risk === 'medium');
          const details = found.map((f) => `${f.port} ${f.name} · ${f.risk}`);
          if (high.length) return fail(`${plural(high.length, 'high-risk door')} open: ${high.map((f) => f.name).join(', ')}`, { details, fix: high[0].fix });
          if (medium.length) return warn(`${plural(medium.length, 'door')} worth closing: ${medium.map((f) => f.name).join(', ')}`, { details, fix: medium[0].fix });
          return ok(`${plural(found.length, 'open door')}, none risky`, { details });
        },
      },
      {
        id: 'admin', label: 'settings page',
        async run(ctx) {
          const open = ctx.cache.open;
          if (!open) return skip('needs the door check');
          if (open.has(443)) return ok('offers an encrypted (https) settings page');
          if (open.has(80)) return note('settings page only without encryption (http): log in to it only from your own devices, at home', { fix: 'If the router offers it, switch its settings page to HTTPS. Use a long, unique admin password.' });
          return ok('no settings page open on the usual ports');
        },
      },
      {
        id: 'upnp', label: 'upnp',
        async run(ctx) {
          const open = ctx.cache.open;
          if (!open) return skip('needs the door check');
          if (open.has(1900) || open.has(5000)) {
            return warn('UPnP looks on: any app or gadget on your network can open doors in the router to the internet without asking', {
              fix: 'In the router\'s settings, turn off UPnP (only consoles and some games need it).',
            });
          }
          return ok('UPnP looks off');
        },
      },
      {
        id: 'dnsservers', label: 'dns servers',
        async run(ctx) {
          const n = await api.network();
          const servers = n.dnsServers || [];
          if (!servers.length) return skip('couldn\'t read which DNS servers are in use');
          const PUBLIC = { '1.1.1.1': 'Cloudflare', '1.0.0.1': 'Cloudflare', '8.8.8.8': 'Google', '8.8.4.4': 'Google', '9.9.9.9': 'Quad9', '149.112.112.112': 'Quad9', '208.67.222.222': 'Cisco OpenDNS', '208.67.220.220': 'Cisco OpenDNS', '94.140.14.14': 'AdGuard', '94.140.15.15': 'AdGuard' };
          const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|fe80:|fd|::1)/i.test(ip);
          const unknown = servers.filter((s) => s !== ctx.cache.router && !PUBLIC[s] && !isPrivate(s));
          let owners = [];
          if (unknown.length) owners = await trafficapi.lookup(unknown).catch(() => []);
          const label = (s) => (s === ctx.cache.router ? `${s} (your router)` : PUBLIC[s] ? `${s} (${PUBLIC[s]})` : isPrivate(s) ? `${s} (a device on your network)` : `${s} (${owners.find((o) => o.ip === s)?.org || 'owner unknown'})`);
          const details = servers.map(label);
          if (unknown.length) return note('a DNS server KYN doesn\'t know by name: usually your internet provider\'s. If you don\'t recognise the owner, check the router\'s DNS setting', { details });
          return ok('the usual: your router or a well-known public service', { details });
        },
      },
      { id: 'dns', label: 'dns answers', run: dnsStep },
    ],
  },

  {
    id: 'blacklist',
    code: 'BLACKLIST',
    title: 'Any app talking to bad servers?',
    when: 'Something feels off, you installed something sketchy, or once a week.',
    checks: 'Every server the apps on this computer are connected to, against three public threat lists that security teams use (botnet control servers, criminal networks, attacking machines). Plus apps online for the first time, and unencrypted connections.',
    touches: 'This computer\'s own connection list. The threat lists are downloaded (at most every 12 h) and matched on this computer; your addresses are never sent anywhere.',
    takes: 'about 10 seconds',
    goto: { key: 't', label: 'open Traffic Monitor', module: 'traffic' },
    steps: [
      {
        id: 'connections', label: 'connections',
        async run(ctx) {
          const model = createModel();
          const data = model.update(await trafficapi.snapshot());
          ctx.cache.apps = data.apps;
          const servers = data.apps.flatMap((a) => a.servers.map((s) => ({ ...s, app: a.name })));
          ctx.cache.servers = servers;
          return ok(`${plural(data.apps.length, 'app')} online · ${plural(servers.length, 'server')}`);
        },
      },
      {
        id: 'threats', label: 'threat lists', key: true,
        async run(ctx) {
          const ips = [...new Set(ctx.cache.servers.map((s) => s.ip))];
          const r = await api.threats(ips);
          const entries = r.lists.reduce((n, l) => n + l.entries, 0);
          const broken = r.lists.filter((l) => l.error && !l.entries);
          if (!entries) return skip('couldn\'t download any threat list', { details: broken.map((l) => `${l.name}: ${l.error}`) });
          if (r.hits.length) {
            const appsOf = (ip) => [...new Set(ctx.cache.servers.filter((s) => s.ip === ip).map((s) => s.app))].join(', ');
            return fail(`${plural(r.hits.length, 'connection')} to KNOWN-BAD servers`, {
              details: r.hits.map((h) => `${appsOf(h.ip)} → ${h.ip}: ${h.what} (${h.list})`),
              fix: 'Quit that app and uninstall it if you don\'t trust it. Then run a malware scanner (for example Malwarebytes) and change passwords you used on this computer recently.',
            });
          }
          const newest = Math.max(...r.lists.map((l) => l.updatedAt || 0));
          return ok(`none of ${plural(r.checked, 'server')} are on the lists (${entries.toLocaleString('en')} bad addresses, updated ${newest ? ago(newest) : 'now'})`, {
            details: broken.map((l) => `${l.name} couldn't be updated: ${l.error}`),
          });
        },
      },
      {
        id: 'newapps', label: 'new apps',
        async run(ctx) {
          const names = ctx.cache.apps.map((a) => a.name);
          const before = new Set(ctx.memory?.apps || []);
          const since = ctx.memory?.at;
          ctx.remember({ apps: [...new Set([...before, ...names])], at: Date.now() });
          if (!since) return note(`first check: ${plural(names.length, 'app')} remembered for next time`);
          const fresh = names.filter((n) => !before.has(n));
          if (!fresh.length) return ok(`no app went online for the first time since ${ago(since)}`);
          return note(`${plural(fresh.length, 'app')} went online for the first time since ${ago(since)}`, { details: fresh.slice(0, 8) });
        },
      },
      {
        id: 'plain', label: 'unencrypted',
        async run(ctx) {
          const plain = ctx.cache.servers.filter((s) => portInfo(s.port, s.proto).plain);
          if (!plain.length) return ok('every connection is encrypted');
          return warn(`${plural(plain.length, 'connection')} NOT encrypted: anyone along the way could read them`, {
            details: plain.slice(0, 6).map((s) => `${s.app} → ${s.ip}:${s.port} (${portInfo(s.port, s.proto).short})`),
            fix: 'Fine for public downloads. If the app sends logins or personal data this way, stop using it on public Wi-Fi.',
          });
        },
      },
    ],
  },
];
