/*
 * My Claude Code UI: the Accounts section of Settings (look 4) and the small
 * account label in the header. A Switch asks 'are you sure?' first, so a stray
 * tap cannot sign you out. The server never sends tokens, only emails and names.
 */
import { S } from './state.js';
import { setAuthenticated } from './connection.js';
import { loginBtn, loginDesc, loginTitle, loginScreen } from './dom.js';

const list = document.getElementById('accounts-list');
const confirmBox = document.getElementById('account-confirm');
const addBtn = document.getElementById('account-add');
const label = document.getElementById('account-label');
const cancelBtn = document.getElementById('login-cancel');

// Header shows a short name; the full email is in Settings > Accounts.
const SHORT = { 'thereades@gmail.com': 'Main', 'thereades.uk@gmail.com': '2nd' };
const shortName = (email) => SHORT[email.toLowerCase()] || email.split('@')[0];

const send = (o) => { if (S.ws && S.isConnected) S.ws.send(JSON.stringify(o)); };
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

export function showAccounts(msg) {
  const cur = msg.current;
  cancelBtn.classList.add('hidden');
  const free = !!(msg.mode && msg.mode.free);
  label.textContent = cur ? shortName(cur.email) + (free ? ' · Free' : '') : '';
  label.classList.toggle('hidden', !cur);
  setBadge(cur, msg.mode);
  list.innerHTML = '';
  for (const a of (msg.saved || [])) {
    const row = mk('div', 'acc-row' + (a.active ? ' acc-on' : ''));
    const who = mk('div', 'acc-who', a.email);
    if (a.displayName) who.appendChild(mk('small', '', a.displayName));
    row.appendChild(who);
    if (a.active) row.appendChild(mk('span', 'acc-tag', 'Signed in'));
    else {
      const b = mk('button', 'settings-btn', 'Switch');
      b.type = 'button';
      b.onclick = () => askSwitch(a);
      row.appendChild(b);
    }
    list.appendChild(row);
  }
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
        go.onclick = () => { go.disabled = true; send({ type: 'model_set', model: sel.value }); };
        const r2 = mk('div', 'acc-confirm-row'); r2.append(sel, go); list.appendChild(row); list.appendChild(r2); return;
      }
    } else if (m.hasKey) {
      const b = mk('button', 'settings-btn', 'Switch'); b.type = 'button';
      b.onclick = () => askMode(true);
      row.appendChild(b);
    }
    list.appendChild(row);
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
  yes.onclick = () => { yes.disabled = true; send({ type: 'mode_switch', free }); };
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
  yes.onclick = () => { yes.disabled = true; send({ type: 'account_switch', id: a.id }); };
  row.append(no, yes);
  confirmBox.appendChild(row);
  confirmBox.classList.remove('hidden');
}

export function showAccountResult(msg) {
  confirmBox.innerHTML = '';
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
