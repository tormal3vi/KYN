// ─────────────────────────────────────────────────────────────────────────────
// Entry point:  startup (boot.js)  →  wait for a key  →  module menu (menu.js)
//
// During startup: any key = finish instantly, Esc = skip straight to the menu.
// ─────────────────────────────────────────────────────────────────────────────

import { APP } from './config.js';
import { GRID_MINIMUMS, runBoot } from './boot.js';
import { createWebTerminal } from './term-web.js';
import { getSystemInfo } from './sysinfo.js';
import { createMenu } from './menu.js';

document.title = APP.name;

let state = 'boot'; // boot → splash → menu
const ctrl = { fast: false, skip: false };
let continueFromSplash = null;

async function start() {
  const term = await createWebTerminal(document.getElementById('app'), { minimums: GRID_MINIMUMS });
  const info = await getSystemInfo();
  const menu = createMenu(term, info);

  // Resizing the window changes the grid, so redraw the current screen.
  term.onResize(() => {
    if (state === 'boot') ctrl.fast = true; // finish now; the final frame is redrawn below
    else if (state === 'splash') runBoot(term, { fast: true });
    else menu.draw();
  });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave Cmd+R, Cmd+Q etc. alone
    if (state === 'boot') {
      if (e.key === 'Escape') ctrl.skip = true;
      else ctrl.fast = true;
    } else if (state === 'splash') {
      continueFromSplash?.();
    } else {
      menu.handleKey(e);
    }
  });
  document.addEventListener('pointerdown', () => {
    if (state === 'boot') ctrl.fast = true;
    else if (state === 'splash') continueFromSplash?.();
  });

  await runBoot(term, ctrl);
  if (!ctrl.skip) {
    if (ctrl.fast) await runBoot(term, { fast: true }); // clean final frame at the current size
    state = 'splash';
    await new Promise((resolve) => { continueFromSplash = resolve; });
  }
  state = 'menu';
  menu.show();
}

start().catch((err) => {
  // Show errors on screen instead of leaving a black window.
  const pre = document.createElement('pre');
  pre.className = 'fatal';
  pre.textContent = `startup failed:\n${err?.stack || err}`;
  document.body.append(pre);
  console.error(err);
});
