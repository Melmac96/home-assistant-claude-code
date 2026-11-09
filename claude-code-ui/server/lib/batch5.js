/*
 * my49: haAi batch 5, server side of "Quiet while you sleep" (user look B, test page batch5-looks.html, 2026-11-09).
 * While Sleep as Android is on, haAi's pushes are held (nothing buzzes). A small pill on the page counts them and
 * "Show now" lists them. When you get up the pill stays until you clear it. The chat itself is never held.
 */
import { SUPERVISOR_URL } from './config.js';
import { log } from './log.js';
import { broadcast } from './broadcast.js';

const SLEEP = 'binary_sensor.sleeping_bedroom_sleep_as_android';
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

async function tick() {
  try {
    const res = await fetch(`${SUPERVISOR_URL}/core/api/states/${SLEEP}`, { headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` } });
    if (!res.ok) return;
    const on = (await res.json()).state === 'on';
    if (on !== asleep) { asleep = on; broadcast({ type: 'quiet', ...quietState() }); }
  } catch (e) { log('WARN', `quiet check failed: ${e?.message || e}`); }
}
export function startQuiet() { tick(); setInterval(tick, 30000).unref?.(); }
