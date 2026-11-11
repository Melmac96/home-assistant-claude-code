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

const NOTES_DIR = '/config/opencode/handovers';
const WAITING = '/config/opencode/waiting-for-you.json';
const WAITING_LOG = '/config/opencode/waiting-history.log';
const CHANGES = '/config/CHANGES.md';
const QUICK = '/data/haai-quick.json';
const SAVED = '/data/haai-saved.json';
const TMP = '/tmp/haai-save';

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const ukNow = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/London' });

const DEFAULT_QUICK = {
  jobs: [
    { label: 'Check notes', text: 'Check notes' },
    { label: 'Full HA check', text: 'Full HA check' },
    { label: 'Weekly checks', text: 'Do the weekly checks' },
    { label: 'Overnight?', text: 'What happened overnight? Tell me only what needs me.' },
    { label: 'Refresh screens', text: 'Refresh my screens' },
  ],
  replies: ['Yes please', 'Continue', 'Finished', 'All confirmed', 'It works, thank you', "Not right, here's a picture", 'Explain that more simply', 'Show the question again'],
};
export function getQuick() { return readJson(QUICK, DEFAULT_QUICK); }
export function saveQuick(msg) {
  const clean = (s, n) => String(s || '').trim().slice(0, n);
  const jobs = (Array.isArray(msg.jobs) ? msg.jobs : []).slice(0, 60).map((j) => ({ label: clean(j.label, 40), text: clean(j.text, 2000) })).filter((j) => j.label && j.text);
  const replies = (Array.isArray(msg.replies) ? msg.replies : []).slice(0, 60).map((r) => clean(r, 500)).filter(Boolean);
  const q = { jobs, replies };
  writeFileSync(QUICK, JSON.stringify(q, null, 1));
  return q;
}

export function getWaiting() { const l = readJson(WAITING, []); return Array.isArray(l) ? l : []; }
export function waitingDone(id) {
  const l = getWaiting();
  const hit = l.find((w) => w.id === id);
  if (!hit) return;
  writeFileSync(WAITING, JSON.stringify(l.filter((w) => w.id !== id), null, 1));
  try { appendFileSync(WAITING_LOG, `${ukNow()} | confirmed by Michael | ${hit.text}\n`); } catch { /* the chat message records it too */ }
}
function addWaiting(texts, job) {
  const l = getWaiting();
  const have = new Set(l.map((w) => w.text.toLowerCase()));
  const jobName = String(job || '').trim().slice(0, 40);
  for (const t of texts) {
    const text = String(t || '').trim().slice(0, 140);
    if (!text || have.has(text.toLowerCase())) continue;
    have.add(text.toLowerCase());
    l.push({ id: randomBytes(4).toString('hex'), text, when: ukNow().slice(0, 10), ...(jobName ? { job: jobName } : {}) });
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
"waiting":["short plain-English label for each thing Claude changed that Michael still has to test and has NOT confirmed, at most 8; empty if none. Leave out anything already on his waiting list below, even if it is worded differently"]}
Only state what the chat shows. Never include passwords, keys or tokens.

ALREADY ON HIS WAITING LIST (do not repeat these):
${waitingNow || '(empty)'}

CHAT:
${text}`;

/** Writes the note. Returns { file, summarised }. */
async function writeNotes(id, title, model, max) {
  const { text } = chatText(id, max);
  let parsed = null;
  if (!modeState().free) {
    try {
      const raw = await ask(PROMPT(title, text, getWaiting().map((w) => '- ' + w.text).join('\n')), model);
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
    const text = `Continue this job: ${title}\n\nRead the notes at ${file}, then carry on from where we left off.`;
    if (ws.readyState === 1) send(ws, { type: 'handover_ready', text });
    else runtime.pendingContinue = text;
  } catch (e) {
    log('ERROR', `continue job failed: ${e?.message || e}`);
    broadcast({ type: 'handover_status', text: 'Could not move to a new chat. Nothing was lost, so you can stay in this one.' });
  } finally {
    runtime.handoverBusy = false;
  }
}
