/*
 * my79 (the last 6 of Michael's 12 picks, twelve-ideas-looks.html, 2026-11-11):
 *  H5  ⟦CLASH|…⟧ card: two rules side by side, Keep rule 1 / Keep rule 2 / Both (Look A)
 *  H9  typing follows him between phone and tablet, tiny grey "From your phone, 1 min ago" line (Look A)
 *  H10 "Checks for today" card: what haAi found, Agree / Look again (Look B)
 *  H17 ⟦TIMED|…⟧ card: "Job set for 15:00 UK time" with Cancel (Look B)
 *  (H11 is a part of the morning line in batch2.js, H12 the haAi group in homehealth.js)
 */
import { S } from './state.js';
import { inputForm, messagesEl, promptInput } from './dom.js';
import { sendText } from './quick.js';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const wsSend = (o) => { if (S.ws && S.isConnected) { S.ws.send(JSON.stringify(o)); return true; } return false; };

// ── H17 job at a set time ────────────────────────────────────────────────────
let timed = {};   // id -> { status, ranAt }
const hm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
function paintTimed(c) {
  const j = timed[c.dataset.timed];
  const st = c.querySelector('.h79-state'), b = c.querySelector('.h2-btn');
  if (!j) return;   // not heard from the server yet: leave Cancel as it is
  if (j.status === 'cancelled') { st.textContent = 'Cancelled'; st.className = 'h2-line h79-state grey'; b.disabled = true; }
  else if (j.status === 'ran') { st.textContent = `✓ Started at ${hm(j.ranAt)} UK time`; st.className = 'h2-line h79-state green'; b.disabled = true; }
}
export function timedCard(f, card, line) {
  const c = card('info', `🕒 Job set for ${f[1] || 'later'}`);
  c.dataset.timed = f[0] || '';
  line(c, f[2]);
  c.append(mk('div', 'h2-line h79-state'));
  const b = mk('button', 'h2-btn sm', 'Cancel'); b.type = 'button';
  b.onclick = (e) => { e.stopPropagation(); if (wsSend({ type: 'timed_cancel', id: c.dataset.timed })) b.disabled = true; };
  const r = mk('div', 'h2-row'); r.append(b); c.append(r);
  paintTimed(c);
  return c;
}

// ── H5 two rules that disagree ───────────────────────────────────────────────
export function clashCard(f, card, line, row, btn) {
  const c = card('bad', 'Two rules disagree', 'red');
  const g = mk('div', 'h79-clash');
  for (const [n, t] of [[1, f[0]], [2, f[1]]]) { const box = mk('div', 'h79-rule'); box.append(mk('b', '', `Rule ${n}`), mk('div', '', t || '')); g.append(box); }
  c.append(g);
  if (f[2]) line(c, f[2]);
  const q = (n) => `"${String(n || '').slice(0, 160)}"`;
  c.append(row(
    btn('Keep rule 1', 'g sm', () => sendText(`Rule clash: keep rule 1 (${q(f[0])}). Change the other rule to match it, back up first and log it.`), c),
    btn('Keep rule 2', 'g sm', () => sendText(`Rule clash: keep rule 2 (${q(f[1])}). Change the other rule to match it, back up first and log it.`), c),
    btn('Both', 'sm', () => sendText(`Rule clash: keep both (${q(f[0])} and ${q(f[1])}). Write down that they do not really clash, so you do not ask again.`), c)));
  return c;
}

// ── H10 checks for today ─────────────────────────────────────────────────────
let checks = [];
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/London' });
const SEEN = 'haai-checks-seen';
const seenMap = () => { try { return JSON.parse(localStorage.getItem(SEEN) || '{}') || {}; } catch { return {}; } };
let shown = [];   // the lines on the card in this page
const chk = mk('div', 'h2-card info h79-checks');
let chkTimer = null;
function drawChecks() {
  const live = shown.filter((w) => checks.some((c) => c.id === w.id));
  for (const w of live) { const now = checks.find((c) => c.id === w.id); w.found = now.found; }
  shown = live;
  chk.textContent = '';
  if (!shown.length) { chk.remove(); return; }
  chk.append(mk('div', 'h2-title', 'Checks for today'));
  for (const w of shown) {
    const r = mk('div', 'h79-check');
    r.append(mk('div', 'h2-line', w.text));
    const ok = w.found && /✓\s*$/.test(w.found), bad = w.found && /✗\s*$/.test(w.found);
    r.append(mk('div', 'h2-line ' + (ok ? 'green' : bad ? 'red' : 'grey'), w.found ? `haAi found: ${w.found}` : 'haAi could not check this by itself'));
    const agree = mk('button', 'h2-btn g sm', w.found ? 'Agree' : 'It is fine'); agree.type = 'button';
    agree.onclick = (e) => { e.stopPropagation(); if (wsSend({ type: 'waiting_done', id: w.id })) { agree.disabled = true; again.disabled = true; } };
    const again = mk('button', 'h2-btn sm', w.found ? 'Look again' : 'Look at it'); again.type = 'button';
    again.onclick = (e) => { e.stopPropagation(); agree.disabled = true; again.disabled = true; sendText(`Please look at this check for today: "${w.text}".${w.found ? ` haAi found: ${w.found}.` : ''} Tell me in plain words if it is right.`); };
    const row = mk('div', 'h2-row'); row.append(agree, again); r.append(row);
    chk.append(r);
  }
  if (!chk.isConnected) messagesEl.append(chk);
}
function onChecks(list) {
  checks = Array.isArray(list) ? list : [];
  const seen = seenMap(), d = today();
  let added = false;
  for (const c of checks) if (seen[c.id] !== d && !shown.some((w) => w.id === c.id)) { shown.push({ ...c }); seen[c.id] = d; added = true; }   // once a day on each device
  for (const k of Object.keys(seen)) if (!checks.some((c) => c.id === k)) delete seen[k];
  try { localStorage.setItem(SEEN, JSON.stringify(seen)); } catch { /* full */ }
  drawChecks();
  if (added) chk.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

// ── H9 typing follows him ────────────────────────────────────────────────────
const ME = (() => { let id = localStorage.getItem('haai-dev-id'); if (!id) { id = Math.random().toString(36).slice(2, 12); localStorage.setItem('haai-dev-id', id); } return id; })();
const KIND = Math.min(screen.width, screen.height) >= 600 ? 'tablet' : 'phone';
const note = mk('div', 'h79-from hidden');
inputForm.before(note);
let lastSent = promptInput.value, applied = null, fromAt = 0, fromKind = '', sendTimer = null;
function drawNote() {
  if (applied == null || promptInput.value !== applied || !applied) { note.classList.add('hidden'); return; }
  const m = Math.max(0, Math.round((Date.now() - fromAt) / 60000));
  note.textContent = `From your ${fromKind}, ${m < 1 ? 'just now' : m === 1 ? '1 min ago' : m < 60 ? `${m} min ago` : 'over an hour ago'}`;
  note.classList.remove('hidden');
}
function pushDraft() {
  clearTimeout(sendTimer);
  sendTimer = setTimeout(() => {
    const v = promptInput.value;
    if (v === lastSent) return;
    if (wsSend({ type: 'draft', text: v, from: ME, kind: KIND })) lastSent = v;
  }, 700);
}
promptInput.addEventListener('input', (e) => { if (e.isTrusted) { applied = null; drawNote(); } pushDraft(); });
setInterval(() => { if (promptInput.value !== lastSent) pushDraft(); drawNote(); }, 1500);   // also catches the box being emptied by Send
function onDraft(msg) {
  if (msg.from === ME) return;
  const mine = promptInput.value;
  const free = !mine || mine === applied || mine === lastSent;   // never write over words typed here
  if (!free || (document.activeElement === promptInput && mine)) return;
  if (msg.text === mine) return;
  promptInput.value = msg.text || '';
  lastSent = promptInput.value; applied = promptInput.value; fromAt = msg.at || Date.now(); fromKind = msg.kind || 'other device';
  promptInput.dispatchEvent(new Event('input'));   // the box grows to fit, like when typed
  drawNote();
}

// ── Messages from the server, and after each history rebuild ─────────────────
export function onMy79Message(msg) {
  if (msg.type === 'timed') {
    timed = {}; for (const j of msg.list || []) timed[j.id] = j;
    messagesEl.querySelectorAll('[data-timed]').forEach(paintTimed);
  } else if (msg.type === 'dated_checks') onChecks(msg.list);
  else if (msg.type === 'draft') onDraft(msg);
}
export function afterHistory79() {
  messagesEl.querySelectorAll('[data-timed]').forEach(paintTimed);
  clearTimeout(chkTimer); chkTimer = setTimeout(drawChecks, 700);   // chat rebuilt: put the card back once it settles
}
