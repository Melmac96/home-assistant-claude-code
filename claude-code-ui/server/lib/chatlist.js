/*
 * my58: the list of chats the "Chats" button shows (number, short name, status).
 * Working = blue, Needs you = red, Finished = green (the user's pick, Look D).
 */
import { chats, hooks, MAX_RUNNING, runningChats } from './chats.js';
import { pendingDialogs } from './dialogs.js';
import { pendingPermissions } from './permissions.js';
import { sessionTitle } from './sessions.js';
import { broadcast } from './broadcast.js';

function needsYou(id) {
  for (const d of pendingDialogs.values()) if (d.chat === id) return true;
  for (const p of pendingPermissions.values()) if (p.chat === id) return true;
  return false;
}

export function chatList() {
  const out = [];
  for (const s of chats.values()) {
    if (!s.query && !s.sessionId && chats.size > 1 && s.id !== 'c1') continue;   // an empty extra chat nobody started
    let name = '';
    try { name = (s.sessionId && sessionTitle(s.sessionId)) || ''; } catch { /* no title yet */ }
    const status = needsYou(s.id) ? 'needs' : s.query ? 'working' : s.finishedUnseen ? 'finished' : 'idle';
    out.push({ id: s.id, n: s.n, name: name || 'New chat', status, account: s.account || '' });
  }
  return out;
}

export function chatsMessage() { return { type: 'chats', chat: null, list: chatList(), max: MAX_RUNNING, working: runningChats().length }; }

export function broadcastChats() { broadcast(chatsMessage()); }

hooks.changed = broadcastChats;
