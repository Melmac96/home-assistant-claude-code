/*
 * my46: haAi batch 2 (user: look A on every part, test page batch2-looks.html, 2026-11-09).
 *  13 job progress strip   14 finished card (It works / Not working)   15 plain-English error card
 *  16 approve-a-change card   19 picture card   20 morning brief   23 "what I told you" card   24 Sunday summary
 * Claude writes hidden lines such as ⟦DONE|a|b|c⟧; prepareCards turns them into placeholders and buildCards into real cards.
 */
import { S } from './state.js';
import { inputForm, messagesEl } from './dom.js';
import { sendText } from './quick.js';
import { undoText } from './batch4.js';   // my48
import { costKey, costText, saveJobText } from './my74.js';   // my74
import { timedCard, clashCard } from './my79.js';   // my79 H17 + H5

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MARK = /⟦(DONE|ERR|ASK|SHOW|MEM|WEEK|RULE|TIMED|CLASH)\|([^⟧\n]*)⟧/g;
const STEP = /⟦STEP\|([^⟧\n]*)⟧[ \t]*\n?/;
const PARTIAL = /⟦(?:DONE|ERR|ASK|SHOW|MEM|WEEK|RULE|TIMED|CLASH|STEP)[^⟧]*$/;

export function prepareCards(raw) {
  const m = raw.match(STEP);
  const text = raw.replace(STEP, '').replace(PARTIAL, '')
    .replace(MARK, (_, k, f) => `\n<div class="h2c" data-k="${k}" data-f="${esc(JSON.stringify(f.split('|').map((s) => s.trim())))}"></div>\n`);
  return { text, step: m ? m[1].split('|').map((s) => s.trim()) : null };
}
export const stripCards = (t) => String(t || '').replace(STEP, '').replace(PARTIAL, '').replace(MARK, '');

function card(cls, title, titleCls) { const c = mk('div', 'h2-card ' + cls); if (title) c.append(mk('div', 'h2-title ' + (titleCls || ''), title)); return c; }
function line(c, text) { if (text) c.append(mk('div', 'h2-line', text)); }
function btn(label, cls, onTap, card) {
  const b = mk('button', 'h2-btn ' + (cls || ''), label); b.type = 'button';
  b.onclick = (e) => {
    e.stopPropagation();
    card.querySelectorAll('.h2-btn').forEach((x) => { x.disabled = true; });
    b.classList.add('chosen');
    onTap();
  };
  return b;
}
const row = (...b) => { const r = mk('div', 'h2-row'); r.append(...b); return r; };
const safeUrl = (u) => /^http:\/\/192\.168\.1\.168\/local\/[\w\-./%]+$/.test(u);

export function buildCards(el) {
  el.querySelectorAll('.h2c').forEach((n) => {
    let f = []; try { f = JSON.parse(n.dataset.f); } catch { /* empty */ }
    const k = n.dataset.k; let c;
    if (k === 'DONE') {
      // my71 (his Look A, finished-box-looks.html): slim card, 2 short lines, one row of small buttons; backup name hidden, Undo still uses it
      c = card('good slim');
      const t1 = mk('div', 'h2-slim-t'); t1.append(mk('span', 'green', '✔ Finished, not confirmed yet'));
      if (f[1]) t1.append(document.createTextNode(' · ' + (/^\d+$/.test(f[1]) ? `${f[1]} file${f[1] === '1' ? '' : 's'}` : f[1])));
      c.append(t1);
      const cs = mk('div', 'h2-slim-t h74-cost'); costText(cs, costKey(f)); c.append(cs);   // my74 H6: what the job cost (Look C), own small line
      if (f[0]) { const t2 = mk('div', 'h2-slim-t grey', f[0]); t2.onclick = () => t2.classList.toggle('open'); c.append(t2); }
      c.append(row(btn('✓ It works', 'g sm', () => sendText('It works. Confirmed.'), c), btn('✗ Not working', 'r sm', () => sendText('That is not working. Please look at it again.'), c),
        btn('↩ Undo', 'sm', () => sendText(undoText(f[2])), c), btn('💾 Save as button', 'sm save', () => sendText(saveJobText(f[0])), c)));   // my74 H20
    } else if (k === 'RULE') {   // my74 H4: which rule a reply broke, and the fix
      c = card('bad', 'Broke a rule', 'red');
      if (f[0]) { const l = mk('div', 'h2-line'); l.append(mk('b', '', `Rule: "${f[0]}"`)); c.append(l); }
      line(c, f[1]); if (f[2]) line(c, 'Fix: ' + f[2]);
      c.append(row(btn('Fix it', 'g', () => sendText('Yes, fix it as you suggested.'), c), btn('Not now', '', () => sendText('Not now, leave that rule fix.'), c)));
    } else if (k === 'TIMED') {   // my79 H17
      c = timedCard(f, card, line);
    } else if (k === 'CLASH') {   // my79 H5
      c = clashCard(f, card, line, row, btn);
    } else if (k === 'ERR') {
      c = card('bad', 'Something went wrong', 'red');
      line(c, f[0]);
      c.append(row(btn('Try again', '', () => sendText('Please try that again.'), c), btn('Ask Claude', '', () => sendText('Please explain what went wrong and what we can do about it, in plain words.'), c)));
      if (f[1]) { const d = mk('details', 'h2-details'); d.append(mk('summary', '', 'details'), mk('div', 'h2-line', f[1])); c.append(d); }
    } else if (k === 'ASK') {
      c = card('info', 'Claude wants to change');
      line(c, f[0]);
      if (f[1] || f[2]) { const l = mk('div', 'h2-line'); l.append(mk('span', 'red', f[1] || ''), document.createTextNode(' → '), mk('span', 'green', f[2] || '')); if (f[3]) l.append(document.createTextNode(' ' + f[3])); c.append(l); }
      c.append(row(btn('Yes, do it', 'g', () => sendText('Yes, do it.'), c), btn('Not now', '', () => sendText('Not now.'), c)));
    } else if (k === 'SHOW') {
      c = card('plain');
      if (safeUrl(f[0] || '')) {
        const img = mk('img', 'h2-img'); img.src = f[0]; img.alt = f[1] || 'picture'; img.loading = 'lazy';
        const a = mk('a', 'h2-btn', 'Open it'); a.href = f[0]; a.target = '_blank'; a.rel = 'noopener';
        c.append(img); line(c, f[1]); c.append(row(a));
      } else line(c, f[1] || 'Picture not available');
    } else if (k === 'MEM') {
      c = card('plain', 'Things Claude remembers');
      f.filter(Boolean).forEach((t) => line(c, t));
      c.append(row(btn('Add a note', '', () => { const t = window.prompt('What should Claude remember?'); if (t && t.trim()) sendText('Please remember this: ' + t.trim()); }, c)));
    } else if (k === 'WEEK') {
      c = card('plain', 'This week');
      line(c, f[0] && `${f[0]} jobs done`); line(c, f[1] && `${f[1]} waiting for you`);
      const p = mk('div', 'h2-line green'); p.textContent = f[2] === '0' ? '0 problems found' : `${f[2] || '?'} problems found`; if (f[2] && f[2] !== '0') p.className = 'h2-line red'; c.append(p);
    }
    if (c) n.replaceWith(c);
  });
}

// ── 13. Job progress strip: only while Claude is working ─────────────────────
const strip = mk('div', 'h2-step hidden');
const bars = mk('div', 'h2-bars'), sNow = mk('div', 'h2-now'), sNext = mk('div', 'h2-next');
strip.append(bars, sNow, sNext);
inputForm.before(strip);
let stepData = null, stepTimer = null;
export function stepFound(contentEl, fields) { contentEl.dataset.step = JSON.stringify(fields); scanSteps(); }
function scanSteps() {
  clearTimeout(stepTimer);
  stepTimer = setTimeout(() => {
    const all = [...messagesEl.querySelectorAll('.bubble-assistant .bubble-content[data-step]')];
    stepData = all.length ? JSON.parse(all[all.length - 1].dataset.step) : null;
    drawStep();
  }, 150);
}
let stepDrawn = '';   // my82: only redraw when the step changed
function drawStep() {
  const n = Number(stepData && stepData[0]), t = Number(stepData && stepData[1]);
  if (!stepData || !S.isRunning || !(t >= 2) || !(n >= 1)) { strip.classList.add('hidden'); stepDrawn = ''; return; }
  const sig = JSON.stringify(stepData);
  if (sig === stepDrawn && !strip.classList.contains('hidden')) return;
  stepDrawn = sig;
  strip.classList.remove('hidden');
  bars.textContent = '';
  for (let i = 1; i <= t && i <= 12; i++) bars.append(mk('i', i < n ? 'd' : i === n ? 'n' : ''));
  sNow.textContent = '';
  sNow.append(mk('b', '', `Step ${n} of ${t}`), document.createTextNode(stepData[2] ? ` – ${stepData[2]}` : ''));
  sNext.textContent = stepData[3] ? `Next: ${stepData[3]}` : '';
}
setInterval(() => { if (!document.hidden) drawStep(); }, 2000);   // my82
new MutationObserver(() => { scanSteps(); }).observe(messagesEl, { childList: true });

// ── 20. Morning brief (my70, his Look E): ONE short grey line inside the chat, first open after waking;
//    it scrolls away with the chat (was a big card above the typing box that only went when he typed) ──
const briefLine = mk('div', 'h2-brief-line');
let briefLive = false, briefTimer = null;
const placeBrief = () => { if (briefLive && !briefLine.isConnected) messagesEl.append(briefLine); };
new MutationObserver(() => {
  if (!briefLive) return;
  if (briefLine.isConnected) {   // he has sent something after it: finished with, never put back after a rebuild
    for (let n = briefLine.nextElementSibling; n; n = n.nextElementSibling) if (n.classList.contains('bubble-user')) { briefLive = false; return; }
  } else { clearTimeout(briefTimer); briefTimer = setTimeout(placeBrief, 600); }   // chat rebuilt: wait until it settles
}).observe(messagesEl, { childList: true });
export function onBriefMessage(msg) {
  const b = msg.brief;
  if (!b) return;
  if (localStorage.getItem('brief-seen') === String(b.wokeAt)) return;
  localStorage.setItem('brief-seen', String(b.wokeAt));
  const hr = new Date().getHours();
  const parts = [hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening', `Home: ${b.home}`];
  if (b.sleptMin != null) parts.push(`Slept ${Math.floor(b.sleptMin / 60)} h ${String(b.sleptMin % 60).padStart(2, '0')}`);
  parts.push(`Waiting for you: ${b.waiting}`);
  if (b.checks) parts.push(`Checks for today: ${b.checks}`);   // my79 H10
  if (b.expire && b.expire.text) parts.push(`Next to expire: ${b.expire.text}`);   // my79 H11
  if (b.overnight) { parts.push(`Overnight jobs started: ${b.overnight}`); if (S.ws && S.isConnected) S.ws.send(JSON.stringify({ type: 'overnight_clear' })); }
  briefLine.textContent = '☀️ ' + parts.join(' · ');
  briefLive = true;
  briefLine.remove();
  placeBrief();
}
