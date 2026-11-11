/*
 * my48: haAi batch 4 (user picks AAABA, test page batch4-looks.html, 2026-11-09).
 *  17 Undo last job (A): button on the finished card (built in batch2.js, text from undoText here)
 *  18 Job queue (A): a strip above the typing box listing what you added while Claude is working
 *  21 Overnight jobs (A): 🌙 Tonight button next to the microphone; saved on the server, started after Sleep as Android has been on 30 min
 *  28 Try another way (B): chip under every reply (built in batch1.js)
 *  26 Find by day (A): day buttons in Sessions (built in sessions.js)
 */
import { S } from './state.js';
import { inputForm, promptInput, permModeSelect } from './dom.js';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const wsSend = (o) => { if (S.ws && S.isConnected) S.ws.send(JSON.stringify(o)); };
const short = (t) => (t.length > 70 ? t.slice(0, 67) + '…' : t);

export const undoText = (where) => `Please undo the last job. ${where ? `The undo copy is: ${where}. ` : ''}First tell me, in plain words, exactly what you would put back and from where, and ask me Yes / Not now before you change anything.`;

// ── 18. Queue strip ──────────────────────────────────────────────────────────
const queue = mk('div', 'h2-card info h4-queue hidden');
inputForm.before(queue);
let added = [];
export function noteAdded(text) { const t = String(text || '').trim(); if (t) { added.push(t); drawQueue(); } }
let queueDrawn = '';   // my82: only redraw when the list changed
function drawQueue() {
  if (!S.isRunning) added = [];
  if (!added.length) { queue.classList.add('hidden'); queueDrawn = ''; return; }
  const sig = added.join('\n');
  if (sig === queueDrawn && !queue.classList.contains('hidden')) return;
  queueDrawn = sig;
  queue.classList.remove('hidden');
  queue.textContent = '';
  queue.append(mk('div', 'h2-title', `Added while working (${added.length})`));
  added.forEach((t, i) => queue.append(mk('div', 'h2-line', `${i + 1} ● ${short(t)}`)));
  queue.append(mk('div', 'h2-line grey', 'Claude takes these in order as soon as it can.'));
}
setInterval(() => { if (!document.hidden) drawQueue(); }, 1500);   // my82

// ── 21. Overnight jobs ───────────────────────────────────────────────────────
const night = mk('div', 'h2-card plain h4-night hidden');
inputForm.before(night);
const mic = document.getElementById('mic-btn');
const nBtn = mk('button', 'attach-btn h3-btn', '🌙'); nBtn.type = 'button'; nBtn.id = 'night-btn';
nBtn.title = 'Do this tonight, while I sleep'; nBtn.setAttribute('aria-label', nBtn.title);
if (mic) mic.after(nBtn);
nBtn.onclick = () => {
  const t = promptInput.value.trim();
  if (!t) { toast('Type the job first, then tap 🌙 to save it for tonight.'); return; }
  wsSend({ type: 'overnight_add', text: t, permissionMode: permModeSelect ? permModeSelect.value : undefined });
  promptInput.value = ''; promptInput.dispatchEvent(new Event('input'));
  toast('Saved for tonight. It starts 30 minutes after Sleep as Android starts. Nothing is done until then.');
};
const toast = (t) => { const d = mk('div', 'haai-toast', t); document.body.append(d); setTimeout(() => d.remove(), 6000); };
let nightList = [];
export function onOvernight(msg) {
  nightList = msg.list || [];
  night.textContent = '';
  if (!nightList.length) { night.classList.add('hidden'); return; }
  night.classList.remove('hidden');
  night.append(mk('div', 'h2-title', `🌙 Tonight (${nightList.length})`));
  for (const j of nightList) {
    const r = mk('div', 'h2-row');
    r.append(mk('span', 'h2-line', short(j.text)));
    const x = mk('button', 'h2-btn', 'Remove'); x.type = 'button';
    x.onclick = (e) => { e.preventDefault(); wsSend({ type: 'overnight_remove', id: j.id }); };
    r.append(x); night.append(r);
  }
}
