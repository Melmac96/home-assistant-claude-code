/*
 * my28: saving a chat's notes (New chat card) and the small stores behind quick jobs/replies
 * and the Waiting for you list. The summary is a separate one-off request with no tools, outside
 * the project folder, so it can run alongside a chat and can only return text; this file does
 * the writing. In Free mode nothing is sent anywhere: the end of the chat is saved as it stands.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import path from 'path';
import { log } from './log.js';
import { runtime } from './state.js';
import { broadcast, send } from './broadcast.js';
import { parseSession, sessionFile, sessionTitle } from './sessions.js';
import { modeState } from './accounts.js';
import { SUPERVISOR_URL } from './config.js';   // my73
import { DEFAULT_QUICK } from './quick-default.js';   // my74

const NOTES_DIR = '/config/opencode/handovers';
const WAITING = '/config/opencode/waiting-for-you.json';
const WAITING_LOG = '/config/opencode/waiting-history.log';
const CHANGES = '/config/CHANGES.md';
const QUICK = '/data/haai-quick.json';
const SAVED = '/data/haai-saved.json';
const TMP = '/tmp/haai-save';

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const ukNow = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/London' });

export function getQuick() { return readJson(QUICK, DEFAULT_QUICK); }
export function saveQuick(msg) {
  const clean = (s, n) => String(s || '').trim().slice(0, n);
  const jobs = (Array.isArray(msg.jobs) ? msg.jobs : []).slice(0, 60).map((j) => ({ label: clean(j.label, 40), text: clean(j.text, 2000) })).filter((j) => j.label && j.text);
  const replies = (Array.isArray(msg.replies) ? msg.replies : []).slice(0, 60).map((r) => clean(r, 500)).filter(Boolean);
  const q = { jobs, replies };
  writeFileSync(QUICK, JSON.stringify(q, null, 1));
  return q;
}

// my73 (Michael 2026-11-11, Q13 D): a check that can only be done after a date or an event is
// kept OUT of the list until then. show_from = "YYYY-MM-DD" or "YYYY-MM-DD HH:MM" (UK time);
// after = an automation or entity id: shown once it has fired / changed after the line was added;
// after = "flag:<name>": shown once /config/opencode/waiting-flags/<name> exists (e.g. energy_watch.py's gas warnings).
export function getAllWaiting() { const l = readJson(WAITING, []); return Array.isArray(l) ? l : []; }
const fired = {};   // id -> ms of the last firing / change, read from Home Assistant
const addedMs = (w) => { const t = Date.parse(w.added_at || w.when || ''); return Number.isFinite(t) ? t : 0; };
function isDue(w) {
  if (w.show_from && ukNow().slice(0, 16) < String(w.show_from).slice(0, 16)) return false;
  if (/^flag:[a-z0-9-]{1,60}$/.test(String(w.after || ''))) return existsSync(`/config/opencode/waiting-flags/${w.after.slice(5)}`);   // a tool wrote it when the thing happened
  if (w.after) return (fired[w.after] || 0) > addedMs(w);
  return true;
}
export function getWaiting() { return getAllWaiting().filter(isDue); }
async function readFired() {
  const ids = [...new Set(getAllWaiting().map((w) => w.after).filter((a) => /^[a-z_]+\.[a-z0-9_]+$/.test(String(a || ''))))];
  for (const id of ids) {
    try {
      const r = await fetch(`${SUPERVISOR_URL}/core/api/states/${id}`, { headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const j = await r.json();
      const t = Date.parse(j.attributes?.last_triggered || j.last_changed || '');
      if (Number.isFinite(t)) fired[id] = t;
    } catch { /* try again next round */ }
  }
}
let dueKey = null;
async function dueRound() {
  await readFired();
  const key = getWaiting().map((w) => w.id).join(',');
  if (dueKey !== null && key !== dueKey) broadcast({ type: 'waiting', list: getWaiting() });
  dueKey = key;
}
setTimeout(() => { dueRound(); setInterval(dueRound, 5 * 60 * 1000); }, 20 * 1000);
export function waitingDone(id) {
  const l = getAllWaiting();
  const hit = l.find((w) => w.id === id);
  if (!hit) return;
  writeFileSync(WAITING, JSON.stringify(l.filter((w) => w.id !== id), null, 1));
  try { appendFileSync(WAITING_LOG, `${ukNow()} | confirmed by Michael | ${hit.text}\n`); } catch { /* the chat message records it too */ }
}
function addWaiting(texts, job) {
  const l = getAllWaiting();
  const have = new Set(l.map((w) => w.text.toLowerCase()));
  const jobName = String(job || '').trim().slice(0, 40);
  for (const t of texts) {
    const text = String((t && typeof t === 'object' ? t.text : t) || '').trim().slice(0, 140);
    if (!text || have.has(text.toLowerCase())) continue;
    have.add(text.toLowerCase());
    const from = t && typeof t === 'object' && /^\d{4}-\d\d-\d\d( \d\d:\d\d)?$/.test(String(t.show_from || '')) ? { show_from: String(t.show_from) } : {};   // my73
    l.push({ id: randomBytes(4).toString('hex'), text, when: ukNow().slice(0, 10), ...from, ...(jobName ? { job: jobName } : {}) });
  }
  writeFileSync(WAITING, JSON.stringify(l, null, 1));
}

function chatText(id, max) {
  const lines = [];
  let you = 0, tools = 0;
  for (const it of parseSession(id)) {
    if (it.kind === 'user') { you++; lines.push('MICHAEL: ' + it.text); }
    else if (it.kind === 'text') lines.push('CLAUDE: ' + it.text);
    else if (it.kind === 'tool_use') tools++;
  }
  return { text: lines.join('\n\n').slice(-max), you, tools };
}

/*
 * my94 (Michael 2026-11-13, Q1 A): questions left waiting in the old chat always come back at the start of the
 * new one, whenever a new chat is opened from an old one (New chat card, my87, my91). Each marked question block
 * (the last one in each of Claude's replies) is paired with Michael's next message. No next message = waiting.
 * A next message that does not start with a letter or Q1-style pick = maybe waiting; the new chat decides.
 */
const Q_BLOCK = /⟦QUESTION⟧[\s\S]*?⟦\/QUESTION⟧/g;
const LOOKS_ANSWERED = /^\s*(\*\*)?(Q\d+\s*[.:)-]?\s*)?[A-Z](\*\*)?(\s*$|[\s.,:;)!-])/;
export function openQuestions(id) {
  const out = [];
  let pending = null;
  for (const it of parseSession(id)) {
    if (it.kind === 'text') {
      const blocks = String(it.text || '').match(Q_BLOCK);
      if (blocks) pending = blocks[blocks.length - 1];
    } else if (it.kind === 'user') {
      if (pending) {
        const reply = String(it.text || '').trim();
        if (!LOOKS_ANSWERED.test(reply)) out.push({ q: pending, reply: reply.slice(0, 400) });
      }
      pending = null;
    }
  }
  if (pending) out.push({ q: pending, reply: '' });
  return out.slice(-8);
}
export function openQuestionsText(id) {
  let list = [];
  try { list = id ? openQuestions(id) : []; } catch (e) { log('WARN', `my94 open questions: ${e?.message || e}`); }
  if (!list.length) return '';
  const parts = list.map((x, i) => `QUESTION ${i + 1}:\n${x.q.slice(0, 3000)}\n${x.reply ? `HIS NEXT MESSAGE AFTER IT: ${x.reply}` : 'HIS NEXT MESSAGE AFTER IT: (none, it was never answered)'}`);
  return `\n\nQUESTIONS THAT MAY STILL BE WAITING FOR MICHAEL (haAi my94, he asked that these ALWAYS come back at the start of a new chat):\nFor each one, check the old chat's notes and his next message. Leave out a question only if his next message or the notes clearly answered it, or a later question replaced it. Every other one MUST be shown again in your FIRST reply, in full, in ONE marked question block at the end of that reply (label them Q1, Q2 ... in bold, keep their options, Recommended first, last option Any other answer, no question shown twice), with one short line near the top saying these questions from the old chat were still waiting.\n\n${parts.join('\n\n')}`.slice(0, 16000);
}

async function ask(prompt, model) {
  mkdirSync(TMP, { recursive: true });
  let out = '';
  for await (const ev of query({ prompt, options: { cwd: TMP, model, settingSources: [], tools: [], maxTurns: 1, env: { ...process.env } } })) {
    if (ev.type === 'result' && ev.subtype === 'success' && ev.result) out = ev.result;
  }
  return out;
}

const PROMPT = (title, text, waitingNow) => `Below is the end of a chat between Michael and Claude about his Home Assistant, titled "${title}". Write the notes a new chat needs to carry on with no loss. Reply with JSON only, no code fences:
{"summary":"plain markdown: what the job is, what has been changed and where, what he decided, what is still to do, any question still waiting for his answer, anything not yet confirmed by him",
"change_line":"one line for the change log describing changes actually made in this chat, or an empty string if none",
"job":"2 to 4 plain words naming this job, e.g. Energy watch",
"waiting":["short plain-English label for each thing Claude changed that Michael still has to test and has NOT confirmed, at most 8; empty if none. Leave out anything already on his waiting list below, even if it is worded differently. If a check can only be done AFTER a future date or time (for example 'tomorrow morning', 'on 18 Nov'), write it as {"text":"label","show_from":"YYYY-MM-DD HH:MM"} with the UK time it can first be checked, so it stays hidden until then. Leave out checks that only make sense after an event that may never happen (a warning firing); the note can mention them"]}
Only state what the chat shows. Never include passwords, keys or tokens.

ALREADY ON HIS WAITING LIST (do not repeat these):
${waitingNow || '(empty)'}

CHAT:
${text}`;

/** Writes the note. Returns { file, summarised }. */
export async function writeNotes(id, title, model, max) {
  const { text } = chatText(id, max);
  let parsed = null;
  if (!modeState().free) {
    try {
      const raw = await ask(PROMPT(title, text, getAllWaiting().map((w) => '- ' + w.text + (isDue(w) ? '' : ' (hidden until it can be checked)')).join('\n')), model);
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { summary: raw };
    } catch (e) { log('WARN', `chat notes summary failed: ${e?.message || e}`); }
  }
  mkdirSync(NOTES_DIR, { recursive: true });
  const stamp = ukNow().replace(/[-: ]/g, '').slice(0, 12);
  const file = path.join(NOTES_DIR, `${stamp}-${id.slice(0, 8)}.md`);
  const body = parsed?.summary ? parsed.summary
    : 'No summary could be written, so this is the end of the chat as it stood:\n\n' + text.slice(-12000);
  writeFileSync(file, `# Notes from the chat "${title}" (${ukNow()} UK)\n\nFull chat: open it from Sessions.\n\n${body}\n`);
  if (parsed?.change_line && existsSync(CHANGES)) {
    try {
      const s = readFileSync(CHANGES, 'utf8');
      const at = s.indexOf('\n- 20');
      if (at > 0) writeFileSync(CHANGES, s.slice(0, at + 1) + `- ${ukNow().slice(0, 10)} | haAi auto-save | ${String(parsed.change_line).replace(/\s+/g, ' ').slice(0, 400)} | Note: ${file.replace('/config/', '')}\n` + s.slice(at + 1));
    } catch (e) { log('WARN', `change log line failed: ${e?.message || e}`); }
  }
  if (Array.isArray(parsed?.waiting) && parsed.waiting.length) { try { addWaiting(parsed.waiting, parsed.job); } catch { /* the note still has them */ } }
  const saved = readJson(SAVED, {});
  try { saved[id] = statSync(sessionFile(id)).mtimeMs; writeFileSync(SAVED, JSON.stringify(saved)); } catch { /* only used to skip repeat saves */ }
  return { file, summarised: !!parsed?.summary };
}

/** Start something new: save the old chat behind the scenes, only if it has something new. */
export function saveInBackground(id) {
  if (!id || !existsSync(sessionFile(id))) return;
  const { you, tools } = chatText(id, 10);
  let mtime = 0; try { mtime = statSync(sessionFile(id)).mtimeMs; } catch { /* treated as new */ }
  if ((you < 2 && !tools) || readJson(SAVED, {})[id] === mtime) return;
  const title = sessionTitle(id) || 'Chat';
  writeNotes(id, title, 'haiku', 30000).then(({ summarised }) => {
    log('INFO', `saved notes for chat ${id}`);
    broadcast({ type: 'handover_status', text: summarised ? 'Notes from your last chat are saved ✓' : 'Your last chat was saved without a summary' });
    broadcast({ type: 'waiting', list: getWaiting() });
  }).catch((e) => {
    log('ERROR', `background save failed: ${e?.message || e}`);
    broadcast({ type: 'handover_status', text: 'Could not save the notes from your last chat. The chat itself is still in Sessions.' });
  });
}

/** Continue this job: wait for Claude to finish, write the note, open a new chat that reads it. */
export async function continueJob(ws, startNew) {
  if (runtime.handoverBusy) return;
  const id = runtime.activeSessionId;
  if (!id) return;
  runtime.handoverBusy = true;
  try {
    if (runtime.activeQuery) {
      broadcast({ type: 'handover_status', text: "I'll move to a new chat as soon as Claude has finished" });
      const until = Date.now() + 30 * 60000;
      while (runtime.activeQuery && Date.now() < until) await new Promise((r) => setTimeout(r, 2000));
      if (runtime.activeQuery) { broadcast({ type: 'handover_status', text: 'Claude is still busy, so I stayed in this chat. Press New chat again when it has finished.' }); return; }
    }
    broadcast({ type: 'handover_status', text: 'Saving notes for the new chat…' });
    const title = (sessionTitle(id) || 'Chat').replace(/^Continue this job:\s*/, '');
    const { file } = await writeNotes(id, title, 'sonnet', 60000);
    startNew();
    const text = `Continue this job: ${title}\n\nRead the notes at ${file}, then carry on from where we left off.` + openQuestionsText(id);   // my94
    if (ws.readyState === 1) send(ws, { type: 'handover_ready', text });
    else runtime.pendingContinue = text;
  } catch (e) {
    log('ERROR', `continue job failed: ${e?.message || e}`);
    broadcast({ type: 'handover_status', text: 'Could not move to a new chat. Nothing was lost, so you can stay in this one.' });
  } finally {
    runtime.handoverBusy = false;
  }
}
