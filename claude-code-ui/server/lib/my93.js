/*
 * my93 (Michael's picks 2026-11-13, nine-picks-looks.html, answers D D C A D D D A A):
 *  H2  Messages page (Look C): every phone/tablet message Home Assistant sends is kept here (7 days),
 *      the page groups them by kind (Home, Health check, TV, Claude). Starts from this update: HA keeps no list itself.
 *  H3  Remember button under each of his messages (Look A): the page sends the ask; Claude files it and writes
 *      ⟦FILED|where it went⟧, which the page shows as a green line.
 *  H19 Now on TV line (Look A): reads sensor.now_watching_home_trakt and tells every page.
 *  I2  Pack old chats (Look A): every night at 03:00 UK, chats untouched for 2 months (his answer A) are packed
 *      (packed.js); the morning line says how many.
 */
import { readFileSync, renameSync, writeFileSync } from 'fs';
import { WebSocket } from 'ws';
import { SUPERVISOR_URL } from './config.js';
import { log } from './log.js';
import { broadcast } from './broadcast.js';
import { chats } from './chats.js';
import { runtime } from './state.js';
import { sessionTitle } from './sessions.js';
import { oldChatFiles, pack } from './packed.js';

const MSGS = '/data/haai-messages.json';
const PACKLOG = '/data/haai-pack.json';
const TV = 'sensor.now_watching_home_trakt';
const PACK_DAYS = 60;
const KEEP_MS = 7 * 86400000;
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')) || d; } catch { return d; } };
const saveJson = (f, o) => { writeFileSync(f + '.tmp', JSON.stringify(o)); renameSync(f + '.tmp', f); };
const ukParts = () => { const s = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/London' }); return { day: s.slice(0, 10), hour: +s.slice(11, 13) }; };

// ── H2 messages ──────────────────────────────────────────────────────────────
let msgs = readJson(MSGS, []);
if (!Array.isArray(msgs)) msgs = [];
let saveT = null;
const saveMsgs = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { saveJson(MSGS, msgs); } catch (e) { log('WARN', `messages save failed: ${e?.message || e}`); } }, 1500); };
export function kindOf(title, text, channel) {
  const s = `${title} ${text} ${channel}`.toLowerCase();
  if (/claude|haai/.test(s)) return 'Claude';
  if (/health check|home check|needs? a look|home health|backup|update|battery|offline|unavailable/.test(s)) return 'Health check';
  if (/\btv\b|shield|apple tv|fire tv|tivimate|watching|trakt|channel|programme|bose|soundbar|\blg\b/.test(s)) return 'TV';
  return 'Home';
}
function noteCall(ev) {
  const d = ev && ev.data;
  if (!d || d.domain !== 'notify') return;
  const sd = d.service_data || {};
  const text = String(sd.message || '').trim();
  if (!text || /^(clear_notification|remove_channel|request_location_update|command_)/.test(text)) return;   // phone commands, not messages
  const title = String(sd.title || '').trim();
  const channel = String((sd.data && sd.data.channel) || '');
  const at = Date.now();
  const dup = msgs.find((m) => m.title === title && m.text === text && at - m.at < 20000);   // the same message to phone AND tablet = one line
  if (dup) { if (!dup.to.includes(d.service)) dup.to.push(d.service); return; }
  const m = { at, title: title.slice(0, 200), text: text.slice(0, 1000), kind: kindOf(title, text, channel), to: [d.service] };
  msgs.push(m);
  msgs = msgs.filter((x) => at - x.at < KEEP_MS).slice(-600);
  saveMsgs();
  broadcast({ type: 'messages_new', item: m });
}
export const getMessages = () => msgs.filter((x) => Date.now() - x.at < KEEP_MS);

let haWs = null, wsTimer = null;
function connectHa() {
  clearTimeout(wsTimer);
  try { haWs = new WebSocket(`${SUPERVISOR_URL.replace(/^http/, 'ws')}/core/websocket`); }
  catch (e) { log('WARN', `messages link failed: ${e?.message || e}`); wsTimer = setTimeout(connectHa, 60000); return; }
  haWs.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'auth_required') haWs.send(JSON.stringify({ type: 'auth', access_token: process.env.SUPERVISOR_TOKEN }));
    else if (m.type === 'auth_ok') haWs.send(JSON.stringify({ id: 1, type: 'subscribe_events', event_type: 'call_service' }));
    else if (m.type === 'event') noteCall(m.event);
  });
  haWs.on('error', (e) => log('WARN', `messages link error: ${e?.message || e}`));
  haWs.on('close', () => { haWs = null; wsTimer = setTimeout(connectHa, 30000); });
}

// ── H19 Now on TV ────────────────────────────────────────────────────────────
let tv = { text: '' };
async function tvTick() {
  try {
    const res = await fetch(`${SUPERVISOR_URL}/core/api/states/${TV}`, { headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` } });
    if (!res.ok) return;
    const st = String((await res.json()).state || '');
    const text = /^(nothing playing|unknown|unavailable|)$/i.test(st.trim()) ? '' : st.replace(/:\s*not sure what$/i, '').trim();
    if (text !== tv.text) { tv = { text, at: Date.now() }; broadcast({ type: 'now_tv', ...tv }); }
  } catch (e) { log('WARN', `now on TV check failed: ${e?.message || e}`); }
}
export const getNowTv = () => tv;

// ── I2 pack old chats ────────────────────────────────────────────────────────
export function packNow() {
  const busy = new Set([runtime.activeSessionId, ...[...chats.values()].map((s) => s.sessionId)].filter(Boolean));
  let count = 0, saved = 0;
  for (const id of oldChatFiles(PACK_DAYS)) {
    if (busy.has(id)) continue;
    try { const title = sessionTitle(id); if (!title) continue; const s = pack(id, title); if (s > 0) { count++; saved += s; } }
    catch (e) { log('WARN', `packing chat ${id} failed: ${e?.message || e}`); }
  }
  const p = readJson(PACKLOG, {});
  saveJson(PACKLOG, { ...p, day: ukParts().day, at: Date.now(), count, savedMb: Math.round(saved / 1048576), totalCount: (p.totalCount || 0) + count });
  log('INFO', `packed ${count} old chats, ${Math.round(saved / 1048576)} MB saved`);
  return count;
}
function packTick() {
  const { day, hour } = ukParts();
  if (hour !== 3 || readJson(PACKLOG, {}).day === day) return;
  try { packNow(); } catch (e) { log('WARN', `nightly pack failed: ${e?.message || e}`); }
}
export function packedLastNight() {   // for the morning line: only a run in the last 18 hours that packed something
  const p = readJson(PACKLOG, {});
  return p.at && Date.now() - p.at < 18 * 3600000 && p.count ? p.count : 0;
}

export function startMy93() {
  connectHa();
  tvTick(); setInterval(tvTick, 30000).unref?.();
  setInterval(packTick, 10 * 60000).unref?.();
}

export function my93Prompt() {
  return 'REMEMBER THIS (haAi): when Michael\'s message starts with "Remember this:", file what follows yourself in the right place in his rule and note files (the same way as anything he tells you to remember), commit it, then answer in one short line and write ⟦FILED|where it went, in plain words, e.g. your rules, the heating notes⟧ (haAi shows it as a green line). Never put health details anywhere his rules forbid.';
}
