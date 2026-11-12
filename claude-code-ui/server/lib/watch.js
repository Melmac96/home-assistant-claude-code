/*
 * my50: the Pixel Watch 4 app. Two small routes for the watch:
 *   GET  /watch/state   -> house status, the newest reply cut short, any waiting A/B question
 *   POST /watch/answer  -> {letter:"A"|"B"} goes into the current chat as a plain message
 * my26 (2026-11-10, overnight ground work, NOT deployed yet): talking from the watch.
 *   POST /watch/say     -> {text} (what he said on the watch) goes into the current chat, marked as from the watch
 *   GET  /watch/reply   -> {id, text, question, options, working, quiet}: the newest reply in full plain words (for reading
 *                          aloud), so the watch can wait for a NEW reply (id changes) after he speaks
 *   /watch/state also gets "qid" (an id of the waiting question) so the watch's 15-minute check can tell a NEW question
 *   and buzz him once, only while he is awake (quiet = Sleep as Android on).
 *   /watch/state also gets home.temp: the average of the bottom-of-house rooms (Living Room and Kitchen, Bedroom, Hall bedroom end;
 *   home_map.yaml house_parts), read from Home Assistant at most every 5 minutes, for the watch face's left value.
 * my68 (2026-11-10): the Home Cog watch pages.
 *   GET  /watch/page/:name -> that page's layout from /config/opencode/watch-talk/watch-pages.json plus the live states of every
 *                             entity it lists ("read"), and for "calendar" / "weather" the coming events / forecast.
 *   POST /watch/act        -> {id}: runs ONE action that is written in watch-pages.json "acts" (the watch never names a service
 *                             or entity itself, so it can only do what that file allows). The file is read fresh each time,
 *                             so pages and devices change without an add-on update.
 * On the direct port (7682) all of them need a paired-device key like everything else there
 * (index.js gates the whole port first). The watch app carries one such key.
 */
import crypto from 'crypto';
import fs from 'fs';
import { getHomeHealth } from './homehealth.js';
import { SUPERVISOR_URL } from './config.js';
import { isQuiet } from './batch5.js';
import { runtime } from './state.js';
import { parseSession } from './sessions.js';
import { runQuery } from './run-query.js';
import { log } from './log.js';

const strip = (s) => String(s || '')
  .replace(/[\u{1F539}\u{1F7E6}\u{1F7E5}]/gu, '').replace(/⟦[^⟧]*⟧/g, '')
  .replace(/\*\*/g, '').replace(/`/g, '').replace(/[ \t]+/g, ' ').trim();
const idOf = (s) => crypto.createHash('sha1').update(String(s || '')).digest('hex').slice(0, 12);

// my88: worked out once per change of the chat (parseSession keeps the same list until the chat file changes),
// so the watch's checks no longer go through the whole chat every time.
const memo = { items: null, full: null, short: null };
function newestText(items) {
  for (let i = items.length - 1; i >= 0; i--) { if (items[i].kind === 'text') return items[i].text; }
  return '';
}

/** The newest assistant text of the current chat, as {reply, question, options}. */
export function newestReply(full = false) {
  const items = parseSession(runtime.activeSessionId);
  if (memo.items !== items) { memo.items = items; memo.full = null; memo.short = null; }
  const key = full ? 'full' : 'short';
  if (!memo[key]) memo[key] = workOut(newestText(items), full);
  return { ...memo[key], options: memo[key].options.map((o) => ({ ...o })) };
}

function workOut(last, full) {
  if (!last) return { reply: '', question: '', options: [], qid: '' };
  const q = /⟦QUESTION⟧([\s\S]*?)⟦\/QUESTION⟧/.exec(last);
  if (q) {
    const lines = q[1].split('\n').map(strip).filter(Boolean);
    const options = [];
    let question = '';
    for (const l of lines) {
      const m = /^([A-Z])\.\s*(.*)$/.exec(l);
      if (m) options.push({ letter: m[1], text: m[2].slice(0, full ? 200 : 60) });
      else if (!question) question = l.replace(/^Q\d\s*/, '');
    }
    const before = full ? last.slice(0, q.index).split('\n').map(strip).filter(Boolean).slice(1).join(' ').slice(0, 1200) : '';
    return { reply: before, question: question.slice(0, full ? 400 : 140), options: options.slice(0, 4), qid: idOf(q[1]) };
  }
  const lines = last.split('\n').map(strip).filter(Boolean);
  const reply = full ? lines.slice(1).join(' ').slice(0, 1500) : (lines.slice(1).join(' ').slice(0, 220) || lines[0] || '');
  return { reply: reply || lines[0] || '', question: '', options: [], qid: '' };
}

const TEMPS = ['sensor.heating_zone_temperature_living_room_and_kitchen_tado', 'sensor.heating_zone_temperature_bedroom_tado',
  'sensor.heating_zone_temperature_hall_bedroom_end_tado'];
let temp = { value: null, at: 0 };
async function houseTemp() {
  if (Date.now() - temp.at < 5 * 60 * 1000) return temp.value;
  temp.at = Date.now();
  try {
    const vals = [];
    for (const id of TEMPS) {
      const r = await fetch(`${SUPERVISOR_URL}/core/api/states/${id}`, { headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` } });
      if (r.ok) { const v = Number((await r.json()).state); if (Number.isFinite(v)) vals.push(v); }
    }
    temp.value = vals.length ? Math.round(10 * vals.reduce((a, b) => a + b, 0) / vals.length) / 10 : null;
  } catch (e) { log('WARN', `watch temperature: ${e?.message || e}`); temp.value = null; }
  return temp.value;
}


const PAGES_FILE = '/config/opencode/watch-talk/watch-pages.json';
const KEEP = ['friendly_name', 'unit_of_measurement', 'current_humidity', 'humidity', 'current_temperature', 'temperature',
  'hvac_action', 'hvac_mode', 'percentage', 'mode', 'brightness', 'message', 'start_time', 'end_time'];
const ha = (path, opt = {}) => fetch(`${SUPERVISOR_URL}/core/api/${path}`, { ...opt,
  headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}`, 'Content-Type': 'application/json' } });
function pagesConf() { return JSON.parse(fs.readFileSync(PAGES_FILE, 'utf8')); }
async function stateOf(id) {
  const r = await ha(`states/${id}`);
  if (!r.ok) return { s: 'missing' };
  const j = await r.json(), a = {};
  for (const k of KEEP) if (j.attributes?.[k] !== undefined) a[k] = j.attributes[k];
  return { s: j.state, a };
}
async function calendarEvents(ids, days) {
  const start = new Date(), end = new Date(Date.now() + days * 864e5), out = [];
  for (const id of ids) {
    try {
      const r = await ha(`calendars/${id}?start=${start.toISOString()}&end=${end.toISOString()}`);
      if (r.ok) for (const e of await r.json()) out.push({ cal: id, title: e.summary || '', start: e.start?.dateTime || e.start?.date || '',
        end: e.end?.dateTime || e.end?.date || '', allDay: !e.start?.dateTime });
    } catch (e) { log('WARN', `watch calendar ${id}: ${e?.message || e}`); }
  }
  return out.sort((x, y) => String(x.start).localeCompare(String(y.start))).slice(0, 40);
}
async function forecast(id, type) {
  try {
    const r = await ha('services/weather/get_forecasts?return_response', { method: 'POST', body: JSON.stringify({ entity_id: id, type }) });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.service_response?.[id]?.forecast || []).slice(0, 12);
  } catch (e) { log('WARN', `watch forecast: ${e?.message || e}`); return []; }
}
const cache = new Map();   // page name -> {at, body}; 20 s, so a quick swipe back does not ask Home Assistant again
async function pageBody(name) {
  const c = cache.get(name);
  if (c && Date.now() - c.at < 20000) return c.body;
  const conf = pagesConf().pages?.[name];
  if (!conf) return null;
  const states = {};
  for (const id of conf.read || []) states[id] = await stateOf(id);
  const body = { name, layout: conf.layout || {}, states, at: new Date().toISOString() };
  if (conf.calendars) body.events = await calendarEvents(conf.calendars, conf.days || 14);
  if (conf.forecast) { body.daily = await forecast(conf.forecast, 'daily'); body.hourly = await forecast(conf.forecast, 'hourly'); }
  cache.set(name, { at: Date.now(), body });
  return body;
}

export function registerWatchRoutes(app, express) {
  app.get('/watch/state', async (_req, res) => {
    const h = getHomeHealth();
    res.json({ home: { status: h.status, count: h.count, temp: await houseTemp() }, quiet: isQuiet(), working: !!runtime.activeQuery, ...newestReply() });
  });
  app.get('/watch/reply', (_req, res) => {
    const last = newestText(parseSession(runtime.activeSessionId));
    res.json({ id: idOf(last), working: !!runtime.activeQuery, quiet: isQuiet(), ...newestReply(true) });
  });
  app.post('/watch/answer', express.json({ limit: '1kb' }), (req, res) => {
    const letter = String(req.body?.letter || '').toUpperCase();
    if (!/^[A-D]$/.test(letter)) return res.status(400).json({ ok: false });
    log('INFO', `my50: watch answered ${letter}`);
    runQuery({ readyState: 3 }, { text: letter, permissionMode: 'default', add: true });
    res.json({ ok: true });
  });
  app.post('/watch/say', express.json({ limit: '8kb' }), (req, res) => {
    const text = String(req.body?.text || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
    if (!text) return res.status(400).json({ ok: false });
    log('INFO', `my26: watch said ${text.length} chars`);
    runQuery({ readyState: 3 }, { text: '(Said on my watch, please answer short and plain, it may be read aloud) ' + text, permissionMode: 'default', add: true });
    res.json({ ok: true, id: idOf(newestText(parseSession(runtime.activeSessionId))) });
  });
  app.get('/watch/page/:name', async (req, res) => {
    try {
      const body = await pageBody(String(req.params.name || '').replace(/[^a-z_]/g, ''));
      if (!body) return res.status(404).json({ ok: false });
      res.json(body);
    } catch (e) { log('WARN', `watch page: ${e?.message || e}`); res.status(500).json({ ok: false }); }
  });
  app.post('/watch/act', express.json({ limit: '1kb' }), async (req, res) => {
    try {
      const id = String(req.body?.id || ''), act = pagesConf().acts?.[id];
      if (!act || !/^[a-z_]+\.[a-z_]+$/.test(act.service || '')) return res.status(400).json({ ok: false });
      const [domain, service] = act.service.split('.');
      const r = await ha(`services/${domain}/${service}`, { method: 'POST', body: JSON.stringify(act.data || {}) });
      log('INFO', `my68: watch act ${id} -> ${act.service} ${r.status}`);
      cache.clear();
      res.json({ ok: r.ok });
    } catch (e) { log('WARN', `watch act: ${e?.message || e}`); res.status(500).json({ ok: false }); }
  });
}
