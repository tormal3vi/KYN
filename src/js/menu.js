// ─────────────────────────────────────────────────────────────────────────────
// Module menu: the main screen after boot.
//
// Keys: ↑/↓ (or j/k) move · 1–9 jump · Enter open · Esc back
// Each module opens into its own view. Modules that are not built yet show
// their plan; when a module is built, its real UI will plug in here.
// ─────────────────────────────────────────────────────────────────────────────

import { APP, MODULES, STATUS_LABEL } from './config.js';
import { ICONS, MARK, pixelSvg, textRows } from './pixel.js';
import { mountGlitch, idleGlitch, burst } from './glitch.js';

const $ = (sel, root = document) => root.querySelector(sel);

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

const NOTE = {
  ready: 'Online.',
  next: 'Next up: this is the module we build next.',
  planned: 'On the build list. Not built yet.',
  locked: 'Locked for now. Unlocks in a later phase.',
};

export function initMenu(info) {
  const screen = $('#screen-menu');
  const list = $('#module-list');
  const listWrap = $('#menu-list-wrap');
  const view = $('#module-view');
  const shellName = APP.name.toLowerCase().replace(/\s+/g, '-');
  const startedAt = Date.now();

  let index = 0;
  let openIndex = -1;
  const stops = [];

  // ── top bar + panel ──────────────────────────────────────────────────────
  mountGlitch($('#brand-mark'), pixelSvg(MARK));
  $('#brand-word').innerHTML = pixelSvg(textRows(APP.name), { label: APP.name });
  $('#menu-prompt').textContent = `${APP.operator}@${shellName}`;
  $('#keybar-version').textContent = `${APP.name} v${APP.version}`;

  const opsMark = $('#ops-mark');
  mountGlitch(opsMark, pixelSvg(MARK, { label: `${APP.name} logo` }));

  const rows = [
    ['host', info.native ? info.hostname : 'browser preview'],
    ['system', [info.os, info.arch].filter(Boolean).join(' ')],
    ['cpu', info.cores ? `${info.cores} cores` : 'unknown'],
    ['display', `${info.screen} @${info.dpr}x`],
    ['locale', info.tz],
    ['bridge', info.native ? 'native · rust core online' : 'offline · ui only'],
    ['session', '00:00:00'],
    ['link', info.online ? 'up' : 'down'],
  ];
  $('#ops-info').innerHTML = rows
    .map(([k, v]) => `<div class="ops-row" data-k="${k}"><dt>${k}</dt><dd>${esc(v)}</dd></div>`)
    .join('');
  if (!info.native) $('#ops-info [data-k="bridge"] dd').classList.add('t-warn');

  const clockEl = $('#st-clock');
  const sessionEl = $('#ops-info [data-k="session"] dd');
  const tick = () => {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    clockEl.textContent = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
    const up = Math.floor((Date.now() - startedAt) / 1000);
    sessionEl.textContent = `${p2(Math.floor(up / 3600))}:${p2(Math.floor(up / 60) % 60)}:${p2(up % 60)}`;
  };
  tick();
  setInterval(tick, 1000);

  const setLink = () => {
    const up = navigator.onLine;
    $('#st-link').textContent = up ? 'LINK UP' : 'LINK DOWN';
    $('#st-link').classList.toggle('t-err', !up);
    $('#ops-info [data-k="link"] dd').textContent = up ? 'up' : 'down';
  };
  setLink();
  window.addEventListener('online', setLink);
  window.addEventListener('offline', setLink);

  // ── module list ──────────────────────────────────────────────────────────
  list.innerHTML = MODULES.map((m, i) => `
    <li>
      <button type="button" class="module" data-index="${i}" data-status="${m.status}">
        <span class="module__key">${i + 1}</span>
        <span class="module__icon">${pixelSvg(ICONS[m.icon] || ICONS.chip, { gap: 0.12 })}</span>
        <span class="module__text">
          <span class="module__name">${esc(m.name)}</span>
          <span class="module__blurb">${esc(m.blurb)}</span>
        </span>
        <span class="module__status">${STATUS_LABEL[m.status] || ''}</span>
      </button>
    </li>`).join('');
  const buttons = [...list.querySelectorAll('.module')];

  const select = (i, focus = true) => {
    index = (i + buttons.length) % buttons.length;
    buttons.forEach((b, j) => b.classList.toggle('is-selected', j === index));
    if (focus) buttons[index].focus({ preventScroll: false });
  };

  buttons.forEach((b, i) => {
    b.addEventListener('mouseenter', () => select(i, false));
    b.addEventListener('focus', () => select(i, false));
    b.addEventListener('click', () => open(i));
  });

  // ── module view ──────────────────────────────────────────────────────────
  function open(i) {
    const m = MODULES[i];
    openIndex = i;
    const denied = m.status === 'locked'
      ? `<p class="denied glitch-text" data-text="ACCESS DENIED">ACCESS DENIED</p>`
      : '';
    view.innerHTML = `
      <p class="mv-cmd"><span class="t-ok">${esc(APP.operator)}@${esc(shellName)}</span><span class="t-dim">:~$ </span>./${esc(m.cmd)}</p>
      ${denied}
      <h2 class="mv-title glitch-text" data-text="${esc(m.name.toUpperCase())}">${esc(m.name.toUpperCase())}</h2>
      <p class="mv-status"><span class="chip" data-status="${m.status}">${STATUS_LABEL[m.status]}</span> <span class="t-dim">${NOTE[m.status] || ''}</span></p>
      <p class="mv-blurb">${esc(m.blurb)}</p>
      <h3 class="mv-sub">// what it will do</h3>
      <ul class="mv-plan">${m.plan.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      <button type="button" class="btn" data-action="back"><kbd>esc</kbd> back to modules</button>`;
    listWrap.hidden = true;
    view.hidden = false;
    view.classList.remove('is-entering');
    void view.offsetWidth; // restart the entry animation
    view.classList.add('is-entering');
    $('[data-action="back"]', view).addEventListener('click', close);
    $('[data-action="back"]', view).focus({ preventScroll: true });
    burst(opsMark, 220, 1.2);
  }

  function close() {
    openIndex = -1;
    view.hidden = true;
    listWrap.hidden = false;
    select(index);
  }

  // ── keyboard ─────────────────────────────────────────────────────────────
  function handleKey(e) {
    if (openIndex >= 0) {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        e.preventDefault();
        close();
      }
      return;
    }
    const k = e.key;
    if (k === 'ArrowDown' || k === 'j') { e.preventDefault(); select(index + 1); }
    else if (k === 'ArrowUp' || k === 'k') { e.preventDefault(); select(index - 1); }
    else if (k === 'Home') { e.preventDefault(); select(0); }
    else if (k === 'End') { e.preventDefault(); select(buttons.length - 1); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); open(index); }
    else if (/^[1-9]$/.test(k) && Number(k) <= buttons.length) { e.preventDefault(); select(Number(k) - 1); open(Number(k) - 1); }
  }

  function show() {
    screen.hidden = false;
    screen.classList.add('is-entering');
    select(0);
    stops.push(idleGlitch(opsMark, { min: 2500, max: 7000 }));
    stops.push(idleGlitch($('#brand-mark'), { min: 4000, max: 11000, strength: 2 }));
  }

  return { show, handleKey };
}
