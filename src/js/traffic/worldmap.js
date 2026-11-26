// ─────────────────────────────────────────────────────────────────────────────
// The world map in Traffic Monitor.
//
// Country outlines (Natural Earth, src/data/) are drawn as dots on the fine
// image grid of the terminal. Showing a place flies from where the map is now
// down to it, and stops at what the location database actually knows:
//
//   city     a circle of about 50 km around the city: the database's guess,
//            not a street address. The map never zooms in closer than that.
//   region   a circle of about 200 km
//   country  the whole country lights up, with no point at all: the database
//            only knows "somewhere in this country"
//   unknown  the whole world
//
// Projection: Web Mercator (like most online maps), cut at 80°N / 58°S.
// Coordinates inside are "mercator units": x = longitude in radians,
// y = ln(tan(45° + latitude / 2)).
// ─────────────────────────────────────────────────────────────────────────────

import { NUMERIC, BY_NAME } from './countries.js';

const EARTH_KM = 6371;
const TOP_LAT = 80;
const BOTTOM_LAT = -58;
const TAU = Math.PI * 2;
const RADIUS = { city: 50, region: 200 }; // km, matches src-tauri/src/traffic/geo.rs
const PINGS = 3;
const PING_MS = 2600;

const rad = (deg) => (deg * Math.PI) / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + rad(Math.max(-85, Math.min(85, lat))) / 2));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// ── outlines ───────────────────────────────────────────────────────────────
let worldPromise = null;

/** Load and unpack the outlines once (about 750 kB). */
export function loadWorld() {
  worldPromise ||= fetch('data/countries-50m.json')
    .then((r) => { if (!r.ok) throw new Error(`map data: ${r.status}`); return r.json(); })
    .then(unpack)
    .catch((e) => { worldPromise = null; throw e; });
  return worldPromise;
}

// Simpler outlines for zoomed-out views: drawing a whole coastline point by
// point when one map cell covers 50 km of it is wasted work. Tolerances in
// mercator units (0.0012 ≈ 8 km at the equator).
const LOD_TOL = [0, 0.0012, 0.005, 0.02];

/** Drop points closer than `tol` to the last kept one. null if nothing is left. */
function simplify(pts, tol, closed) {
  if (!tol) return pts;
  const out = [pts[0], pts[1]];
  let lx = pts[0];
  let ly = pts[1];
  const t2 = tol * tol;
  for (let i = 2; i < pts.length - 2; i += 2) {
    const dx = pts[i] - lx;
    const dy = pts[i + 1] - ly;
    if (dx * dx + dy * dy >= t2) { out.push(pts[i], pts[i + 1]); lx = pts[i]; ly = pts[i + 1]; }
  }
  out.push(pts[pts.length - 2], pts[pts.length - 1]);
  if (closed && out.length < 8) return null; // an island smaller than one map cell
  return Float32Array.from(out);
}

/** The outline detail to use at `s` cells per mercator unit. */
function lodFor(s) {
  let level = 0;
  for (let i = 1; i < LOD_TOL.length; i++) if (LOD_TOL[i] <= 0.5 / s) level = i;
  return level;
}

/** TopoJSON → countries made of rings in mercator units, plus border lines. */
function unpack(topo) {
  const { scale: [kx, ky], translate: [tx, ty] } = topo.transform;
  const arcs = topo.arcs.map((arc) => {
    const out = new Float32Array(arc.length * 2);
    let x = 0;
    let y = 0;
    arc.forEach(([dx, dy], i) => {
      x += dx;
      y += dy;
      out[2 * i] = rad(x * kx + tx);
      out[2 * i + 1] = mercY(y * ky + ty);
    });
    return out;
  });
  const used = new Uint8Array(arcs.length);
  const ring = (ids) => {
    const parts = ids.map((i) => {
      const a = arcs[i < 0 ? ~i : i];
      used[i < 0 ? ~i : i]++;
      if (i >= 0) return a;
      const rev = new Float32Array(a.length);
      for (let p = 0; p < a.length; p += 2) { rev[p] = a[a.length - 2 - p]; rev[p + 1] = a[a.length - 1 - p]; }
      return rev;
    });
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const countries = topo.objects.countries.geometries.map((g) => {
    const shapes = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    const polys = shapes.map((rings) => {
      const rs = rings.map(ring);
      const lod = LOD_TOL.map((tol) => rs.map((r) => simplify(r, tol, true)).filter(Boolean));
      return { rings: rs, lod, box: bounds(rs[0]) };
    });
    return { id: g.id || null, name: g.properties?.name || '', polys, box: union(polys.map((p) => p.box)) };
  });
  // a line used by two countries is a border between them (the rest is coast)
  const borders = arcs.filter((_, i) => used[i] > 1)
    .map((a) => ({ lod: LOD_TOL.map((tol) => simplify(a, tol, false)), box: bounds(a) }));
  return { countries, borders };
}

function bounds(pts) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i]; const y = pts[i + 1];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

function union(boxes) {
  return boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])],
    [Infinity, Infinity, -Infinity, -Infinity]);
}

function inside(pts, x, y) {
  let hit = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i]; const yi = pts[i + 1]; const xj = pts[j]; const yj = pts[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function findCountry(world, code) {
  if (!world || !code) return null;
  const num = NUMERIC.get(code);
  const name = BY_NAME[code];
  return world.countries.find((c) => (num && c.id === num) || (name && c.name === name)) || null;
}

// ── the map ────────────────────────────────────────────────────────────────
const SEA = 0;
const LAND = 1;
const LIT = 2;    // the country being shown
const BORDER = 3;

export function createWorldMap() {
  let world = null;
  let failed = null;
  let lastFocus = null; // shown again once the outlines have loaded

  let layer = null;
  let box = null;            // { cols, rows, k }: fine grid size; k = cell width / cell height
  let spec = { kind: 'world' };
  let from = null;           // view at the start of the flight
  let to = null;             // view at the end
  let flightStart = 0;
  let flightMs = 0;
  let points = [];           // overview dots [{ x, y }] (city / region level)
  let lit = new Set();       // countries lit up as a whole (country level)
  let arrived = 0;           // when the flight ended (for the "ping")

  const cvs = document.createElement('canvas');
  const ctx = cvs.getContext('2d', { willReadFrequently: true });
  let cells = null;
  let cellsKey = '';

  // views: { cx, cy, s } = centre in mercator units + fine cells per unit
  function worldView() {
    const { cols, rows, k } = box;
    const top = mercY(TOP_LAT);
    const bottom = mercY(BOTTOM_LAT);
    const s = Math.min(cols / TAU, rows / ((top - bottom) * k)) * 0.98;
    return { cx: 0, cy: (top + bottom) / 2, s };
  }

  /** The closest the map may get: the circle of `km` around the place fills
   *  about 2/5 of the height, so the borders around it still show. */
  function circleView(x, y, lat, km) {
    const { cols, rows, k } = box;
    const r = km / EARTH_KM / Math.cos(rad(lat));
    return { cx: x, cy: y, s: Math.min(cols * 0.2, (rows * 0.2) / k) / r };
  }

  function targetView() {
    if (!box) return null;
    const w = worldView();
    if (spec.kind === 'circle') return circleView(spec.x, spec.y, spec.lat, spec.km);
    if (spec.kind === 'country' && spec.box) {
      const [x0, y0, x1, y1] = spec.box;
      const { cols, rows, k } = box;
      let s = Math.min(cols / ((x1 - x0) * 1.45), rows / ((y1 - y0) * k * 1.45));
      const close = circleView((x0 + x1) / 2, (y0 + y1) / 2, spec.lat, RADIUS.city).s;
      s = Math.max(w.s, Math.min(s, close));
      return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s };
    }
    return w;
  }

  function viewAt(now) {
    if (!from || !to) return to || targetView();
    const p = Math.min(1, (now - flightStart) / Math.max(1, flightMs));
    if (p >= 1) return to;
    const e = ease(p);
    // zoom out on the way when both ends are close-ups far apart
    const l0 = Math.log(from.s);
    const l1 = Math.log(to.s);
    const dist = Math.hypot(to.cx - from.cx, to.cy - from.cy);
    const both = Math.log(Math.min(box.cols, box.rows / box.k) / Math.max(1e-9, dist * 1.6));
    const bump = Math.max(0, (l0 + l1) / 2 - both);
    return {
      cx: from.cx + (to.cx - from.cx) * e,
      cy: from.cy + (to.cy - from.cy) * e,
      s: Math.exp(l0 + (l1 - l0) * e - bump * 4 * e * (1 - e)),
    };
  }

  function fly(now, instant) {
    const current = layer && box ? viewAt(now) : null;
    to = targetView();
    from = instant || !current ? to : current;
    flightStart = now;
    const ratio = from && to ? Math.abs(Math.log(to.s / from.s)) + Math.hypot(to.cx - from.cx, to.cy - from.cy) : 0;
    flightMs = Math.min(2600, 700 + ratio * 260);
    arrived = 0;
  }

  /** Paint land / sea / borders for a view into `cells` (one byte per fine cell). */
  function rasterize(v) {
    const { cols, rows, k } = box;
    const litKey = [...lit].map((c) => c.id || c.name).join(',');
    const key = `${cols}x${rows}:${v.cx.toFixed(5)},${v.cy.toFixed(5)},${v.s.toFixed(3)}:${spec.country?.id || ''}:${litKey}`;
    if (key === cellsKey && cells) return cells;
    if (cvs.width !== cols || cvs.height !== rows) { cvs.width = cols; cvs.height = rows; }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cols, rows);
    const half = { x: cols / 2 / v.s, y: rows / 2 / (v.s * k) };
    const view = [v.cx - half.x, v.cy - half.y, v.cx + half.x, v.cy + half.y];
    const overlaps = (b, dx) => b[2] + dx >= view[0] && b[0] + dx <= view[2] && b[3] >= view[1] && b[1] <= view[3];
    const shifts = [-TAU, 0, TAU].filter((dx) => view[0] < -Math.PI + dx + TAU && view[2] > -Math.PI + dx);
    const litSet = lit;
    const level = lodFor(v.s);
    const trace = (pts) => {
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    };
    for (const dx of shifts) {
      ctx.setTransform(v.s, 0, 0, -v.s * k, cols / 2 - (v.cx - dx) * v.s, rows / 2 + v.cy * v.s * k);
      for (const [style, lit] of [['#ff0000', false], ['#0000ff', true]]) {
        ctx.beginPath();
        for (const c of world.countries) {
          if ((c === spec.country || litSet.has(c)) !== lit || !overlaps(c.box, dx)) continue;
          for (const p of c.polys) if (overlaps(p.box, dx)) p.lod[level].forEach(trace);
        }
        ctx.fillStyle = style;
        ctx.fill('evenodd');
      }
      // borders only once zoomed in: from far away they would cover small countries
      if (v.s > worldView().s * 2.5) {
        ctx.beginPath();
        for (const b of world.borders) if (overlaps(b.box, dx)) trace(b.lod[level]);
        ctx.lineWidth = 1.3 / v.s;
        ctx.strokeStyle = '#00ff00';
        ctx.stroke();
      }
    }
    const px = ctx.getImageData(0, 0, cols, rows).data;
    cells = new Uint8Array(cols * rows);
    for (let i = 0; i < cells.length; i++) {
      const r = px[4 * i]; const g = px[4 * i + 1]; const b = px[4 * i + 2];
      cells[i] = g > 80 ? BORDER : b > 110 ? LIT : r > 110 ? LAND : SEA;
    }
    cellsKey = key;
    return cells;
  }

  function render(now) {
    if (!layer || !box) return false;
    const L = layer;
    L.clear();
    if (!world) { L.flush(); return !failed; }
    if (!to) fly(now, true);
    const v = viewAt(now);
    const moving = now - flightStart < flightMs;
    if (!moving && !arrived) arrived = now;
    const { cols, rows, k } = box;
    const grid = rasterize(v);
    const toCell = (x, y) => [(x - v.cx) * v.s + cols / 2, rows / 2 - (y - v.cy) * v.s * k];

    // where the circle is, in fine cells
    let circle = null;
    if (spec.kind === 'circle') {
      const [cx, cy] = toCell(spec.x, spec.y);
      const r = (spec.km / EARTH_KM / Math.cos(rad(spec.lat))) * v.s;
      circle = { cx, cy, r };
    }

    for (let i = 0; i < grid.length; i++) {
      const c = grid[i];
      const x = i % cols;
      const y = (i - x) / cols;
      let inCircle = false;
      if (circle) {
        const d = Math.hypot(x + 0.5 - circle.cx, (y + 0.5 - circle.cy) / k);
        inCircle = d <= circle.r;
        if (Math.abs(d - circle.r) < 0.55) { L.set(x, y, '+', moving ? 1 : 2); continue; }
      }
      if (c === LAND) L.set(x, y, '.', inCircle ? 3 : 1);
      else if (c === LIT) L.set(x, y, '.', spec.kind === 'circle' && !inCircle ? 2 : 3);
      else if (c === BORDER) L.set(x, y, '.', inCircle ? 1 : 0);
    }

    // overview: a bright dot per city-level server
    for (const p of points) {
      for (const dx of [-TAU, 0, TAU]) {
        const [px, py] = toCell(p.x + dx, p.y);
        if (px < 0 || py < 0 || px >= cols || py >= rows) continue;
        const cx = Math.floor(px);
        const cy = Math.floor(py);
        for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) L.set(cx + ox, cy + oy, 'M', ox || oy ? 3 : 4);
      }
    }

    // the place: a small red cross, and three pings once arrived (then the
    // map holds still, so it costs nothing while you read)
    const pinging = !!circle && !moving && arrived && now - arrived < PINGS * PING_MS;
    if (circle) {
      const mx = Math.floor(circle.cx);
      const my = Math.floor(circle.cy);
      if (pinging) {
        const p = ((now - arrived) % PING_MS) / 1600;
        if (p < 1) {
          const pr = p * circle.r;
          for (let a = 0; a < TAU; a += 0.6 / Math.max(1, pr)) {
            L.set(Math.floor(circle.cx + Math.cos(a) * pr), Math.floor(circle.cy + Math.sin(a) * pr * k), '.', 4);
          }
        }
      }
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) L.set(mx + dx, my + dy, 'M', 5);
    }
    L.flush();
    return moving || pinging;
  }

  loadWorld().then((w) => {
    world = w;
    if (lastFocus) api.focus(lastFocus, { instant: true });
  }).catch((e) => { failed = String(e?.message || e); });

  const api = {
    get ready() { return !!world; },
    get error() { return failed; },

    /** Put the map on a fine image layer (call after each term.clear()). */
    attach(newLayer, k) {
      const size = `${newLayer.cols}x${newLayer.rows}:${k}`;
      const resized = !box || `${box.cols}x${box.rows}:${box.k}` !== size;
      layer = newLayer;
      box = { cols: newLayer.cols, rows: newLayer.rows, k };
      if (resized) fly(performance.now(), true);
    },

    /** Fly to what the database knows about one address (a GeoInfo from Rust). */
    focus(geo, { instant = false } = {}) {
      lastFocus = geo;
      const country = findCountry(world, geo?.country);
      let next;
      if (geo?.lat != null && geo?.lon != null && (geo.level === 'city' || geo.level === 'region')) {
        // the country lights up a little too, so you can tell where you are when zoomed in
        next = { kind: 'circle', x: rad(geo.lon), y: mercY(geo.lat), lat: geo.lat, km: geo.radiusKm || RADIUS[geo.level], country };
      } else if (country) {
        // fit the part of the country the database's point is in (mainland US, not Alaska)
        const x = geo.lon != null ? rad(geo.lon) : null;
        const y = geo.lat != null ? mercY(geo.lat) : null;
        const part = (x != null && country.polys.find((p) => inside(p.rings[0], x, y)))
          || country.polys.reduce((a, b) => ((b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) > (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]) ? b : a));
        const lat = (Math.atan(Math.sinh((part.box[1] + part.box[3]) / 2)) * 180) / Math.PI;
        next = { kind: 'country', box: part.box, lat, country };
      } else {
        next = { kind: 'world' };
      }
      const same = JSON.stringify({ ...next, country: next.country?.id }) === JSON.stringify({ ...spec, country: spec.country?.id });
      spec = next;
      points = [];
      lit = new Set();
      if (!same) fly(performance.now(), instant);
    },

    /**
     * The whole world with every server of an app (GeoInfos from Rust):
     * city / region level as a bright dot, country level as the whole country.
     */
    overview(list, { instant = false } = {}) {
      lastFocus = null;
      const wasWorld = spec.kind === 'world';
      spec = { kind: 'world' };
      points = list.filter((g) => (g.level === 'city' || g.level === 'region') && g.lat != null && g.lon != null)
        .map((g) => ({ x: rad(g.lon), y: mercY(g.lat) }));
      lit = new Set(list.filter((g) => g.level === 'country').map((g) => findCountry(world, g.country)).filter(Boolean));
      if (!wasWorld) fly(performance.now(), instant);
    },

    /** Draw one frame. Returns true while something moves. */
    render,
  };
  return api;
}
