// ─────────────────────────────────────────────────────────────────────────────
// Character effects shared by the startup and the menu.
//
// Everything here only rewrites characters on the grid, a few times per
// second, so it works the same in the app and in a real terminal.
// ─────────────────────────────────────────────────────────────────────────────

export const FRAME_MS = 30;                       // ~33 frames per second
export const NOISE_TEXT = '#%&*+=-:/\\<>|_';      // scramble characters for text
export const NOISE_GLYPHS = 'M=-+.|:';            // scramble shapes for the logo

export const now = () => performance.now();
export const frame = () => new Promise((r) => setTimeout(r, FRAME_MS));
export const pick = (s) => s[Math.floor(Math.random() * s.length)];
export const rand = (a, b) => a + Math.random() * (b - a);

/** Scramble characters for `text`, keeping its spaces. */
export const scramble = (text) => [...text].map((ch) => (ch === ' ' ? ' ' : pick(NOISE_TEXT))).join('');

/**
 * "Decode" text into place: a short run of scramble characters sweeps left
 * to right and leaves the real text behind it.
 */
export async function decode(term, x, y, text, style, { ms = 280, ctrl = {}, trail = 5 } = {}) {
  const start = now();
  while (!ctrl.fast) {
    const p = (now() - start) / ms;
    if (p >= 1) break;
    const front = Math.floor(p * text.length);
    const noise = scramble(text.slice(front, front + trail));
    term.write(x, y, text.slice(0, front), style);
    term.write(x + front, y, noise, 'noise');
    term.write(x + front + noise.length, y, ' '.repeat(Math.max(0, text.length - front - noise.length)), style);
    term.flush();
    await frame();
  }
  term.write(x, y, text, style);
  term.flush();
}

/**
 * Run `draw(fakeTerm)` to collect what a screen would print, then reveal it
 * line by line with the decode effect. `isCancelled()` lets a key press
 * jump to the finished screen. Returns when done.
 */
export async function revealScreen(term, draw, { stagger = 16, isCancelled = () => false } = {}) {
  const writes = [];
  const recorder = Object.create(term);
  recorder.write = (x, y, text, style) => writes.push({ x, y, text: String(text), style });
  recorder.flush = () => {};
  term.clear();
  draw(recorder);

  const rows = [...new Set(writes.map((w) => w.y))].sort((a, b) => a - b);
  const delay = new Map(rows.map((y, i) => [y, i * stagger]));
  const start = now();
  let done = false;
  while (!done && !isCancelled()) {
    done = true;
    const t = now() - start;
    for (const w of writes) {
      const ms = Math.min(240, 40 + w.text.length * 5);
      const p = (t - delay.get(w.y)) / ms;
      if (p < 1) done = false;
      if (p <= 0) continue;
      if (p >= 1) { term.write(w.x, w.y, w.text, w.style); continue; }
      const front = Math.floor(p * w.text.length);
      term.write(w.x, w.y, w.text.slice(0, front), w.style);
      term.write(w.x + front, w.y, scramble(w.text.slice(front, front + 4)), 'noise');
    }
    term.flush();
    if (!done) await frame();
  }
}
