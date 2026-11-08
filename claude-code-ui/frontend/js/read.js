/*
 * my43: READ TO ME (user's design, 2026-11-08) and TALK (blue microphone).
 *  - A speaker button (no text) at the top AND the bottom of every reply. Both do the same: a sheet opens with the
 *    reply split into tappable pieces; tick some and press "Read selected", or press "Read it all to me". Stop while reading.
 *  - Talk: blue mic beside the paperclip; tap to start, tap to stop; the words go into the typing box (not sent).
 * Voices: the haAi phone app (v11+) provides them natively (window.HaAiNative); a normal browser uses its own speech.
 */
import { S } from './state.js';
import { promptInput } from './dom.js';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const native = () => (typeof window.HaAiNative !== 'undefined' ? window.HaAiNative : null);
const SVG = (d) => `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const SPEAKER = SVG('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>');
const MIC = SVG('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="22"/>');

// ── Split a reply into pieces ────────────────────────────────────────────────
export function splitReply(raw) {
  let t = String(raw || '')
    .replace(/⟦ADVISE\|[^⟧\n]*⟧/g, '')
    .replace(/```[\s\S]*?```/g, '\n\n(a code block is skipped)\n\n')
    .replace(/^(?:🔹){8}[ \t]*$/gm, '')
    .replace(/[🟦🟥]?\s*⟦\/?QUESTION⟧/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\|/g, ' ')
    .replace(/[ \t]+/g, ' ');
  const blocks = t.split(/\n\s*\n/).map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean).join('. ').replace(/\.\.+/g, '.').replace(/([.!?:])\./g, '$1')).filter((b) => b.length > 1);
  // Short blocks (headings, single words) join the next one; long ones split at sentence ends.
  const J = (a, b) => (/[.!?:]$/.test(a) ? a + ' ' + b : a + '. ' + b);
  const out = []; let carry = '';
  for (const b of blocks) {
    const cur = carry ? J(carry, b) : b; carry = '';
    if (cur.length < 70) { carry = cur; continue; }
    if (cur.length <= 380) { out.push(cur); continue; }
    let part = '';
    for (const s of cur.match(/[^.!?]+[.!?]*\s*/g) || [cur]) {
      if ((part + s).length > 320 && part) { out.push(part.trim()); part = s; } else part += s;
    }
    if (part.trim()) out.push(part.trim());
  }
  if (carry) { if (out.length && carry.length < 40) out[out.length - 1] = J(out[out.length - 1], carry); else out.push(carry); }
  return out;
}

// ── Speaking ─────────────────────────────────────────────────────────────────
let speakDone = null;
window.haaiSpeakDone = (ok) => { const f = speakDone; speakDone = null; if (f) f(ok !== false); };
function canSpeak() { return !!native() || ('speechSynthesis' in window); }
function speakOne(text) {
  return new Promise((resolve) => {
    const n = native();
    if (n) { speakDone = resolve; try { n.speak(text); } catch { speakDone = null; resolve(false); } return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    const v = (speechSynthesis.getVoices() || []).find((x) => /en[-_]GB/i.test(x.lang));
    if (v) u.voice = v;
    u.onend = () => resolve(true); u.onerror = () => resolve(false);
    speechSynthesis.speak(u);
  });
}
function stopSpeaking() {
  const n = native();
  if (n) { try { n.stopSpeak(); } catch { /* ignore */ } } else if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (speakDone) { const f = speakDone; speakDone = null; f(false); }
}

// ── The sheet ────────────────────────────────────────────────────────────────
const sheet = mk('div', 'read-sheet hidden');
document.body.append(sheet);
let token = 0;

async function readList(list, status, close) {
  const my = ++token;
  for (let i = 0; i < list.length; i++) {
    if (my !== token) return;
    status(i, list.length);
    const ok = await speakOne(list[i]);
    if (my !== token || !ok) break;
  }
  if (my === token) close();
}

export function openReader(raw) {
  const pieces = splitReply(raw);
  sheet.textContent = '';
  sheet.classList.remove('hidden');
  const head = mk('div', 'read-title', 'Choose what to hear');
  sheet.append(head);
  if (!canSpeak()) { sheet.append(mk('p', 'read-hint', 'This device cannot read aloud yet. In the haAi phone app it needs app version 11.')); const c = mk('button', 'read-btn2', 'Close'); c.type = 'button'; c.onclick = closeSheet; sheet.append(c); return; }
  if (!pieces.length) { sheet.append(mk('p', 'read-hint', 'Nothing to read in this reply.')); const c = mk('button', 'read-btn2', 'Close'); c.type = 'button'; c.onclick = closeSheet; sheet.append(c); return; }
  const list = mk('div', 'read-pieces');
  const els = pieces.map((p, i) => { const d = mk('div', 'read-piece', p); d.onclick = () => { d.classList.toggle('sel'); upd(); }; list.append(d); return d; });
  const row = mk('div', 'read-row');
  const sel = mk('button', 'read-go', 'Read selected'); sel.type = 'button'; sel.disabled = true;
  const all = mk('button', 'read-btn2', 'Read it all to me'); all.type = 'button';
  const cls = mk('button', 'read-btn2 read-close', 'Close'); cls.type = 'button';
  row.append(sel, all);
  sheet.append(list, row, cls);
  function upd() { const n = els.filter((e) => e.classList.contains('sel')).length; sel.disabled = !n; sel.textContent = n ? `Read selected (${n})` : 'Read selected'; }
  const run = (items, idxs) => {
    row.classList.add('hidden'); cls.classList.add('hidden');
    const stop = mk('button', 'read-stop', '■ Stop'); stop.type = 'button';
    const st = mk('div', 'read-title', 'Reading…');
    sheet.insertBefore(st, list); sheet.append(stop);
    stop.onclick = () => { token++; stopSpeaking(); closeSheet(); };
    readList(items, (i, n) => { st.textContent = `Reading piece ${i + 1} of ${n}…`; els.forEach((e) => e.classList.remove('now')); els[idxs[i]].classList.add('now'); els[idxs[i]].scrollIntoView({ block: 'nearest' }); }, closeSheet);
  };
  sel.onclick = () => { const idx = els.map((e, i) => (e.classList.contains('sel') ? i : -1)).filter((i) => i >= 0); run(idx.map((i) => pieces[i]), idx); };
  all.onclick = () => run(pieces, pieces.map((_, i) => i));
  cls.onclick = closeSheet;
}
function closeSheet() { token++; stopSpeaking(); sheet.classList.add('hidden'); sheet.textContent = ''; }

export function speakerButton(getRaw) {
  const b = mk('button', 'read-btn'); b.type = 'button'; b.innerHTML = SPEAKER; b.setAttribute('aria-label', 'Read to me'); b.title = 'Read to me';
  b.onclick = (e) => { e.stopPropagation(); openReader(getRaw()); };
  return b;
}

// ── Talk (blue microphone) ───────────────────────────────────────────────────
const mic = mk('button', 'attach-btn mic-btn'); mic.type = 'button'; mic.id = 'mic-btn'; mic.innerHTML = MIC; mic.title = 'Talk'; mic.setAttribute('aria-label', 'Talk');
document.getElementById('attach-btn')?.after(mic);
const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
let listening = false, base = '', webRec = null;
if (!native() && !Rec) mic.classList.add('hidden');
const setBox = (heard) => {
  promptInput.value = (base ? base.replace(/\s+$/, '') + ' ' : '') + heard;
  promptInput.dispatchEvent(new Event('input', { bubbles: true }));
};
function setListening(on) { listening = on; mic.classList.toggle('on', on); mic.title = on ? 'Tap to stop' : 'Talk'; }
window.haaiHeard = (text, final) => { setBox(String(text || '')); if (final) { base = promptInput.value; } };
window.haaiListenEnd = (err) => {
  setListening(false);
  if (err) { mic.title = err; const n = mk('div', 'read-toast', err); document.body.append(n); setTimeout(() => n.remove(), 4000); }
};
mic.onclick = (e) => {
  e.preventDefault();
  if (listening) { if (native()) { try { native().stopListen(); } catch { /* ignore */ } } else if (webRec) webRec.stop(); setListening(false); return; }
  base = promptInput.value; setListening(true);
  const n = native();
  if (n) { try { n.startListen(); } catch { setListening(false); } return; }
  webRec = new Rec(); webRec.lang = 'en-GB'; webRec.interimResults = true; webRec.continuous = true;
  webRec.onresult = (ev) => { let s = ''; for (const r of ev.results) s += r[0].transcript; setBox(s); };
  webRec.onend = () => setListening(false); webRec.onerror = () => setListening(false);
  try { webRec.start(); } catch { setListening(false); }
};
