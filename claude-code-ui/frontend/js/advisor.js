/*
 * my42: MODEL ADVISOR (Look C). Claude puts a hidden line  ⟦ADVISE|opus|high|kind|reason⟧  under its heading;
 * links.js hands it here, the line is hidden and a card with the reason and two buttons shows above the typing box.
 * ⟦ADVISE|back⟧ = the job on the advised model is finished: my122 (Michael 2026-11-15) it only SUGGESTS switching back (a card, he decides); nothing switches by itself.
 * Settings has an on/off switch (kept on the server, shared by every device).
 */
import { S } from './state.js';
import { mk, wsSend } from './util.js';   // my115: shared helpers
import { inputForm, messagesEl, modelSelect } from './dom.js';

const send = wsSend;   // my115: shared helper (util.js)

const MARK = /⟦ADVISE\|([^⟧\n]*)⟧[ \t]*\n?/;
const PARTIAL = /⟦ADVISE[^⟧]*$/;

let adv = { enabled: true, advised: false };
let card = null;           // { to, effort, kind, reason } or null
// my115: one damaged saved value can no longer stop the whole app from loading (blank page)
const readHandled = () => { try { const l = JSON.parse(localStorage.getItem('adv-handled') || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } };
const saveHandled = () => { try { localStorage.setItem('adv-handled', JSON.stringify([...handled].slice(-40))); } catch { /* storage full: kept for this visit */ } };
const handled = new Set(readHandled());
const markHandled = (k) => { handled.add(k); saveHandled(); send({ type: 'advisor_set', handledKey: String(k) }); };   // my104: tell the other devices

// my114 (Michael 15 Nov): the card also offers the other PAID account with the most room, and a FREE chat, and says
// whether the free one would do the job just as well (Claude's verdict: same / worse / private).
let accts = { cur: null, saved: [], free: false };
let quota = {};
window.addEventListener('haai-accounts', (e) => { accts = e.detail || accts; if (card) draw(); });
window.addEventListener('haai-quota', (e) => { quota = e.detail || {}; if (card) draw(); });
const SHORTN = { 'thereades@gmail.com': 'Main', 'thereades.uk@gmail.com': '2nd', 'rf.mike@gmail.com': '3rd', 'readerufus@gmail.com': '4th', 'rufusreade1969@gmail.com': '5th' };
const used5 = (email) => { const w = (quota[String(email).toLowerCase()] || {}).five_hour; if (!w) return null; return w.resetsAt && w.resetsAt * 1000 <= Date.now() ? 0 : w.used; };
function otherPaid() {
  const cur = accts.cur && accts.cur.email;
  const list = (accts.saved || []).filter((a) => !a.active && a.email !== cur).map((a) => ({ ...a, used: used5(a.email) }));
  if (!list.length) return null;
  list.sort((x, y) => (x.used ?? 101) - (y.used ?? 101));
  return list[0];
}
const lastAsk = () => { const u = messagesEl.querySelectorAll('.bubble-user'); return u.length ? (u[u.length - 1].innerText || '').trim() : ''; };
const FREE_SAYS = { same: 'A free model would do this just as well.', worse: 'A free model could do it, but not as well.', private: 'Not for a free model: it is private.' };

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
      if (adv.advised) { card = { to: 'back', effort: '', kind: 'job finished', reason: 'The job on the other model looks finished, so Sonnet on Medium would use less allowance again.', key: key + all.length }; draw(); }   // my122: a suggestion, never automatic
      return;
    }
    const [to, effort, kind, reason, freeV, ...freeNote] = fields;
    if (to === 'free') {   // my114: no model change, just "a free chat does this as well"
      if (accts.free || (freeV || 'same') !== 'same') return;
      card = { to: 'free', effort: '', kind: kind || 'this job', reason: reason || '', free: 'same', freeNote: freeNote.join(' '), key: key + all.length };
      draw(); return;
    }
    if (adv.advised && modelSelect.value !== 'latest-sonnet' && !/sonnet/i.test(modelSelect.value)) return;
    if (!['opus', 'haiku'].includes(to) || !pick(to)) return;
    card = { to, effort: ['low', 'medium', 'high'].includes(effort) ? effort : (to === 'opus' ? 'high' : 'low'), kind: kind || 'this job', reason: reason || '',
      free: ['same', 'worse', 'private'].includes(freeV) ? freeV : '', freeNote: freeNote.join(' '), key: key + all.length };
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
    const c0 = card, isFree = c0.to === 'free';
    if (c0.to === 'back') {   // my122: suggestion to go back to Sonnet on Medium, he decides
      strip.append(mk('div', 'adv-title', 'Suggestion: switch back to Sonnet on Medium'), mk('div', 'adv-reason', c0.reason));
      const row0 = mk('div', 'adv-row');
      const b1 = mk('button', 'adv-yes', 'Switch back to Sonnet'); b1.type = 'button'; b1.onclick = (e) => { e.preventDefault(); markHandled(c0.key); goBack(false); };
      const b2 = mk('button', 'adv-no', 'Stay as I am'); b2.type = 'button'; b2.onclick = (e) => { e.preventDefault(); markHandled(c0.key); card = null; draw(); };
      row0.append(b1, b2); strip.append(row0); strip.classList.remove('hidden');
      return;
    }
    const name = NAMES[c0.to], eff = isFree ? '' : c0.effort[0].toUpperCase() + c0.effort.slice(1);
    strip.append(mk('div', 'adv-title', isFree ? 'Suggestion: do this job on a free model' : `Suggestion: ${name} on ${eff} for this job`));
    strip.append(mk('div', 'adv-reason', c0.reason || (c0.to === 'opus' ? 'This looks hard; Opus is less likely to need a redo.' : isFree ? 'This is a small job.' : 'This looks small and simple.')));
    if (!isFree) strip.append(mk('div', 'adv-note', c0.to === 'opus'
      ? 'Costs about two-thirds more allowance per reply than Sonnet, but can be cheaper overall if Sonnet would need a redo.'
      : 'Should use less allowance than Sonnet. This saving is a guess, not measured yet.'));
    if (c0.free) strip.append(mk('div', 'adv-note adv-free-' + c0.free, (FREE_SAYS[c0.free] || '') + (c0.freeNote ? ' ' + c0.freeNote : '')));
    const row = mk('div', 'adv-row');
    const done = () => { markHandled(c0.key); card = null; draw(); };
    const btn = (cls, text, fn) => { const b = mk('button', cls, text); b.type = 'button'; b.onclick = (e) => { e.preventDefault(); fn(); }; row.append(b); };
    const useModel = () => { if (isFree) return; const o = pick(c0.to); if (!o) return; send({ type: 'prefs_set', model: o.value, effort: c0.effort }); send({ type: 'advisor_set', advised: true }); };
    if (!isFree) btn('adv-yes', `Switch to ${name} · ${eff}`, () => { useModel(); done(); });
    const other = otherPaid();
    if (other && !accts.free) {
      const pct = other.used == null ? '' : ` (${other.used}% used)`;
      btn('adv-no adv-acct', `${isFree ? 'Use' : 'Same on'} ${SHORTN[other.email.toLowerCase()] || other.email.split('@')[0]} account${pct}`,
        () => { send({ type: 'account_switch', id: other.id }); useModel(); done(); });
    }
    if (c0.free && c0.free !== 'private' && !accts.free) {
      btn(c0.free === 'same' ? 'adv-yes adv-freebtn' : 'adv-no adv-freebtn', c0.free === 'same' ? 'Do it free (just as good)' : 'Do it free anyway (not as good)', () => {
        const ask = lastAsk();
        send({ type: 'new_session', mode: 'extra_free' });   // grey free chat; this chat stays open as it is
        if (ask) send({ type: 'prompt', text: '(Moved here from a paid chat: the advisor said a free model does this job ' + (c0.free === 'same' ? 'just as well' : 'but not as well') + '.)\n\n' + ask });
        done();
      });
    }
    btn('adv-no', 'Stay as I am', () => { markHandled(c0.key); card = null; send({ type: 'advisor_set', declineKind: c0.kind }); draw(); });
    strip.append(row);
    strip.classList.remove('hidden');
  } else if (adv.advised && /sonnet/i.test(modelSelect.value + ' ' + (modelSelect.selectedOptions[0]?.dataset.resolvedModel || '')) && (document.getElementById('effort-select')?.value || 'medium') === 'medium') {
    send({ type: 'advisor_set', advised: false });   // my54: stuck flag, we are back on Sonnet Medium
    strip.classList.add('hidden');
  } else if (adv.advised && !adv.slimGone) {   // my104: hidden on every device, not just this one
    const row = mk('div', 'adv-row adv-slim');
    row.append(mk('span', 'adv-reason', 'Using a different model for this job.'));
    const b = mk('button', 'adv-no', 'Back to Sonnet now'); b.type = 'button';
    b.onclick = (e) => { e.preventDefault(); goBack(false); };
    const x = mk('button', 'adv-x', '✕'); x.type = 'button'; x.title = 'Hide this'; x.setAttribute('aria-label', 'Hide this');   // my52
    x.onclick = (e) => { e.preventDefault(); adv.slimGone = true; send({ type: 'advisor_set', slimGone: true }); draw(); };   // my104
    row.append(b, x); strip.append(row);
    strip.classList.remove('hidden');
  } else strip.classList.add('hidden');
}

export function onAdvisorMessage(msg) {
  adv = { enabled: msg.enabled !== false, advised: !!msg.advised, slimGone: !!msg.slimGone };   // my104: slimGone shared
  if (Array.isArray(msg.handled)) { for (const k of msg.handled) handled.add(k); saveHandled(); }
  if (card && handled.has(card.key)) card = null;   // my104: answered on another device
  if (!adv.enabled) card = null;
  const t = document.getElementById('advisor-toggle');
  if (t) { t.checked = adv.enabled; }
  draw();
}
document.getElementById('advisor-toggle')?.addEventListener('change', (e) => send({ type: 'advisor_set', enabled: e.target.checked }));

export const advisorOn = () => adv.enabled;   // my55
