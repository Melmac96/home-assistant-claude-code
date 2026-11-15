/*
 * my115 (Michael C, 15 Nov 2026): the small helpers that were copied into about a dozen page files (mk, the
 * socket sender, toast) live here once, plus ONE shared timer that the page's regular checks hang off (there were
 * 18 separate timers running all the time).
 *
 *   mk(tag, cls, text)        a new element
 *   wsSend(obj)               sends to haAi; true when it went, false with no link (never throws)
 *   toast(text, ms)           a small note at the bottom that goes by itself (tap to close)
 *   every(ms, fn, hidden)     runs fn about every ms; while haAi is not on screen it rests unless hidden = true
 */
import { S } from './state.js';

export const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function wsSend(o) {
  if (S.ws && S.isConnected && S.ws.readyState === 1) { try { S.ws.send(JSON.stringify(o)); return true; } catch { /* below */ } }
  return false;
}

export function toast(text, ms = 7000) {
  const t = mk('div', 'guard-toast', text);
  t.onclick = () => t.remove();
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
  return t;
}

const jobs = [];   // { ms, fn, hidden, last }
const BASE = 200;
setInterval(() => {
  const now = Date.now();
  for (const j of jobs) {
    if (now - j.last < j.ms) continue;
    if (document.hidden && !j.hidden) continue;
    j.last = now;
    try { j.fn(); } catch (e) { console.warn('a regular page check failed', e); }
  }
}, BASE);
export function every(ms, fn, hidden = false) { jobs.push({ ms: Math.max(BASE, ms), fn, hidden, last: 0 }); }
