/*
 * my146 (Michael 23 Nov 2026, "it must never happen again"): the words he types or picks under a question are
 * kept on haAi the moment he types them, never only in one phone's browser. They used to go only with the
 * "Send my answers" button: when he sent a normal message instead, the question closed and hundreds of words
 * stayed behind on his device and were lost. Now:
 *  - every pick and every typed word is saved here as he types (a private file, outside git and www),
 *  - each version is also added to a log that is never trimmed, so nothing he typed can ever be lost,
 *  - any answers still waiting when his next message arrives are added to that message for Claude.
 */
import { readFileSync, writeFileSync, appendFileSync, renameSync } from 'node:fs';
import { log } from './log.js';

const FILE = '/data/haai-typed-answers.json';
const LOG = '/data/haai-typed-answers.log';
const KEEP = 14 * 24 * 3600 * 1000;   // an unsent answer waits 14 days at most

let waiting = {};
try { waiting = JSON.parse(readFileSync(FILE, 'utf8')) || {}; } catch { waiting = {}; }

function save() {
  try { writeFileSync(FILE + '.tmp', JSON.stringify(waiting)); renameSync(FILE + '.tmp', FILE); }
  catch (e) { log('WARN', `my146: could not save his typed answers: ${e?.message || e}`); }
}

/** The page sends this on every pick and as he types. No lines = that question block has been sent. */
export function answerTyped(msg) {
  const qid = String(msg.qid || '').slice(0, 40);
  if (!qid) return;
  const lines = Array.isArray(msg.lines) ? msg.lines.map((l) => String(l).slice(0, 20000)).filter((l) => l.trim()).slice(0, 60) : [];
  if (!lines.length) { if (waiting[qid]) { delete waiting[qid]; save(); } return; }
  const q = String(msg.q || '').slice(0, 300);
  const prev = waiting[qid];
  if (prev && prev.lines.join('\n') === lines.join('\n')) return;
  waiting[qid] = { lines, q, chat: String(msg.chat || ''), at: Date.now() };
  save();
  try { appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), qid, q, lines }) + '\n'); }
  catch (e) { log('WARN', `my146: could not add to the typed answers log: ${e?.message || e}`); }
}

/** Called for each message he sends: the blocks that went with it are done; any others still waiting are added. */
export function addWaitingAnswers(text, sentIds) {
  let changed = false;
  for (const id of Array.isArray(sentIds) ? sentIds : []) if (waiting[String(id)]) { delete waiting[String(id)]; changed = true; }
  const now = Date.now();
  const parts = [];
  for (const [id, w] of Object.entries(waiting)) {
    delete waiting[id]; changed = true;
    if (now - w.at > KEEP) continue;
    parts.push(`Your question${w.q ? ` starting "${w.q}"` : ''}:\n${w.lines.join('\n')}`);
  }
  if (changed) save();
  if (!parts.length) return text;
  log('INFO', `my146: ${parts.length} question block(s) of his answers were waiting unsent: added to his message`);
  return `${text}\n\n[haAi my146: Michael also picked or typed these answers under your questions, but they were not sent with the Send my answers button. They are his answers, word for word: act on them and never ask them again.]\n${parts.join('\n\n')}`;
}
