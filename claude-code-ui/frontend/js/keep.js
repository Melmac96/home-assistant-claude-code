/*
 * my35: Keep. Bits of text and photos wait in a tray above the typing box (saved in haAi) and
 * all go to Claude together when Send is pressed.
 */
import { S } from './state.js';
import { attachments, fileToDataURL, removeAttachment } from './attachments.js';
import { updateSendBtn } from './composer.js';
import { promptInput } from './dom.js';
import { appendErrorBubble } from './transcript.js';

export let keepItems = [];
let pendingText = null;   // { cid, text }: stays in the typing box until haAi says it is saved

const tray = document.getElementById('keep-tray');
const keepBtn = document.getElementById('keep-btn');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const wsSend = (o) => { if (S.ws && S.isConnected) { S.ws.send(JSON.stringify(o)); return true; } return false; };
const newCid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export function updateKeepBtn() {
  if (keepBtn) keepBtn.disabled = !promptInput.value.trim() || !S.isConnected;
}

function summary() {
  const t = keepItems.filter((i) => i.kind === 'text').length;
  const f = keepItems.length - t;
  const p = keepItems.filter((i) => i.kind === 'file' && i.isImage).length;
  const parts = [];
  if (t) parts.push(`${t} bit${t > 1 ? 's' : ''} of text`);
  if (p) parts.push(`${p} photo${p > 1 ? 's' : ''}`);
  if (f - p) parts.push(`${f - p} file${f - p > 1 ? 's' : ''}`);
  return parts.join(' and ');
}

function removeButton(item) {
  const b = el('button', 'keep-rm', '✕');
  b.type = 'button';
  b.setAttribute('aria-label', 'Remove');
  let armed = null;
  b.onclick = () => {
    if (armed) { clearTimeout(armed); wsSend({ type: 'keep_remove', id: item.id }); return; }
    b.textContent = 'Remove?';   // two presses, so a stray tap cannot lose a long bit of typing
    b.classList.add('armed');
    armed = setTimeout(() => { armed = null; b.textContent = '✕'; b.classList.remove('armed'); }, 3000);
  };
  return b;
}

function draw() {
  tray.textContent = '';
  tray.classList.toggle('hidden', !keepItems.length);
  if (!keepItems.length) return;
  tray.append(el('div', 'keep-title', `Waiting, not sent yet: ${summary()}`));
  for (const item of keepItems) {
    const row = el('div', 'keep-row');
    const body = el('div', 'keep-body');
    if (item.kind === 'text') {
      body.textContent = item.text;
      body.onclick = () => {
        if (!wsSend({ type: 'keep_remove', id: item.id })) return;
        const cur = promptInput.value.trim();
        promptInput.value = cur ? `${cur} ${item.text}` : item.text;
        promptInput.dispatchEvent(new Event('input'));
        promptInput.focus();
      };
    } else if (item.isImage && item.thumb) {
      const img = el('img', 'keep-thumb');
      img.src = item.thumb;
      img.alt = item.name;
      body.append(img);
    } else {
      body.textContent = `📎 ${item.name}`;
    }
    row.append(body, removeButton(item));
    tray.append(row);
  }
}

function makeThumb(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, 160 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.6));
      } catch { resolve(''); }
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

/** Moves chosen photos and files into the tray. They stay as chips until haAi says each is saved. */
export async function flushKeep() {
  for (const a of attachments.slice()) {
    if (a.keepFailed || a.keepWs === S.ws) continue;
    if (!S.ws || !S.isConnected) return;
    a.keepWs = S.ws;
    a.cid = a.cid || newCid();
    let data = null;
    try { data = await fileToDataURL(a.file, a.isImage); } catch { data = null; }
    if (!data) {
      a.keepFailed = true;
      appendErrorBubble(`${a.name} could not be read, so it was not kept.`);
      continue;
    }
    const mediaType = (data.match(/^data:([^;]+);/) || [])[1] || a.mediaType || 'application/octet-stream';
    let name = a.name;
    if (a.isImage && /jpeg/.test(mediaType) && !/\.jpe?g$/i.test(name)) name = `${name.replace(/\.[^.]+$/, '')}.jpg`;
    const thumb = a.isImage ? await makeThumb(data) : '';
    wsSend({ type: 'keep_add', kind: 'file', cid: a.cid, name, mediaType, isImage: a.isImage, thumb, data });
  }
}

/** Send waits here for photos still on their way into the tray. False if they did not make it in time. */
export async function keepSettled() {
  for (let n = 0; n < 150; n++) {
    if (!attachments.some((a) => !a.keepFailed)) return true;
    if (!S.isConnected) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** The message Claude gets: the bits in order, then whatever is still in the typing box. */
export function joinKept(kept, boxText) {
  const hasText = !!boxText || kept.some((i) => i.kind === 'text');
  const mix = hasText && kept.some((i) => i.kind === 'file');
  let n = 0;
  const parts = kept.map((i) => {
    if (i.kind === 'text') return i.text;
    n++;
    return mix ? `[${i.isImage ? 'Photo' : 'File'} ${n}]` : null;
  }).filter(Boolean);
  if (boxText) parts.push(boxText);
  return parts.join('\n\n');
}

keepBtn.onclick = () => {
  const text = promptInput.value.trim();
  if (!text) return;
  const cid = newCid();
  if (wsSend({ type: 'keep_add', kind: 'text', cid, text })) pendingText = { cid, text };
};

export function onKeepMessage(msg) {
  if (msg.type === 'keep_error') {
    appendErrorBubble(msg.text);
    const a = attachments.find((x) => x.cid === msg.cid);
    if (a) a.keepFailed = true;
    if (pendingText && pendingText.cid === msg.cid) pendingText = null;
    return;
  }
  keepItems = msg.list || [];
  const saved = new Set(keepItems.map((i) => i.cid));
  for (let i = attachments.length - 1; i >= 0; i--) {
    if (attachments[i].cid && saved.has(attachments[i].cid)) removeAttachment(i);
  }
  if (pendingText && saved.has(pendingText.cid)) {
    if (promptInput.value.trim() === pendingText.text) {
      promptInput.value = '';
      localStorage.removeItem('draft');
      promptInput.dispatchEvent(new Event('input'));
    }
    pendingText = null;
  }
  draw();
  updateSendBtn();
  flushKeep();
}
