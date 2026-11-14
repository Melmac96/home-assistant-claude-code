/*
 * my96 (Michael 2026-11-14, idea list 'U decide / I'm back', his answer A):
 *  U decide: he presses it when he will be away from haAi for a while. Claude then gets on by itself, but ONLY with
 *  jobs he has already said yes to, plus checks and tidy-ups (backed up first). Anything new waits for him.
 *  While he is away the page shows an I'm back button (only then). When he presses it, Claude finishes what it is
 *  doing, then tells him what it did and that it is ready for him. The away state is shared by every device.
 *  AP40 (idea list 17): counts what Michael presses so a monthly report can show which buttons are used and which
 *  never are (so screens can get simpler). Counted here because haAi always runs: every service call made by HIS
 *  Home Assistant user (Companion app pages, haAi Home, RS90 touchscreens, HA dashboards; never automations, scripts
 *  or Claude, which run as other users), plus the Living Room RS90's real buttons (haptique_rs90_key_pressed).
 *  One file per month: /config/opencode/health/button-use/YYYY-MM.json. Report: opencode/tools/button_use_report.py.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { WebSocket } from 'ws';
import { SUPERVISOR_URL } from './config.js';
import { log } from './log.js';
import { broadcast } from './broadcast.js';

const FILE = '/data/haai-away.json';
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')) || d; } catch { return d; } };
let st = readJson(FILE, { away: false });

export const awayState = () => ({ away: !!st.away, since: st.since || 0 });
export function setAway(on) {
  st = on ? { away: true, since: Date.now() } : { away: false, since: 0, backAt: Date.now() };
  try { writeFileSync(FILE + '.tmp', JSON.stringify(st)); renameSync(FILE + '.tmp', FILE); } catch (e) { log('WARN', `away save failed: ${e?.message || e}`); }
  log('INFO', on ? 'U decide: Michael is away' : "I'm back: Michael has returned");
  broadcast({ type: 'away_state', ...awayState() });
}

export function my96Prompt() {
  const since = st.away && st.since ? new Date(st.since).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }) : '';
  return 'U DECIDE / I\'M BACK (haAi): a message starting "U decide" means Michael is going away from haAi for a while. Get on by yourself with ONLY jobs he has already said yes to (open lines in his plan and idea files, the waiting list, CHANGES.md items marked not finished), plus checks and tidy-ups; back up first; anything new or any real choice waits for him and goes in the I\'m back report; ask no questions while he is away and do not message his phone unless a job needs it. Keep going job after job until nothing agreed is left, using nextchat-cli if the chat gets long. A message starting "I\'m back" means he has returned: finish the step you are on, do the bookkeeping, then write ONE plain report: what you did while he was away, what is waiting for him (with lettered questions in his marker layout), and that you are ready for him. Call nothing fixed.'
    + (st.away ? ` Right now he IS away (pressed U decide at ${since} UK).` : '');
}

// ── AP40 button use counts ───────────────────────────────────────────────────
const USE_DIR = '/config/opencode/health/button-use';
const RS90 = { 1: 'Power', 2: 'Home', 3: 'Mic', 4: 'Left side up', 5: 'Up', 6: 'Left', 7: 'OK', 8: 'Right', 9: 'Down', 10: 'Plus', 11: 'Left side down', 12: 'Minus', 13: 'Back', 14: 'Menu', 15: 'Mute', 16: 'Rewind', 17: 'Play / Pause', 18: 'Fast-forward', 19: 'Windows', 20: 'Input', 21: 'Settings', 22: 'Dot 1', 23: 'Dot 2', 24: 'Dot 3' };
const SKIP = /^(system_log|logger|recorder|persistent_notification|frontend|browser_mod|homeassistant\.update_entity|notify|mobile_app|webhook|conversation|tts|camera\.snapshot)/;
const hdr = () => ({ Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` });
let me = '', names = {}, month = '', use = null, useT = null;
const ukMonth = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/London' }).slice(0, 7);
function useFile(m) { return `${USE_DIR}/${m}.json`; }
function loadMonth() {
  const m = ukMonth();
  if (m === month && use) return;
  if (use) saveUse(true);
  month = m; use = readJson(useFile(m), null) || { month: m, started: Date.now(), presses: {}, names: {} };
}
function saveUse(now) {
  clearTimeout(useT);
  const go = () => { try { mkdirSync(USE_DIR, { recursive: true }); use.updated = Date.now(); writeFileSync(useFile(month) + '.tmp', JSON.stringify(use)); renameSync(useFile(month) + '.tmp', useFile(month)); } catch (e) { log('WARN', `button use save failed: ${e?.message || e}`); } };
  if (now) go(); else useT = setTimeout(go, 20000);
}
function count(key, label) {
  loadMonth();
  use.presses[key] = (use.presses[key] || 0) + 1;
  if (label) use.names[key] = label;
  saveUse(false);
}
async function loadNames() {
  try {
    const r = await fetch(`${SUPERVISOR_URL}/core/api/states`, { headers: hdr() });
    const list = await r.json();
    const n = {};
    for (const s of list) {
      n[s.entity_id] = s.attributes?.friendly_name || s.entity_id;
      if (s.entity_id.startsWith('person.') && s.attributes?.user_id && !me) me = s.attributes.user_id;
    }
    names = n;
  } catch (e) { log('WARN', `button use names failed: ${e?.message || e}`); }
}
function onCall(ev) {
  const d = ev?.data, uid = ev?.context?.user_id;
  if (!d || !me || uid !== me) return;   // only what HE pressed
  const svc = `${d.domain}.${d.service}`;
  if (SKIP.test(svc) || SKIP.test(d.domain) || /^(get_|reload|list|search)/.test(d.service)) return;   // reads, not presses
  let ids = d.service_data?.entity_id ?? d.target?.entity_id ?? [];
  if (!Array.isArray(ids)) ids = [ids];
  if (d.domain === 'script' && !ids.length) ids = [`script.${d.service}`];
  if (!ids.length) { count(svc, svc); return; }
  for (const id of ids.slice(0, 5)) count(`${svc} ${id}`, `${names[id] || id}: ${d.service.replace(/_/g, ' ')}`);
}
function onKey(ev) {
  const b = ev?.data?.button;
  if (!b) return;
  count(`rs90 ${ev.data.remote_id || ''} ${b}`, `RS90 Living Room real button: ${RS90[b] || 'Button ' + b}`);
}
let useWs = null;
function connectUse() {
  try { useWs = new WebSocket(`${SUPERVISOR_URL.replace(/^http/, 'ws')}/core/websocket`); }
  catch (e) { log('WARN', `button use link failed: ${e?.message || e}`); setTimeout(connectUse, 60000); return; }
  useWs.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'auth_required') useWs.send(JSON.stringify({ type: 'auth', access_token: process.env.SUPERVISOR_TOKEN }));
    else if (m.type === 'auth_ok') {
      useWs.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'call_service' }));
      useWs.send(JSON.stringify({ id: 2, type: 'subscribe_events', event_type: 'haptique_rs90_key_pressed' }));
    } else if (m.type === 'event') {
      if (m.event?.event_type === 'call_service') onCall(m.event); else if (m.event?.event_type === 'haptique_rs90_key_pressed') onKey(m.event);
    }
  });
  useWs.on('error', (e) => log('WARN', `button use link error: ${e?.message || e}`));
  useWs.on('close', () => { useWs = null; setTimeout(connectUse, 30000); });
}
export function startMy96() {
  loadNames().then(connectUse);
  setInterval(loadNames, 30 * 60000).unref?.();
  process.on('exit', () => { if (use) saveUse(true); });
}
