/*
 * my138 (Michael 21 Nov 2026): the "What's going on" box - our own icons, their colours and what each group holds.
 * Picked on www/my-claude-code-ui/whats-going-on-looks.html: small box Look D (4 lines, full width), opened box
 * Version 2 (coloured icon + heading, each group in its own strip with a coloured left edge).
 * His rule: haAi things only (never house / Home Assistant things), and only for the chat he is in.
 * A group with nothing real to show is left out; nothing is ever made up.
 */
import { S } from './state.js';
import { mk } from './util.js';
import { modelSelect, effortSelect } from './dom.js';
import { allowanceNow } from './usage.js';
import { addedCount } from './batch4.js';

export const COL = { job: '#6b9fd4', task: '#e0a84f', model: '#b48ce0', msg: '#5fc47a', chat: '#4fc3c8', alarm: '#e87ea1',
  upd: '#f0904a', brain: '#9fb3c8', allow: '#d9c45a', conn: '#7fd0a0' };
export const NAMES = { job: 'This job', task: 'Background tasks', model: 'Other models helping', msg: 'Your messages',
  chat: 'Other chats', alarm: 'Reminders and timed jobs', upd: 'haAi update', brain: 'This chat', allow: 'Allowance', conn: 'Connection' };
const P = {
  job: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M8.5 10h7M8.5 14h7M8.5 18h4"/>',
  task: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/><circle cx="12" cy="12" r="6.2"/>',
  model: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V5"/><circle cx="12" cy="4" r="1.2"/><circle cx="9.5" cy="13" r="1"/><circle cx="14.5" cy="13" r="1"/><path d="M9.5 16.5h5"/>',
  msg: '<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M4 7l8 6 8-6"/>',
  chat: '<path d="M4 5h11a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M19 9h1a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1v2.5L16 18h-4"/>',
  alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.5 1.5"/><path d="M4 5l3-2.5M20 5l-3-2.5"/>',
  upd: '<path d="M12 15V4"/><path d="M7.5 8.5L12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  brain: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/><circle cx="12" cy="17" r="1.3"/>',
  allow: '<rect x="3" y="8" width="16" height="9" rx="2"/><path d="M21 11v3"/><path d="M6 11v3M9 11v3M12 11v3"/>',
  conn: '<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
};
export function icon(k) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [a, v] of [['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', COL[k]], ['stroke-width', '1.8'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]) s.setAttribute(a, v);
  s.innerHTML = P[k];
  return s;
}

// Account and Free / Paid mode, from the accounts menu (my54 event)
let acct = { email: '', free: false };
window.addEventListener('haai-accounts', (e) => { const d = e.detail || {}; acct = { email: (d.cur && d.cur.email) || '', free: !!d.free }; });

// A background task tagged "[Haiku] ..." / "[Sonnet] ..." is another model's job (the my44 tag); untagged = mine
const tagOf = (d) => { const m = /^\s*\[([^\]]{2,24})\]\s*/.exec(d || ''); return { model: m ? m[1] : '', text: String(d || '').replace(/^\s*\[[^\]]{2,24}\]\s*/, '') || 'A job' }; };
export function wgoData() {
  const tasks = (S.backgroundTasks || []).map((t) => tagOf(t.description));
  const others = (S.chatList || []).filter((c) => c.id !== S.chat);
  return { own: tasks.filter((x) => !x.model), helpers: tasks.filter((x) => x.model), msgs: addedCount() || 0,
    others, working: others.filter((c) => c.status === 'working').length };
}

// Line 4 of the small box: our own icons, each with how many; an icon shows only when there is at least 1
export function drawIcons(el, d = wgoData()) {
  const key = [d.own.length, d.helpers.length, d.msgs, d.working].join(',');
  if (el.dataset.k === key) return;
  el.dataset.k = key; el.textContent = '';
  for (const [k, n] of [['task', d.own.length], ['model', d.helpers.length], ['msg', d.msgs], ['chat', d.working]]) {
    if (!n) continue;
    const s = mk('span', 'h7-ic'); s.title = NAMES[k];
    s.append(icon(k), mk('em', '', String(n)));
    el.append(s);
  }
  el.classList.toggle('hidden', !el.childElementCount);
}

// How much of the 5-hour allowance this reply has used: the figure now minus the figure when the reply started
function fiveNow() {
  const a = allowanceNow(), w = a.w && a.w.five_hour;
  if (!w) return null;
  if (w.resetsAt && w.resetsAt * 1000 <= Date.now()) return 0;
  return Math.max(0, Math.min(100, w.utilization <= 1 ? w.utilization * 100 : w.utilization));
}
let startPct = null;
export function replyStarted() { startPct = fiveNow(); }
export function usedThisReply() {
  const n = fiveNow();
  if (n == null || startPct == null) return '';
  return `used ${Math.max(0, Math.round(n - startPct))}% of 5 hours`;
}

const pct = (x) => (!x ? null : (x.resetsAt && x.resetsAt * 1000 <= Date.now()) ? 0 : Math.round(x.utilization <= 1 ? x.utilization * 100 : x.utilization));
const optText = (sel) => (sel && sel.selectedOptions && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent.trim() : '');

// The opened box: every group under its own icon and colour. job = [{t, m}] lines for "This job".
export function drawGroups(box, job, reply) {
  const d = wgoData();
  const G = [];
  const add = (k, count, lines) => { if (lines.length) G.push({ k, count, lines }); };
  add('job', '', job);
  add('task', d.own.length ? `${d.own.length} running` : '', d.own.map((x) => ({ t: x.text, m: 'running' })));
  add('model', d.helpers.length ? `${d.helpers.length} running` : '', d.helpers.map((x) => ({ t: `${x.model}: ${x.text}`, m: 'running' })));
  add('msg', d.msgs ? `${d.msgs} waiting` : '', d.msgs ? [{ t: `${d.msgs} message${d.msgs === 1 ? '' : 's'} you sent while I work` }] : []);
  add('chat', d.working ? `${d.working} working` : '', d.others.map((c, i) => ({ t: c.name || `Chat ${i + 2}`, m: c.status === 'working' ? 'working' : (c.status || '') })));
  const tok = (S.ctxUsage && S.ctxUsage.totalTokens) || 0, full = Math.min(100, Math.round(tok / 1500));   // the move to a new chat is at 150k
  const eff = effortSelect && effortSelect.value ? `${optText(effortSelect)} effort` : '';
  const chat = [{ t: [acct.free ? '' : optText(modelSelect), eff, acct.free ? 'Free mode' : 'Paid mode'].filter(Boolean).join(' · ') }];
  if (tok) chat.push({ t: `Chat ${full}% full (moves to a new chat at 100%)`, bar: full });
  if (reply) chat.push({ t: reply });
  add('brain', '', chat);
  const a = allowanceNow(), w = a.w || {}, p5 = pct(w.five_hour), p7 = pct(w.seven_day), em = acct.email || a.email || '';
  const al = [em ? em.split('@')[0] : '', p5 != null ? `5 hours ${p5}%` : '', p7 != null ? `week ${p7}%` : ''].filter(Boolean).join(' · ');
  add('allow', '', al ? [{ t: al }] : []);
  add('conn', '', [{ t: S.isConnected ? 'Connected' : 'Reconnecting…' }]);
  const key = JSON.stringify(G);
  if (box.dataset.k === key) return;   // redrawn only when something changed (the page timer calls this every second)
  box.dataset.k = key; box.textContent = '';
  for (const g of G) {
    const el = mk('div', 'h7-g'); el.style.setProperty('--c', COL[g.k]);
    const h = mk('div', 'h7-gh'); h.append(icon(g.k), mk('span', '', NAMES[g.k]));
    if (g.count) h.append(mk('span', 'h7-gn', g.count));
    el.append(h);
    for (const l of g.lines) {
      const r = mk('div', 'h7-it'); r.append(mk('span', '', l.t));
      if (l.m) r.append(mk('span', 'h7-m', l.m));
      el.append(r);
      if (l.bar != null) { const b = mk('div', 'h7-bar'), i = mk('i'); i.style.width = `${l.bar}%`; b.append(i); el.append(b); }
    }
    box.append(el);
  }
}
