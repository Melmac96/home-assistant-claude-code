/*
 * my49: haAi batch 5 (user picks CABC, test page batch5-looks.html, 2026-11-09).
 *  32 Live house chips (C): ONE calm chip, "✔ Home fine", turns red and says what needs a look; tap opens the Home health panel
 *  34 TV reading view (A): big white text on black, newest reply only, no buttons; "📺 TV view" chip, Back / Esc leaves
 *  35 Quiet while you sleep (B): small pill "🌙 Quiet (n held)" with Show now, while Sleep as Android is on
 *  33 Watch: route C is a separate job (own Wear OS app), not in this file
 */
import { S } from './state.js';
import { messagesEl } from './dom.js';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const wsSend = (o) => { if (S.ws && S.isConnected) S.ws.send(JSON.stringify(o)); };

const bar = mk('div', 'h5-row');
document.getElementById('chat-scroll').before(bar);

// ── 32. one calm home chip ───────────────────────────────────────────────────
const home = mk('button', 'reply-chip h5-home hidden'); home.type = 'button';
home.onclick = () => document.getElementById('health-btn')?.click();
bar.append(home);
export function homeChip(text, bad) { home.textContent = text; home.classList.toggle('bad', !!bad); home.classList.remove('hidden'); }

// ── 35. quiet pill ───────────────────────────────────────────────────────────
const quiet = mk('button', 'reply-chip h5-quiet hidden'); quiet.type = 'button';
const list = mk('div', 'h2-card plain h5-held hidden');
bar.after(list);
let q = { on: false, held: [] };
export function onQuiet(msg) { q = { on: !!msg.on, held: msg.held || [] }; window.haaiAsleep = q.on; window.dispatchEvent(new Event('haai-asleep')); drawQuiet(); }
function drawQuiet() {
  if (!q.on && !q.held.length) { quiet.classList.add('hidden'); list.classList.add('hidden'); return; }
  quiet.classList.remove('hidden');
  quiet.textContent = `${q.on ? '🌙 Quiet' : '☀ Pushes held'} (${q.held.length} held)${q.held.length ? ' ▾' : ''}`;
  list.textContent = '';
  q.held.forEach((h) => list.append(mk('div', 'h2-line', `${new Date(h.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ${h.title}: ${h.message}`)));
  if (!q.on && q.held.length) {
    const c = mk('button', 'h2-btn', 'Clear'); c.type = 'button';
    c.onclick = () => { wsSend({ type: 'quiet_clear' }); list.classList.add('hidden'); };
    list.append(c);
  }
  if (!q.held.length) list.classList.add('hidden');
}
quiet.onclick = () => { if (q.held.length) list.classList.toggle('hidden'); };
bar.append(quiet);

// ── 34. TV reading view ──────────────────────────────────────────────────────
const tvBtn = mk('button', 'reply-chip', '📺 TV view'); tvBtn.type = 'button'; tvBtn.id = 'tv-view-btn';   // my52: opened from the ☰ menu
const tvExit = mk('button', 'h2-btn h5-exit', 'Leave TV view'); tvExit.type = 'button';
document.body.append(tvExit);
function markLast() {
  messagesEl.querySelectorAll('.tv-last').forEach((e) => e.classList.remove('tv-last'));
  const all = messagesEl.querySelectorAll('.bubble-assistant');
  if (all.length) all[all.length - 1].classList.add('tv-last');
}
function setTv(on) {
  document.body.classList.toggle('tv-view', on);
  try { localStorage.setItem('tv-view', on ? '1' : ''); } catch { /* ignore */ }
  if (on) markLast();
}
tvBtn.onclick = () => setTv(true);
tvExit.onclick = () => setTv(false);
document.addEventListener('keydown', (e) => { if (document.body.classList.contains('tv-view') && (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack')) setTv(false); });
new MutationObserver(() => { if (document.body.classList.contains('tv-view')) markLast(); }).observe(messagesEl, { childList: true, subtree: true });
if (localStorage.getItem('tv-view') === '1' || /[?&]tv=1/.test(location.search)) setTv(true);
bar.append(tvBtn);
