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

// my29: the two drop-down sections of the Sessions menu. Each one stays as it
// was left on this device; a search always shows its results.
const SECTIONS = { waiting: ['waiting-toggle', 'waiting-list'], chats: ['chats-toggle', 'sessions-list'] };
const SECTIONS_KEY = 'haai-sessions-open';
function savedSections() {
  try { return JSON.parse(localStorage.getItem(SECTIONS_KEY)) || {}; } catch { return {}; }
}
function showSection(name, open) {
  const [btn, body] = SECTIONS[name].map((id) => document.getElementById(id));
  btn.setAttribute('aria-expanded', String(open));
  body.classList.toggle('sec-closed', !open);
}
function applySections() {
  const saved = savedSections();
  showSection('waiting', !!saved.waiting);
  showSection('chats', (S.searchResults || S.searching) ? true : !!saved.chats);
}
for (const name of Object.keys(SECTIONS)) {
  document.getElementById(SECTIONS[name][0]).onclick = () => {
    const open = document.getElementById(SECTIONS[name][0]).getAttribute('aria-expanded') !== 'true';
    showSection(name, open);
    const saved = savedSections();
    saved[name] = open;
    try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(saved)); } catch {}
  };
}

export function renderSessions() {
  sessionsListEl.innerHTML = '';
  const list = S.searchResults || S.sessions;   // my28
  document.getElementById('chats-count').textContent = S.searching ? '' : S.searchResults ? `(${list.length} found)` : `(${list.length})`;   // my29
  applySections();
  if (S.searching) {   // my30: the search of every chat takes a few seconds
    const wait = document.createElement('div');
    wait.className = 'sessions-empty';
    wait.textContent = 'Searching all chats…';
    sessionsListEl.appendChild(wait);
    return;
  }
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
  S.searching = false;   // my30
  sessionsPanel.classList.add('hidden');
  sessionsBtn.classList.remove('active');
}

// my28: search every saved chat, from the box at the top of the Sessions menu.
const searchBox = document.getElementById('sessions-search');
let searchTimer = null, searchSeq = 0;
// my30: the keyboard's search key runs it at once and puts the keyboard away.
function startSearch() {
  clearTimeout(searchTimer);
  const q = searchBox.value.trim();
  if (q.length < 2 || !S.ws || !S.isConnected) return;
  S.searching = true;
  renderSessions();
  S.ws.send(JSON.stringify({ type: 'sessions_search', q, seq: ++searchSeq }));
}
if (searchBox) {
  searchBox.oninput = () => {
    clearTimeout(searchTimer);
    if (searchBox.value.trim().length < 2) { searchSeq++; S.searchResults = null; S.searching = false; renderSessions(); return; }
    searchTimer = setTimeout(startSearch, 400);
  };
  searchBox.onkeydown = (e) => {
    if (e.key !== 'Enter' && e.keyCode !== 13) return;
    e.preventDefault();
    startSearch();
    searchBox.blur();
  };
}
export function onSearchResults(msg) {
  if (msg.seq !== searchSeq) return;
  S.searching = false;   // my30
  S.searchResults = msg.results || [];
  renderSessions();
}
