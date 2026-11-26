// ─────────────────────────────────────────────────────────────────────────────
// The startup, the idle loop and the exit, written as a terminal program.
//
// It only ever puts characters (or, for the fine logo, character-sized shapes)
// on a grid, so the same code runs in the app (term-web.js) and in a real
// terminal (npm run boot:cli).
//
// A "term" has:
//   term.cols, term.rows               grid size in characters
//   term.clear()                       blank the screen
//   term.write(x, y, text, style)      print text at column x, row y
//   term.cursor(x, y) / cursor(null)   show the red blinking "_" / hide it
//   term.flush()                       push changes to the screen
//   term.image?(x, y, w, h, cols, rows) optional: a finer grid laid over
//                                      w×h text cells (the app has it; a
//                                      terminal doesn't, so it gets the
//                                      text logo instead)
// ─────────────────────────────────────────────────────────────────────────────

import { APP, BOOT_LINES } from './config.js';
import { FINE, COARSE } from './logo.js';
import { NOISE_GLYPHS, decode, frame, now, pick, rand, scramble } from './fx.js';

export const logoFor = (term) => (term.image ? FINE : COARSE);

/** Smallest grids the splash is designed for, wide and tall. */
export function gridMinimums(logo) {
  const side = Math.max(`[ ${APP.name} ]`.length + 2, APP.tagline.length + 2);
  return [
    { cols: logo.w + side + 9, rows: BOOT_LINES.length + logo.h + 6 },
    { cols: logo.w + 6, rows: BOOT_LINES.length + logo.h + 13 },
  ];
}

/** Where everything goes for a given grid size. */
export function bootLayout(cols, rows, logo) {
  const word = `[ ${APP.name} ]`;
  const side = Math.max(word.length + 2, APP.tagline.length + 2);
  const bootH = BOOT_LINES.length;
  const boot = { x: 3, y: 1 };
  const hint = { x: 3, y: rows - 2 };

  // Wide: logo, with the name just right of its tip (like the artwork).
  if (cols >= logo.w + 1 + side + 6 && rows >= bootH + logo.h + 4) {
    const lx = Math.max(3, Math.floor((cols - (logo.w + 1 + side)) / 2));
    const ly = Math.max(bootH + 2, Math.floor((rows - logo.h) / 2));
    const wy = ly + logo.wordRow;
    return { boot, hint, logo: { x: lx, y: ly }, word: { x: lx + logo.w + 1, y: wy }, tag: { x: lx + logo.w + 3, y: wy + 1 } };
  }
  // Tall: logo centred, name centred underneath.
  if (cols >= logo.w + 4 && rows >= bootH + logo.h + 8) {
    const ly = bootH + 2 + Math.floor((rows - (bootH + logo.h + 8)) / 2);
    const wy = ly + logo.h + 1;
    return {
      boot, hint,
      logo: { x: Math.floor((cols - logo.w) / 2), y: ly },
      word: { x: Math.floor((cols - word.length - 2) / 2), y: wy },
      tag: { x: Math.floor((cols - APP.tagline.length) / 2), y: wy + 1 },
    };
  }
  // Too small for the logo: text only.
  return { boot, hint, logo: null, word: { x: 3, y: bootH + 2 }, tag: { x: 5, y: bootH + 3 } };
}

/** A grid to draw the logo on: the fine image layer, or plain text cells. */
function logoSurface(term, L, logo) {
  if (logo.kind === 'fine') return term.image(L.logo.x, L.logo.y, logo.w, logo.h, logo.cols, logo.rows);
  const state = new Map(); // only rewrite cells that changed
  return {
    cols: logo.cols,
    rows: logo.rows,
    set(c, r, g, t) {
      const key = r * logo.cols + c;
      const v = `${g}${t}`;
      if (state.get(key) === v) return;
      state.set(key, v);
      term.write(L.logo.x + c, L.logo.y + r, g === 'M' ? '#' : g, `logo-${t}`);
    },
    flush: () => term.flush(),
  };
}

/** Every lit cell of the logo, with a few facts the animations use. */
function logoCells(logo) {
  const faceX = logo.cols * 0.55;
  const cells = [];
  for (let r = 0; r < logo.rows; r++) {
    for (let c = 0; c < logo.cols; c++) {
      const v = logo.cell(c, r);
      if (!v) continue;
      const [g, t] = v;
      const e = logo.eyes;
      const eye = g === 'M' && r >= e.r0 && r <= e.r1 && c >= e.c0 && c <= e.c1;
      const streak = !eye && c < faceX && (g === '-' || g === '=' || t <= 1);
      cells.push({ c, r, g, t, eye, streak });
    }
  }
  return cells;
}

const show = (surface, cells) => { for (const k of cells) surface.set(k.c, k.r, k.g, k.t); };

/**
 * Play the startup. ctrl.fast = jump to the finished frame (any key, or
 * redrawing after a resize); ctrl.skip = same, and the caller goes straight
 * to the menu. Returns a "scene" that startIdle() and runExit() use.
 */
export async function runBoot(term, ctrl = {}, { hint = 'press any key' } = {}) {
  const wait = (ms) => (ctrl.fast || ctrl.skip ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
  const logo = logoFor(term);
  const L = bootLayout(term.cols, term.rows, logo);
  const fast = () => ctrl.fast || ctrl.skip;

  term.clear();
  term.cursor(L.boot.x, L.boot.y);
  term.flush();
  await wait(400);

  // 1. status lines decode in; finished lines dim; the last one flashes once
  for (let i = 0; i < BOOT_LINES.length; i++) {
    const line = BOOT_LINES[i];
    const last = i === BOOT_LINES.length - 1;
    const working = line.endsWith('...');
    const head = working ? line.slice(0, -3) : line;
    const y = L.boot.y + i;
    if (i > 0) term.write(L.boot.x, y - 1, `[+] ${BOOT_LINES[i - 1]}`, 'gray');
    term.write(L.boot.x, y, '[+] ', 'text');
    term.cursor(null);
    await decode(term, L.boot.x + 4, y, head, 'text', { ms: 220, ctrl: { get fast() { return fast(); } } });
    let x = L.boot.x + 4 + head.length;
    term.cursor(x, y);
    term.flush();
    if (working) {
      for (let d = 0; d < 3; d++) {
        await wait(120);
        term.write(x, y, '.', 'text');
        x += 1;
        term.cursor(x, y);
        term.flush();
      }
    }
    if (last && !fast()) {
      term.write(L.boot.x, y, `[+] ${line}`, 'inverse');
      term.flush();
      await wait(110);
      term.write(L.boot.x, y, `[+] ${line}`, 'text');
      term.flush();
    }
    await wait(last ? 260 : 120);
  }
  term.cursor(null);

  // 2. logo: the solid right side forms right-to-left, the streaks fly in from
  //    the left, and the eyes light up last
  let surface = null;
  let cells = [];
  if (L.logo) {
    surface = logoSurface(term, L, logo);
    cells = logoCells(logo);
    const faceX = logo.cols * 0.55;
    const rowDelay = Array.from({ length: logo.rows }, () => rand(0, 260));
    for (const k of cells) {
      if (k.eye) k.t0 = 1150 + rand(0, 140);
      else if (k.streak) k.t0 = 80 + (k.c / faceX) * 760 + rowDelay[k.r];
      else k.t0 = 160 + (1 - k.c / logo.cols) * 720 + rand(0, 160);
      k.dur = rand(70, 200);
    }
    const end = Math.max(...cells.map((k) => k.t0 + k.dur)) + 180;
    const start = now();
    while (!fast()) {
      const t = now() - start;
      if (t > end) break;
      for (const k of cells) {
        if (t < k.t0) surface.set(k.c, k.r, ' ', 0);
        else if (t < k.t0 + k.dur) surface.set(k.c, k.r, pick(NOISE_GLYPHS), Math.random() < 0.5 ? 4 : 3);
        else if (k.eye && t < k.t0 + k.dur + 160) surface.set(k.c, k.r, k.g, 4);
        else surface.set(k.c, k.r, k.g, k.t);
      }
      surface.flush();
      await frame();
    }
    show(surface, cells);
    surface.flush();

    // 3. one diagonal glint across the mask
    const gStart = now();
    while (!fast()) {
      const p = (now() - gStart) / 650;
      if (p > 1) break;
      const bx = -12 + p * (logo.cols + 24);
      for (const k of cells) {
        const d = Math.abs(k.c + k.r * 0.45 - bx - logo.rows * 0.2);
        surface.set(k.c, k.r, k.g, d < 1.5 ? 4 : d < 4 ? Math.min(4, k.t + 1) : k.t);
      }
      surface.flush();
      await frame();
    }
    show(surface, cells);
    surface.flush();
    await wait(150);
  }

  // 4. name decodes in, cursor appears, tagline types out
  const word = `[ ${APP.name} ]`;
  await decode(term, L.word.x, L.word.y, word, 'strong', { ms: 300, ctrl: { get fast() { return fast(); } } });
  term.cursor(L.word.x + word.length + 1, L.word.y);
  term.flush();
  await wait(350);
  for (let i = 1; i <= APP.tagline.length; i++) {
    if (fast()) break;
    term.write(L.tag.x, L.tag.y, APP.tagline.slice(0, i), 'muted');
    term.flush();
    await wait(24);
  }
  term.write(L.tag.x, L.tag.y, APP.tagline, 'muted');

  await wait(500);
  if (hint) term.write(L.hint.x, L.hint.y, hint, 'faint');
  term.flush();

  return { L, logo, surface, cells, hint };
}

/**
 * The idle loop on the finished splash. Returns stop().
 *  - a pulse of light runs along one streak into the mask every couple of seconds
 *  - every few seconds the eyes glimmer left to right
 *  - a few cells flicker like faint static
 */
export function startIdle(scene, { calm = false } = {}) {
  const { surface, cells } = scene;
  if (!surface || calm) return () => {};

  const byRow = new Map();
  for (const k of cells) if (k.streak) (byRow.get(k.r) || byRow.set(k.r, []).get(k.r)).push(k);
  const streakRows = [...byRow.values()].filter((row) => row.length >= 5).map((row) => row.sort((a, b) => a.c - b.c));
  const eyes = cells.filter((k) => k.eye);
  const eyeC0 = Math.min(...eyes.map((k) => k.c));
  const eyeC1 = Math.max(...eyes.map((k) => k.c));
  const noisy = cells.filter((k) => k.streak || k.t === 0);

  const pulses = [];   // { path, start, ms }
  let glimmer = null;  // { start, ms }
  const sparks = [];   // { k, until, g }
  let nextPulse = now() + 600;
  let nextGlimmer = now() + rand(2500, 4000);
  let touched = new Set();
  let stopped = false;

  (async () => {
    while (!stopped) {
      const t = now();
      if (t > nextPulse && streakRows.length) {
        const path = pick(streakRows);
        pulses.push({ path, start: t, ms: 380 + path.length * 14 });
        nextPulse = t + rand(900, 2200);
      }
      if (t > nextGlimmer && eyes.length) {
        glimmer = { start: t, ms: 520 };
        nextGlimmer = t + rand(4500, 7500);
      }
      if (Math.random() < 0.3 && noisy.length) sparks.push({ k: pick(noisy), until: t + rand(60, 140), g: pick(NOISE_GLYPHS) });

      // work out this frame's highlighted cells
      const lit = new Map(); // cell → [glyph, tone]
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        const head = ((t - p.start) / p.ms) * (p.path.length + 6);
        if (head > p.path.length + 6) { pulses.splice(i, 1); continue; }
        p.path.forEach((k, j) => {
          const d = head - j;
          if (d >= 0 && d < 6) lit.set(k, [k.g, d < 1.5 ? 4 : Math.min(4, k.t + 2 - Math.floor(d / 3))]);
        });
      }
      if (glimmer) {
        const p = (t - glimmer.start) / glimmer.ms;
        if (p > 1) glimmer = null;
        else {
          const x = eyeC0 - 3 + p * (eyeC1 - eyeC0 + 6);
          for (const k of eyes) if (Math.abs(k.c - x) < 2.5) lit.set(k, [k.g, 4]);
        }
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        if (t > s.until) { sparks.splice(i, 1); continue; }
        if (!lit.has(s.k)) lit.set(s.k, [s.g, Math.max(1, s.k.t)]);
      }

      // restore cells that were lit last frame but aren't now, then draw
      for (const k of touched) if (!lit.has(k)) surface.set(k.c, k.r, k.g, k.t);
      for (const [k, [g, tone]] of lit) surface.set(k.c, k.r, g, tone);
      touched = new Set(lit.keys());
      surface.flush();
      await frame();
    }
  })();

  return () => {
    stopped = true;
    for (const k of touched) surface.set(k.c, k.r, k.g, k.t);
  };
}

/** Leave the splash: the logo breaks into static and the text scrambles away. */
export async function runExit(term, scene, ctrl = {}) {
  const { L, surface, cells } = scene;
  const texts = [
    ...BOOT_LINES.map((line, i) => ({ x: L.boot.x, y: L.boot.y + i, text: `[+] ${line}` })),
    { x: L.word.x, y: L.word.y, text: `[ ${APP.name} ]  ` },
    { x: L.tag.x, y: L.tag.y, text: APP.tagline },
  ];
  if (scene.hint) texts.push({ x: L.hint.x, y: L.hint.y, text: scene.hint });
  for (const k of cells) k.out = rand(0, 260) + (k.c / (surface?.cols || 1)) * 120;
  texts.forEach((s, i) => { s.out = i * 28; });

  term.cursor(null);
  const start = now();
  while (!ctrl.fast) {
    const t = now() - start;
    if (t > 520) break;
    for (const k of cells) {
      if (t < k.out) continue;
      surface.set(k.c, k.r, t < k.out + 90 ? pick(NOISE_GLYPHS) : ' ', t < k.out + 90 ? 3 : 0);
    }
    for (const s of texts) {
      if (t < s.out) continue;
      term.write(s.x, s.y, t < s.out + 110 ? scramble(s.text) : ' '.repeat(s.text.length), 'noise');
    }
    surface?.flush();
    term.flush();
    await frame();
  }
  term.clear();
  term.flush();
}
