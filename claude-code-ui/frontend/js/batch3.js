/*
 * my47: haAi batch 3 (user picks BAAA, test page batch3-looks.html, 2026-11-09). Phone app v14 does the Android side.
 *  - Conversation mode (A): you speak, it sends, Claude answers aloud, then it listens again. Needs the phone app (voices).
 *  - Camera with a circle (A): photo from the app, drag to circle the part, Send.
 *  - Look at my screen (A): choose a screen, the server takes its picture and adds it to your message.
 *  - Shared things from Android's Share menu and the home-screen Talk button arrive through window.haaiShared / haaiTalk.
 */
import { S } from './state.js';
import { inputForm, messagesEl, promptInput } from './dom.js';
import { sendText } from './quick.js';
import { addFiles } from './attachments.js';
import { splitReply, speakOne } from './read.js';
import { stripMarks } from './batch1.js';

const native = () => (typeof window.HaAiNative !== 'undefined' ? window.HaAiNative : null);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const toast = (t) => { const d = mk('div', 'haai-toast', t); document.body.append(d); setTimeout(() => d.remove(), 5000); };
const wsSend = (o) => { if (S.ws && S.isConnected) S.ws.send(JSON.stringify(o)); };
const b64ToFile = (b64, name, type) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], name, { type }); };

// ── Buttons next to the microphone (only inside the phone app, which has the voices and camera) ──
const mic = document.getElementById('mic-btn');
const mkBtn = (id, label, title) => { const b = mk('button', 'attach-btn h3-btn', label); b.type = 'button'; b.id = id; b.title = title; b.setAttribute('aria-label', title); return b; };
const convBtn = mkBtn('conv-btn', '💬', 'Conversation mode'), camBtn = mkBtn('cam-btn', '📷', 'Take a photo and circle a part'), scrBtn = mkBtn('scr-btn', '📺', 'Look at my screen');
if (mic) { mic.after(convBtn); convBtn.after(camBtn); camBtn.after(scrBtn); }
if (!native()) { convBtn.classList.add('hidden'); camBtn.classList.add('hidden'); }   // screens work in a browser too

// ── Conversation mode ────────────────────────────────────────────────────────
const conv = mk('div', 'h3-conv hidden');
const cState = mk('div', 'h3-conv-state'), cHeard = mk('div', 'h3-conv-heard');
const cEnd = mk('button', 'h2-btn', '■ End conversation'); cEnd.type = 'button';
conv.append(cState, cHeard, cEnd);
inputForm.before(conv);
let on = false, phase = 'idle', idleTimer = null, gen = 0;
const show = (state, heard) => { cState.textContent = state; cHeard.textContent = heard || ''; };
const IDLE_MS = 2 * 60 * 1000;
function poke() { clearTimeout(idleTimer); idleTimer = setTimeout(() => endConv('Conversation ended: nothing heard for 2 minutes.'), IDLE_MS); }
function endConv(why) {
  if (!on) return;
  on = false; gen++; phase = 'idle'; clearTimeout(idleTimer);
  try { native().stopListen(); native().stopSpeak(); } catch { /* ignore */ }
  conv.classList.add('hidden'); convBtn.classList.remove('on');
  if (why) toast(why);
}
function listen() { if (!on) return; phase = 'listen'; show('🎤 Listening…', ''); poke(); try { native().startListen(); } catch { endConv('Could not start listening.'); } }
function lastReply() {
  const all = messagesEl.querySelectorAll('.bubble-assistant .bubble-content');
  const c = all[all.length - 1];
  return c ? stripMarks(c._rawMd || '') : '';
}
async function answerAloud(g) {
  phase = 'wait'; show('⏳ Claude is working…', '');
  // wait until the run starts, then until it is finished
  for (let i = 0; i < 40 && !S.isRunning && on && g === gen; i++) await new Promise((r) => setTimeout(r, 250));
  while (S.isRunning && on && g === gen) await new Promise((r) => setTimeout(r, 400));
  if (!on || g !== gen) return;
  await new Promise((r) => setTimeout(r, 600));   // let the last words paint
  phase = 'speak'; show('🔊 Claude is answering…', '');
  for (const piece of splitReply(lastReply())) { if (!on || g !== gen) return; await speakOne(piece); }
  if (on && g === gen) listen();
}
const prevHeard = window.haaiHeard, prevEnd = window.haaiListenEnd;
window.haaiHeard = (text, final) => {
  if (!on) { if (prevHeard) prevHeard(text, final); return; }
  if (phase !== 'listen') return;
  poke(); show('🎤 Listening…', `You: ${text}`);
  if (final && String(text).trim()) {
    phase = 'sent'; try { native().stopListen(); } catch { /* ignore */ }
    show('📨 Sending…', `You: ${text}`);
    sendText(String(text).trim());
    answerAloud(++gen);
  }
};
window.haaiListenEnd = (err) => {
  if (!on) { if (prevEnd) prevEnd(err); return; }
  if (phase === 'listen') endConv(err || 'Conversation ended.');
};
convBtn.onclick = (e) => { e.preventDefault(); if (on) { endConv(''); return; } on = true; convBtn.classList.add('on'); conv.classList.remove('hidden'); listen(); };
cEnd.onclick = (e) => { e.preventDefault(); endConv('Conversation ended.'); };

// ── Home-screen Talk button / tile: open haAi already listening ──────────────
window.haaiTalk = () => { if (mic && !mic.classList.contains('on')) mic.click(); };

// ── Camera with a circle ─────────────────────────────────────────────────────
const MAXD = 1568;
camBtn.onclick = (e) => { e.preventDefault(); try { native().takePhoto(); } catch { toast('The phone app could not open the camera.'); } };
window.haaiPhoto = (b64) => {
  const img = new Image();
  img.onload = () => {
    const k = Math.min(1, MAXD / Math.max(img.width, img.height));
    const w = Math.round(img.width * k), h = Math.round(img.height * k);
    const base = document.createElement('canvas'); base.width = w; base.height = h; base.getContext('2d').drawImage(img, 0, 0, w, h);
    const ov = mk('div', 'h3-photo'), cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.className = 'h3-canvas';
    const hint = mk('div', 'h3-hint', 'Drag on the picture to circle the part you mean');
    const row = mk('div', 'h2-row');
    const undo = mk('button', 'h2-btn', 'Undo circle'), send = mk('button', 'h2-btn g', 'Send'), cancel = mk('button', 'h2-btn r', 'Cancel');
    [undo, send, cancel].forEach((b) => { b.type = 'button'; });
    row.append(undo, send, cancel); ov.append(hint, cv, row); document.body.append(ov);
    const g = cv.getContext('2d'); let circle = null, start = null;
    const draw = () => {
      g.clearRect(0, 0, w, h); g.drawImage(base, 0, 0);
      if (circle) { g.strokeStyle = '#f3736c'; g.lineWidth = Math.max(4, w / 160); g.beginPath(); g.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2); g.stroke(); }
    };
    const pos = (ev) => { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) * w / r.width, y: (ev.clientY - r.top) * h / r.height }; };
    cv.addEventListener('pointerdown', (ev) => { ev.preventDefault(); cv.setPointerCapture(ev.pointerId); start = pos(ev); circle = { ...start, r: 1 }; });
    cv.addEventListener('pointermove', (ev) => { if (!start) return; const p = pos(ev); circle.r = Math.max(4, Math.hypot(p.x - start.x, p.y - start.y)); draw(); });
    cv.addEventListener('pointerup', () => { start = null; });
    undo.onclick = () => { circle = null; draw(); };
    cancel.onclick = () => ov.remove();
    send.onclick = () => {
      cv.toBlob((blob) => {
        ov.remove();
        if (!blob) { toast('Could not make the picture.'); return; }
        addFiles([new File([blob], 'photo.jpg', { type: 'image/jpeg' })]);
        sendText(circle ? 'This photo has a red circle around the part I mean. What can you tell me about it?' : 'Here is a photo. What can you tell me about it?');
      }, 'image/jpeg', 0.85);
    };
    draw();
  };
  img.onerror = () => toast('Could not open the photo.');
  img.src = 'data:image/jpeg;base64,' + b64;
};

// ── Look at my screen ────────────────────────────────────────────────────────
const scr = mk('div', 'h2-card info h3-screens hidden');
scr.append(mk('div', 'h2-title', 'Which screen?'));
const scrRow = mk('div', 'h2-row');
[['ha-shield', 'HA Shield'], ['main-shield', 'Main Shield'], ['fire-tv', 'Fire TV']].forEach(([id, label]) => {
  const b = mk('button', 'h2-btn', label); b.type = 'button';
  b.onclick = (e) => { e.preventDefault(); scr.classList.add('hidden'); toast(`Taking a picture of the ${label}…`); wsSend({ type: 'screen_shot', device: id }); };
  scrRow.append(b);
});
scr.append(scrRow);
inputForm.before(scr);
scrBtn.onclick = (e) => { e.preventDefault(); scr.classList.toggle('hidden'); };
export function onScreenShot(msg) {
  if (!msg.ok) { toast(msg.error || 'Could not take the picture.'); return; }
  addFiles([b64ToFile(msg.data, `${String(msg.name || 'screen').replace(/\s+/g, '-')}-screen.png`, 'image/png')]);
  if (!promptInput.value) { promptInput.value = `This is a picture of the ${msg.name} screen. What can you see?`; promptInput.dispatchEvent(new Event('input', { bubbles: true })); }
  toast(`Picture of the ${msg.name} added to your message.`);
}

// ── Shared from Android's Share menu: text and files arrive from the app ─────
window.haaiShared = (json) => {
  let d; try { d = typeof json === 'string' ? JSON.parse(json) : json; } catch { return; }
  const n = native(); let count = 0;
  if (d.text) { promptInput.value = (promptInput.value ? promptInput.value + '\n' : '') + d.text; promptInput.dispatchEvent(new Event('input', { bubbles: true })); count++; }
  (d.files || []).forEach((f, i) => { try { addFiles([b64ToFile(n.sharedFile(i), f.name || `shared-${i}`, f.mime || 'application/octet-stream')]); count++; } catch { /* skip */ } });
  if (count) toast(`Added ${count} shared item${count > 1 ? 's' : ''} to your message.`);
};
// Tell the app the page is ready to receive anything shared or a Talk request.
window.addEventListener('load', () => { try { native() && native().pageReady(); } catch { /* older app */ } });
