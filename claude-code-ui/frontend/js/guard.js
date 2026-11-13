/*
 * my54: stops before a message is sent when it would be a bad idea (user's words, 2026-11-09).
 *  1. my91 (Michael 2026-11-13): the "chat nearly full" pop-up is GONE. Once a chat has passed 150k tokens, the server
 *     moves it to a new chat by itself when the reply has finished (my87.js autoMove); the colour bar at the bottom stays.
 *  2. my90 (Michael 2026-11-13): the 75% pop-up and the page's own 90% switch are GONE. The server now moves a chat
 *     between the three accounts by itself (my90.js); this page only shows what happened: a small bar when a chat
 *     moved account, and a centre pop-up with Carry on / Wait when every account is at 90% (main stops at 95%).
 * Not used in Free mode (the paid allowance does not apply) or while Claude is already working (adds go in as before).
 */
import { S } from './state.js';
import { inputForm } from './dom.js';

const send = (o) => { if (S.ws && S.isConnected) S.ws.send(JSON.stringify(o)); };
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let quota = {};
let acc = { cur: null, saved: [], free: false };
let lastEmail = null;

window.addEventListener('haai-quota', (e) => { quota = e.detail || {}; });
window.addEventListener('haai-accounts', (e) => {
  acc = e.detail;
  const em = acc.cur && acc.cur.email;
  if (lastEmail && em && em !== lastEmail) send({ type: 'quota_get', force: true });
  lastEmail = em || lastEmail;
});
window.addEventListener('haai-usage', () => setTimeout(() => send({ type: 'quota_get' }), 2500));
setInterval(() => { if (S.isConnected && !S.isRunning && !document.hidden) send({ type: 'quota_get' }); }, 90000);   // my88: rests while not on screen
setTimeout(() => send({ type: 'quota_get' }), 4000);

// ── what we know ─────────────────────────────────────────────────────────────
const winUse = (w) => (!w ? 0 : (w.resetsAt && w.resetsAt * 1000 <= Date.now() ? 0 : w.used));
function use(email) {
  const q = email && quota[String(email).toLowerCase()];
  if (!q || (!q.five_hour && !q.seven_day)) return null;
  const f = winUse(q.five_hour), w = winUse(q.seven_day);
  return { f, w, max: Math.max(f, w), what: f >= w ? '5-hour' : '7-day' };
}
// ── pop-up and bar ───────────────────────────────────────────────────────────
function pop(title, text, buttons) {
  const ov = mk('div', 'start-check guard-pop'); ov.setAttribute('role', 'alertdialog'); ov.setAttribute('aria-modal', 'true');
  const card = mk('div', 'sc-card');
  card.append(mk('div', 'sc-title', title), mk('div', 'sc-q', text));
  for (const [label, cls, fn] of buttons) {
    const b = mk('button', cls, label); b.type = 'button';
    b.onclick = () => { ov.remove(); fn(); };
    card.append(b);
  }
  ov.append(card); ov.addEventListener('click', (e) => e.stopPropagation());
  document.body.append(ov);
}
function toast(text) {
  const t = mk('div', 'guard-toast', text);
  t.onclick = () => t.remove();
  document.body.append(t);
  setTimeout(() => t.remove(), 20000);
}

// ── the stop before sending ──────────────────────────────────────────────────
inputForm.addEventListener('submit', (e) => {
  if (document.querySelector('.start-check')) { e.preventDefault(); e.stopImmediatePropagation(); }   // a pop-up is still open
}, true);

// ── my90: what the server did with the accounts ──────────────────────────────
const nameByEmail = (email) => { const i = acc.saved.findIndex((x) => x.email === email); return i >= 0 ? `Claude Pro Account ${i + 1}` : 'another account'; };
window.addEventListener('haai-cycle', (e) => {
  const m = e.detail || {};
  if (m.type === 'cycle_moved') {
    toast(m.used ? `Your account reached ${m.used}% of its 5 hours, so haAi moved this chat to ${nameByEmail(m.to)} and carried on by itself.`
      : `haAi is using ${nameByEmail(m.to)} now, as its 5 hours run out soonest.`);
    send({ type: 'quota_get', force: true });
  } else if (m.type === 'cycle_stop') {
    if (document.querySelector('.guard-pop')) return;
    pop('haAi has stopped', `${m.text || 'All your Claude accounts are at their limit.'} Carry on uses the accounts past 90%, but your main account still stops at 95%.`, [
      ['Carry on', 'sc-switch', () => send({ type: 'cycle_carry_on', on: true })],
      ['Wait', 'sc-stay', () => send({ type: 'cycle_carry_on', on: false })],
    ]);
  }
});
