/*
 * my74 (Michael's picks 2026-11-11, twelve-ideas-looks.html):
 *  H4  "Broke a rule" button under every reply (Look A) + the ⟦RULE|…⟧ card (built in batch2.js)
 *  H6  job cost on the Finished box only (Look C): figures come from the server (jobcost)
 *  H8  Send when back (Look A): with no connection the message waits under an amber line, Cancel on it
 *  H16 What's new card at the top of the chat (Look A), Try it on each line, Got it closes it everywhere
 *  H20 Save as button on the Finished box (Look A); saved jobs also sit in the Quick list (lightning button)
 */
import { S } from './state.js';
import { messagesEl } from './dom.js';
import { sendText } from './quick.js';
import { appendInfoLine } from './transcript.js';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const wsSend = (o) => { if (S.ws && S.isConnected) { S.ws.send(JSON.stringify(o)); return true; } return false; };

// ── H6 job cost ──────────────────────────────────────────────────────────────
let costs = {};
export const costKey = (fields) => fields.slice(0, 2).map((s) => String(s || '').trim()).join('|').slice(0, 300);
const costCls = (p) => (p < 10 ? 'green' : p <= 25 ? 'amber' : 'red');
export function costText(el, key) {
  el.dataset.costkey = key;
  const p = costs[key];
  el.textContent = '';
  if (p == null) return;
  el.append(document.createTextNode('This job used '), mk('span', costCls(p), p < 1 ? 'under 1%' : `${p}%`), document.createTextNode(' of your 5 hours'));
}
function repaintCosts() { messagesEl.querySelectorAll('[data-costkey]').forEach((e) => costText(e, e.dataset.costkey)); }

// ── H4 broke a rule ──────────────────────────────────────────────────────────
export function ruleButton(getRaw) {
  const b = mk('button', 'rule-btn', '⚠ Broke a rule'); b.type = 'button';
  b.onclick = (e) => {
    e.stopPropagation();
    const snip = getRaw().replace(/🔹+/g, '').replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!S.isConnected) { appendInfoLine('No connection, so nothing was sent. Try again when haAi is back.'); return; }
    wsSend({ type: 'rule_broken', text: snip });
    sendText(`That broke a rule. The reply that starts: "${snip}". Please find which of my rules it broke and suggest a fix.`);
  };
  return b;
}

// ── H20 Save as button ───────────────────────────────────────────────────────
export function saveJobText(what) {
  return `Please save the job you just finished${what ? ` ("${what}")` : ''} as a one-tap button in my Quick list, with the exact steps that worked so next time is cheaper.`;
}

// ── H8 send when back ────────────────────────────────────────────────────────
const OUT = 'haai-outbox';
const readOut = () => { try { const l = JSON.parse(localStorage.getItem(OUT) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } };
const writeOut = (l) => { try { localStorage.setItem(OUT, JSON.stringify(l)); } catch { /* full */ } };
function drawOutbox() {
  messagesEl.querySelectorAll('.h74-wait').forEach((e) => e.remove());
  let last = null;
  for (const m of readOut()) {
    const b = mk('div', 'bubble bubble-user h74-wait'); last = b;
    const c = mk('div', 'bubble-content'); c.append(mk('div', '', m.text)); b.append(c);
    const line = mk('div', 'h74-wait-line', '⏳ No connection. Waiting to send. ');
    const x = mk('button', 'h2-btn sm', 'Cancel'); x.type = 'button';
    x.onclick = (e) => { e.stopPropagation(); writeOut(readOut().filter((o) => o.id !== m.id)); drawOutbox(); };
    line.append(x); b.append(line);
    messagesEl.append(b);
  }
  if (last) last.scrollIntoView({ block: 'end' });
}
export function queueOffline(text) {
  const l = readOut(); l.push({ id: Date.now().toString(36), text, at: Date.now() }); writeOut(l);
  drawOutbox();
}
let flushTimer = null;
function flushOutbox() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    const l = readOut();
    if (!l.length) return;
    if (!S.isConnected) { drawOutbox(); return; }
    writeOut([]);
    messagesEl.querySelectorAll('.h74-wait').forEach((e) => e.remove());
    sendText(l.map((m) => m.text).join('\n\n'));   // all waiting messages go as one, in the order typed
  }, 900);   // let the greeting burst (history, sessions, chats) settle first
}
setTimeout(() => { if (!S.isConnected && readOut().length) drawOutbox(); }, 3000);   // page opened while still offline

// ── H16 What's new ───────────────────────────────────────────────────────────
let news = null;
function flash(sel) {
  const all = messagesEl.querySelectorAll(sel);
  const t = all[all.length - 1];
  if (!t) return false;
  t.scrollIntoView({ block: 'center', behavior: 'smooth' });
  t.classList.add('h74-flash'); setTimeout(() => t.classList.remove('h74-flash'), 2600);
  return true;
}
function drawNews() {
  document.getElementById('h74-news')?.remove();
  if (!news || !news.items || !news.items.length) return;
  const c = mk('div', 'h2-card info h74-news'); c.id = 'h74-news';
  c.append(mk('div', 'h2-title', `What's new in update ${String(news.version || '').replace(/^my/, '')}`));
  for (const it of news.items) {
    const r = mk('div', 'h74-news-row');
    r.append(mk('span', 'h74-news-t', it.t));
    const b = mk('button', 'h2-btn sm', 'Try it'); b.type = 'button';
    b.onclick = (e) => {
      e.stopPropagation();
      if (it.click && document.getElementById(it.click)) { document.getElementById(it.click).click(); return; }
      if (it.flash && flash(it.flash)) return;
      appendInfoLine(it.how);
    };
    r.append(b); c.append(r);
  }
  const ok = mk('button', 'h2-btn g sm', 'Got it'); ok.type = 'button';
  ok.onclick = (e) => { e.stopPropagation(); c.remove(); news = null; wsSend({ type: 'whatsnew_seen' }); };
  const row = mk('div', 'h2-row'); row.append(ok); c.append(row);
  messagesEl.prepend(c);
}

// ── Messages from the server, and after each history rebuild ─────────────────
export function onMy74Message(msg) {
  if (msg.type === 'jobcost') {
    if (msg.map) costs = { ...msg.map }; else if (msg.key) costs[msg.key] = msg.pct;
    repaintCosts();
  } else if (msg.type === 'whatsnew') {
    news = msg.items ? msg : null;
    drawNews();
  }
}
export function afterHistory74() {
  drawNews();
  repaintCosts();
  if (readOut().length) flushOutbox();
}
