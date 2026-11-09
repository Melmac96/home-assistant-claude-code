/*
 * my42: MODEL ADVISOR (Look C). Claude puts a hidden line  ⟦ADVISE|opus|high|kind|reason⟧  under its heading;
 * links.js hands it here, the line is hidden and a card with the reason and two buttons shows above the typing box.
 * ⟦ADVISE|back⟧ = the job on the advised model is finished: switch back to Sonnet on Medium by itself.
 * Settings has an on/off switch (kept on the server, shared by every device).
 */
import { S } from './state.js';
import { inputForm, messagesEl, modelSelect } from './dom.js';

const send = (o) => { if (S.ws && S.isConnected) S.ws.send(JSON.stringify(o)); };
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const MARK = /⟦ADVISE\|([^⟧\n]*)⟧[ \t]*\n?/;
const PARTIAL = /⟦ADVISE[^⟧]*$/;

let adv = { enabled: true, advised: false };
let card = null;           // { to, effort, kind, reason } or null
const handled = new Set(JSON.parse(localStorage.getItem('adv-handled') || '[]'));
const markHandled = (k) => { handled.add(k); localStorage.setItem('adv-handled', JSON.stringify([...handled].slice(-40))); };

const strip = mk('div', 'adv-card hidden');
inputForm.prepend(strip);

// Remove the hidden line from a reply's text; returns { text, marker } (marker = fields or null).
export function takeAdvice(raw) {
  const m = raw.match(MARK);
  let text = raw.replace(MARK, '').replace(PARTIAL, '');
  return { text, fields: m ? m[1].split('|').map((s) => s.trim()) : null, key: m ? m[0] : null };
}

const pick = (family) => {
  const opts = [...modelSelect.options].filter((o) => new RegExp(family, 'i').test(o.value + ' ' + (o.dataset.resolvedModel || '')));
  if (!opts.length) return null;
  const ver = (o) => (String(o.dataset.resolvedModel || o.value).match(/\d+/g) || []).map(Number);
  opts.sort((a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < 4; i++) { const d = (y[i] || 0) - (x[i] || 0); if (d) return d; } return 0; });
  return opts[0];
};
const NAMES = { opus: 'Opus', haiku: 'Haiku' };

// Called by renderMarkdown for every assistant reply. Only the LAST reply, not seen before, can start something.
export function adviceFound(el, fields, key) {
  if (!fields || !adv.enabled && fields[0] !== 'back') return;
  queueMicrotask(() => {
    const all = messagesEl.querySelectorAll('.bubble-assistant .bubble-content');
    if (!all.length || all[all.length - 1] !== el || handled.has(key + all.length)) return;
    if (fields[0] === 'back') {
      markHandled(key + all.length);
      if (adv.advised) goBack(true);
      return;
    }
    if (adv.advised && modelSelect.value !== 'latest-sonnet' && !/sonnet/i.test(modelSelect.value)) return;   // already on an advised model (my54: a stuck flag no longer blocks it)
    const [to, effort, kind, ...rest] = fields;
    if (!['opus', 'haiku'].includes(to) || !pick(to)) return;
    card = { to, effort: ['low', 'medium', 'high'].includes(effort) ? effort : (to === 'opus' ? 'high' : 'low'), kind: kind || 'this job', reason: rest.join('|'), key: key + all.length };
    draw();
  });
}

function goBack(auto) {
  send({ type: 'prefs_set', model: 'latest-sonnet', effort: 'medium' });
  send({ type: 'advisor_set', advised: false });
  strip.dataset.note = auto ? 'Job finished: switched back to Sonnet on Medium.' : 'Switched back to Sonnet on Medium.';
  card = null;
  draw(true);
  setTimeout(() => { delete strip.dataset.note; draw(); }, 6000);
}

function draw(note) {
  strip.textContent = '';
  if (strip.dataset.note && note) { strip.append(mk('div', 'adv-reason', strip.dataset.note)); strip.classList.remove('hidden'); return; }
  if (card) {
    const name = NAMES[card.to], eff = card.effort[0].toUpperCase() + card.effort.slice(1);
    strip.append(mk('div', 'adv-title', `Suggestion: ${name} on ${eff} for this job`));
    strip.append(mk('div', 'adv-reason', card.reason || (card.to === 'opus' ? 'This looks hard; Opus is less likely to need a redo.' : 'This looks small and simple.')));
    strip.append(mk('div', 'adv-note', card.to === 'opus'
      ? 'Costs about two-thirds more allowance per reply than Sonnet, but can be cheaper overall if Sonnet would need a redo.'
      : 'Should use less allowance than Sonnet. This saving is a guess, not measured yet.'));
    const row = mk('div', 'adv-row');
    const yes = mk('button', 'adv-yes', `Switch to ${name} · ${eff}`); yes.type = 'button';
    const no = mk('button', 'adv-no', 'Stay on Sonnet'); no.type = 'button';
    yes.onclick = (e) => {
      e.preventDefault(); const c = card; markHandled(c.key); card = null;
      const o = pick(c.to);
      send({ type: 'prefs_set', model: o.value, effort: c.effort });
      send({ type: 'advisor_set', advised: true });
      draw();
    };
    no.onclick = (e) => { e.preventDefault(); const c = card; markHandled(c.key); card = null; send({ type: 'advisor_set', declineKind: c.kind }); draw(); };
    row.append(yes, no); strip.append(row);
    strip.classList.remove('hidden');
  } else if (adv.advised && /sonnet/i.test(modelSelect.value + ' ' + (modelSelect.selectedOptions[0]?.dataset.resolvedModel || '')) && (document.getElementById('effort-select')?.value || 'medium') === 'medium') {
    send({ type: 'advisor_set', advised: false });   // my54: stuck flag, we are back on Sonnet Medium
    strip.classList.add('hidden');
  } else if (adv.advised && !localStorage.getItem('adv-slim-gone')) {
    const row = mk('div', 'adv-row adv-slim');
    row.append(mk('span', 'adv-reason', 'Using a different model for this job.'));
    const b = mk('button', 'adv-no', 'Back to Sonnet now'); b.type = 'button';
    b.onclick = (e) => { e.preventDefault(); goBack(false); };
    const x = mk('button', 'adv-x', '✕'); x.type = 'button'; x.title = 'Hide this'; x.setAttribute('aria-label', 'Hide this');   // my52
    x.onclick = (e) => { e.preventDefault(); localStorage.setItem('adv-slim-gone', '1'); draw(); };
    row.append(b, x); strip.append(row);
    strip.classList.remove('hidden');
  } else strip.classList.add('hidden');
}

export function onAdvisorMessage(msg) {
  adv = { enabled: msg.enabled !== false, advised: !!msg.advised };
  if (!adv.advised) localStorage.removeItem('adv-slim-gone');   // my52: the next switch shows the strip again
  if (!adv.enabled) card = null;
  const t = document.getElementById('advisor-toggle');
  if (t) { t.checked = adv.enabled; }
  draw();
}
document.getElementById('advisor-toggle')?.addEventListener('change', (e) => send({ type: 'advisor_set', enabled: e.target.checked }));

export const advisorOn = () => adv.enabled;   // my55
