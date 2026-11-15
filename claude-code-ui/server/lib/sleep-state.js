/*
 * my115 (Michael C, 15 Nov 2026): ONE check of the Sleep as Android sensor for the whole of haAi. The quiet-while-asleep
 * check (batch5), the morning brief (batch2) and the overnight jobs (batch4) each asked Home Assistant for the same
 * sensor on their own timers; now they all read this one. Home Assistant also pushes a change the moment it happens
 * (shared event link), and the 30-second ask stays as the back-up. Each ask has a time limit.
 */
import { SUPERVISOR_URL } from './config.js';
import { log } from './log.js';
import { fetchT } from './util.js';
import { onState } from './ha-events.js';

export const SLEEP = 'binary_sensor.sleeping_bedroom_sleep_as_android';
let cur = null;               // { state, last_changed, at }
const subs = [];
let warnedAt = 0;

function set(st) {
  if (!st || !st.state) return;
  cur = { state: st.state, last_changed: st.last_changed || null, at: Date.now() };
  for (const f of subs) { try { f(cur); } catch (e) { log('WARN', `sleep listener: ${e?.message || e}`); } }
}

async function ask() {
  try {
    const res = await fetchT(`${SUPERVISOR_URL}/core/api/states/${SLEEP}`, { headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` } }, 10000);
    if (!res.ok) return;
    set(await res.json());
  } catch (e) {
    if (Date.now() - warnedAt > 30 * 60000) { warnedAt = Date.now(); log('WARN', `sleep check failed: ${e?.message || e}`); }
  }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  onState(SLEEP, (s) => set(s));
  ask();
  setInterval(ask, 30000).unref?.();
}

/** The last known state (null until the first answer). */
export function getSleep() { start(); return cur; }
/** Called with { state, last_changed } on every check and every change. */
export function onSleep(fn) { start(); subs.push(fn); if (cur) { try { fn(cur); } catch { /* listener logs its own */ } } }
