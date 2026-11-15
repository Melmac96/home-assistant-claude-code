/*
 * haAi (my23): Settings > Paired devices. Makes the 6-digit pairing code and lists/removes paired devices.
 * Only works when haAi is opened through Home Assistant; the direct port (7682) hides this section.
 */
import { S } from './state.js';
const sec = document.getElementById('pair-section');
if (location.port === '7682') sec.classList.add('hidden');
const btn = document.getElementById('pair-btn');
const box = document.getElementById('pair-code');
const list = document.getElementById('devices-list');
// my115: says whether it went; with no link he is told and the button is not left greyed out
const send = (o) => {
  if (S.ws && S.isConnected && S.ws.readyState === 1) { try { S.ws.send(JSON.stringify(o)); return true; } catch { /* below */ } }
  const t = document.createElement('div'); t.className = 'guard-toast'; t.textContent = 'No connection, so nothing was changed. Try again when haAi is back.';
  t.onclick = () => t.remove(); document.body.append(t); setTimeout(() => t.remove(), 6000);
  return false;
};
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
let timer = null;

btn.onclick = () => send({ type: 'pair_start' });
document.getElementById('settings-btn').addEventListener('click', () => send({ type: 'devices_list' }));

export function showPairCode(msg) {
  box.innerHTML = '';
  box.appendChild(mk('b', '', 'Type this code on the device:'));
  const big = mk('div', 'pair-big', msg.code.slice(0, 3) + ' ' + msg.code.slice(3));
  box.appendChild(big);
  const left = mk('div', 'settings-hint', '');
  box.appendChild(left);
  box.classList.remove('hidden');
  clearInterval(timer);
  const tick = () => {
    const s = Math.round((msg.expires - Date.now()) / 1000);
    if (s <= 0) { clearInterval(timer); box.classList.add('hidden'); return; }
    left.textContent = 'Works once, for ' + s + ' more seconds.';
  };
  tick(); timer = setInterval(tick, 1000);
}

export function showDevices(msg) {
  list.innerHTML = '';
  for (const d of msg.list || []) {
    const row = mk('div', 'acc-row');
    const who = mk('div', 'acc-who acc-email', d.name);
    who.appendChild(mk('small', 'acc-paid', d.lastSeen ? 'Last used ' + new Date(d.lastSeen).toLocaleString('en-GB') : 'Paired'));
    row.appendChild(who);
    const b = mk('button', 'settings-btn', 'Remove'); b.type = 'button';
    b.onclick = () => { b.disabled = send({ type: 'device_remove', id: d.id }); };
    row.appendChild(b);
    list.appendChild(row);
  }
  if (!(msg.list || []).length) list.appendChild(mk('div', 'settings-hint', 'No devices paired yet.'));
  if (box && !box.classList.contains('hidden') && (msg.list || []).length) { /* keep the code visible until it runs out */ }
}
