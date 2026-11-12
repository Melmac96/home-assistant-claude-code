/*
 * my45: haAi batch 1 (user picks 2026-11-09, test page batch1-looks.html):
 *  1 chips under every reply (A)   2 tap a hard word (A)   3 rest nudge (A, off unless switched on)
 *  4 night dimming (A)             5 remind me (A: pill + list)   7 pinned summary (A: strip that opens out)
 * (6 allowance forecast, look B, lives in usage.js.)
 */
import { S } from './state.js';
import { inputForm, messagesEl } from './dom.js';
import { sendText } from './quick.js';
import { requestNewSession } from './composer.js';
import { stripCards } from './batch2.js';   // my46

const send = (o) => { if (S.ws && S.isConnected) S.ws.send(JSON.stringify(o)); };
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ls = (k, d) => { const v = localStorage.getItem(k); return v == null ? d : v; };

// ── Hidden lines in a reply: hard words and the pinned summary ───────────────
const HARD = /⟦\?([^|⟧\n]{1,40})\|([^⟧\n]{1,200})⟧/g;
const PIN = /⟦PIN\|([^⟧\n]*)⟧[ \t]*\n?/;
const PARTIAL = /⟦(?:\?|PIN)[^⟧]*$/;
const hardOn = () => ls('hard-words', '1') === '1';

// Called by renderMarkdown before the text is turned into a page: returns the clean text and the pin fields.
export function prepareReply(raw) {
  const m = raw.match(PIN);
  const text = raw.replace(PIN, '').replace(PARTIAL, '')
    .replace(HARD, (_, w, n) => (hardOn() ? `<span class="hard" data-note="${esc(n)}">${w}</span>` : w));
  return { text, pin: m ? m[1].split('|').map((s) => s.trim()) : null };
}
// For places that show or read the raw text (stars, read aloud): the plain words only.
export const stripMarks = (t) => stripCards(String(t || '')).replace(PIN, '').replace(PARTIAL, '').replace(HARD, '$1');

// ── 2. Tap a hard word: small note above the word ────────────────────────────
let pop = null;
const closePop = () => { if (pop) { pop.remove(); pop = null; } };
messagesEl.addEventListener('click', (e) => {
  const h = e.target.closest && e.target.closest('.hard');
  if (!h) return;
  e.stopPropagation();
  const same = pop && pop.dataset.for === h.dataset.note + h.textContent;
  closePop();
  if (same) return;
  pop = mk('div', 'hard-pop', h.dataset.note);
  pop.dataset.for = h.dataset.note + h.textContent;
  document.body.append(pop);
  const r = h.getBoundingClientRect(), w = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  pop.style.top = (r.top - ph - 8 >= 8 ? r.top - ph - 8 : r.bottom + 8) + 'px';
  setTimeout(closePop, 8000);
});
document.addEventListener('click', closePop);
window.addEventListener('scroll', closePop, true);

// ── 1. Chips under every reply ───────────────────────────────────────────────
const CHIPS = [
  ['Simpler', 'Please say that again in simpler, plainer words.'],
  ['Shorter', 'Please say that again in 3 short lines.'],
  ['Why?', 'Why? Please explain the reason in plain English.'],
  ['Show me', 'Please show me, with a picture or a simple example.'],
];
export function replyChips(bubble, content) {
  if (bubble.querySelector(':scope > .reply-chips')) return;
  if (content.querySelector('.answer-card')) return;   // a question is not something to simplify
  // my51 (tidy screen): two small lines, "Explain it:" pills, then "Another way:" blue buttons
  const wrap = mk('div', 'reply-chips tidy-chips');
  const r1 = mk('div', 'tc-row'); r1.append(mk('em', null, 'Explain it:'));
  for (const [label, text] of [['Plainer', CHIPS[0][1]], CHIPS[1], CHIPS[2], CHIPS[3]]) {
    const b = mk('button', 'reply-chip', label);
    b.type = 'button';
    b.onclick = (e) => { e.stopPropagation(); sendText(text); };
    r1.append(b);
  }
  const r2 = mk('div', 'tc-row tc-way'); r2.append(mk('em', null, 'Another way:'));
  for (const [label, text] of [['\u{1F6E1} Safer', 'Please do this a different, safer way (back up first), and tell me what changes.'], ['\u26A1 Faster', 'Please do this a different, faster way, and tell me what changes.'], ['\u{1F4B7} Cheaper', 'Please do this a different, cheaper way (fewer steps, smaller chat), and tell me what changes.']]) {
    const b = mk('button', 'reply-chip way-chip', label);
    b.type = 'button';
    b.onclick = (e) => { e.stopPropagation(); sendText(text); };
    r2.append(b);
  }
  wrap.append(r1, r2);
  bubble.append(wrap);
}

// ── 7. Pinned summary: a one-line strip at the top that opens out ────────────
const sum = mk('div', 'sum-pin hidden');
const sumHead = mk('button', 'sum-head'); sumHead.type = 'button';
const sumBody = mk('div', 'sum-body hidden');
sum.append(sumHead, sumBody);
document.getElementById('chat-scroll').before(sum);
sumHead.onclick = () => { sumBody.classList.toggle('hidden'); sumHead.dataset.open = sumBody.classList.contains('hidden') ? '' : '1'; drawSum(); };
let sumData = null;
function drawSum() {
  if (!sumData) { sum.classList.add('hidden'); return; }
  sum.classList.remove('hidden');
  sumHead.textContent = `📌 ${sumData[0] || 'This chat'} ${sumHead.dataset.open ? '▴' : '▾'}`;
  sumBody.textContent = '';
  if (sumData[1]) { const l = mk('div'); l.append(mk('b', '', 'Done: '), document.createTextNode(sumData[1])); sumBody.append(l); }
  if (sumData[2]) { const l = mk('div'); l.append(mk('b', '', 'Next: '), document.createTextNode(sumData[2])); sumBody.append(l); }
}
export function pinFound(el, fields) { el.dataset.pin = JSON.stringify(fields); scanPins(); }
let pinTimer = null;
function scanPins() {
  clearTimeout(pinTimer);
  pinTimer = setTimeout(() => {
    const all = [...messagesEl.querySelectorAll('.bubble-assistant .bubble-content[data-pin]')];
    sumData = all.length ? JSON.parse(all[all.length - 1].dataset.pin) : null;
    drawSum();
    window.haaiPins = all.map((e) => JSON.parse(e.dataset.pin));   // my52: the pin button on the top bar lists these
    window.dispatchEvent(new Event('haai-pins'));
  }, 150);
}
new MutationObserver((m) => { if (m.some((x) => x.removedNodes.length)) scanPins(); }).observe(messagesEl, { childList: true });

// ── 5. Remind me: a pill and a list (Claude sets them; see server/lib/batch1.js) ─────────────────────────
let reminders = [];
const remPill = mk('button', 'rem-pill hidden'); remPill.type = 'button';
const remList = mk('div', 'rem-list hidden');
inputForm.prepend(remList); inputForm.prepend(remPill);
const UK = { timeZone: 'Europe/London' };
const when = (ms) => {
  const d = new Date(ms), day = (x) => x.toLocaleDateString('en-GB', { ...UK, day: 'numeric', month: 'short' });
  const t = d.toLocaleTimeString('en-GB', { ...UK, hour: '2-digit', minute: '2-digit' });
  return day(d) === day(new Date()) ? t : d.toLocaleDateString('en-GB', { ...UK, weekday: 'short' }) + ' ' + t;
};
function drawRem() {
  remPill.classList.toggle('hidden', !reminders.length);
  remPill.textContent = `⏰ ${reminders.length} waiting · see list`;
  if (!reminders.length) remList.classList.add('hidden');
  remList.textContent = '';
  for (const r of reminders) {
    const row = mk('div', 'rem-row');
    row.append(mk('span', 'rem-when', when(r.at)), mk('span', 'rem-text', r.text));
    const x = mk('button', 'rem-x', 'Remove'); x.type = 'button';
    x.onclick = (e) => { e.preventDefault(); send({ type: 'reminder_remove', id: r.id }); };
    row.append(x);
    remList.append(row);
  }
}
remPill.onclick = (e) => { e.preventDefault(); remList.classList.toggle('hidden'); };

// ── 3. Rest nudge (off unless switched on in Settings) ───────────────────────
const nudge = mk('div', 'rest-card hidden');
inputForm.prepend(nudge);
let chatSid = null, chatStart = Date.now(), talked = false, snoozeUntil = 0;
inputForm.addEventListener('submit', () => { talked = true; });
function checkRest() {
  const sid = S.activeSessionId || 'new';
  if (sid !== chatSid) { chatSid = sid; chatStart = Date.now(); talked = false; nudge.classList.add('hidden'); }
  if (ls('rest-on', '0') !== '1' || !talked || S.isRunning || Date.now() < snoozeUntil || !nudge.classList.contains('hidden')) return;
  const min = Number(ls('rest-min', '40'));
  const mins = Math.floor((Date.now() - chatStart) / 60000);
  if (mins < min) return;
  nudge.textContent = '';
  nudge.append(mk('div', 'rest-title', `You have been chatting for ${mins} minutes.`), mk('div', 'rest-sub', 'Good place to rest? Everything is saved.'));
  const row = mk('div', 'rest-row');
  const save = mk('button', 'rest-save', 'Save and rest'); save.type = 'button';
  const keep = mk('button', 'rest-keep', 'Keep going'); keep.type = 'button';
  save.onclick = (e) => { e.preventDefault(); nudge.classList.add('hidden'); snoozeUntil = Date.now() + 3600000; requestNewSession(); toast('Saved. Rest well.'); };
  keep.onclick = (e) => { e.preventDefault(); nudge.classList.add('hidden'); snoozeUntil = Date.now() + 3600000; };
  row.append(save, keep); nudge.append(row);
  nudge.classList.remove('hidden');
}
function toast(t) { const d = mk('div', 'haai-toast', t); document.body.append(d); setTimeout(() => d.remove(), 5000); }

// ── 4. Night dimming ─────────────────────────────────────────────────────────
function checkNight() {
  const on = ls('night-on', '0') === '1';
  const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const now = new Date(), cur = now.getHours() * 60 + now.getMinutes();
  const a = toMin(ls('night-from', '22:00')), b = toMin(ls('night-to', '07:00'));
  const inside = a <= b ? cur >= a && cur < b : cur >= a || cur < b;
  // my72: also dim while Sleep as Android is on (the house rule for 'asleep'), whatever the clock says
  document.body.classList.toggle('night', on && (inside || window.haaiAsleep === true));
}
window.addEventListener('haai-asleep', () => checkNight());

// ── Settings controls ────────────────────────────────────────────────────────
const bind = (id, key, def, isBool) => {
  const el = document.getElementById(id);
  if (!el) return;
  if (isBool) el.checked = ls(key, def) === '1'; else el.value = ls(key, def);
  el.addEventListener('change', () => { localStorage.setItem(key, isBool ? (el.checked ? '1' : '0') : el.value); checkNight(); checkRest(); });
};
bind('hard-toggle', 'hard-words', '1', true);
bind('rest-toggle', 'rest-on', '0', true);
bind('rest-min', 'rest-min', '40', false);
bind('night-toggle', 'night-on', '0', true);
bind('night-from', 'night-from', '22:00', false);
bind('night-to', 'night-to', '07:00', false);
setInterval(() => { if (document.hidden) return; checkRest(); checkNight(); }, 30000);   // my88: rests while haAi is not on screen
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkNight(); });   // my88
checkNight();

export function onBatch1Message(msg) {
  if (msg.type === 'reminders') { reminders = msg.list || []; drawRem(); }
}
