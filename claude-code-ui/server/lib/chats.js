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

export const MAX_RUNNING = 2;   // user 2026-11-09: at most two chats working at once

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
  };
  chats.set(slot.id, slot);
  return slot;
}

makeSlot();   // c1, the chat that exists at start-up

export const slotNow = () => als.getStore() || chats.get(view.last) || chats.get('c1');
export const inChat = (slot, fn) => als.run(slot, fn);
export const runningChats = () => [...chats.values()].filter((s) => s.query);
export const anyRunning = () => runningChats().length > 0;

/** Set by chatlist.js so slot changes can tell every browser without an import loop. */
export const hooks = { changed: () => {} };
