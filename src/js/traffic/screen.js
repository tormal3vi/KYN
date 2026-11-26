// ─────────────────────────────────────────────────────────────────────────────
// Traffic Monitor screen: which app on this computer talks to which server,
// how much data, and roughly where in the world that server is.
//
//   apps      every app that is online right now, with its data and the
//             countries it talks to; the map shows all its servers
//   servers   one app's servers; the map flies to the one you pick and stops
//             at what the location database knows (city / region / country)
//   detail    (narrow windows) one server with its map
//
// Keys (apps):    ↑↓ select · enter servers · d download places · space pause · esc back
// Keys (servers): ↑↓ select · esc back to apps (narrow: enter map)
//
// Only this computer's own connections, read from the system's own lists.
// Nothing is captured and no connection's contents are read.
// ─────────────────────────────────────────────────────────────────────────────

import { APP } from '../config.js';
import * as netapi from '../netmap/api.js';
import { nameOf } from '../netmap/screen.js';
import * as api from './api.js';
import { countryName } from './countries.js';
import { createModel, fmtBytes, fmtRate, portInfo } from './model.js';
import { createWorldMap } from './worldmap.js';

const X = 3;
const TOP = 8;
const POLL_MS = 2000;
const GEO_SIZE = '37 MB';

const fit = (s, w) => (w <= 0 ? '' : s.length <= w ? s : `${s.slice(0, Math.max(0, w - 1))}~`);
const pad = (s, w) => fit(s, w).padEnd(w);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

export function createTraffic(term, { paintHeader, onExit }) {
  let active = false;
  let session = 0;
  let mode = 'apps'; // apps | servers | detail
  let data = null;
  let error = null;
  let paused = false;
  let appKey = null;
  let aIndex = 0;
  let sIndex = 0;
  let geo = { status: null, progress: null, error: null };
  const places = new Map(); // ip → GeoInfo from Rust
  const asked = new Set();  // ips already looked up (without / with server names)
  const named = new Set();
  const devices = new Map(); // ip → name from Network Map ("Living Room", "router")
  const model = createModel();
  const map = createWorldMap();
  let mapOn = false;
  let looping = false;

  const apps = () => data?.apps || [];
  const app = () => apps()[aIndex] || null;
  const servers = () => app()?.servers || [];
  const server = () => servers()[sIndex] || null;
  const usageKnown = () => !!data?.hasUsage;

  // ── places ──────────────────────────────────────────────────────────────
  async function refreshGeoStatus() {
    try { geo.status = await api.geoStatus(); } catch (e) { geo.error = String(e?.message || e); }
  }

  async function resolvePlaces() {
    const ips = [...new Set(apps().flatMap((a) => a.servers.map((s) => s.ip)))];
    const fresh = ips.filter((ip) => !asked.has(ip));
    if (fresh.length) {
      fresh.forEach((ip) => asked.add(ip));
      try {
        (await api.lookup(fresh)).forEach((g) => places.set(g.ip, { ...places.get(g.ip), ...g, host: places.get(g.ip)?.host ?? null }));
        if (active) draw();
      } catch { fresh.forEach((ip) => asked.delete(ip)); }
    }
    // server names come from your normal DNS and can be slow: fetch them after
    const unnamed = ips.filter((ip) => !named.has(ip) && places.get(ip)?.scope === 'public');
    if (unnamed.length) {
      unnamed.forEach((ip) => named.add(ip));
      try {
        (await api.lookup(unnamed, { names: true })).forEach((g) => places.set(g.ip, g));
        if (active) draw();
      } catch { unnamed.forEach((ip) => named.delete(ip)); }
    }
  }

  async function download() {
    if (geo.status?.ready || geo.status?.downloading || geo.progress) return;
    geo.error = null;
    geo.progress = { part: 'city', done: 0, total: 0 };
    draw();
    try {
      geo.status = await api.geoDownload((p) => { geo.progress = p; if (active) paintGeoLine(6, true); });
      places.clear();
      asked.clear();
      named.clear();
    } catch (e) {
      geo.error = String(e?.message || e);
    }
    geo.progress = null;
    if (active) draw();
    resolvePlaces();
  }

  async function loadDevices() {
    try {
      const net = await netapi.getNetwork();
      if (net?.gatewayIp) devices.set(net.gatewayIp, 'your router');
      if (!net?.approved) return;
      for (const d of await netapi.remembered(net.id)) devices.set(d.ip, d.isGateway ? 'your router' : nameOf(d));
    } catch { /* no network info: local servers just show their address */ }
  }

  // ── live data ───────────────────────────────────────────────────────────
  async function poll(mine) {
    while (active && mine === session) {
      if (!paused) {
        try {
          const keep = app()?.name;
          data = model.update(await api.snapshot());
          error = null;
          if (keep) {
            const i = apps().findIndex((a) => a.name === keep);
            if (i >= 0) aIndex = i;
            else if (mode !== 'apps') { mode = 'apps'; aIndex = Math.min(aIndex, Math.max(0, apps().length - 1)); }
          }
          aIndex = Math.min(aIndex, Math.max(0, apps().length - 1));
          sIndex = Math.min(sIndex, Math.max(0, servers().length - 1));
          resolvePlaces();
        } catch (e) {
          error = String(e?.message || e);
        }
        if (active && mine === session) draw();
      }
      await sleep(POLL_MS);
    }
  }

  // ── words ───────────────────────────────────────────────────────────────
  /** "Frankfurt am Main, DE" / "United States" / "your network" / "?" */
  function whereShort(ip) {
    const g = places.get(ip);
    if (!g) return '';
    if (g.scope === 'local') return devices.has(ip) ? `your network · ${devices.get(ip)}` : 'your network';
    if (g.level === 'city') return `${g.city}, ${g.country}`;
    if (g.level === 'region') return `${g.region}, ${g.country}`;
    if (g.level === 'country') return countryName(g.country);
    return geo.status?.ready ? 'unknown' : '';
  }

  function placeLong(g) {
    if (g.level === 'city') return [g.city, g.region, countryName(g.country)].filter(Boolean).join(', ');
    if (g.level === 'region') return [g.region, countryName(g.country)].filter(Boolean).join(', ');
    if (g.level === 'country') return countryName(g.country);
    return 'unknown';
  }

  function accuracy(g) {
    if (g.level === 'city') return `city level: somewhere within about ${g.radiusKm || 50} km. An estimate from a database, not GPS.`;
    if (g.level === 'region') return `region level: somewhere within about ${g.radiusKm || 200} km. An estimate, not GPS.`;
    if (g.level === 'country') return 'country level: only the country is known. Big cloud and video providers often look like this.';
    return 'the database doesn\'t know where this address is (often a global network like Cloudflare\'s).';
  }

  const codeOf = (ip) => {
    const g = places.get(ip);
    if (!g) return null;
    if (g.scope === 'local') return 'LAN';
    return g.country || (geo.status?.ready ? '?' : null);
  };

  /** Countries an app talks to, most data first: [[code, bytes, servers]] */
  function countriesOf(a) {
    const by = new Map();
    for (const s of a.servers) {
      const c = codeOf(s.ip);
      if (!c) continue;
      const e = by.get(c) || [c, 0, 0];
      e[1] += (s.bytesIn || 0) + (s.bytesOut || 0);
      e[2]++;
      by.set(c, e);
    }
    return [...by.values()].sort((x, y) => y[1] - x[1] || y[2] - x[2]);
  }

  // ── layout ──────────────────────────────────────────────────────────────
  function layout() {
    const footer = term.rows - 2;
    const wide = term.cols >= 112;
    if (!wide) {
      const w = term.cols - X * 2;
      const mapH = Math.max(6, Math.min(Math.round(w / 3.3), footer - TOP - 14));
      return {
        wide,
        list: { x: X, y: TOP, w, h: footer - TOP - 1 },
        map: { x: X, y: TOP + 1, w, h: mapH },
        panel: { x: X, y: TOP + mapH + 2, w, h: footer - TOP - mapH - 3 },
      };
    }
    const mapW = Math.min(70, Math.floor((term.cols - X * 2) * 0.43));
    const mapX = term.cols - X - mapW;
    const mapH = Math.max(8, Math.min(Math.round(mapW / 3.3), footer - TOP - 14));
    return {
      wide,
      list: { x: X, y: TOP, w: mapX - X - 4, h: footer - TOP - 1 },
      map: { x: mapX, y: TOP + 1, w: mapW, h: mapH },
      panel: { x: mapX, y: TOP + mapH + 2, w: mapW, h: footer - TOP - mapH - 3 },
    };
  }

  // ── painting ────────────────────────────────────────────────────────────
  function paintSummary(y) {
    if (error && !data) { term.write(X, y, fit(`[!] ${error}`, term.cols - X * 2), 'red'); return; }
    let x = X;
    const put = (s, st) => { term.write(x, y, s, st); x += s.length; };
    put('[+] ', 'gray');
    if (!data) { put('reading this computer\'s connections...', 'gray'); return; }
    const n = apps().length;
    put(`this computer · ${n} app${n === 1 ? '' : 's'} online · ${data.totals.conns} connection${data.totals.conns === 1 ? '' : 's'}`, 'text');
    if (data.totals.rateIn != null) put(`   ↓ ${fmtRate(data.totals.rateIn)}  ↑ ${fmtRate(data.totals.rateOut)}`, 'muted');
    if (paused) put('   paused', 'strong');
    if (api.isDemo) put(' · demo data (browser preview)', 'faint');
  }

  function paintGeoLine(y, flush = false) {
    term.write(X, y, ' '.repeat(term.cols - X * 2), 'text');
    const label = '[+] places  ';
    const vx = X + label.length;
    const w = term.cols - X - vx;
    if (geo.progress) {
      const p = geo.progress;
      const share = p.part === 'city' ? 0 : 0.67; // the places file is about 2/3 of the download
      const part = p.total ? p.done / p.total : 0;
      const pct = Math.min(100, Math.round((share + part * (p.part === 'city' ? 0.67 : 0.33)) * 100));
      const cells = 20;
      const filled = Math.round((pct / 100) * cells);
      const text = 'downloading the location database  ';
      term.write(X, y, label, 'gray');
      term.write(vx, y, text, 'text');
      term.write(vx + text.length, y, '█'.repeat(filled), 'text');
      term.write(vx + text.length + filled, y, '░'.repeat(cells - filled), 'faint');
      term.write(vx + text.length + cells + 1, y, `${pct}%`, 'text');
    } else if (geo.error) {
      term.write(X, y, fit(`[!] places  ${geo.error} · d to try again`, term.cols - X * 2), 'red');
    } else if (!geo.status) {
      term.write(X, y, label, 'gray');
      term.write(vx, y, 'checking...', 'gray');
    } else if (!geo.status.ready) {
      term.write(X, y, '[~] places  ', 'strong');
      term.write(vx, y, fit(`press d to download the free location database (${GEO_SIZE}, one time). Lookups then run on this computer.`, w), 'text');
      term.addHit(X, y, term.cols - X * 2, 1, { click: download });
    } else {
      term.write(X, y, label, 'gray');
      const long = 'looked up on this computer · GeoLite2 data created by MaxMind (maxmind.com) · owners: RouteViews, DB-IP';
      term.write(vx, y, fit(long.length <= w ? long : 'offline · GeoLite2 data by MaxMind (maxmind.com)', w), 'gray');
    }
    if (flush) term.flush();
  }

  function selectRow(i, box, onClick) {
    return {
      hover: () => { if ((mode === 'apps' ? aIndex : sIndex) !== i) { if (mode === 'apps') { aIndex = i; sIndex = 0; } else sIndex = i; draw(); } },
      click: onClick,
    };
  }

  function paintApps(box) {
    const list = apps();
    if (!data) { term.write(box.x, box.y + 1, 'reading...', 'faint'); return; }
    if (!list.length) { term.write(box.x, box.y + 1, 'no app is connected to anything right now', 'gray'); return; }
    const rates = usageKnown();
    const nums = rates ? 32 : 4;
    const nameW = Math.max(12, Math.min(28, box.w - nums - 13));
    const cx = box.x + nameW + 1;
    const header = rates
      ? `${pad('app', nameW)} ${pad('#', 4)}${pad('↓ now', 10)}${pad('↑ now', 10)}${pad('total', 8)}countries`
      : `${pad('app', nameW)} ${pad('#', 4)}countries`;
    term.write(box.x, box.y, fit(header, box.w), 'faint');
    const visible = Math.max(1, box.h - 2);
    const first = Math.min(Math.max(0, aIndex - visible + 2), Math.max(0, list.length - visible));
    list.slice(first, first + visible).forEach((a, k) => {
      const i = first + k;
      const y = box.y + 1 + k;
      const sel = i === aIndex;
      if (sel) term.write(box.x - 2, y, '>', 'red');
      term.write(box.x, y, fit(a.name, nameW), sel ? 'strong' : 'text');
      let x = cx;
      term.write(x, y, String(a.servers.length), sel ? 'text' : 'gray');
      x += 4;
      if (rates) {
        term.write(x, y, fmtRate(a.rateIn), a.rateIn >= 50 ? 'text' : 'faint'); x += 10;
        term.write(x, y, fmtRate(a.rateOut), a.rateOut >= 50 ? 'text' : 'faint'); x += 10;
        term.write(x, y, fmtBytes((a.bytesIn || 0) + (a.bytesOut || 0)), 'gray'); x += 8;
      }
      const codes = countriesOf(a).map(([c]) => c).join(' ');
      term.write(x, y, fit(codes, box.x + box.w - x), sel ? 'text' : 'muted');
      term.addHit(box.x, y, box.w, 1, selectRow(i, box, () => { aIndex = i; openServers(); }));
    });
    if (list.length > visible) term.write(box.x, box.y + 1 + visible, `${list.length - visible} more · ↑↓ or scroll`, 'faint');
  }

  function paintServers(box) {
    const a = app();
    const list = servers();
    if (!a) return;
    const rates = usageKnown();
    const whereW = Math.max(14, Math.min(30, Math.floor(box.w * 0.4)));
    const portW = 9;
    const rateW = rates ? 12 : 0;
    const ownerW = Math.max(8, box.w - whereW - portW - rateW - 3);
    term.write(box.x, box.y, fit(`${pad('where', whereW)} ${pad('owner', ownerW)} ${pad('port', portW)}${rates ? '↓↑ now' : ''}`, box.w), 'faint');
    const visible = Math.max(1, box.h - 2);
    const first = Math.min(Math.max(0, sIndex - visible + 2), Math.max(0, list.length - visible));
    list.slice(first, first + visible).forEach((s, k) => {
      const i = first + k;
      const y = box.y + 1 + k;
      const sel = i === sIndex;
      const g = places.get(s.ip);
      const p = portInfo(s.port, s.proto);
      if (sel) term.write(box.x - 2, y, '>', 'red');
      term.write(box.x, y, fit(whereShort(s.ip) || s.ip, whereW), sel ? 'strong' : 'text');
      const owner = g?.scope === 'local' ? s.ip : g?.org || g?.host || s.ip;
      term.write(box.x + whereW + 1, y, fit(owner + (s.count > 1 ? ` ×${s.count}` : ''), ownerW), sel ? 'text' : 'muted');
      const px = box.x + whereW + ownerW + 2;
      if (p.plain) term.write(px - 1, y, '!', 'red');
      term.write(px, y, fit(p.short, portW - 1), p.plain ? 'red' : 'gray');
      if (rates) {
        const r = (s.rateIn || 0) + (s.rateOut || 0);
        term.write(px + portW, y, fit(s.rateIn == null ? '' : fmtRate(r), rateW), r >= 50 ? 'text' : 'faint');
      }
      term.addHit(box.x, y, box.w, 1, selectRow(i, box, () => { sIndex = i; if (!layout().wide) { mode = 'detail'; } draw(); }));
    });
    if (list.length > visible) term.write(box.x, box.y + 1 + visible, `${list.length - visible} more · ↑↓ or scroll`, 'faint');
  }

  /** Key/value lines with wrapping. Returns a writer. */
  function lines(box) {
    let row = box.y;
    const end = box.y + box.h;
    return {
      title(text) { if (row < end) term.write(box.x, row++, fit(text, box.w), 'strong'); },
      gap() { row++; },
      kv(k, v, st = 'text') {
        if (!v) return;
        wrap(v, box.w - 10).forEach((part, i) => {
          if (row >= end) return;
          if (i === 0 && k) term.write(box.x, row, k, 'gray');
          term.write(box.x + 10, row++, part, st);
        });
      },
      raw(x, text, st) { if (row < end) term.write(box.x + x, row, fit(text, box.w - x), st); },
      next() { row++; },
      get row() { return row; },
      get full() { return row >= end; },
    };
  }

  function paintAppPanel(box) {
    const a = app();
    if (!a) return;
    const out = lines(box);
    out.title(a.name.toUpperCase());
    out.gap();
    const procs = a.procs.slice(0, 3).map((p) => `${p.name} (pid ${p.pid})`).join(', ') + (a.procs.length > 3 ? ` +${a.procs.length - 3}` : '');
    out.kv('process', procs, 'muted');
    const n = a.servers.length;
    out.kv('servers', `${n} right now`);
    if (a.bytesIn != null) out.kv('data', `↓ ${fmtBytes(a.bytesIn)} in  ↑ ${fmtBytes(a.bytesOut)} out, since it started`);
    const plain = a.servers.filter((s) => portInfo(s.port, s.proto).plain);
    if (plain.length) out.kv('warning', `${plain.length} connection${plain.length === 1 ? ' is' : 's are'} NOT encrypted (see enter)`, 'red');
    const countries = countriesOf(a);
    if (countries.length && !out.full) {
      out.gap();
      out.raw(0, usageKnown() ? 'where its data goes (open connections)' : 'where its servers are', 'gray');
      out.next();
      const max = Math.max(1, ...countries.map((c) => c[1]));
      for (const [code, bytes, count] of countries) {
        if (out.full) break;
        const label = code === 'LAN' ? 'your network' : code === '?' ? 'unknown' : countryName(code);
        out.raw(2, pad(label, 18), 'text');
        if (usageKnown()) {
          const bar = Math.max(1, Math.round((bytes / max) * Math.max(4, box.w - 34)));
          out.raw(21, `${'█'.repeat(bar)} ${fmtBytes(bytes)}`, 'muted');
        } else {
          out.raw(21, `${count} server${count === 1 ? '' : 's'}`, 'muted');
        }
        out.next();
      }
    }
  }

  function paintServerPanel(box) {
    const s = server();
    if (!s) return;
    const g = places.get(s.ip) || { scope: 'public', level: 'unknown' };
    const p = portInfo(s.port, s.proto);
    const out = lines(box);
    out.title(`${s.ip} · ${s.proto} ${s.port}`);
    out.gap();
    if (g.scope === 'local') {
      out.kv('place', devices.has(s.ip) ? `your own network: ${devices.get(s.ip)}` : 'your own network (not the internet)');
    } else if (!geo.status?.ready) {
      out.kv('place', `not looked up yet: press d (esc first) to download the location database`, 'muted');
    } else {
      out.kv('place', placeLong(g));
      out.kv('accuracy', accuracy(g), 'muted');
      out.kv('owner', g.org ? `${g.org}${g.asn ? ` (AS${g.asn})` : ''}` : null);
    }
    out.kv('server', g.host, 'muted');
    out.kv('port', `${p.short}: ${p.about}`, p.plain ? 'red' : 'text');
    if (p.plain) out.kv('', 'Anyone along the way (a public Wi-Fi, your internet provider) could read or change this data. Fine for public pages, never for passwords.', 'muted');
    if (s.bytesIn != null) {
      const idle = (s.rateIn || 0) + (s.rateOut || 0) < 50;
      out.kv('data', `↓ ${fmtBytes(s.bytesIn)} in  ↑ ${fmtBytes(s.bytesOut)} out${s.rateIn == null ? '' : idle ? ' · idle now' : ` · now ↓ ${fmtRate(s.rateIn)} ↑ ${fmtRate(s.rateOut)}`}`);
    }
    if (s.count > 1) out.kv('sockets', `${s.count} connections to this server`, 'gray');
  }

  function placeMap(box) {
    // tiny corner marks around the map, like a viewfinder
    term.write(box.x - 1, box.y - 1, '┌', 'faint');
    term.write(box.x + box.w, box.y - 1, '┐', 'faint');
    term.write(box.x - 1, box.y + box.h, '└', 'faint');
    term.write(box.x + box.w, box.y + box.h, '┘', 'faint');
    const layer = term.image(box.x, box.y, box.w, box.h, box.w * 2, box.h * 4);
    map.attach(layer, (2 * term.cellW) / term.cellH);
    mapOn = true;
    if (map.error) term.write(box.x + 1, box.y + 1, fit(`[!] ${map.error}`, box.w - 2), 'red');
  }

  function aimMap() {
    if (mode === 'apps') {
      const a = app();
      map.overview((a?.servers || []).map((s) => places.get(s.ip)).filter((g) => g?.scope === 'public'));
    } else {
      const g = places.get(server()?.ip);
      map.focus(g?.scope === 'public' ? g : null);
    }
  }

  function mapCaption(box) {
    let text = 'where it goes';
    if (mode !== 'apps') {
      const s = server();
      const g = s && places.get(s.ip);
      if (g?.scope === 'local') text = 'your own network: no map needed';
      else if (g && g.level !== 'unknown') text = `${whereShort(s.ip)} · ${g.level} level${g.radiusKm ? `, ± ${g.radiusKm} km` : ''}`;
      else text = geo.status?.ready ? 'location unknown' : 'location not looked up yet';
    } else if (app()) {
      text = `${app().name}: where its servers are`;
    }
    term.write(box.x, box.y - 1, ' ', 'faint');
    term.write(box.x + 1, box.y - 1, fit(text, box.w - 2), 'gray');
  }

  function paintFooter() {
    const y = term.rows - 2;
    let keys;
    if (mode === 'detail') keys = 'esc back';
    else if (mode === 'servers') keys = `↑↓ select   ${layout().wide ? '' : 'enter map   '}esc back to apps`;
    else keys = `↑↓ select   enter servers   ${geo.status && !geo.status.ready && !geo.progress ? 'd download places   ' : ''}space ${paused ? 'resume' : 'pause'}   esc back`;
    term.write(X, y, fit(keys, term.cols - X * 2 - 26), 'faint');
    const note = 'places are estimates, not GPS';
    if (term.cols - X * 2 - keys.length > note.length + 4) term.write(term.cols - X - note.length, y, note, 'faint');
  }

  function draw() {
    if (!active) return;
    term.clear();
    paintHeader(term);
    term.cursor(null);
    mapOn = false;
    const a = app();
    term.write(X, 4, '$ ', 'gray');
    term.write(X + 2, 4, `${APP.command} traffic${mode !== 'apps' && a ? ` "${a.name}"` : ''}`, 'text');
    paintSummary(5);
    paintGeoLine(6);
    const L = layout();
    if (mode === 'detail') {
      placeMap(L.map);
      mapCaption(L.map);
      paintServerPanel(L.panel);
    } else {
      if (mode === 'apps') paintApps(L.list);
      else paintServers(L.list);
      if (L.wide) {
        placeMap(L.map);
        mapCaption(L.map);
        if (mode === 'apps') paintAppPanel(L.panel);
        else paintServerPanel(L.panel);
      }
    }
    paintFooter();
    term.flush();
    if (mapOn) {
      aimMap();
      map.render(performance.now());
      startLoop();
    }
  }

  // the map moves on its own (flights, the "ping"); ~30 frames a second
  function startLoop() {
    if (looping) return;
    looping = true;
    let last = 0;
    const tick = (now) => {
      if (!active || !mapOn) { looping = false; return; }
      if (now - last >= 33) {
        last = now;
        if (!map.render(now) && map.ready) { looping = false; return; }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ── flow ────────────────────────────────────────────────────────────────
  function openServers() {
    if (!app()) return;
    mode = 'servers';
    sIndex = 0;
    draw();
  }

  async function open() {
    active = true;
    const mine = ++session;
    mode = 'apps';
    model.reset();
    draw();
    await Promise.all([refreshGeoStatus(), loadDevices()]);
    if (active && mine === session) draw();
    poll(mine);
  }

  function exit() {
    active = false;
    session++;
    onExit();
  }

  function move(delta) {
    if (mode === 'apps' && apps().length) {
      aIndex = Math.max(0, Math.min(apps().length - 1, aIndex + delta));
      sIndex = 0;
    } else if (mode === 'servers' && servers().length) {
      sIndex = Math.max(0, Math.min(servers().length - 1, sIndex + delta));
    } else return;
    draw();
  }

  function handleKey(e) {
    const k = e.key;
    const take = () => e.preventDefault();
    if (mode === 'detail') {
      if (k === 'Escape' || k === 'Enter' || k === 'Backspace') { take(); mode = 'servers'; draw(); }
      return;
    }
    if (k === 'ArrowDown' || k === 'j') { take(); move(1); }
    else if (k === 'ArrowUp' || k === 'k') { take(); move(-1); }
    else if (k === 'Home') { take(); move(-1e6); }
    else if (k === 'End') { take(); move(1e6); }
    else if (k === ' ') { take(); paused = !paused; draw(); }
    else if (mode === 'apps') {
      if (k === 'Enter') { take(); openServers(); }
      else if (k === 'd' || k === 'D') { take(); download(); }
      else if (k === 'Escape' || k === 'Backspace') { take(); exit(); }
    } else if (mode === 'servers') {
      if (k === 'Enter' && !layout().wide && server()) { take(); mode = 'detail'; draw(); }
      else if (k === 'Escape' || k === 'Backspace') { take(); mode = 'apps'; draw(); }
    }
  }

  term.onWheel?.((dir) => { if (active) move(dir); });

  return { open, draw, handleKey, get active() { return active; } };
}
