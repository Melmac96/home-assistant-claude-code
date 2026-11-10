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
 * On the direct port (7682) all of them need a paired-device key like everything else there
 * (index.js gates the whole port first). The watch app carries one such key.
 */
import crypto from 'crypto';
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

function newestText() {
  const items = parseSession(runtime.activeSessionId);
  for (let i = items.length - 1; i >= 0; i--) { if (items[i].kind === 'text') return items[i].text; }
  return '';
}

/** The newest assistant text of the current chat, as {reply, question, options}. */
export function newestReply(full = false) {
  const last = newestText();
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

export function registerWatchRoutes(app, express) {
  app.get('/watch/state', async (_req, res) => {
    const h = getHomeHealth();
    res.json({ home: { status: h.status, count: h.count, temp: await houseTemp() }, quiet: isQuiet(), working: !!runtime.activeQuery, ...newestReply() });
  });
  app.get('/watch/reply', (_req, res) => {
    const last = newestText();
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
    res.json({ ok: true, id: idOf(newestText()) });
  });
}
