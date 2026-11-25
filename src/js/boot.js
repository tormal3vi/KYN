// ─────────────────────────────────────────────────────────────────────────────
// Boot sequence: a fake-but-honest startup log, typed out line by line.
//
// "Honest" means the numbers are real (CPU cores, screen, locale, hostname
// from Rust) and the module lines reflect each module's real status from
// config.js. The drama is in the timing, not in made-up claims.
//
// ctrl.fast = true  → finish the rest quickly (any key)
// ctrl.skip = true  → finish instantly (Esc); main.js then jumps to the menu
// ─────────────────────────────────────────────────────────────────────────────

import { APP, MODULES } from './config.js';
import { reducedMotion } from './glitch.js';

const MOD_LINE = {
  ready: { tag: '[ OK ]', tagCls: 't-ok', word: 'online', wordCls: 't-ok' },
  next: { tag: '[ OK ]', tagCls: 't-ok', word: 'staged · next build', wordCls: 't-warn' },
  planned: { tag: '[ -- ]', tagCls: 't-dim', word: 'queued', wordCls: 't-dim' },
  locked: { tag: '[ !! ]', tagCls: 't-mag', word: 'locked', wordCls: 't-mag' },
};

function span(text, cls) {
  const s = document.createElement('span');
  if (cls) s.className = cls;
  s.textContent = text; // textContent, never innerHTML: hostnames are data, not markup
  return s;
}

export function createBootController() {
  return { fast: reducedMotion, skip: false };
}

export async function runBoot(logEl, info, ctrl) {
  logEl.textContent = '';
  const cursor = span('', 'cursor');

  const wait = (ms) => {
    const t = ctrl.skip ? 0 : ctrl.fast ? Math.min(ms, 10) : ms;
    return new Promise((r) => setTimeout(r, t));
  };
  const jitter = (base, spread) => base + Math.random() * spread;

  const addLine = (parts = []) => {
    const line = document.createElement('div');
    line.className = 'boot-line';
    parts.forEach(([text, cls]) => line.append(span(text, cls)));
    line.append(cursor);
    logEl.append(line);
    logEl.scrollTop = logEl.scrollHeight; // keep the newest line in view
    return line;
  };

  const type = async (line, text, cls, speed = 34) => {
    const s = span('', cls);
    line.insertBefore(s, cursor);
    for (const ch of text) {
      if (ctrl.skip || ctrl.fast) break;
      s.textContent += ch;
      await wait(jitter(speed * 0.6, speed));
    }
    s.textContent = text;
  };

  // Kernel-style timestamps: [    0.003114]
  let clock = 0;
  const stamp = () => {
    clock += jitter(0.002, 0.009);
    return `[${clock.toFixed(6).padStart(12)}] `;
  };

  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const dateStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  // ── 1. banner + typed command ────────────────────────────────────────────
  await wait(350);
  addLine([[`${APP.name} secure shell v${APP.version}`, 't-strong']]);
  addLine([[`own-devices build · scope locked · ${dateStr}`, 't-dim']]);
  addLine();
  await wait(400);
  const prompt = addLine([[`${APP.operator}@${APP.name.toLowerCase().replace(/\s+/g, '-')}`, 't-ok'], [':~$ ', 't-dim']]);
  await wait(500);
  await type(prompt, `./${APP.name.toLowerCase().replace(/\s+/g, '-')} --boot --scope=own-devices`, 't-strong');
  await wait(380);

  // ── 2. hardware / environment probe (real values) ────────────────────────
  const probes = [
    ['ghost-core: waking up', ''],
    [`cpu: ${info.cores ?? '?'} logical cores online`, ''],
    [`display: ${info.screen} @${info.dpr}x`, ''],
    [`locale: ${info.locale} · ${info.tz}`, ''],
    info.native
      ? [`host: ${info.hostname} (${info.os} ${info.arch})`, 't-strong']
      : ['bridge: no native shell (browser preview, Rust side not running)', 't-warn'],
    [`link: ${info.online ? 'up' : 'down'}`, info.online ? '' : 't-warn'],
  ];
  for (const [text, cls] of probes) {
    addLine([[stamp(), 't-dim'], [text, cls]]);
    await wait(jitter(55, 90));
  }
  await wait(200);

  // ── 3. services ──────────────────────────────────────────────────────────
  const services = [
    'mounted /dev/shadowfs',
    'started entropy daemon',
    'loaded scope policy → own devices only',
    'reached target: operator console',
  ];
  for (const text of services) {
    addLine([['[ OK ] ', 't-ok'], [text, '']]);
    await wait(jitter(80, 110));
  }
  await wait(180);

  // ── 4. modules (from config.js) ──────────────────────────────────────────
  const nameWidth = Math.max(...MODULES.map((m) => m.cmd.length)) + 1;
  for (const mod of MODULES) {
    const style = MOD_LINE[mod.status] || MOD_LINE.planned;
    const tag = span('[ .. ] ', 't-dim');
    const line = addLine();
    line.insertBefore(tag, cursor);
    line.insertBefore(span(`module ${mod.cmd.padEnd(nameWidth)}`, ''), cursor);
    const dots = span('', 't-faint');
    line.insertBefore(dots, cursor);
    for (let i = 0; i < 10; i++) {
      dots.textContent += '.';
      await wait(jitter(14, 20));
    }
    await wait(jitter(60, 120));
    tag.textContent = `${style.tag} `;
    tag.className = style.tagCls;
    line.insertBefore(span(` ${style.word}`, style.wordCls), cursor);
    if (mod.bootNote) line.insertBefore(span(`  (${mod.bootNote})`, 't-dim'), cursor);
    await wait(jitter(40, 60));
  }
  await wait(220);

  // ── 5. progress bar ──────────────────────────────────────────────────────
  const bar = span('', 't-ok');
  const pct = span('', 't-strong');
  const pLine = addLine([['decrypting interface  ', '']]);
  pLine.insertBefore(span('[', 't-dim'), cursor);
  pLine.insertBefore(bar, cursor);
  pLine.insertBefore(span('] ', 't-dim'), cursor);
  pLine.insertBefore(pct, cursor);
  const cells = 24;
  let p = 0;
  while (p < 100) {
    p = Math.min(100, p + Math.round(jitter(3, 14)));
    const filled = Math.round((p / 100) * cells);
    bar.textContent = '█'.repeat(filled) + '░'.repeat(cells - filled);
    pct.textContent = `${String(p).padStart(3)}%`;
    await wait(jitter(30, 70));
  }
  await wait(250);

  // ── 6. sign-off ──────────────────────────────────────────────────────────
  addLine();
  const bye = addLine([['> ', 't-ok']]);
  await type(bye, `handshake complete. welcome back, ${APP.operator}.`, 't-ok', 26);
  await wait(650);
}
