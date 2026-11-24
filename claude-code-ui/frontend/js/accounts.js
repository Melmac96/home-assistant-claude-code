/*
 * My Claude Code UI: the Accounts section of Settings (look 4) and the small
 * account label in the header. A Switch asks 'are you sure?' first, so a stray
 * tap cannot sign you out. The server never sends tokens, only emails and names.
 */
import { S } from './state.js';
import { setAuthenticated } from './connection.js';
import { loginBtn, loginDesc, loginTitle, loginScreen } from './dom.js';
import { openAccountPage, openProviderPage } from './accpage.js';   // my148: each account's own page

const list = document.getElementById('accounts-list');
const confirmBox = document.getElementById('account-confirm');
const freeList = document.getElementById('accounts-free');
const paidProv = document.getElementById('accounts-paid-prov');
const freeProv = document.getElementById('accounts-prov');
const addBtn = document.getElementById('account-add');
const label = document.getElementById('account-label');
const cancelBtn = document.getElementById('login-cancel');

// Header shows a short name; the full email is in Settings > Accounts.
const SHORT = { 'thereades@gmail.com': 'Main', 'thereades.uk@gmail.com': '2nd', 'rf.mike@gmail.com': '3rd', 'readerufus@gmail.com': '4th', 'rufusreade1969@gmail.com': '5th' };
// my19: paid accounts listed Main first, with a white PAID line under a grey email.
const PAID = { 'thereades@gmail.com': 'PAID - Main Claude Pro Account', 'thereades.uk@gmail.com': 'PAID - 2nd Claude Pro Account', 'rf.mike@gmail.com': 'PAID - 3rd Claude Pro Account', 'readerufus@gmail.com': 'PAID - 4th Claude Pro Account', 'rufusreade1969@gmail.com': 'PAID - 5th Claude Pro Account' };
const ORDER = ['thereades@gmail.com', 'thereades.uk@gmail.com', 'rf.mike@gmail.com', 'readerufus@gmail.com', 'rufusreade1969@gmail.com'];
const rank = (e) => { const i = ORDER.indexOf(String(e).toLowerCase()); return i < 0 ? 99 : i; };
export const shortName = (email) => SHORT[String(email).toLowerCase()] || String(email).split('@')[0];   // my78: also used by the chat tabs

// my115: says whether it went; with no link he is told and the button is not left greyed out
const send = (o) => {
  if (S.ws && S.isConnected && S.ws.readyState === 1) { try { S.ws.send(JSON.stringify(o)); return true; } catch { /* below */ } }
  const t = document.createElement('div'); t.className = 'guard-toast'; t.textContent = 'No connection, so nothing was changed. Try again when haAi is back.';
  t.onclick = () => t.remove(); document.body.append(t); setTimeout(() => t.remove(), 6000);
  return false;
};
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };


// my18: the service + model badge next to the Ask box (not a menu, it just says what is in use).
// Paid: "Claude" over the account (Main / 2nd). Free: the service over the model.
const badge = document.getElementById('svc-badge');
const BN = { openrouter: 'OpenRouter', google: 'Google', groq: 'Groq', mistral: 'Mistral', cerebras: 'Cerebras', huggingface: 'Hugging Face', nvidia: 'NVIDIA', ollama: 'Ollama', auto: 'Free Auto' };
const prettyModel = (id) => String(id || '').split('/').pop().replace(/:free$/, '');
function setBadge(cur, m) {
  if (!badge) return;
  const a = badge.querySelector('.sb-a'), b = badge.querySelector('.sb-m');
  const free = !!(m && m.free);
  badge.classList.toggle('free', free);
  if (free) {
    a.textContent = BN[m.provider] || 'Free';
    b.textContent = prettyModel(m.model) || (m.provider === 'auto' ? 'Automatic' : 'Free model');
  } else {
    a.textContent = 'Claude';
    b.textContent = cur ? shortName(cur.email) : 'Signed out';
  }
}

// ── Hold buttons + Look D tiles (Michael 23 Nov 2026, Q1 D, Q2 A) ─────────────────────────────
// Main across the top, the other accounts in a 2 by 2 grid. Each Hold button holds ONLY its own account, until tapped off.
let lastMsg = null, lastQuota = {};
const UKT = { timeZone: 'Europe/London' };
const hmT = (d) => d.toLocaleTimeString('en-GB', { ...UKT, hour: '2-digit', minute: '2-digit' });
const dayT = (d) => d.toLocaleDateString('en-GB', { ...UKT, day: 'numeric', month: 'short' });
const when = (ms) => { const d = new Date(ms); return dayT(d) === dayT(new Date()) ? hmT(d) + ' today' : d.toLocaleDateString('en-GB', { ...UKT, weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + hmT(d); };
const lvl = (p, cap) => (p >= cap ? 'r' : p >= 50 ? 'a' : 'g');
function fig(q, key) {   // { p, reset } or null; a window that has reset since counts as 0
  const w = q && q[key]; if (!w || w.used == null) return null;
  const reset = w.resetsAt ? w.resetsAt * 1000 : 0;
  return reset && reset <= Date.now() ? { p: 0, reset: 0 } : { p: Math.round(w.used), reset };
}
function tbar(label, f, cap, wide) {
  const d = mk('div', 'acc-tbar');
  const top = mk('div', 'acc-tlbl'); top.append(mk('span', '', label), mk('b', f ? 'acc-' + lvl(f.p, cap) + 'tx' : '', f ? f.p + '%' : 'no figure yet'));
  const t = mk('div', 'acc-track'), fill = mk('i', f ? 'acc-' + lvl(f.p, cap) + 'bg' : '');
  fill.style.width = (f ? Math.min(f.p, 100) : 0) + '%'; t.append(fill);
  d.append(top, t);
  if (wide && f && f.reset) d.append(mk('div', 'acc-tnote', 'Resets ' + when(f.reset)));
  return d;
}
function holdButton(a, held) {
  const b = mk('button', 'settings-btn acc-hold' + (held ? ' active' : ''), held ? 'ON HOLD' : 'Hold'); b.type = 'button';
  b.onclick = () => { b.disabled = send({ type: 'account_hold', email: a.email, on: !held }); };   // this one account only
  return b;
}
function drawTiles() {
  const msg = lastMsg; if (!msg) return;
  list.innerHTML = '';
  const saved = (msg.saved || []).slice().sort((x, y) => rank(x.email) - rank(y.email));
  if (!saved.length) return;
  const held = msg.held || {}, turn = msg.turn;
  const tile = (a, wide) => {
    const e = a.email.toLowerCase(), q = lastQuota[e], isHeld = !!held[e], cap = a.cap || 95;
    const f5 = fig(q, 'five_hour'), f7 = fig(q, 'seven_day');
    const t = mk('div', 'acc-tile' + (wide ? ' acc-wide' : '') + (isHeld ? ' acc-held' : a.active ? ' acc-on' : ''));
    t.append(mk('div', 'acc-big', shortName(a.email)), mk('div', 'acc-temail', wide ? a.email : a.email.split('@')[0]));
    const due = msg.pending && msg.pending.email === a.email;
    const myTurn = turn && turn.email === e && turn.on;
    let chip;
    if (isHeld) chip = mk('span', 'acc-chip acc-r', 'On hold');
    else if (due) chip = mk('span', 'acc-chip acc-b', 'Switch due');
    else if (a.active) chip = mk('span', 'acc-chip acc-b', 'Signed in');
    else if (f5 && f5.p >= cap) chip = mk('span', 'acc-chip acc-a', f5.reset ? 'Full till ' + hmT(new Date(f5.reset)) : 'Full');
    else if (myTurn) chip = mk('span', 'acc-chip acc-g', 'Its turn');
    else chip = mk('span', 'acc-chip acc-g', 'Room');
    t.append(chip, tbar('5 hours', f5, cap, wide), tbar('7 days', f7, cap, wide));
    if (wide) {
      let note = isMain_(e) ? 'Used last. Never past 75%, because you use it in the Claude app too.' : 'Used before it resets. Can go up to 95%.';
      if (turn && turn.email === e) note = turn.on ? `Its turn now, until ${when(turn.close)}.` : `Its turn opens ${when(turn.open)}.`;
      if (isHeld) note = 'On hold: haAi will not use it until you tap ON HOLD to take the hold off. A reply already running finishes first.';
      t.append(mk('div', 'acc-tnote acc-center', note));
      if (q && q.forecast && /I predict you will use up/.test(q.forecast)) t.append(mk('div', 'acc-tnote acc-center acc-atx', q.forecast));
    } else if (q && q.forecast && /I predict you will use up/.test(q.forecast)) t.append(mk('div', 'acc-tnote acc-center acc-atx', 'May run out before it resets'));
    const btns = mk('div', 'acc-tbtns');
    if (due) { const c = mk('button', 'settings-btn', 'Cancel'); c.type = 'button'; c.onclick = () => { c.disabled = send({ type: 'account_switch_cancel' }); }; btns.append(c); }
    else { const s = mk('button', 'settings-btn', 'Switch'); s.type = 'button'; if (a.active) s.disabled = true; else s.onclick = () => askSwitch(a); btns.append(s); }
    btns.append(holdButton(a, isHeld));
    t.append(btns, mk('div', 'acc-tnote acc-center acc-more', 'Tap for its own page \u203a'));
    // my148 (Michael 24 Nov): tapping the account (not one of its buttons) opens its own page
    t.classList.add('acc-tap');
    t.onclick = (ev) => {
      if (ev.target.closest('button')) return;
      openAccountPage(a, { short: shortName(a.email), label: PAID[e] || '', chip: chip.textContent, chipCls: chip.className.replace('acc-chip', '').trim(), cap, held: isHeld });
    };
    return t;
  };
  const first = saved[0];
  list.appendChild(tile(first, true));
  const g = mk('div', 'acc-grid2'); for (const a of saved.slice(1)) g.appendChild(tile(a, false)); list.appendChild(g);
}
const isMain_ = (e) => rank(e) === 0;
window.addEventListener('haai-quota', (ev) => { lastQuota = ev.detail || {}; drawTiles(); });
// the 3 page buttons: Claude Pro, Other Paid, Free
const tabs = document.getElementById('acc-tabs');
if (tabs) tabs.addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-page]'); if (!b) return;
  ev.stopPropagation();
  for (const x of tabs.querySelectorAll('button')) x.classList.toggle('on', x === b);
  for (const pg of document.querySelectorAll('#accounts-panel .acc-page')) pg.classList.toggle('hidden', pg.dataset.page !== b.dataset.page);
});

export function showAccounts(msg) {
  setTimeout(() => { if (lastStats) showStats(lastStats); }, 0);
  const cur = msg.current;
  cancelBtn.classList.add('hidden');
  const free = !!(msg.mode && msg.mode.free);
  label.textContent = cur ? shortName(cur.email) + (free ? ' · Free' : '') : '';
  label.classList.toggle('hidden', !cur);
  setBadge(cur, msg.mode);
  list.innerHTML = ''; freeList.innerHTML = '';
  const saved = (msg.saved || []).slice().sort((x, y) => rank(x.email) - rank(y.email));
  window.dispatchEvent(new CustomEvent('haai-accounts', { detail: { cur, saved, free } }));   // my54
  lastMsg = msg; drawTiles();
  if (!(msg.saved || []).length) list.appendChild(mk('div', 'settings-hint', 'No accounts saved yet.'));
  // my16: the Free / Paid model choice, one more option under the accounts.
  if (msg.mode) {
    const m = msg.mode;
    const row = mk('div', 'acc-row' + (m.free ? ' acc-free' : ''));
    const PN = { openrouter: 'OpenRouter', google: 'Google', groq: 'Groq', mistral: 'Mistral', cerebras: 'Cerebras', huggingface: 'Hugging Face', nvidia: 'NVIDIA', ollama: 'Ollama', auto: 'Automatic' };
    const who = mk('div', 'acc-who', 'Free models (' + (PN[m.provider] || 'OpenRouter') + ')');
    who.appendChild(mk('small', '', m.free ? 'In use now. Weaker, no cost. Your Claude sign-in is untouched.'
      : (m.hasKey ? 'No cost, weaker. For simple jobs.' : 'No OpenRouter key saved yet.')));
    row.appendChild(who);
    if (m.free) {
      row.appendChild(mk('span', 'acc-tag acc-tag-free', 'In use'));
      const b = mk('button', 'settings-btn', 'Back to paid'); b.type = 'button';
      b.onclick = () => askMode(false);
      row.appendChild(b);
      if (m.provider === 'openrouter' && (m.pool || []).length) {
        const sel = document.createElement('select'); sel.className = 'settings-btn acc-model';
        for (const o of m.pool) { const op = mk('option', '', o.id.replace(':free', '') + (o.context ? '  ' + Math.round(o.context / 1000) + 'k' : '')); op.value = o.id; if (o.id === m.model) op.selected = true; sel.appendChild(op); }
        const go = mk('button', 'settings-btn', 'Use this model'); go.type = 'button';
        go.onclick = () => { go.disabled = send({ type: 'model_set', model: sel.value }); };
        const r2 = mk('div', 'acc-confirm-row'); r2.append(sel, go); freeList.appendChild(row); freeList.appendChild(r2); return;
      }
    } else if (m.hasKey) {
      const b = mk('button', 'settings-btn', 'Switch'); b.type = 'button';
      b.onclick = () => askMode(true);
      row.appendChild(b);
    }
    freeList.appendChild(row);
  }
}

function askMode(free) {
  confirmBox.innerHTML = '';
  confirmBox.appendChild(mk('b', '', free ? 'Switch to FREE models (OpenRouter)?' : 'Switch back to your paid Claude account?'));
  confirmBox.appendChild(mk('div', 'settings-hint',
    'It applies to your next NEW chat. This chat will close, and a short summary of where you are is saved first. Your Claude sign-in is never touched.'
    + (free ? ' Free models are weaker: for big jobs switch back.' : '')));
  const row = mk('div', 'acc-confirm-row');
  const no = mk('button', 'settings-btn', 'Cancel'); no.type = 'button';
  const yes = mk('button', 'settings-btn acc-yes', 'Switch'); yes.type = 'button';
  no.onclick = () => confirmBox.classList.add('hidden');
  yes.onclick = () => { yes.disabled = send({ type: 'mode_switch', free }); };
  row.append(no, yes);
  confirmBox.appendChild(row);
  confirmBox.classList.remove('hidden');
}

function askSwitch(a) {
  confirmBox.innerHTML = '';
  confirmBox.appendChild(mk('b', '', `Switch to ${a.email}?`));
  confirmBox.appendChild(mk('div', 'settings-hint',
    'Your next message will use that account. Your current sign-in is backed up first. Nothing is lost.'));
  const row = mk('div', 'acc-confirm-row');
  const no = mk('button', 'settings-btn', 'Cancel'); no.type = 'button';
  const yes = mk('button', 'settings-btn acc-yes', 'Switch'); yes.type = 'button';
  no.onclick = () => confirmBox.classList.add('hidden');
  yes.onclick = () => { yes.disabled = send({ type: 'account_switch', id: a.id }); };
  row.append(no, yes);
  confirmBox.appendChild(row);
  confirmBox.classList.remove('hidden');
}

export function showAccountResult(msg) {
  confirmBox.innerHTML = '';
  if (msg.ok && msg.providerSet) {
    confirmBox.appendChild(mk('b', '', 'Done: Free mode will use ' + msg.provider));
    confirmBox.appendChild(mk('div', 'settings-hint', 'Open a NEW chat for it to take effect.'));
    confirmBox.classList.remove('hidden');
    return;
  }
  if (msg.ok && msg.modelSet) {
    confirmBox.appendChild(mk('b', '', 'Done: now using ' + msg.model));
    confirmBox.appendChild(mk('div', 'settings-hint', 'Your next message in this chat uses it. Nothing is lost.'));
    confirmBox.classList.remove('hidden');
    return;
  }
  if (msg.ok && msg.mode) {
    confirmBox.appendChild(mk('b', '', msg.free ? 'Done: Free models are on.' : 'Done: your paid Claude account is back.'));
    confirmBox.appendChild(mk('div', 'settings-hint', 'Open a NEW chat now for it to take effect. This chat will close shortly.'));
    confirmBox.classList.remove('hidden');
    return;
  }
  if (msg.ok && msg.pending) {   // my123
    confirmBox.appendChild(mk('b', '', 'Done: switching to ' + shortName(msg.email) + ' right after this turn'));
    confirmBox.appendChild(mk('div', 'settings-hint', 'haAi is busy, so nothing is cut off. It switches as soon as the current reply ends, and the account list above says so until then.'));
    confirmBox.classList.remove('hidden');
    return;
  }
  if (msg.ok) {
    confirmBox.classList.add('hidden');
    return;
  }
  confirmBox.appendChild(mk('b', '', msg.error || 'The switch did not work.'));
  confirmBox.classList.remove('hidden');
}

// Sign in to another account: the normal sign-in screen, but the current
// account stays untouched until the new sign-in actually completes.
addBtn.onclick = () => {
  setAuthenticated(false);
  loginTitle.textContent = 'Sign in to another account';
  loginDesc.textContent = 'Sign in with the other Claude account. It is saved here, and you can switch between them in Settings.';
  cancelBtn.classList.remove('hidden');
};
cancelBtn.onclick = () => {
  send({ type: 'auth_cancel' });
  cancelBtn.classList.add('hidden');
  loginScreen.classList.add('hidden');
  loginBtn.disabled = false;
};

// Header Accounts icon (5th icon): opens the Accounts panel under the header.
const accBtn = document.getElementById('accounts-btn');
const accPanel = document.getElementById('accounts-panel');
const closeAcc = () => { accPanel.classList.add('hidden'); accBtn.classList.remove('active'); };
accBtn.onclick = (e) => {
  e.stopPropagation();
  send({ type: 'stats_get' });
  const open = accPanel.classList.toggle('hidden');
  accBtn.classList.toggle('active', !open);
  if (!open) {
    for (const id of ['settings', 'sessions']) {
      document.getElementById(id + '-panel').classList.add('hidden');
      document.getElementById(id + '-btn').classList.remove('active');
    }
  }
};
document.addEventListener('click', (e) => {
  if (accPanel.classList.contains('hidden')) return;
  if (accPanel.contains(e.target) || accBtn.contains(e.target)) return;
  closeAcc();
});

// my8: only ONE of the five header icons is lit / open at a time. Before an icon's own
// handler runs (capture phase), close whatever the OTHER icons opened.
const PANELS = { 'settings-btn': 'settings-panel', 'sessions-btn': 'sessions-panel', 'accounts-btn': 'accounts-panel' };
function closeOthers(keepBtnId) {
  for (const [bid, pid] of Object.entries(PANELS)) {
    if (bid === keepBtnId) continue;
    document.getElementById(pid).classList.add('hidden');
    document.getElementById(bid).classList.remove('active');
  }
  if (keepBtnId !== 'find-btn') {
    const fb = document.getElementById('find-bar');
    if (fb && !fb.classList.contains('hidden')) document.getElementById('find-close').click();
  }
}
for (const id of ['find-btn', 'sessions-btn', 'settings-btn', 'accounts-btn', 'new-session-btn']) {
  document.getElementById(id).addEventListener('click', () => closeOthers(id), true);
}


// my25: one row per provider with usage lines (requests, tokens, credit, limits). Paid ones (Hugging Face) sit above the blue line.
let lastStats = null;
export function showStats(msg) {
  lastStats = msg;
  paidProv.innerHTML = ''; freeProv.innerHTML = '';
  if (msg.error) { freeProv.appendChild(mk('div', 'settings-hint', msg.error)); return; }
  const freeOn = !!document.querySelector('#accounts-free .acc-free .acc-tag-free');
  // Look D (Michael 23 Nov 2026): the first service across the top, the rest in a 2 by 2 grid, on its own page
  const AB = { openrouter: 'OR', huggingface: 'HF', sambanova: 'SN', google: 'GA', cerebras: 'CB', mistral: 'MA', groq: 'GQ', cloudflare: 'CF', nvidia: 'NV', github: 'GH' };
  const tiles = { paid: [], free: [] };
  for (const p of msg.providers || []) {
    const t = mk('div', 'acc-tile' + (p.active ? ' acc-on' : '') + (p.ready ? '' : ' acc-off'));
    t.append(mk('div', 'acc-big', AB[p.id] || String(p.label || '?').slice(0, 2).toUpperCase()), mk('div', 'acc-tname', p.label));
    if (p.model) t.append(mk('div', 'acc-temail', p.model.replace(/^[^/]+\//, '')));
    if (p.active) t.append(mk('span', 'acc-chip acc-b', 'In use'));
    else t.append(mk('span', 'acc-chip ' + (p.ready ? 'acc-g' : 'acc-r'), p.ready ? 'Ready' : 'Not ready'));
    const lines = mk('div', 'acc-lines'); for (const l of p.lines || []) lines.append(mk('div', '', l)); t.append(lines);
    if (!p.active && p.ready && freeOn) { const b = mk('button', 'settings-btn', 'Use'); b.type = 'button'; b.onclick = () => { b.disabled = send({ type: 'provider_use', id: p.id }); }; const bb = mk('div', 'acc-tbtns acc-one'); bb.append(b); t.append(bb); }
    t.append(mk('div', 'acc-tnote acc-center acc-more', 'Tap for its own page \u203a'));   // my148 (his Q2 A)
    t.classList.add('acc-tap'); t.onclick = (ev) => { if (!ev.target.closest('button')) openProviderPage(p); };
    tiles[p.paid ? 'paid' : 'free'].push(t);
  }
  for (const [k, box] of [['paid', paidProv], ['free', freeProv]]) {
    const ts = tiles[k]; if (!ts.length) continue;
    ts[0].classList.add('acc-wide'); box.appendChild(ts[0]);
    if (ts.length > 1) { const g = mk('div', 'acc-grid2'); for (const t of ts.slice(1)) g.appendChild(t); box.appendChild(g); }
  }
}
