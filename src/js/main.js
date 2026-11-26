// ─────────────────────────────────────────────────────────────────────────────
// Entry point:
//   startup (boot.js) → idle splash until a key → dissolve → module menu
//
// During startup: any key = finish instantly, Esc = skip straight to the menu.
// ─────────────────────────────────────────────────────────────────────────────

import { APP } from './config.js';
import { FINE } from './logo.js';
import { gridMinimums, runBoot, startIdle, runExit } from './boot.js';
import { createWebTerminal } from './term-web.js';
import { getSystemInfo } from './sysinfo.js';
import { createMenu } from './menu.js';

document.title = APP.name;
const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let state = 'boot'; // boot → splash → leaving → menu
const ctrl = { fast: calm, skip: false };
let continueFromSplash = null;

async function start() {
  const term = await createWebTerminal(document.getElementById('app'), { minimums: gridMinimums(FINE) });
  const info = await getSystemInfo();
  const menu = createMenu(term, info);
  let scene = null;
  let stopIdle = () => {};

  // Resizing the window changes the grid, so redraw the current screen.
  term.onResize(async () => {
    if (state === 'boot') ctrl.fast = true; // finish now; redrawn below at the new size
    else if (state === 'splash') {
      stopIdle();
      scene = await runBoot(term, { fast: true });
      stopIdle = startIdle(scene, { calm });
    } else if (state === 'menu') menu.draw();
  });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave Cmd+R, Cmd+Q etc. alone
    if (state === 'boot') {
      if (e.key === 'Escape') ctrl.skip = true;
      else ctrl.fast = true;
    } else if (state === 'splash') {
      continueFromSplash?.();
    } else if (state === 'menu') {
      menu.handleKey(e);
    }
  });
  document.addEventListener('pointerdown', () => {
    if (state === 'boot') ctrl.fast = true;
    else if (state === 'splash') continueFromSplash?.();
  });

  scene = await runBoot(term, ctrl);
  if (!ctrl.skip) {
    if (ctrl.fast) scene = await runBoot(term, { fast: true }); // clean final frame at the current size
    state = 'splash';
    stopIdle = startIdle(scene, { calm });
    await new Promise((resolve) => { continueFromSplash = resolve; });
    stopIdle();
    state = 'leaving';
    await runExit(term, scene, { fast: calm });
  }
  state = 'menu';
  await menu.show({ animate: !calm });
}

start().catch((err) => {
  // Show errors on screen instead of leaving a black window.
  const pre = document.createElement('pre');
  pre.className = 'fatal';
  pre.textContent = `startup failed:\n${err?.stack || err}`;
  document.body.append(pre);
  console.error(err);
});
