/*
 * my49: haAi batch 5 (user picks CABC, test page batch5-looks.html, 2026-11-09).
 *  32 Live house chips (C): ONE calm chip, "✔ Home fine", turns red and says what needs a look; tap opens the Home health panel
 *  34 TV reading view (A): big white text on black, newest reply only, no buttons; "📺 TV view" chip, Back / Esc leaves
 *  35 Quiet while you sleep (B): small pill "🌙 Quiet (n held)" with Show now, while Sleep as Android is on
 *  33 Watch: route C is a separate job (own Wear OS app), not in this file
 */
import { S } from './state.js';
import { mk, wsSend } from './util.js';   // my115: shared helpers
import { messagesEl } from './dom.js';

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
// my115: only re-marked when the chat's own list of messages changes, a moment later (it ran on every streamed piece)
let tvT = 0;
new MutationObserver(() => { if (!document.body.classList.contains('tv-view')) return; clearTimeout(tvT); tvT = setTimeout(markLast, 200); }).observe(messagesEl, { childList: true });
// my115: TV view only comes back by itself on a TV-sized screen; on a phone or tablet it never hides the typing box
// after a reload (the only way out was a faint button)
const bigScreen = () => /\b(Android TV|SHIELD|AFT\w*|GoogleTV|BRAVIA)\b|\bTV\b/i.test(navigator.userAgent) ||
  (Math.min(screen.width, screen.height) >= 700 && !matchMedia('(pointer: coarse)').matches);
if (/[?&]tv=1/.test(location.search) || (localStorage.getItem('tv-view') === '1' && bigScreen())) setTv(true);
else if (localStorage.getItem('tv-view') === '1') { try { localStorage.setItem('tv-view', ''); } catch { /* ignore */ } }
bar.append(tvBtn);
