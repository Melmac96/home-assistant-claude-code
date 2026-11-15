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
import { mkdirSync } from 'fs';
import { onEvent } from './ha-events.js';   // my115: one shared Home Assistant link
import { readJson as rj, saveJson, fetchT } from './util.js';   // my115: shared helpers
import { SUPERVISOR_URL } from './config.js';
import { log } from './log.js';
import { broadcast } from './broadcast.js';

const FILE = '/data/haai-away.json';
const readJson = (f, d) => rj(f, d) || d;
let st = readJson(FILE, { away: false });

export const awayState = () => ({ away: !!st.away, since: st.since || 0 });
export function setAway(on) {
  st = on ? { away: true, since: Date.now() } : { away: false, since: 0, backAt: Date.now() };
  try { saveJson(FILE, st); } catch (e) { log('WARN', `away save failed: ${e?.message || e}`); }
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
  const go = () => { try { mkdirSync(USE_DIR, { recursive: true }); use.updated = Date.now(); saveJson(useFile(month), use); } catch (e) { log('WARN', `button use save failed: ${e?.message || e}`); } };
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
    const r = await fetchT(`${SUPERVISOR_URL}/core/api/states`, { headers: hdr() }, 20000);
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
// my115: the shared Home Assistant event link (ha-events.js); it was a second link of its own
function connectUse() {
  onEvent('call_service', onCall);
  onEvent('haptique_rs90_key_pressed', onKey);
}
export function startMy96() {
  connectUse();   // my115: listening starts at once; names fill in when loaded (only HIS presses count, so nothing counts before)
  loadNames();
  setInterval(loadNames, 30 * 60000).unref?.();
  process.on('exit', () => { if (use) saveUse(true); });
}

// ── my97 Lots to send (moved here from my97.js by my115: the two on/off modes now live in one file) ─────────
// (Michael 2026-11-14): 'Lots to send' button next to the … button. Pressed = he is about to send lots of changes;
// Claude works quietly and keeps its questions until he presses Done. Shared by every device, like U decide.
const LOTS_FILE = '/data/haai-lots.json';
let lots = readJson(LOTS_FILE, { on: false });

export const lotsState = () => ({ on: !!lots.on, since: lots.since || 0 });
export function setLots(on) {
  lots = on ? { on: true, since: Date.now() } : { on: false, since: 0, doneAt: Date.now() };
  try { saveJson(LOTS_FILE, lots); } catch (e) { log('WARN', `lots save failed: ${e?.message || e}`); }
  log('INFO', on ? 'Lots to send: on' : 'Lots to send: Done');
  broadcast({ type: 'lots_state', ...lotsState() });
}

export function my97Prompt() {
  return 'LOTS TO SEND (haAi my97): a message starting "Lots to send:" means Michael is about to send many changes one after another. ' +
    'While it is on, work on each message quietly (back up first, as always), ask NO questions and use no question markers; when a real choice comes up, pick nothing, note the question and carry on with what does not depend on it. ' +
    'Reply to each message in one or two short plain lines (what you did or noted). A message starting "Done:" means he has finished: ask ALL the saved questions in ONE marked question block (Q1, Q2 ... his marker layout), then do whatever is left.' +
    (lots.on ? ' Right now Lots to send IS ON: no questions until he presses Done.' : '');
}
