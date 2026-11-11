/*
 * my58: the list of chats the "Chats" button shows (number, short name, status).
 * Working = blue, Needs you = red, Finished = green (the user's pick, Look D).
 */
import { chats, hooks, MAX_RUNNING, runningChats, FOLD_MS } from './chats.js';
import { connections } from './broadcast.js';
import { pendingDialogs } from './dialogs.js';
import { pendingPermissions } from './permissions.js';
import { sessionTitle } from './sessions.js';
import { broadcast } from './broadcast.js';
import { freeServiceNow } from './accounts.js';   // my78

function needsYou(id) {
  for (const d of pendingDialogs.values()) if (d.chat === id) return true;
  for (const p of pendingPermissions.values()) if (p.chat === id) return true;
  return false;
}

export function chatList() {
  const out = [];
  for (const s of chats.values()) {
    if (!s.query && !s.sessionId && !s.opened && chats.size > 1 && s.id !== 'c1') continue;   // an empty extra chat nobody started
    let name = '';
    try { name = (s.sessionId && sessionTitle(s.sessionId)) || ''; } catch { /* no title yet */ }
    // my77: a reply that ends with a marked question also counts as "needs you" until he answers it.
    const status = needsYou(s.id) || (s.asks && !s.query) ? 'needs' : s.query ? 'working' : s.finishedUnseen ? 'finished' : 'idle';
    out.push({ id: s.id, n: s.n, name: name || 'New chat', status, account: s.free ? 'Free' : (s.account || ''),
      colour: s.colour ? s.colour.key : '', colourName: s.colour ? s.colour.name : '', hex: s.colour ? s.colour.hex : '',
      free: !!s.free, cost: Math.round(s.cost || 0), service: s.free ? (s.service || freeServiceNow() || 'Free') : '' });   // my78
  }
  return out;
}

export function chatsMessage() { return { type: 'chats', chat: null, list: chatList(), max: MAX_RUNNING, working: runningChats().length }; }

export function broadcastChats() { broadcast(chatsMessage()); }

hooks.changed = broadcastChats;

// my77: a finished chat folds into Previous chats after 30 minutes (it stays in Sessions, like any chat).
// Never the last chat, never one that is working or waiting for him, never one a screen is sending to.
setInterval(() => {
  let folded = false;
  for (const s of [...chats.values()]) {
    if (chats.size <= 1) break;
    if (s.query || needsYou(s.id) || s.asks || !s.finishedAt || Date.now() - s.finishedAt < FOLD_MS) continue;
    if ([...connections].some((ws) => ws.chat === s.id)) continue;
    chats.delete(s.id); folded = true;
  }
  if (folded) broadcastChats();
}, 60 * 1000).unref?.();
