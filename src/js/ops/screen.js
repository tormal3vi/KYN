// ─────────────────────────────────────────────────────────────────────────────
// OPS screen: pick the situation you're in, press enter, watch the op run.
//
//   list   every op with its briefing and a strip of past results
//   run    the op's steps as a live log ([+] fine, [-] worth knowing,
//          [~] to fix, [!] wrong right now, [?] couldn't check), then a
//          verdict (CLEAR / CAUTION / ALERT) and a numbered to-do list
//
// Keys (list): ↑↓ select · enter run · esc back
// Keys (run):  r run again · ↑↓ scroll · the op's shortcut (e.g. m) · esc back
// Ops are defined in catalog.js. Past runs are kept so ops can tell you what
// changed since last time.
// ─────────────────────────────────────────────────────────────────────────────

import { APP } from '../config.js';
import { scramble } from '../fx.js';
import { invokeNative } from '../sysinfo.js';
import * as api from './api.js';
import { OPS, ago } from './catalog.js';

const X = 3;
const TOP = 7;
const LABEL_W = 15;
const REVEAL_MS = 260;
const KEEP_RUNS = 20;

const fit = (s, w) => (w <= 0 ? '' : s.length <= w ? s : `${s.slice(0, Math.max(0, w - 1))}~`);
const pad = (s, w) => fit(s, w).padEnd(w);

function wrap(text, width) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    if (line && `${line} ${word}`.length > width) { out.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

const ICON = {
  wait: ['[ ]', 'faint', 'faint'],
  ok: ['[+]', 'gray', 'text'],
  note: ['[-]', 'gray', 'muted'],
  warn: ['[~]', 'strong', 'strong'],
  fail: ['[!]', 'red', 'red'],
  skip: ['[?]', 'faint', 'gray'],
};
const VERDICT = {
  ALERT: { style: 'red', mark: '!' },
  CAUTION: { style: 'strong', mark: '~' },
  CLEAR: { style: 'text', mark: '+' },
  'NOT RUN': { style: 'gray', mark: '·' },
  UNSURE: { style: 'muted', mark: '?' },
};
const SPIN = '|/-\\';

function verdictOf(rows) {
  const n = (s) => rows.filter((r) => r.status === s).length;
  const counts = { fail: n('fail'), warn: n('warn'), ok: n('ok'), note: n('note'), skip: n('skip') };
  // an op that couldn't get going (e.g. network not confirmed yet) isn't an alert
  const unsure = rows.some((r) => r.step.key && r.status === 'skip');
  const verdict = rows.some((r) => r.stop) ? 'NOT RUN' : counts.fail ? 'ALERT' : counts.warn ? 'CAUTION' : unsure ? 'UNSURE' : 'CLEAR';
  return { verdict, counts };
}

export function createOps(term, { paintHeader, onExit, onGoto }) {
  let active = false;
  let mode = 'list'; // list | run
  let index = 0;
  let history = { runs: {}, memory: {} };
  let run = null;   // { op, rows, done, started, ms, verdict, counts, fixes, headerAt }
  let runToken = 0;
  let scroll = 0;   // run log: lines scrolled up from the bottom
  let ticking = false;
  // the demo plays a Mac; the app asks Rust (see open())
  let os = api.isDemo ? 'macos' : navigator.platform.startsWith('Mac') ? 'macos' : navigator.platform.startsWith('Win') ? 'windows' : 'linux';

  const op = () => OPS[index];
  const runsOf = (id) => history.runs?.[id] || [];
  const lastOf = (id) => runsOf(id)[runsOf(id).length - 1] || null;

  // ── animation: spinner while a step runs, decode as each result lands ───
  function animating() {
    if (!run || mode !== 'run') return false;
    const t = performance.now();
    return !run.done || t - run.headerAt < REVEAL_MS * 2 || t - (run.doneAt || 0) < 500
      || run.rows.some((r) => r.at && t - r.at < REVEAL_MS);
  }

  function tick() {
    if (ticking) return;
    ticking = true;
    const step = () => {
      if (!active || !animating()) { ticking = false; if (active) draw(); return; }
      draw();
      setTimeout(step, 50);
    };
    step();
  }

  /** text as it decodes in: real text behind a short run of scramble characters */
  function revealed(text, at, ms = REVEAL_MS) {
    if (!at) return text;
    const p = (performance.now() - at) / ms;
    if (p >= 1) return text;
    const front = Math.floor(p * text.length);
    return text.slice(0, front) + scramble(text.slice(front, front + 5)) + ' '.repeat(Math.max(0, text.length - front - 5));
  }

  // ── running ─────────────────────────────────────────────────────────────
  async function runOp(which) {
    const mine = ++runToken;
    mode = 'run';
    scroll = 0;
    run = {
      op: which,
      rows: which.steps.map((s) => ({ step: s, status: 'wait', text: '', details: [], at: 0 })),
      done: false,
      started: performance.now(),
      headerAt: performance.now(),
    };
    tick();
    let remembered = null;
    const ctx = {
      os,
      onMac: os === 'macos',
      memory: history.memory?.[which.id] || null,
      cache: {},
      remember(obj) { remembered = { ...remembered, ...obj }; },
      progress: () => {},
    };
    let stopped = false;
    for (const row of run.rows) {
      if (mine !== runToken || !active) return;
      if (stopped) { row.status = 'skip'; row.text = 'not run'; continue; }
      row.status = 'run';
      row.text = 'checking...';
      ctx.progress = (text) => { if (mine === runToken) row.text = text; };
      let res;
      try {
        res = await row.step.run(ctx);
      } catch (e) {
        res = { status: 'skip', text: `couldn't check: ${String(e?.message || e)}` };
      }
      if (mine !== runToken) return;
      Object.assign(row, { details: [], fix: null }, res, { at: performance.now() });
      if (res.stop) stopped = true;
    }
    const { verdict, counts } = verdictOf(run.rows);
    Object.assign(run, {
      done: true,
      ms: performance.now() - run.started,
      verdict,
      counts,
      fixes: run.rows.filter((r) => r.fix && r.status !== 'ok').map((r) => r.fix),
      goto: [...run.rows].reverse().find((r) => r.goto)?.goto || which.goto || null,
      doneAt: performance.now(),
    });
    // remember the run (and what the op wants to compare with next time)
    const entry = { at: Date.now(), verdict, ...counts, ms: Math.round(run.ms) };
    history.runs = { ...history.runs, [which.id]: [...runsOf(which.id), entry].slice(-KEEP_RUNS) };
    if (remembered) history.memory = { ...history.memory, [which.id]: remembered };
    api.saveHistory(history).catch(() => {});
    if (active && mine === runToken) draw();
  }

  // ── painting: list ──────────────────────────────────────────────────────
  function strip(id, n = 8) {
    return runsOf(id).slice(-n).map((r) => VERDICT[r.verdict] || VERDICT.CLEAR);
  }

  function paintList() {
    term.write(X, 5, '[+] pick the situation you\'re in · enter runs it', 'gray');
    const wide = term.cols >= 110;
    const listW = wide ? term.cols - X * 2 - 50 : term.cols - X * 2;
    OPS.forEach((o, i) => {
      const y = TOP + i * 2;
      const sel = i === index;
      if (sel) term.write(X - 2, y, '>', 'red');
      term.write(X, y, pad(o.code, 12), sel ? 'strong' : 'muted');
      const last = lastOf(o.id);
      const lastText = last ? `${ago(last.at)}` : 'never run';
      const titleW = Math.max(10, listW - 12 - 22);
      term.write(X + 12, y, fit(o.title, titleW), sel ? 'text' : 'gray');
      const lx = X + 12 + titleW + 2;
      term.write(lx, y, fit(lastText, 12), 'faint');
      strip(o.id, 4).forEach((v, k) => term.write(lx + 13 + k * 2, y, v.mark, v.style === 'text' ? 'gray' : v.style));
      term.addHit(X, y, listW, 1, {
        hover: () => { if (index !== i) { index = i; draw(); } },
        click: () => { index = i; runOp(o); },
      });
    });
    const by = TOP + OPS.length * 2 + 1;
    if (wide) paintBriefing(term.cols - X - 46, TOP, 46, term.rows - TOP - 4);
    else paintBriefing(X, by, term.cols - X * 2, term.rows - by - 3);
  }

  function paintBriefing(x, y0, w, h) {
    const o = op();
    let y = y0;
    const end = y0 + h;
    term.write(x, y++, o.code, 'strong');
    term.write(x, y++, fit(o.title, w), 'text');
    y++;
    const kv = (k, v, st = 'muted') => {
      wrap(v, w - 9).forEach((line, i) => {
        if (y >= end) return;
        if (i === 0) term.write(x, y, k, 'gray');
        term.write(x + 9, y++, line, st);
      });
      y++;
    };
    kv('when', o.when, 'text');
    kv('checks', o.checks);
    kv('touches', o.touches);
    kv('takes', o.takes);
    const last = lastOf(o.id);
    if (last && y < end) {
      const v = VERDICT[last.verdict];
      term.write(x, y, 'last', 'gray');
      const parts = `${ago(last.at)} · `;
      term.write(x + 9, y, parts, 'muted');
      term.write(x + 9 + parts.length, y, last.verdict, v.style);
      const more = last.verdict === 'NOT RUN' ? '' : ` · ${last.fail + last.warn} to fix`;
      term.write(x + 9 + parts.length + last.verdict.length, y++, more, 'muted');
      if (y < end) {
        term.write(x, y, 'trend', 'gray');
        strip(o.id).forEach((s, k) => term.write(x + 9 + k * 2, y, s.mark, s.style === 'text' ? 'gray' : s.style));
      }
    }
  }

  // ── painting: run ───────────────────────────────────────────────────────
  /** The whole log as lines of segments: [[x, text, style], ...] */
  function runLines(width) {
    const lines = [];
    const textW = Math.max(20, width - LABEL_W - 4);
    const spin = SPIN[Math.floor(performance.now() / 120) % SPIN.length];
    for (const r of run.rows) {
      const [icon, iconStyle, textStyle] = r.status === 'run' ? [`[${spin}]`, 'gray', 'faint'] : ICON[r.status];
      const text = r.status === 'run' ? r.text : revealed(r.text, r.at);
      wrap(text, textW).forEach((part, i) => {
        lines.push(i === 0
          ? [[0, icon, iconStyle], [4, r.step.label, r.status === 'wait' ? 'faint' : 'gray'], [4 + LABEL_W, part, textStyle]]
          : [[4 + LABEL_W, part, textStyle]]);
      });
      if (r.status !== 'run' && r.status !== 'wait') {
        for (const d of r.details || []) {
          wrap(revealed(d, r.at), textW - 2).forEach((part, i) => lines.push([[4 + LABEL_W + 2, (i ? '  ' : '· ') + part, 'gray']]));
        }
      }
    }
    if (run.done) {
      const v = VERDICT[run.verdict];
      const c = run.counts;
      lines.push([]);
      lines.push([[0, '─'.repeat(Math.min(width, 72)), 'faint']]);
      const stamp = revealed(run.verdict, run.doneAt, 420);
      const summary = run.verdict === 'NOT RUN' ? 'needs one thing first, see below' : [
        c.fail + c.warn ? `${c.fail + c.warn} to fix` : 'nothing to fix',
        `${c.ok + c.note} fine`,
        c.skip ? `${c.skip} couldn't check` : null,
        `${(run.ms / 1000).toFixed(1)} s`,
      ].filter(Boolean).join(' · ');
      lines.push([[0, 'VERDICT', 'gray'], [10, `[ ${stamp} ]`, v.style === 'text' ? 'strong' : v.style], [10 + run.verdict.length + 7, summary, 'muted']]);
      if (run.fixes.length) {
        lines.push([]);
        run.fixes.forEach((f, i) => {
          wrap(f, width - 6).forEach((part, k) => lines.push(k ? [[5, part, 'text']] : [[1, String(i + 1), 'strong'], [5, part, 'text']]));
        });
      }
      const prev = runsOf(run.op.id).slice(0, -1).reverse().find((r) => r.verdict !== 'NOT RUN');
      if (prev && run.verdict !== 'NOT RUN') {
        lines.push([]);
        const was = prev.fail + prev.warn;
        const now = c.fail + c.warn;
        const trend = now < was ? `better than last time (${ago(prev.at)}: ${prev.verdict}, ${was} to fix)` : now > was ? `worse than last time (${ago(prev.at)}: ${prev.verdict}, ${was} to fix)` : `same as last time (${ago(prev.at)})`;
        lines.push([[0, trend, now > was ? 'strong' : 'gray']]);
      }
    }
    return lines;
  }

  function paintRun() {
    const o = run.op;
    const head = `[ OP ] ${o.code}`;
    term.write(X, 5, revealed(head, run.headerAt, REVEAL_MS * 2), 'strong');
    term.write(X + head.length + 2, 5, fit(o.title, term.cols - X * 2 - head.length - 2), 'muted');
    if (api.isDemo) term.write(term.cols - X - 9, 5, 'demo data', 'faint');
    const width = Math.min(term.cols - X * 2, 110);
    const lines = runLines(width);
    const room = term.rows - TOP - 3;
    const maxScroll = Math.max(0, lines.length - room);
    scroll = Math.min(scroll, maxScroll);
    const first = Math.max(0, lines.length - room - scroll);
    lines.slice(first, first + room).forEach((segs, k) => {
      for (const [dx, text, style] of segs) term.write(X + dx, TOP + k, fit(text, width - dx), style);
    });
    if (first > 0) term.write(term.cols - X - 12, TOP, '↑ more above', 'faint');
  }

  function paintFooter() {
    const y = term.rows - 2;
    let keys;
    if (mode === 'list') keys = '↑↓ select   enter run   esc back';
    else if (!run?.done) keys = 'esc stop';
    else keys = ['r run again', run.goto && `${run.goto.key} ${run.goto.label}`, '↑↓ scroll', 'esc back'].filter(Boolean).join('   ');
    term.write(X, y, fit(keys, term.cols - X * 2), 'faint');
    if (mode === 'list') {
      const note = 'your own devices and network only';
      if (term.cols - X * 2 - keys.length > note.length + 4) term.write(term.cols - X - note.length, y, note, 'faint');
    }
  }

  function draw() {
    if (!active) return;
    term.clear();
    paintHeader(term);
    term.cursor(null);
    term.write(X, 4, '$ ', 'gray');
    term.write(X + 2, 4, `${APP.command} ops${mode === 'run' && run ? ` ${run.op.id}` : ''}`, 'text');
    if (mode === 'list') paintList();
    else paintRun();
    paintFooter();
    term.flush();
  }

  // ── flow ────────────────────────────────────────────────────────────────
  async function open() {
    active = true;
    mode = 'list';
    draw();
    try {
      const info = await invokeNative('system_info');
      if (info?.os) os = info.os;
    } catch { /* keep the guess */ }
    try {
      const h = await api.loadHistory();
      history = { runs: h?.runs || {}, memory: h?.memory || {} };
    } catch { /* first run */ }
    if (active) draw();
  }

  function exit(then) {
    active = false;
    runToken++;
    if (then) onGoto(then);
    else onExit();
  }

  function handleKey(e) {
    const k = e.key;
    const take = () => e.preventDefault();
    if (mode === 'list') {
      if (k === 'ArrowDown' || k === 'j') { take(); index = (index + 1) % OPS.length; draw(); }
      else if (k === 'ArrowUp' || k === 'k') { take(); index = (index - 1 + OPS.length) % OPS.length; draw(); }
      else if (/^[1-9]$/.test(k) && Number(k) <= OPS.length) { take(); index = Number(k) - 1; draw(); }
      else if (k === 'Enter' || k === ' ') { take(); runOp(op()); }
      else if (k === 'Escape' || k === 'Backspace') { take(); exit(); }
      return;
    }
    // run
    if (k === 'Escape' || k === 'Backspace') { take(); runToken++; mode = 'list'; draw(); return; }
    if (!run?.done) return;
    if (k === 'r' || k === 'R') { take(); runOp(run.op); }
    else if (run.goto && k.toLowerCase() === run.goto.key) { take(); exit(run.goto.module); }
    else if (k === 'ArrowUp' || k === 'k') { take(); scroll++; draw(); }
    else if (k === 'ArrowDown' || k === 'j') { take(); scroll = Math.max(0, scroll - 1); draw(); }
  }

  term.onWheel?.((dir) => {
    if (!active) return;
    if (mode === 'list') { index = Math.max(0, Math.min(OPS.length - 1, index + dir)); draw(); }
    else { scroll = Math.max(0, scroll - dir); draw(); }
  });

  return { open, draw, handleKey, get active() { return active; } };
}
