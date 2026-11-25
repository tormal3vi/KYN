// ─────────────────────────────────────────────────────────────────────────────
// Entry point. Runs the screens in order:
//   boot log  →  CRT glitch-out  →  logo reveal  →  module menu
//
// Keys during boot: any key = fast-forward, Esc = skip straight to the menu.
// On the logo: any key or click continues.
// ─────────────────────────────────────────────────────────────────────────────

import { APP } from './config.js';
import { MARK, pixelSvg, textRows } from './pixel.js';
import { mountGlitch, burst, idleGlitch, reducedMotion } from './glitch.js';
import { getSystemInfo } from './sysinfo.js';
import { createBootController, runBoot } from './boot.js';
import { initMenu } from './menu.js';

const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

document.title = APP.name;

const ctrl = createBootController();
let current = 'boot';
let menu = null;
let wake = null; // resolves the current "wait for key or timeout"

/** Wait `ms`, or less if the user presses a key / clicks. */
function waitOrInput(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      wake = null;
      resolve();
    }
    wake = done;
  });
}

/** Play the CRT "switch-off" glitch on a screen, then hide it. */
async function glitchOut(el) {
  if (!reducedMotion) {
    el.classList.add('is-glitching-out');
    await sleep(520);
  }
  el.hidden = true;
  el.classList.remove('is-glitching-out');
}

async function typeInto(el, text, speed = 28) {
  el.textContent = '';
  for (const ch of text) {
    if (reducedMotion) break;
    el.textContent += ch;
    await sleep(speed);
  }
  el.textContent = text;
}

async function showLogo() {
  current = 'logo';
  const screen = $('#screen-logo');
  const mark = $('#logo-mark');
  const word = $('#logo-word');
  screen.hidden = false;

  mountGlitch(mark, pixelSvg(MARK, { label: `${APP.name} logo` }), { resolve: true });
  mountGlitch(word, pixelSvg(textRows(APP.name), { label: APP.name }), { resolve: true });
  burst(mark, 1100, 1.8);
  burst(word, 1100, 1.8);

  let skipped = false;
  const skipNow = () => { skipped = true; };
  wake = skipNow;

  await sleep(reducedMotion ? 0 : 1250);
  if (!skipped) {
    await typeInto($('#logo-tagline'), `// ${APP.tagline}`);
    $('#logo-meta').textContent = `v${APP.version} · own devices only`;
    $('#logo-continue').hidden = false;
    const stopMark = idleGlitch(mark, { min: 900, max: 2600, strength: 1.2 });
    const stopWord = idleGlitch(word, { min: 1400, max: 3400, strength: 1.2 });
    await waitOrInput(7000);
    stopMark();
    stopWord();
  }
  wake = null;
  await Promise.all([burst(mark, 260, 2.2), burst(word, 260, 2.2)]);
  await glitchOut(screen);
}

function showMenu() {
  current = 'menu';
  $('#screen-boot').hidden = true;
  $('#screen-logo').hidden = true;
  menu.show();
}

// ── input routing ──────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return; // leave Cmd+R, Cmd+Q etc. alone
  if (current === 'boot') {
    if (e.key === 'Escape') ctrl.skip = true;
    else ctrl.fast = true;
  } else if (current === 'logo') {
    wake?.();
  } else if (current === 'menu') {
    menu.handleKey(e);
  }
});

document.addEventListener('pointerdown', (e) => {
  if (current === 'boot' && !e.target.closest('#boot-skip')) ctrl.fast = true;
  else if (current === 'logo') wake?.();
});

$('#boot-skip').addEventListener('click', () => {
  ctrl.skip = true;
});

// ── go ─────────────────────────────────────────────────────────────────────
async function start() {
  const info = await getSystemInfo();
  menu = initMenu(info);

  await runBoot($('#boot-log'), info, ctrl);
  if (!ctrl.skip) {
    await glitchOut($('#screen-boot'));
    await showLogo();
  }
  showMenu();
}

start().catch((err) => {
  // If something breaks, show it on screen rather than leaving a black window.
  const pre = document.createElement('pre');
  pre.className = 'fatal';
  pre.textContent = `boot failure:\n${err?.stack || err}`;
  document.body.append(pre);
  console.error(err);
});
