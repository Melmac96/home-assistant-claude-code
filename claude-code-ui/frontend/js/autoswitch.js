/*
 * my55: AUTOMATIC OPUS ON HIGH FOR IMAGE AND ICON WORK (user chose A, 2026-11-09).
 * The app itself (not Claude) looks at the message on Send. If it has image words (icon, image, picture, logo,
 * drawing, button design) and the chat is on Sonnet, it switches to Opus on High, then the message goes out as normal.
 * A small bar says so, with Undo. It goes back to Sonnet Medium by the existing advisor path (Claude's "back" line when the
 * job is finished, or the "Back to Sonnet now" bar). Haiku stays a card he chooses. Not used in Free mode, for slash
 * commands, or while Claude is already working. Word list: WORDS below.
 */
import { S } from './state.js';
import { inputForm, promptInput, modelSelect } from './dom.js';
import { advisorOn } from './advisor.js';

const WORDS = /\b(icons?|images?|pictures?|logos?|drawings?|button designs?|designs? (?:for )?(?:the |a )?buttons?)\b/i;
const send = (o) => { if (S.ws && S.isConnected) S.ws.send(JSON.stringify(o)); };
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
let free = false;
window.addEventListener('haai-accounts', (e) => { free = !!(e.detail && e.detail.free); });

const pickOpus = () => {
  const ver = (o) => (String(o.dataset.resolvedModel || o.value).match(/\d+/g) || []).map(Number);
  const opts = [...modelSelect.options].filter((o) => /opus/i.test(o.value + ' ' + (o.dataset.resolvedModel || '')));
  opts.sort((a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < 4; i++) { const d = (y[i] || 0) - (x[i] || 0); if (d) return d; } return 0; });
  return opts[0] || null;
};

function bar(prev) {
  const t = mk('div', 'guard-toast');
  t.append(mk('span', '', 'Switched to Opus on High for image work. '));
  const u = mk('button', 'adv-no', 'Undo'); u.type = 'button';
  u.onclick = () => {
    send({ type: 'prefs_set', model: prev.model, effort: prev.effort });
    send({ type: 'advisor_set', advised: false });
    t.remove();
  };
  t.append(u);
  document.body.append(t);
  setTimeout(() => t.remove(), 15000);
}

inputForm.addEventListener('submit', (e) => {
  if (e.defaultPrevented || document.querySelector('.start-check')) return;
  if (S.isRunning || free || !advisorOn()) return;
  const text = promptInput.value.trim();
  if (!text || text.startsWith('/') || !WORDS.test(text)) return;
  if (!/sonnet/i.test(modelSelect.value + ' ' + (modelSelect.selectedOptions[0]?.dataset.resolvedModel || ''))) return;   // already on Opus/Haiku
  const o = pickOpus();
  if (!o) return;
  const prev = { model: 'latest-sonnet', effort: localStorage.getItem('effort') || 'medium' };
  modelSelect.value = o.value;                    // the message that follows reads these two at once
  localStorage.setItem('model', o.value);
  localStorage.setItem('effort', 'high');
  const eff = document.getElementById('effort-select'); if (eff) eff.value = 'high';
  send({ type: 'prefs_set', model: o.value, effort: 'high' });
  send({ type: 'advisor_set', advised: true });
  bar(prev);
}, true);
