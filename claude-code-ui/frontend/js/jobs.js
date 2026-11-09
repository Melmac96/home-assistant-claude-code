/*
 * my44: JOBS under one chat (user 2026-11-08, Look A + model shown; tablet = numbered buttons, phone = one pill).
 * Reads the background tasks the server already tracks (S.backgroundTasks). Each gets a number; a task that
 * goes away becomes a finished job kept in Storage (this device only, localStorage). The model is read from a
 * "[Haiku]" / "[Sonnet]" tag Claude puts at the start of the task description (standing instruction in advisor.js).
 */
import { S } from './state.js';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const KEY = 'haaiJobsStore';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const save = (a) => localStorage.setItem(KEY, JSON.stringify(a.slice(-30)));
const tagOf = (d) => { const m = /^\s*\[([^\]]{2,24})\]\s*/.exec(d || ''); return { model: m ? m[1] : 'Claude', text: (d || '').replace(/^\s*\[[^\]]{2,24}\]\s*/, '') || 'Job' }; };

const row = mk('div', 'jobs-row hidden');
const sheet = mk('div', 'jobs-sheet hidden');
const anchor = document.querySelector('.header');
if (anchor) { anchor.after(row); row.after(sheet); }
// my52: Storage is a plain number on the top bar
const storeBtn = mk('button', 'icon-btn hidden'); storeBtn.type = 'button'; storeBtn.id = 'job-store-btn'; storeBtn.title = 'Finished jobs'; storeBtn.setAttribute('aria-label', 'Finished jobs');
document.querySelector('.icon-group')?.prepend(storeBtn);
storeBtn.onclick = () => { showStorage = !showStorage; openN = null; draw(); };

let live = new Map();   // id -> {n, text, model, lastTool, summary}
let nextN = 1;
let openN = null;
let showStorage = false;

export function onJobsChanged() {
  const now = new Map((S.backgroundTasks || []).map((t) => [t.id, t]));
  const store = load();
  for (const [id, j] of live) {
    if (!now.has(id)) { store.push({ n: j.n, text: j.text, model: j.model, summary: j.summary || '', at: Date.now() }); live.delete(id); }
  }
  save(store);
  for (const [id, t] of now) {
    const g = tagOf(t.description);
    const prev = live.get(id);
    live.set(id, { n: prev ? prev.n : nextN++, text: g.text, model: g.model, lastTool: t.lastTool, summary: t.summary });
  }
  if (!live.size) nextN = 1;
  draw();
}

function draw() {
  const store = load();
  const wide = window.matchMedia('(min-width: 700px)').matches;
  row.textContent = '';
  const any = live.size || store.length;
  row.classList.toggle('hidden', !live.size);
  storeBtn.textContent = store.length || '';
  storeBtn.classList.toggle('hidden', !store.length);
  storeBtn.classList.toggle('sel', showStorage);
  if (!any) { sheet.classList.add('hidden'); return; }
  if (wide) {
    for (const j of live.values()) {
      const b = mk('button', 'job-btn working' + (openN === j.n && !showStorage ? ' sel' : ''), String(j.n)); b.type = 'button';
      b.onclick = () => { openN = openN === j.n && !showStorage ? null : j.n; showStorage = false; draw(); };
      row.appendChild(b);
    }
  } else if (live.size) {
    const b = mk('button', 'job-pill', live.size === 1 ? '1 job running' : live.size + ' jobs running'); b.type = 'button';
    b.onclick = () => { openN = openN ? null : [...live.values()][0].n; showStorage = false; draw(); };
    row.appendChild(b);
  }
  sheet.textContent = '';
  const open = [...live.values()].find((j) => j.n === openN);
  if (showStorage) {
    sheet.appendChild(mk('div', 'jobs-h', 'Storage: finished jobs'));
    for (const j of store.slice().reverse()) {
      const r = mk('div', 'jobs-item');
      r.appendChild(mk('span', 'jobs-t', j.n + '  ' + j.text));
      r.appendChild(mk('span', 'job-model', j.model));
      sheet.appendChild(r);
      if (j.summary) sheet.appendChild(mk('div', 'jobs-sub', j.summary));
    }
    const c = mk('button', 'job-pill', 'Clear storage'); c.type = 'button';
    c.onclick = () => { if (c.dataset.sure) { save([]); showStorage = false; draw(); } else { c.dataset.sure = '1'; c.textContent = 'Press again to clear'; } };
    sheet.appendChild(c);
    sheet.classList.remove('hidden');
  } else if (open) {
    sheet.appendChild(mk('div', 'jobs-h', 'Job ' + open.n + ' is working'));
    const r = mk('div', 'jobs-item');
    r.appendChild(mk('span', 'jobs-t', open.text));
    r.appendChild(mk('span', 'job-model', open.model));
    sheet.appendChild(r);
    if (open.lastTool) sheet.appendChild(mk('div', 'jobs-sub', 'Now: ' + open.lastTool));
    if (open.summary) sheet.appendChild(mk('div', 'jobs-sub', open.summary));
    sheet.classList.remove('hidden');
  } else sheet.classList.add('hidden');
}
window.addEventListener('resize', draw);
draw();
