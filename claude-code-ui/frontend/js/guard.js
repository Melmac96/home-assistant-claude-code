/*
 * my54: stops before a message is sent when it would be a bad idea (user's words, 2026-11-09).
 *  1. Chat too long: if this chat plus one more reply would pass 150k tokens, a centre pop-up offers
 *     "Continue this in a new chat" (saves a note and opens the new chat) or "Do one more thing here"
 *     (lets exactly ONE more message through, then asks again).
 *  2. Allowance: at 75% of either the 5-hour or the weekly allowance on the Claude account in use, a centre
 *     pop-up offers switching to the other Claude account (or carrying on for one more message).
 *  3. At 90% the switch happens by itself (only if the other account is under 75%), with a small bar saying so.
 * Figures come from the same per-account quota list the Accounts menu uses (live from Anthropic, about every minute).
 * Not used in Free mode (the paid allowance does not apply) or while Claude is already working (adds go in as before).
 */
import { S } from './state.js';
import { inputForm, promptInput } from './dom.js';

const LIM = 150;          // thousand tokens
const WARN = 75, AUTO = 90, OTHER_OK = 75;
const send = (o) => { if (S.ws && S.isConnected) S.ws.send(JSON.stringify(o)); };
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let quota = {};
let acc = { cur: null, saved: [], free: false };
let passCtx = false, passQuota = false;
let pendingAuto = null, lastAuto = 0, lastEmail = null;

window.addEventListener('haai-quota', (e) => { quota = e.detail || {}; });
window.addEventListener('haai-accounts', (e) => {
  acc = e.detail;
  const em = acc.cur && acc.cur.email;
  if (lastEmail && em && em !== lastEmail) { passQuota = false; send({ type: 'quota_get', force: true }); }
  lastEmail = em || lastEmail;
  if (pendingAuto && em && em === pendingAuto.email) { toast(pendingAuto.text); pendingAuto = null; }
});
window.addEventListener('haai-usage', () => setTimeout(() => send({ type: 'quota_get' }), 2500));
setInterval(() => { if (S.isConnected && !S.isRunning) send({ type: 'quota_get' }); }, 90000);
setTimeout(() => send({ type: 'quota_get' }), 4000);

// ── what we know ─────────────────────────────────────────────────────────────
const winUse = (w) => (!w ? 0 : (w.resetsAt && w.resetsAt * 1000 <= Date.now() ? 0 : w.used));
function use(email) {
  const q = email && quota[String(email).toLowerCase()];
  if (!q || (!q.five_hour && !q.seven_day)) return null;
  const f = winUse(q.five_hour), w = winUse(q.seven_day);
  return { f, w, max: Math.max(f, w), what: f >= w ? '5-hour' : '7-day' };
}
const nameOf = (a) => { const i = acc.saved.findIndex((x) => x.email === a.email); return `Claude Pro Account ${i + 1}`; };
const otherAcc = () => acc.saved.find((a) => !a.active && a.email !== (acc.cur && acc.cur.email));

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
  if (document.querySelector('.start-check')) { e.preventDefault(); e.stopImmediatePropagation(); return; }
  if (S.isRunning || acc.free) return;
  if (promptInput.value.trim().startsWith('/')) return;     // /compact, /help and so on must always work
  const block = () => { e.preventDefault(); e.stopImmediatePropagation(); };

  const k = typeof window.haaiNextK === 'function' ? window.haaiNextK() : 0;
  if (k >= LIM) {
    if (passCtx) { passCtx = false; return; }
    block();
    pop('This chat is nearly full', `This chat is about ${Math.round(S.ctxUsage ? S.ctxUsage.totalTokens / 1000 : k)}k tokens, and one more reply would take it past ${LIM}k. Every reply in a chat this long costs a lot more. It is better to carry on in a new chat before your next message.`, [
      ['Continue this in a new chat', 'sc-switch', () => send({ type: 'handover' })],
      ['Do one more thing here', 'sc-stay', () => { passCtx = true; }],
    ]);
    return;
  }
  passCtx = false;

  const me = acc.cur && use(acc.cur.email);
  if (me && me.max >= WARN) {
    if (passQuota) { passQuota = false; return; }
    block();
    const other = otherAcc(), ou = other && use(other.email);
    const title = `You've used ${me.max}% of your ${me.what} allowance`;
    if (other && ou && ou.max < OTHER_OK) {
      pop(title, `This is ${nameOf({ email: acc.cur.email })}. You should switch to ${nameOf(other)} (${ou.max}% used) before continuing. Your message is kept in the box.`, [
        [`Switch to ${nameOf(other)}`, 'sc-switch', () => send({ type: 'account_switch', id: other.id })],
        ['Carry on with this account', 'sc-stay', () => { passQuota = true; }],
      ]);
    } else {
      pop(title, other ? (ou ? `The other account is also fairly used (${ou.max}%), so switching would not help right now.` : 'I do not have figures for your other account yet, so I cannot say if switching would help.') : 'There is no other saved account to switch to.', [
        ['Carry on with this account', 'sc-switch', () => { passQuota = true; }],
      ]);
    }
    return;
  }
  passQuota = false;
}, true);

// ── automatic switch at 90% ──────────────────────────────────────────────────
setInterval(() => {
  if (!S.isConnected || S.isRunning || acc.free || !acc.cur || pendingAuto) return;
  if (document.querySelector('.start-check') || Date.now() - lastAuto < 10 * 60000) return;
  const me = use(acc.cur.email);
  if (!me || me.max < AUTO) return;
  const other = otherAcc(), ou = other && use(other.email);
  if (!other || !ou || ou.max >= OTHER_OK) return;
  lastAuto = Date.now();
  pendingAuto = { email: other.email, text: `haAi has automatically switched to ${nameOf(other)} for you, as you have hit ${me.max}% of your ${me.what} allowance on the account you were using.` };
  send({ type: 'account_switch', id: other.id });
  setTimeout(() => { pendingAuto = null; }, 15000);
}, 5000);
