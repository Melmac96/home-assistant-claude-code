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

export function showAccounts(msg) {
  const cur = msg.current;
  cancelBtn.classList.add('hidden');
  label.textContent = cur ? shortName(cur.email) : '';
  label.classList.toggle('hidden', !cur);
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
