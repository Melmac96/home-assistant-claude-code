/*
 * my58: several chats at once.
 *
 * Each chat has its own "slot" (session, running query, permission mode, background
 * tasks). Code that reads `runtime.activeQuery` and friends keeps working unchanged:
 * state.js points those names at the slot of whichever chat the code is running for
 * (AsyncLocalStorage), or, outside any chat, at the chat last looked at.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { DEFAULT_PERMISSION_MODE } from './config.js';

export const MAX_RUNNING = 3;   // my77 (user 2026-11-11): up to three chats working at once (was two)

// my77: each chat's own colour (Michael's pick A on three-chats-colours.html). A free-account chat is always grey.
export const COLOURS = [
  { key: 'purple', name: 'Purple', hex: '#b48cff' },
  { key: 'gold', name: 'Gold', hex: '#e6b84a' },
  { key: 'teal', name: 'Teal', hex: '#3fc8b8' },
];
export const FREE_COLOUR = { key: 'grey', name: 'Free', hex: '#9a9da4' };   // grey colour, called "Free" on screen
export const CLASH_MS = 10 * 60 * 1000;   // my77: "changed in the last few minutes" = 10 minutes
export const FOLD_MS = 30 * 60 * 1000;    // my77: a finished chat folds into Previous chats after 30 minutes

export const als = new AsyncLocalStorage();
export const chats = new Map();   // id -> slot
export const view = { last: 'c1' };
let counter = 0;

export function makeSlot() {
  counter += 1;
  const slot = {
    id: `c${counter}`, n: counter, sessionId: null, query: null, run: null,
    permMode: DEFAULT_PERMISSION_MODE, bgTasks: new Map(),
    account: null,        // email this chat's run is using ('' = the shared main sign-in)
    finishedUnseen: false, touched: new Map(),
    colour: null, free: false, opened: false,   // my77: own colour, grey free-account chat, opened from the New chat list
    asks: false, cost: 0, costLast: {}, finishedAt: 0, clashOk: new Map(), clashWarned: new Map(),
  };
  slot.colour = pickColour(slot);
  chats.set(slot.id, slot);
  return slot;
}

makeSlot();   // c1, the chat that exists at start-up

/** my77: the first colour no other chat is using (a free chat is grey). */
export function pickColour(slot) {
  if (slot.free) return FREE_COLOUR;
  const used = new Set([...chats.values()].filter((c) => c !== slot && c.colour).map((c) => c.colour.key));
  return COLOURS.find((c) => !used.has(c.key)) || COLOURS[(slot.n - 1) % COLOURS.length];
}

/** my77: short label such as "Chat 2 (Gold)". */
export const chatLabel = (slot) => `Chat ${slot.n}${slot.colour ? ` (${slot.colour.name})` : ''}`;

/** my77: another chat changed this file in the last 10 minutes? Returns { other, mins } or null. */
export function recentClash(slot, file) {
  const now = Date.now();
  let best = null;
  for (const other of chats.values()) {
    if (other === slot) continue;
    const t = other.touched.get(file);
    if (t && now - t < CLASH_MS && (!best || t > best.t)) best = { other, t };
  }
  return best ? { other: best.other, mins: Math.max(1, Math.round((now - best.t) / 60000)) } : null;
}

export const slotNow = () => als.getStore() || chats.get(view.last) || chats.get('c1');
export const inChat = (slot, fn) => als.run(slot, fn);
export const runningChats = () => [...chats.values()].filter((s) => s.query);
export const anyRunning = () => runningChats().length > 0;

/** Set by chatlist.js so slot changes can tell every browser without an import loop. */
export const hooks = { changed: () => {} };
