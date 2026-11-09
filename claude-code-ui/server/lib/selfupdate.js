/*
 * my33: is there an update for this add-on? Asks the Supervisor every 2 minutes
 * and tells the page, which shows the Update button only while one is waiting.
 */
import { SUPERVISOR_URL } from './config.js';
import { log } from './log.js';
import { broadcast } from './broadcast.js';

const CHECK_MS = 2 * 60 * 1000;
let state = { available: false, url: null, version: null };

export const getSelfUpdate = () => state;

export async function checkSelfUpdate() {
  if (!process.env.SUPERVISOR_TOKEN) return;
  try {
    const res = await fetch(`${SUPERVISOR_URL}/addons/self/info`, {
      headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` },
    });
    if (!res.ok) { log('WARN', `update check: Supervisor answered ${res.status}`); return; }
    const info = (await res.json())?.data || {};
    const next = {
      available: !!info.update_available && !!info.slug,
      url: info.slug ? `http://192.168.1.168/config/app/${info.slug}/info` : null,
      version: info.version || null,   // my51: the live update number for the menu
    };
    if (next.available === state.available && next.url === state.url && next.version === state.version) return;
    state = next;
    broadcast({ type: 'self_update', ...state });
  } catch (e) {
    log('WARN', `update check failed: ${e?.message || e}`);   // keeps the last known answer
  }
}

export function startSelfUpdateCheck() {
  checkSelfUpdate();
  setInterval(checkSelfUpdate, CHECK_MS).unref?.();
}
