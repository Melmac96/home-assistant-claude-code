/*
 * The sessions panel — past conversations, read from Claude Code's own store.
 */
import { S } from './state.js';
import { sessionsBtn, sessionsListEl, sessionsPanel } from './dom.js';
import { confirmAction, confirmInterrupt } from './confirm.js';

// ── Sessions ─────────────────────────────────────────────────────────────────
export function relTime(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function renderSessions() {
  sessionsListEl.innerHTML = '';
  const list = S.searchResults || S.sessions;   // my28
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'sessions-empty';
    empty.textContent = S.searchResults ? 'Nothing found.' : 'No saved sessions yet.';
    sessionsListEl.appendChild(empty);
    return;
  }
  for (const s of list) {
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === S.activeSessionId ? ' active' : '');

    const main = document.createElement('div');
    main.className = 'session-main';
    const title = document.createElement('div');
    title.className = 'session-title';
    title.textContent = s.title;
    const time = document.createElement('div');
    time.className = 'session-time';
    time.textContent = relTime(s.updatedAt);
    main.append(title, time);
    if (s.snippet) { const sn = document.createElement('div'); sn.className = 'session-snippet'; sn.textContent = s.snippet; main.append(sn); }   // my28

    const del = document.createElement('button');
    del.className = 'session-del';
    del.textContent = '✕';
    del.title = 'Delete session';
    del.onclick = async (e) => {
      e.stopPropagation();
      const ok = await confirmAction({
        title: 'Delete this conversation?',
        body: 'It will be removed from the store permanently. This cannot be undone.',
        confirm: 'Delete',
        cancel: 'Keep it',
      });
      if (!ok) return;
      if (S.ws && S.isConnected) S.ws.send(JSON.stringify({ type: 'session_delete', id: s.id }));
    };

    item.onclick = async () => {
      if (s.id === S.activeSessionId) return closeSessions();
      // The server aborts the active query on session_switch, so this is the
      // last point at which the turn can be saved.
      if (S.isRunning) {
        const ok = await confirmInterrupt({
          body: 'Switching to another chat will stop what it is doing now. Everything '
              + 'written so far is already saved, but the rest of this turn will not be finished.',
          confirm: 'Stop and switch',
        });
        if (!ok) return;   // stay put, panel still open, nothing sent
      }
      if (S.ws && S.isConnected) {
        S.ws.send(JSON.stringify({ type: 'session_switch', id: s.id }));
      }
      closeSessions();
    };

    item.append(main, del);
    sessionsListEl.appendChild(item);
  }
}

export function openSessions() {
  if (S.ws && S.isConnected) { S.ws.send(JSON.stringify({ type: 'sessions_list' })); S.ws.send(JSON.stringify({ type: 'waiting_get' })); }   // my28 waiting
  renderSessions();
  sessionsPanel.classList.remove('hidden');
  sessionsBtn.classList.add('active');
}
export function closeSessions() {
  const box = document.getElementById('sessions-search');   // my28
  if (box) box.value = '';
  S.searchResults = null;
  sessionsPanel.classList.add('hidden');
  sessionsBtn.classList.remove('active');
}

// my28: search every saved chat, from the box at the top of the Sessions menu.
const searchBox = document.getElementById('sessions-search');
let searchTimer = null, searchSeq = 0;
if (searchBox) searchBox.oninput = () => {
  clearTimeout(searchTimer);
  const q = searchBox.value.trim();
  if (q.length < 2) { searchSeq++; S.searchResults = null; renderSessions(); return; }
  searchTimer = setTimeout(() => {
    if (S.ws && S.isConnected) S.ws.send(JSON.stringify({ type: 'sessions_search', q, seq: ++searchSeq }));
  }, 400);
};
export function onSearchResults(msg) {
  if (msg.seq !== searchSeq) return;
  S.searchResults = msg.results || [];
  renderSessions();
}
