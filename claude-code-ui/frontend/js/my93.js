/*
 * my93 (Michael's picks 2026-11-13, nine-picks-looks.html, answers D D C A D D D A A):
 *  H2  Messages page in the menu (Look C), grouped by kind: Home, Health check, TV, Claude
 *  H3  small Remember button under each of his messages (Look A); Claude's ⟦FILED|…⟧ shows as a green line (batch2.js)
 *  H19 small "Now on TV" line at the top of the chat (Look A); tap it to ask about it
 *  (I2 pack old chats is server only; its count rides on the morning line in batch2.js)
 */
import { S } from './state.js';
import { messagesEl } from './dom.js';
import { sendText } from './quick.js';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const wsSend = (o) => { if (S.ws && S.isConnected) { S.ws.send(JSON.stringify(o)); return true; } return false; };

const css = mk('style');
css.textContent = `
.h93-rem{display:block;margin:4px 0 0 auto;background:none;border:1px solid #33363c;color:#7d8087;border-radius:9px;padding:2px 9px;font:600 12px system-ui,sans-serif;cursor:pointer}
.h93-rem:disabled{color:#46bb68;border-color:#46bb68}
.h93-filed{color:#46bb68;font-size:13px;margin-top:6px}
.h93-tv{display:none;align-items:center;gap:6px;margin:0;padding:4px 12px;font-size:12.5px;color:#9cc8ff;background:#0b0c0e;border-bottom:1px solid #1e2024;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h93-tv.on{display:flex}.tv-view .h93-tv{display:none!important}
.h93-page{position:fixed;inset:0;z-index:9000;background:#000;color:#ececee;overflow:auto;padding:12px 12px 40px;font-family:inherit}
.h93-page h3{margin:4px 0 10px;font-size:17px;display:flex;justify-content:space-between;align-items:center}
.h93-page h4{margin:16px 0 6px;font-size:14px;color:#4da3ff}
.h93-m{border:1.5px solid #26282d;border-radius:12px;padding:8px 11px;margin-top:6px}
.h93-m b{display:block;font-size:13.5px}.h93-m span{display:block;font-size:13px;color:#c9cbd0;margin-top:2px}
.h93-m i{display:block;font-style:normal;font-size:11.5px;color:#7d8087;margin-top:3px}
.h93-none{color:#7d8087;font-size:13px}`;
document.head.append(css);

// ── H3 Remember this ─────────────────────────────────────────────────────────
function addRemember(b) {
  if (b.querySelector(':scope > .h93-rem') || b.classList.contains('h74-wait')) return;
  const txt = [...b.querySelectorAll(':scope > .bubble-content > div:not(.bubble-attachments)')].map((d) => d.textContent).join('\n').trim();
  if (!txt || /^(Remember this:|That broke a rule)/.test(txt)) return;
  const r = mk('button', 'h93-rem', '📌 Remember'); r.type = 'button';
  r.onclick = (e) => {
    e.stopPropagation();
    if (!S.isConnected) return;
    r.disabled = true; r.textContent = '✓ Sent to be remembered';
    sendText(`Remember this: "${txt.slice(0, 1500)}"`);
  };
  b.append(r);
}
const scan = () => messagesEl.querySelectorAll('.bubble-user').forEach(addRemember);
new MutationObserver(() => { clearTimeout(scan.t); scan.t = setTimeout(scan, 300); }).observe(messagesEl, { childList: true });

export function filedLine(f) { return mk('div', 'h93-filed', `✓ Remembered. Filed in ${f[0] || 'your notes'}`); }

// ── H19 Now on TV ────────────────────────────────────────────────────────────
const tvLine = mk('div', 'h93-tv');
let tvText = '';
tvLine.onclick = () => { if (tvText) sendText(`What's on TV now: "${tvText}". Please tell me about it in a few plain lines.`); };
const placeTv = () => { if (!tvLine.isConnected && messagesEl.parentElement) messagesEl.parentElement.insertBefore(tvLine, messagesEl); };
function drawTv() {
  placeTv();
  tvLine.textContent = tvText ? `📺 Now on TV: ${tvText}` : '';
  tvLine.classList.toggle('on', !!tvText);
}

// ── H2 Messages page ─────────────────────────────────────────────────────────
const KINDS = ['Home', 'Health check', 'TV', 'Claude'];
let page = null, list = [];
const when = (ms) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit' });
const to = (a) => { const s = (a || []).join(' '); const p = /pixel_10/i.test(s), t = /tablet/i.test(s); return p && t ? 'phone and tablet' : t ? 'tablet' : p ? 'phone' : (a || []).length ? 'other' : ''; };
function drawPage() {
  if (!page) return;
  page.textContent = '';
  const h = mk('h3', null, '✉ Messages');
  const x = mk('button', 'h2-btn sm', 'Close'); x.type = 'button'; x.onclick = () => { page.remove(); page = null; };
  h.append(x); page.append(h);
  page.append(mk('div', 'h93-none', 'Messages sent to your phone and tablet in the last 7 days, newest first.'));
  if (!list.length) { page.append(mk('div', 'h93-none', 'None yet. haAi starts keeping them from this update on.')); return; }
  for (const k of KINDS) {
    const items = list.filter((m) => (m.kind || 'Home') === k).sort((a, b) => b.at - a.at);
    if (!items.length) continue;
    page.append(mk('h4', null, `${k} (${items.length})`));
    for (const m of items.slice(0, 80)) {
      const c = mk('div', 'h93-m');
      c.append(mk('b', null, m.title || m.text.slice(0, 60)));
      if (m.title) c.append(mk('span', null, m.text));
      const w = to(m.to);
      c.append(mk('i', null, `${when(m.at)} UK${w ? ' · ' + w : ''}`));
      page.append(c);
    }
  }
}
const openBtn = mk('button', 'hidden'); openBtn.id = 'msgs-btn'; openBtn.type = 'button'; openBtn.style.display = 'none';
openBtn.onclick = () => {
  page?.remove();
  page = mk('div', 'h93-page');
  document.body.append(page);
  drawPage();
  wsSend({ type: 'messages_get' });
};
document.body.append(openBtn);

export function onMy93Message(msg) {
  if (msg.type === 'now_tv') { tvText = msg.text || ''; drawTv(); }
  else if (msg.type === 'messages_list') { list = msg.list || []; drawPage(); }
  else if (msg.type === 'messages_new') { if (msg.item) { list.push(msg.item); drawPage(); } }
}
