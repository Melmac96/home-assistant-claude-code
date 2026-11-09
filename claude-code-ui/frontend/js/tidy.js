/*
 * my51: the tidy screen (user confirmed the mock-up www/my-claude-code-ui/tidy-mockup.html on 2026-11-09).
 * This module only REARRANGES what the other modules already build: it moves nothing out of the page, it hides
 * buttons it does not need on the bar (they stay in the page and are clicked from the menus), and it reads live
 * values (model, effort, chat size, allowance, home health, jobs, waiting list).
 *   top bar: haAi star (green = connected), badge, Settings, Accounts, menu, new chat
 *   slim status bar: red number + items that fade in groups; tap = drop-down with the full wording
 *   side bars: 5-hour allowance (left), 7-day allowance (right); bottom bar: chat size with a guess for the next reply
 *   bottom row: paperclip, more (everything else), keep (+), send; coloured token text
 *   extras: A/B/C answer chips, jump-to-latest arrow, big faint name on an empty chat
 */
import { S } from './state.js';
import { openNewChat } from './quick.js';
import { messagesEl, promptInput, modelSelect, effortSelect, statusDot } from './dom.js';

const $ = (id) => document.getElementById(id);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const LIM = 150;   // thousand tokens: where a chat counts as long (same number as the chat length strip)
const EFF = { low: 'L', medium: 'M', high: 'H', xhigh: 'X', max: 'Max' };
const colour = (p) => (p < 60 ? '#46bb68' : p < 85 ? '#e8b84a' : '#f3736c');
const cls = (p) => (p < 60 ? 'cg' : p < 85 ? 'cy' : 'cr');

let version = '';
let health = null;     // { status, count, lines }
let lost = false;
let growth = 6;        // thousand tokens added by the last reply: the guess for the next one
let lastK = 0;

const modelName = () => { const o = modelSelect.selectedOptions[0]; return o ? o.textContent.trim() : ''; };
const effLetter = () => EFF[effortSelect.value] || '';
const modelLabel = () => `${modelName()}${effLetter() ? ' ' + effLetter() : ''}`.trim();
const tokensK = () => (S.ctxUsage && S.ctxUsage.totalTokens ? Math.round(S.ctxUsage.totalTokens / 1000) : 0);
const pctOf = (id) => { const e = $(id); const w = e ? parseFloat(e.style.width) : NaN; return Number.isFinite(w) ? Math.round(w) : null; };
const updateNo = () => { const m = /my(\d+)/.exec(version); return m ? m[1] : ''; };

// ── top bar ──────────────────────────────────────────────────────────────────
const header = document.querySelector('.header');
const star = mk('span', 'tidy-star', '✳');
statusDot.after(star);
const group = document.querySelector('.icon-group');
const menuBtn = mk('button', 'icon-btn'); menuBtn.type = 'button'; menuBtn.id = 'tidy-menu-btn'; menuBtn.title = 'Menu'; menuBtn.setAttribute('aria-label', 'Menu');
menuBtn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
$('new-session-btn').before(menuBtn);

// ── status bar ───────────────────────────────────────────────────────────────
const sbar = mk('div'); sbar.id = 'tidy-sbar';
const stb = mk('button', 'tidy-stb'); stb.type = 'button';
const num = mk('span', 'tidy-num hidden');
const col = mk('span', 'tidy-col');
const cyc = mk('span'); cyc.id = 'tidy-cyc';
const meas = mk('span'); meas.id = 'tidy-mz';
col.append(cyc); stb.append(num, col); sbar.append(stb, meas);
header.after(sbar);

const veil = mk('div', 'tidy-veil hidden');
const sheet = mk('div', 'tidy-sheet hidden');
const menu = mk('div', 'tidy-sheet tidy-menu hidden');
const more = mk('div', 'tidy-sheet tidy-more hidden');
document.body.append(veil, sheet, menu, more);
const closeAll = () => { for (const e of [veil, sheet, menu, more]) e.classList.add('hidden'); };
veil.onclick = closeAll;
const open = (el) => { closeAll(); veil.classList.remove('hidden'); el.classList.remove('hidden'); };

function items() {
  const a = [['Using ' + modelLabel(), 'cb']];
  const k = tokensK();
  if (k >= LIM) a.push(['⚠ Long chat: ' + k + 'k tokens', 'cr']);
  const u = S.ctxUsage;
  const limit = u ? ((u.autoCompactEnabled && u.autoCompactThreshold) || u.maxTokens) : 0;
  if (u && limit && u.totalTokens) a.push([Math.max(0, 100 - Math.min(100, Math.round(u.totalTokens / limit * 100))) + '% left before auto-compact', 'cg']);
  const jobs = (S.backgroundTasks || []).length;
  if (jobs) a.push([jobs + (jobs === 1 ? ' job running' : ' jobs running'), 'cb']);
  const w = /\d+/.exec(($('waiting-count') || {}).textContent || '');
  if (w && +w[0]) a.push([w[0] + (w[0] === '1' ? ' thing waiting for you to test' : ' things waiting for you to test'), 'cb']);
  const f = pctOf('ub-5h');
  if (f != null) a.push(['5-hour allowance ' + f + '% used', cls(f).replace('cg', 'cg')]);
  const hrs = backupHours();
  if (hrs != null && hrs >= 24) a.push(['Last backup ' + hrs + ' hours ago', 'cr']);
  return a;
}
function backupHours() {
  if (!health || !health.lines) return null;
  for (const l of health.lines) { const m = /backup is (\d+) hours? old/i.exec(l); if (m) return +m[1]; }
  return null;
}
let ci = 0;
function cycle(now) {
  const a = items(), W = cyc.clientWidth || 200;
  const groups = [];
  let cur = [];
  for (const it of a) {
    const t = cur.concat([it]);
    meas.innerHTML = '';
    meas.textContent = t.map((x) => x[0]).join(' · ');
    if (cur.length && meas.offsetWidth > W) { groups.push(cur); cur = [it]; } else cur = t;
  }
  groups.push(cur);
  if (groups.length < 2) ci = 0; else if (!now) ci++;
  const grp = groups[ci % groups.length];
  const paint = () => {
    cyc.textContent = '';
    grp.forEach((x, i) => { if (i) cyc.append(mk('span', 'tidy-sep', ' · ')); cyc.append(mk('span', x[1], x[0])); });
    cyc.classList.remove('f');
  };
  if (now) paint(); else { cyc.classList.add('f'); setTimeout(paint, 900); }
}
setInterval(() => cycle(false), 5000);

function drawNum() {
  const bad = lost || (health && health.status !== 'good');
  num.classList.remove('hidden', 'ok');
  if (lost) num.textContent = '!';
  else if (!health || health.status === 'wait') num.classList.add('hidden');
  else if (health.status === 'stale') num.textContent = '!';
  else if (health.status === 'bad') num.textContent = String(health.count);
  else { num.textContent = '✓'; num.classList.add('ok'); }
  void bad;
}

function row(text, sub, kind, extra) {
  const r = mk('div', 'tidy-row ' + (kind || ''));
  const t = mk('span', 'tidy-r1', text);
  if (sub) t.append(mk('span', 'tidy-sm', sub));
  r.append(t);
  if (extra) r.append(extra);
  return r;
}
const btn = (text, fn) => { const b = mk('button', 'tidy-btn', text); b.type = 'button'; b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; };

function fillSheet() {
  sheet.textContent = '';
  sheet.append(mk('h4', null, 'Status'));
  const k = tokensK();
  if (lost || (health && health.status !== 'good' && health.status !== 'wait')) {
    const text = lost ? '● haAi has lost touch with the home check' : health.status === 'stale' ? '● The home check has stopped updating' : `● ${health.count} ${health.count === 1 ? 'thing needs' : 'things need'} a look`;
    const r = row(text, null, 'r', mk('span', null, '›')); r.onclick = () => { closeAll(); $('health-btn').click(); };
    sheet.append(r);
  }
  if (k >= LIM) sheet.append(row(`⚠ Long chat (${k}k tokens): costs more each reply`, null, 'r', btn('New chat', () => { closeAll(); openNewChat(); })));
  if (!/sonnet/i.test(modelName())) {
    const r = row(`Using ${modelLabel()} for this chat`, null, 'b', btn('Back to Sonnet', () => {
      const o = [...modelSelect.options].find((x) => /sonnet/i.test(x.textContent));
      if (o) { modelSelect.value = o.value; modelSelect.dispatchEvent(new Event('change', { bubbles: true })); }
      closeAll();
    }));
    sheet.append(r);
  }
  const u = S.ctxUsage;
  if (u && u.totalTokens) {
    const limit = (u.autoCompactEnabled && u.autoCompactThreshold) || u.maxTokens;
    const left = limit ? Math.max(0, 100 - Math.min(100, Math.round(u.totalTokens / limit * 100))) : null;
    const sub = `≈ ${k + growth}k after your next reply`;
    sheet.append(row(`${k}k tokens${left != null ? ` · ${left}% to auto-compact` : ''}`, sub, 'g'));
  }
  const f = pctOf('ub-5h'), w7 = pctOf('ub-7d');
  if (f != null) {
    const r = row(`5-hour allowance ${f}% used`, w7 != null ? `Weekly ${w7}% used` : '', '', mk('span', null, '›'));
    r.onclick = () => { closeAll(); $('usage-bars').click(); };
    sheet.append(r);
  }
  const jobs = (S.backgroundTasks || []).length;
  const wt = /\d+/.exec(($('waiting-count') || {}).textContent || '');
  if (jobs || (wt && +wt[0])) sheet.append(row(`${jobs} jobs running · ${wt ? wt[0] : 0} things waiting for you`, null, 'b'));
  const hrs = backupHours();
  if (hrs != null && hrs >= 24) sheet.append(row(`Last backup ${hrs} hours ago`, null, 'r'));
}
stb.onclick = () => { fillSheet(); open(sheet); };

// ── menu ─────────────────────────────────────────────────────────────────────
function fillMenu() {
  menu.textContent = '';
  const h = mk('h4', null, '✳ haAi'); if (updateNo()) h.append(mk('span', 'tidy-sm tidy-inl', 'update ' + updateNo()));
  menu.append(h);
  const go = (t, id) => { const r = mk('button', 'tidy-row'); r.type = 'button'; r.textContent = t; r.onclick = () => { closeAll(); $(id).click(); }; menu.append(r); };
  go('★ Favourites', 'stars-btn');
  go('⌕ Search', 'find-btn');
  go('◷ History', 'sessions-btn');
  go('📺 TV view', 'tv-view-btn');
  const big = mk('button', 'tidy-row'); big.type = 'button'; big.textContent = 'Aa Bigger text';
  big.onclick = () => {
    const r = $('ts-range'); if (!r) return;
    const on = localStorage.getItem('tidyBigFrom');
    if (on) { r.value = on; localStorage.removeItem('tidyBigFrom'); } else { localStorage.setItem('tidyBigFrom', r.value); r.value = Math.min(250, parseInt(r.value, 10) + 30); }
    r.dispatchEvent(new Event('input', { bubbles: true }));
    closeAll();
  };
  menu.append(big);
}
menuBtn.onclick = () => { fillMenu(); open(menu); };
window.addEventListener('haai-version', (e) => { version = String(e.detail || ''); setWm(); });

// ── pinned summaries: a pin and a number on the top bar, opens a drop-down ────
const pinBtn = mk('button', 'icon-btn hidden'); pinBtn.type = 'button'; pinBtn.id = 'tidy-pin-btn'; pinBtn.title = 'Pinned'; pinBtn.setAttribute('aria-label', 'Pinned');
pinBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3.5h6l-1 6 3.5 3.5v1.5h-11V13L10 9.5z"/><path d="M12 14.5V21"/></svg>';
const pinNum = mk('span');
pinBtn.append(pinNum);
group.prepend(pinBtn);
function drawPins() {
  const n = (window.haaiPins || []).length;
  pinNum.textContent = n || '';
  pinBtn.classList.toggle('hidden', !n);
}
pinBtn.onclick = () => {
  sheet.textContent = '';
  sheet.append(mk('h4', null, 'Pinned'));
  for (const p of (window.haaiPins || []).slice().reverse()) {
    const r = row(p[0] || 'This chat', p[1] ? 'Done: ' + p[1] : null, 'b');
    if (p[2]) r.firstChild.append(mk('span', 'tidy-sm', 'Next: ' + p[2]));
    sheet.append(r);
  }
  open(sheet);
};
window.addEventListener('haai-pins', drawPins);

// ── side bars and chat bar ───────────────────────────────────────────────────
const e5 = mk('div', 'tidy-eb'); e5.id = 'tidy-e5'; e5.append(mk('i'));
const ew = mk('div', 'tidy-eb'); ew.id = 'tidy-ew'; ew.append(mk('i'));
const tb = mk('div', 'tidy-tb'); const tbi = mk('i'); const tbg = mk('b'); tb.append(tbi, tbg);
document.body.append(e5, ew, tb);
function drawBars() {
  for (const [el, id] of [[e5, 'ub-5h'], [ew, 'ub-7d']]) {
    const p = pctOf(id);
    el.style.display = p == null ? 'none' : '';
    if (p != null) { const i = el.firstChild; i.style.height = p + '%'; i.style.background = colour(p); }
  }
  const k = tokensK();
  tb.style.display = k ? '' : 'none';
  const pc = Math.min(100, k / LIM * 100), nx = Math.min(100, (k + growth) / LIM * 100), c = colour(pc);
  tbi.style.width = pc + '%'; tbi.style.background = c;
  tbg.style.left = pc + '%'; tbg.style.width = Math.max(0, nx - pc) + '%'; tbg.style.color = c; tbg.style.opacity = nx > pc ? 1 : 0;
}
new MutationObserver(drawBars).observe($('usage-bars'), { subtree: true, attributes: true, attributeFilter: ['style'] });

// ── bottom row ───────────────────────────────────────────────────────────────
const actions = document.querySelector('.composer-actions');
const keepBtn = $('keep-btn');
promptInput.placeholder = 'Ask haAi…';
keepBtn.textContent = '+';
keepBtn.setAttribute('aria-label', 'Add this bit to my message');
const moreBtn = mk('button', 'attach-btn tidy-morebtn'); moreBtn.type = 'button'; moreBtn.title = 'More'; moreBtn.setAttribute('aria-label', 'More');
moreBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="3" cy="9" r="1.8" fill="#9cc8ff"/><circle cx="9" cy="9" r="1.8" fill="#9cc8ff"/><circle cx="15" cy="9" r="1.8" fill="#9cc8ff"/></svg>';
$('attach-btn').after(moreBtn);
const tk = mk('span', 'tidy-tk');
moreBtn.after(tk);
const KEEP = new Set(['attach-btn', 'keep-btn', 'send-btn']);
const tucked = [];
function sweep() {
  tucked.length = 0;
  for (const b of actions.querySelectorAll(':scope > button')) {
    if (KEEP.has(b.id) || b === moreBtn) continue;
    b.classList.add('tidy-hid'); tucked.push(b);
  }
}
sweep();
new MutationObserver(sweep).observe(actions, { childList: true });
moreBtn.onclick = () => {
  more.textContent = ''; more.append(mk('h4', null, 'More'));
  for (const b of tucked) {
    const label = b.title || b.getAttribute('aria-label') || b.textContent.trim();
    if (!label) continue;
    const r = mk('button', 'tidy-row'); r.type = 'button';
    const ic = b.querySelector('svg'); if (ic) { const c = ic.cloneNode(true); c.setAttribute('width', 18); c.setAttribute('height', 18); r.append(c); } else if (b.textContent.trim().length <= 3) r.append(mk('span', null, b.textContent.trim()));
    r.append(mk('span', 'tidy-r1', label));
    r.onclick = () => { closeAll(); b.click(); };
    more.append(r);
  }
  open(more);
};
function drawTk() {
  const k = tokensK();
  tk.textContent = k ? `${k}k · ${modelLabel()}` : modelLabel();
  tk.className = 'tidy-tk ' + (k >= LIM ? 'cr' : 'cg');
}

// ── live data hooks ──────────────────────────────────────────────────────────
window.addEventListener('haai-ctx', () => {
  const k = tokensK();
  if (lastK && k > lastK) growth = Math.max(2, Math.min(20, k - lastK));
  lastK = k;
  drawBars(); drawTk(); cycle(true);
});
window.addEventListener('haai-health', (e) => { health = e.detail.data; lost = e.detail.lost; drawNum(); cycle(true); });
modelSelect.addEventListener('change', () => { drawTk(); cycle(true); });
effortSelect.addEventListener('change', () => { drawTk(); cycle(true); });
window.addEventListener('haai-models', () => { drawTk(); cycle(true); });
star.classList.toggle('on', statusDot.classList.contains('connected'));
new MutationObserver(() => star.classList.toggle('on', statusDot.classList.contains('connected'))).observe(statusDot, { attributes: true, attributeFilter: ['class'] });

// ── answer chips (A / B / C) above the typing box ────────────────────────────
const chips = mk('div'); chips.id = 'tidy-chips'; chips.classList.add('hidden');
$('input-form').prepend(chips);
let chipTimer = 0;
function drawChips() {
  chips.textContent = '';
  const cards = [...messagesEl.querySelectorAll('.answer-card:not(.locked)')];
  const groups = new Set(cards.map((c) => c.closest('.bubble, .bubble-assistant, div')));
  const single = cards.length >= 2 && cards.every((c) => c.parentElement === cards[0].parentElement);
  void groups;
  if (!single) { chips.classList.add('hidden'); return; }
  for (const c of cards) {
    const b = mk('button', null, c._letter || '?'); b.type = 'button';
    if (c._other) b.classList.add('other');
    b.onclick = () => { c.click(); const s = c.parentElement.querySelector('.answer-send'); if (s && !c._other && !s.disabled) s.click(); else c.scrollIntoView({ block: 'center' }); };
    chips.append(b);
  }
  chips.classList.remove('hidden');
}

// ── jump to latest, big faint name on an empty chat ──────────────────────────
const jl = mk('button', 'tidy-jl hidden', '↓'); jl.type = 'button'; jl.title = 'Jump to latest'; jl.setAttribute('aria-label', 'Jump to latest');
const wm = mk('div', 'tidy-wm hidden');
$('chat-scroll').append(jl, wm);
const nearEnd = () => messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
messagesEl.addEventListener('scroll', () => jl.classList.toggle('hidden', nearEnd()), { passive: true });
jl.onclick = () => { messagesEl.scrollTop = messagesEl.scrollHeight; };
function setWm() {
  wm.textContent = '';
  wm.append(document.createTextNode('✳ haAi'));
  if (updateNo()) wm.append(mk('small', null, 'update ' + updateNo()));
  wm.classList.toggle('hidden', messagesEl.children.length > 0);
}
new MutationObserver(() => {
  setWm();
  jl.classList.toggle('hidden', nearEnd());
  clearTimeout(chipTimer); chipTimer = setTimeout(drawChips, 250);
}).observe(messagesEl, { childList: true, subtree: true });

setWm(); drawBars(); drawTk(); drawNum(); drawPins(); cycle(true);
