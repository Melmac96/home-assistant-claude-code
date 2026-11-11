/*
 * my56: PREVIOUS CHAT button on the top bar (user chose A, 2026-11-09): one tap jumps back to the chat you were in
 * before this one; tap again to come back (it swaps). Remembered per device. Not shown until there is a previous chat.
 */
import { S } from './state.js';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const KEY = 'haai-chat-pair';
let pair = JSON.parse(localStorage.getItem(KEY) || '{"cur":null,"prev":null}');
const save = () => localStorage.setItem(KEY, JSON.stringify(pair));

const btn = mk('button', 'icon-btn'); btn.type = 'button'; btn.id = 'prev-chat-btn'; btn.title = 'Previous chat'; btn.setAttribute('aria-label', 'Previous chat');
btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>';
const group = document.querySelector('.icon-group');
group.prepend(btn);

const exists = (id) => id && Array.isArray(S.sessions) && S.sessions.some((s) => s.id === id);
function refresh() {
  const id = S.activeSessionId;
  if (id && id !== pair.cur) { pair = { cur: id, prev: pair.cur }; save(); }
  btn.classList.toggle('hidden', !(pair.prev && (!S.sessions || !S.sessions.length || exists(pair.prev))));
}
setInterval(() => { if (!document.hidden) refresh(); }, 1000);   // my82: rests while haAi is not on screen

btn.onclick = () => {
  if (!pair.prev || !S.ws || !S.isConnected) return;
  if (S.isRunning) {
    const t = mk('div', 'guard-toast', 'Claude is working. Stop it or wait until it finishes, then tap again.');
    t.onclick = () => t.remove(); document.body.append(t); setTimeout(() => t.remove(), 6000);
    return;
  }
  S.ws.send(JSON.stringify({ type: 'session_switch', id: pair.prev }));
};
