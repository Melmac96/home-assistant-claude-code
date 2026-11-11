/*
 * my34: the Home health heart on the top bar. Reads sensor.home_health every minute and
 * tells the page. Anything it cannot read or trust counts as "stale", never as fine.
 */
import { SUPERVISOR_URL } from './config.js';
import { log } from './log.js';
import { broadcast } from './broadcast.js';
import { getHaaiChecks } from './my79.js';   // my79 H12

const CHECK_MS = 60 * 1000;
const STALE_MS = 15 * 60 * 1000;   // the house rule: older than 15 minutes = stopped updating
let state = { status: 'wait', count: 0, lines: [], last: null };

export const getHomeHealth = () => ({ ...state, haai: getHaaiChecks() });   // my79 H12: haAi's own checks ride along

export function readHealth(sensor, now = Date.now()) {
  const a = sensor?.attributes || {};
  const last = a.checked_hm || null;
  const when = Date.parse(a.checked_at);
  const count = Number(sensor?.state);
  if (!Number.isFinite(when) || now - when > STALE_MS || !Number.isInteger(count) || count < 0) {
    return { status: 'stale', count: 0, lines: [], last };
  }
  if (count === 0) return { status: 'good', count: 0, lines: [], last };
  const lines = String(a.problems_text || '').split('\n').map((s) => s.trim()).filter(Boolean);
  return { status: 'bad', count, lines, last };
}

export async function checkHomeHealth() {
  try {
    const res = await fetch(`${SUPERVISOR_URL}/core/api/states/sensor.home_health`, {
      headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` },
    });
    if (!res.ok) throw new Error(`Home Assistant answered ${res.status}`);
    state = readHealth(await res.json());
  } catch (e) {
    log('WARN', `home health check failed: ${e?.message || e}`);
    state = { status: 'stale', count: 0, lines: [], last: state.last };
  }
  broadcast({ type: 'home_health', ...getHomeHealth() });   // every time: the page treats silence as a problem
}

export function startHomeHealthCheck() {
  checkHomeHealth();
  setInterval(checkHomeHealth, CHECK_MS).unref?.();
}
