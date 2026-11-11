/*
 * my73: the chat opens where Michael left it, on every device. When HE scrolls (finger, wheel
 * or keys, not a reply arriving) the place is sent to the server: which message is at the top
 * of the screen and how far into it, or "at the bottom". When a chat is shown, the server's
 * place is used if ANOTHER device saved it, or if this page has just been opened.
 */
import { S } from './state.js';
import { messagesEl } from './dom.js';

const wsSend = (o) => { if (S.ws && S.isConnected) S.ws.send(JSON.stringify(o)); };
const DEV = localStorage.getItem('haai-dev') || (() => {
  const d = Math.random().toString(36).slice(2, 12);
  localStorage.setItem('haai-dev', d);
  return d;
})();

let sid = null;
let firstRender = true;
let userAt = 0;        // last time his finger, wheel or keys moved the chat
let timer = null;

const bubbles = () => messagesEl.querySelectorAll('.bubble');

function here() {
  const top = messagesEl.getBoundingClientRect().top;
  const list = bubbles();
  for (let i = 0; i < list.length; i++) {
    const r = list[i].getBoundingClientRect();
    if (r.bottom > top + 1) return { idx: i, frac: r.height > 0 ? Math.max(0, Math.min(1, (top - r.top) / r.height)) : 0 };
  }
  return { idx: Math.max(0, list.length - 1), frac: 0 };
}

function save() {
  const cur = sid || S.activeSessionId;   // a brand-new chat gets its id after it was drawn
  if (!cur) return;
  const p = S.stickToBottom ? { idx: 0, frac: 0 } : here();
  wsSend({ type: 'scrollpos_set', sid: cur, bottom: !!S.stickToBottom, idx: p.idx, frac: p.frac, dev: DEV });
}

const mark = () => { userAt = Date.now(); };
['touchstart', 'touchmove', 'wheel', 'keydown', 'pointerdown'].forEach((e) => messagesEl.addEventListener(e, mark, { passive: true }));
messagesEl.addEventListener('scroll', () => {
  if (S.suppressAutoScroll || Date.now() - userAt > 1500) return;
  clearTimeout(timer);
  timer = setTimeout(save, 700);
});
window.addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); save(); } });

function goTo(pos) {
  if (pos.bottom) {
    S.stickToBottom = true;
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return;
  }
  const list = bubbles();
  if (!list.length) return;
  const b = list[Math.min(pos.idx, list.length - 1)];
  const off = b.getBoundingClientRect().top - messagesEl.getBoundingClientRect().top + messagesEl.scrollTop;
  S.stickToBottom = false;
  messagesEl.scrollTop = Math.max(0, off + (pos.frac || 0) * b.offsetHeight);
}

// Called by connection.js straight after a chat has been drawn.
export function afterHistory(msg) {
  const changed = msg.sid !== sid;
  sid = msg.sid || null;
  const pos = msg.scrollPos;
  const use = pos && (firstRender || changed || pos.dev !== DEV);
  firstRender = false;
  if (!use) return;
  goTo(pos);
  // Pictures and long code can grow after drawing: settle once more.
  setTimeout(() => { if (Date.now() - userAt > 1500) goTo(pos); }, 400);
}
