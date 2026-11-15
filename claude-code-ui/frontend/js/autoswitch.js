/*
 * my122 (Michael 2026-11-15): NO LONGER AUTOMATIC. It now only RECOMMENDS: a pop-up with the reason and he decides
 * (switch and send / send as it is). "Send as it is" is not asked again for 2 hours.
 * my55 (old wording, before my122): AUTOMATIC OPUS ON HIGH FOR IMAGE AND ICON WORK (user chose A, 2026-11-09).
 * The app itself (not Claude) looks at the message on Send. If it has image words (icon, image, picture, logo,
 * drawing, button design) and the chat is on Sonnet, it switches to Opus on High, then the message goes out as normal.
 * A small bar says so, with Undo. It goes back to Sonnet Medium by the existing advisor path (Claude's "back" line when the
 * job is finished, or the "Back to Sonnet now" bar). Haiku stays a card he chooses. Not used in Free mode, for slash
 * commands, or while Claude is already working. Word list: WORDS below.
 */
import { S } from './state.js';
import { mk, wsSend } from './util.js';   // my115: shared helpers
import { inputForm, promptInput, modelSelect } from './dom.js';
import { advisorOn } from './advisor.js';
import { pop } from './guard.js';   // my122

const WORDS = /\b(icons?|images?|pictures?|logos?|drawings?|button designs?|designs? (?:for )?(?:the |a )?buttons?)\b/i;
const send = wsSend;   // my115: shared helper (util.js)

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
  if (!e.isTrusted) return;   // my115: only a message he typed himself, never a button's canned text
  if (e.defaultPrevented || document.querySelector('.start-check')) return;
  if (S.isRunning || free || !advisorOn()) return;
  const text = promptInput.value.trim();
  if (!text || text.startsWith('/') || !WORDS.test(text)) return;
  if (!/sonnet/i.test(modelSelect.value + ' ' + (modelSelect.selectedOptions[0]?.dataset.resolvedModel || ''))) return;   // already on Opus/Haiku
  const o = pickOpus();
  if (!o) return;
  if (Date.now() - Number(sessionStorage.getItem('as-declined') || 0) < 2 * 3600 * 1000) return;
  const prev = { model: 'latest-sonnet', effort: localStorage.getItem('effort') || 'medium' };
  e.preventDefault(); e.stopImmediatePropagation();   // the message stays in the box until he decides
  pop('Suggestion: Opus on High for this job',
    'This looks like image or icon work. Opus on High is less likely to need a redo, but it uses about two-thirds more allowance per reply than Sonnet. You decide.', [
      ['Switch to Opus on High and send', 'sc-switch', () => {
        modelSelect.value = o.value;
        localStorage.setItem('model', o.value);
        localStorage.setItem('effort', 'high');
        const eff = document.getElementById('effort-select'); if (eff) eff.value = 'high';
        send({ type: 'prefs_set', model: o.value, effort: 'high' });
        send({ type: 'advisor_set', advised: true });
        bar(prev);
        setTimeout(() => inputForm.requestSubmit(), 50);
      }],
      ['Send as it is (Sonnet)', 'sc-stay', () => { sessionStorage.setItem('as-declined', String(Date.now())); inputForm.requestSubmit(); }],
    ]);
}, true);
