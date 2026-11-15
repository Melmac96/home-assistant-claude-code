/*
 * my49: haAi batch 5, server side of "Quiet while you sleep" (user look B, test page batch5-looks.html, 2026-11-09).
 * While Sleep as Android is on, haAi's pushes are held (nothing buzzes). A small pill on the page counts them and
 * "Show now" lists them. When you get up the pill stays until you clear it. The chat itself is never held.
 */
import { SUPERVISOR_URL } from './config.js';
import { log } from './log.js';
import { broadcast } from './broadcast.js';

import { onSleep } from './sleep-state.js';   // my115
let asleep = false;
let held = [];

export const isQuiet = () => asleep;
export const quietState = () => ({ on: asleep, held });
export function holdPush(kind, title, message) {
  held.push({ at: Date.now(), kind, title, message });
  if (held.length > 50) held.shift();
  broadcast({ type: 'quiet', ...quietState() });
  log('INFO', `my49: push held while asleep (${kind})`);
}
export function clearHeld() { held = []; broadcast({ type: 'quiet', ...quietState() }); }

// my115: reads the one shared sleep check (sleep-state.js) instead of asking Home Assistant itself
function tick(st) {
  const on = st.state === 'on';
  if (on !== asleep) { asleep = on; broadcast({ type: 'quiet', ...quietState() }); }
}
export function startQuiet() { onSleep(tick); }
