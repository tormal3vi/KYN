// ─────────────────────────────────────────────────────────────────────────────
// Glitch effect.
//
// How it works: the same SVG is stacked five times on top of itself:
//   m  = magenta copy, y = yellow copy  → shifted sideways = RGB split
//   c  = the real teal logo on top
//   s1, s2 = extra teal copies clipped to a thin horizontal band and shoved
//            sideways = the "torn scanline" slices
// A burst sets random offsets as CSS variables a few times, then resets.
// The CSS side lives in css/logo.css.
// ─────────────────────────────────────────────────────────────────────────────

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const LAYERS = ['m', 'y', 'c', 's1', 's2'];

/**
 * Put a glitchable copy of `svg` into `el`.
 * With `resolve: true` the teal pixels flicker in one by one (boot reveal).
 */
export function mountGlitch(el, svg, { resolve = false } = {}) {
  el.classList.add('glitch');
  el.innerHTML = LAYERS.map((k) => `<div class="layer layer--${k}">${svg}</div>`).join('');
  if (resolve && !reducedMotion) {
    el.classList.add('is-resolving');
    const rects = el.querySelectorAll('.layer--c rect');
    rects.forEach((r) => {
      // Each pixel starts flickering in at its own random moment.
      r.style.animationDelay = `${Math.round(Math.random() * 900)}ms`;
    });
    setTimeout(() => {
      el.classList.remove('is-resolving');
      el.classList.add('is-resolved');
    }, 1700);
  } else {
    el.classList.add('is-resolved');
  }
}

const rand = (n) => (Math.random() * 2 - 1) * n;

function slice() {
  const top = Math.random() * 92;
  const height = 3 + Math.random() * 16;
  return `inset(${top.toFixed(1)}% 0 ${Math.max(0, 100 - top - height).toFixed(1)}% 0)`;
}

function clearVars(el) {
  ['--mx', '--my', '--yx', '--yy', '--mclip', '--yclip', '--s1clip', '--s2clip', '--s1x', '--s2x', '--cx']
    .forEach((v) => el.style.removeProperty(v));
  el.classList.remove('is-bursting');
}

/** One glitch burst lasting `duration` ms. Strength scales with element width. */
export function burst(el, duration = 240, strength = 1) {
  if (reducedMotion) return Promise.resolve();
  const k = Math.max(1, (el.clientWidth / 100) * strength); // ~1% of width
  const end = performance.now() + duration;
  el.classList.add('is-bursting');
  return new Promise((done) => {
    const tick = () => {
      if (performance.now() >= end) {
        clearVars(el);
        done();
        return;
      }
      const s = el.style;
      s.setProperty('--mx', `${rand(3 * k).toFixed(1)}px`);
      s.setProperty('--my', `${rand(0.6 * k).toFixed(1)}px`);
      s.setProperty('--yx', `${rand(3 * k).toFixed(1)}px`);
      s.setProperty('--yy', `${rand(0.6 * k).toFixed(1)}px`);
      s.setProperty('--mclip', Math.random() < 0.5 ? slice() : 'none');
      s.setProperty('--yclip', Math.random() < 0.5 ? slice() : 'none');
      s.setProperty('--s1clip', slice());
      s.setProperty('--s2clip', Math.random() < 0.6 ? slice() : 'inset(0 0 100% 0)');
      s.setProperty('--s1x', `${rand(7 * k).toFixed(1)}px`);
      s.setProperty('--s2x', `${rand(5 * k).toFixed(1)}px`);
      s.setProperty('--cx', `${rand(0.8 * k).toFixed(1)}px`);
      setTimeout(tick, 40 + Math.random() * 50);
    };
    tick();
  });
}

/** Fire short random bursts every few seconds. Returns a stop() function. */
export function idleGlitch(el, { min = 2200, max = 6000, strength = 1 } = {}) {
  if (reducedMotion) return () => {};
  let stopped = false;
  let timer;
  const loop = () => {
    timer = setTimeout(async () => {
      if (stopped) return;
      if (!document.hidden && el.isConnected && el.offsetParent !== null) {
        await burst(el, 90 + Math.random() * 260, strength);
        // Sometimes a quick double-hit, like a bad signal.
        if (Math.random() < 0.3) await burst(el, 70, strength * 1.4);
      }
      loop();
    }, min + Math.random() * (max - min));
  };
  loop();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
