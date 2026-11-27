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
import { freeServiceNow, listAccounts } from './accounts.js';   // my78; my161 listAccounts
import { pinOptions } from './my161.js';   // my161

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
    out.push({ id: s.id, n: s.n, name: s.label || name || 'New chat', status, account: s.free ? 'Free' : (s.account || ''),
      colour: s.colour ? s.colour.key : '', colourName: s.colour ? s.colour.name : '', hex: s.colour ? s.colour.hex : '',
      free: !!s.free, ending: !!s.endWhenDone, cost: Math.round(s.cost || 0), service: s.free ? (s.service || freeServiceNow() || 'Free') : '',   // my78
      win: s.win || 0, pin: s.pin || '', pinNote: s.pinNote || '' });   // my161
  }
  // my161 (Q3 A): two windows on one account = 'shared' on both tabs
  const n = {};
  for (const c of out) { const a = String(c.pin || c.account || '').toLowerCase(); if (a && !c.free) n[a] = (n[a] || 0) + 1; }
  for (const c of out) { const a = String(c.pin || c.account || '').toLowerCase(); c.shared = !!(a && !c.free && n[a] > 1); }
  return out;
}

/** my161: the accounts a window can be put on (cached 5 s: the chat list is sent often). */
let optCache = { at: 0, v: [] };
function accountOptions() {
  if (Date.now() - optCache.at < 5000) return optCache.v;
  let v = [];
  try { v = pinOptions(listAccounts().saved); } catch { /* no accounts readable */ }
  optCache = { at: Date.now(), v };
  return v;
}

export function chatsMessage() { return { type: 'chats', chat: null, list: chatList(), max: MAX_RUNNING, working: runningChats().length, accts: accountOptions() }; }

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
