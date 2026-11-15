/*
 * my87 (Michael 2026-11-12, app check Q3 A): Claude moves a long job on to a NEW chat by itself, no input from him.
 *   Claude runs:  node /opt/server/lib/nextchat-cli.js "what the next chat must do, written out in full"
 * When the chat that asked has finished its reply, haAi writes the handover note for it (as the New chat card does),
 * starts that same chat fresh (same colour; the account is picked as for any new chat, my83) and sends
 * "Continue this job: ..." with the note and the job. One waiting request at a time, at most 12 a day,
 * dropped after 3 hours or if he starts a new chat there himself.
 *
 * my91 (Michael 2026-11-13): a chat that has passed 150k tokens moves to a new chat BY ITSELF as soon as Claude's
 * reply has finished (never in the middle of one): same steps as above, and the new chat first shows that last reply
 * again in full (with any question waiting), because the move takes it off his screen. One try per old chat,
 * at most 20 a day. Not in Free mode.
 * my100 (Michael 14 Nov, his rule 'LONG CHATS MOVE BY THEMSELVES, ALWAYS, NO DAILY LIMIT'): no daily cap on either
 *   move (the 20-a-day cap silently kept long chats from 18:48 UK). Only the one-try-per-chat loop guard stays, and
 *   when it (or a failed move) keeps a long chat, haAi TELLS him instead of keeping it quietly. A long chat whose
 *   last reply was cut short (an error, not his own Stop and not an account limit that haAi resumes) moves too.
 * my110 (Michael 15 Nov, 'never move to a new chat before I have answered'): neither move happens while the chat's last
 *   reply holds a question waiting for him (slot.asks). After he answers and that reply has finished, the move carries
 *   the question and his answer word for word, so the new chat simply carries on as if it were the same chat.
 * my113 (Michael 15 Nov, the chat that reached 219k): (1) after a haAi restart (an install) the chat's size and
 *   'last reply finished' were forgotten until the next reply, so the move missed its chance. Now they are read back
 *   from the chat's own file (with any question still waiting) the first time haAi looks at that chat after a restart.
 *   (2) a chat past 150k moves AS SOON AS he answers a question: his answer is not run in the long chat; the new chat
 *   gets the question and his answer word for word and acts on it, so a run of questions can no longer keep it growing.
 * my94: both moves also carry every question still waiting in the old chat (handover.js openQuestionsText). The page's "nearly full" pop-up and warnings are gone; the colour bar stays.
 */
import { readFileSync } from 'fs';
import { log } from './log.js';
import { saveJson, cachedJson } from './util.js';   // my115: shared helpers, files re-read only when changed
import { broadcast } from './broadcast.js';
import { chats, view, inChat, runningChats, hooks } from './chats.js';
import { runtime } from './state.js';
import { DEFAULT_PERMISSION_MODE } from './config.js';
import { sessionTitle, saveActive, listSessions, parseSession, sessionFile } from './sessions.js';   // my113 sessionFile
import { modeState } from './accounts.js';   // my91
import { writeNotes, openQuestionsText } from './handover.js';   // my94

export const NEXT_FILE = '/data/haai-nextchat.json';
const read = () => { const j = cachedJson(NEXT_FILE, null); return j && typeof j === 'object' ? j : null; };
const save = (j) => saveJson(NEXT_FILE, j, true);
let runner = null, busy = false;
export const AUTO_TOKENS = 150000;   // my91: same 150k as the chat colour bar
const AUTO_FILE = '/data/haai-automove.json';
const readAuto = () => { const j = cachedJson(AUTO_FILE, null); return j && Array.isArray(j.tried) ? j : { tried: [], log: [] }; };
const saveAuto = (j) => saveJson(AUTO_FILE, j, true);
const RUNNING_MAX_MS = 15 * 60 * 1000;   // my115: a move still 'running' after this long was cut off (haAi restarted part-way)
const ASK_WAIT_MAX_MS = 24 * 3600 * 1000;   // my115: a request whose chat waits on his answer still expires after a day

function pickSlot() {   // the chat that is working now (the one whose Claude ran the command); else the chat last looked at
  const run = runningChats().filter((s) => !s.free);
  const last = chats.get(view.last);
  if (last && run.includes(last)) return last;
  return run[0] || (last && !last.free ? last : null);
}

/** The text Michael last saw from Claude in this chat: the reply after his last message. */
function lastReply(id, items = parseSession(id)) {   // my115: the caller may pass the chat it has already read
  let i = items.length - 1;
  while (i >= 0 && items[i].kind !== 'user') i--;
  const texts = items.slice(i + 1).filter((it) => it.kind === 'text' && it.text && it.text.trim()).map((it) => it.text.trim());
  return (texts[texts.length - 1] || '').slice(-8000);
}

/** my110: the last question Claude asked before his latest message, and his answer to it (word for word). */
function lastAnswered(id, items = parseSession(id)) {
  let u = items.length - 1;
  while (u >= 0 && items[u].kind !== 'user') u--;
  if (u < 0) return '';
  let q = u - 1;
  while (q >= 0 && !(items[q].kind === 'text' && /⟦QUESTION⟧/.test(items[q].text || ''))) { if (items[q].kind === 'user') return ''; q--; }
  if (q < 0) return '';
  return `\n\nTHE QUESTION HE ANSWERED LAST IN THE OLD CHAT (treat it as answered, never ask it again):\n${items[q].text.trim().slice(-4000)}\n\nHIS ANSWER:\n${(items[u].text || '').trim().slice(0, 3000)}\n`;
}

/** Moves one chat on to a fresh chat in the same slot. Used by the request (my87) and the 150k move (my91). */
// my115: everything he sent while the chat was moving goes into the new chat, word for word.
const extraText = (slot) => {
  const x = slot.moveExtra || [];
  slot.moveExtra = [];
  return x.length ? `\n\nHE ALSO SENT THIS WHILE THE CHAT WAS MOVING (act on it in the new chat, word for word):\n${x.map((t) => String(t).slice(0, 4000)).join('\n---\n')}\n` : '';
};

async function moveOn(slot, nextStep, why, ans = null) {
  slot.moving = true;   // my115: runQuery keeps any message he sends now for the new chat instead of starting a run
  let started = false;
  try {
  await inChat(slot, async () => {
    const id = runtime.activeSessionId;
    const title = ((id && sessionTitle(id)) || 'Chat').replace(/^Continue this job:\s*/, '');
    broadcast({ type: 'handover_status', text: why === 'auto' ? 'This chat has passed 150k, so haAi is moving it to a new chat by itself…' : 'Moving this job to a new chat by itself…' });
    let items = [];
    try { items = id ? parseSession(id) : []; } catch (e) { log('WARN', `my87: could not read the old chat: ${e?.message || e}`); }   // my115: read once
    const last = why === 'auto' && id ? lastReply(id, items) : '';
    const waitingQs = openQuestionsText(id, items);   // my94: questions left waiting come back in the new chat
    const answered = id && !ans ? lastAnswered(id, items) : '';   // my110: his last answer carries over (my113: given straight in)
    const { file } = id ? await writeNotes(id, title, 'sonnet', 60000) : { file: '(no notes: the old chat was empty)' };
    runtime.activeSessionId = null; saveActive();
    broadcast({ type: 'cleared', chat: slot.id });
    broadcast({ type: 'sessions', sessions: listSessions(), activeId: null });
    hooks.changed();
    const text = ans
      ? `Continue this job: ${title}\n\nRead the notes at ${file}, then carry on from where we left off. [haAi moved this chat to a new one by itself because the old chat passed 150k tokens, straight after Michael answered your question (my113): no greeting.]\n\nTHE QUESTION YOU ASKED IN THE OLD CHAT (he has answered it now, never ask it again):\n${ans.q || '(could not be read: use the notes)'}\n\nHIS ANSWER, WORD FOR WORD:\n${ans.answer}\n\nNEXT STEP:\nAdd one short line at the top saying haAi moved to a new chat because the old one was long, then act on his answer exactly as the old chat would have done, and reply as usual.` + (waitingQs ? waitingQs + '\n(The question he has just answered above is NOT waiting any more: leave it out. Show only any others, once, in one block at the end.)' : '')
      : why === 'auto'
      ? `Continue this job: ${title}\n\nRead the notes at ${file}, then carry on from where we left off. [haAi moved this chat to a new one by itself because the old chat passed 150k tokens, as Michael asked (my91): no greeting.]\n\nNEXT STEP:\nThe old chat had just finished a reply, and the move took it off Michael's screen, so he may not have read it. Read the notes, then write that last reply again IN FULL (keep its layout and any question with its markers exactly as they were, but leave out any DONE, TIMED or PIN card lines so they are not shown twice), and add one short line at the top saying haAi moved to a new chat because the old one was long. Then stop and wait for his answer. Do not start new work and do not redo anything already done.\n\nLAST REPLY IN THE OLD CHAT:\n${last || '(could not be read: use the notes)'}` + answered + (waitingQs ? waitingQs + '\n(The last reply above may hold one of these questions: show it once, in the same single block.)' : '')
      : `Continue this job: ${title}\n\nRead the notes at ${file}, then carry on from where we left off. [haAi started this new chat by itself, as Michael asked (my87): no greeting.]\n\nNEXT STEP:\n${nextStep}` + answered + (waitingQs ? waitingQs + '\n(Do the next step only if it does not depend on those answers; otherwise stop and wait for them.)' : '');
    slot.moving = false;   // the new chat's first message must start a run, not be kept
    // my115: wait for the run and check it really started; a move that never started is reported, never logged as done.
    started = await runner({ readyState: 3 }, { text: text + extraText(slot), permissionMode: DEFAULT_PERMISSION_MODE, synthetic: true });
  });
  } finally {
    slot.moving = false;
    if (slot.moveExtra && slot.moveExtra.length) {   // the move failed part-way: give his messages back, never lose them
      for (const t of slot.moveExtra) broadcast({ type: 'draft_back', text: t, chat: slot.id });
      slot.moveExtra = [];
    }
  }
  if (started === false) throw new Error('the new chat could not start (see the message on screen)');
}

// my100: the loop guard kept a long chat (its one move already failed): say so once, never silently
const warned = new Set();
function warnKept(s) {
  if (warned.has(s.sessionId)) return;
  warned.add(s.sessionId);
  log('WARN', `my100: chat ${s.id} is still over ${Math.round(AUTO_TOKENS / 1000)}k after its one move try`);
  broadcast({ type: 'handover_status', text: 'This long chat could not move to a new one by itself (it was tried once). Please tap New chat, or ask me to move it.' });
}

// my113: after a restart a chat's size, 'reply finished' and waiting question are read back from its own file, once
const seeded = new Set();
function seedAfterRestart(s) {
  if (s.ctx || !s.sessionId || seeded.has(s.sessionId)) return;
  seeded.add(s.sessionId);
  try {
    const lines = readFileSync(sessionFile(s.sessionId), 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 500; i--) {
      let j; try { j = JSON.parse(lines[i]); } catch { continue; }
      const c = j.message?.content;
      if (j.type === 'user' && (typeof c === 'string' || (Array.isArray(c) && c.some((x) => x.type === 'text') && !c.some((x) => x.type === 'tool_result')))) return;   // he wrote after it: that reply never finished
      if (j.type !== 'assistant' || !j.message?.usage) continue;
      if (j.message.stop_reason !== 'end_turn') return;      // it stopped part way through a job
      const u = j.message.usage;
      const tokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
      const text = (Array.isArray(c) ? c : []).filter((x) => x.type === 'text').map((x) => x.text || '').join('');
      s.ctx = { tokens, sid: s.sessionId, at: Date.now() - 6000 };
      s.lastOk = true;
      if (/⟦QUESTION⟧/.test(text)) s.asks = true;            // a question still waits: never move before he answers
      log('INFO', `my113: chat ${s.id} read back after a restart: ${Math.round(tokens / 1000)}k${s.asks ? ', a question waits' : ''}`);
      return;
    }
  } catch (e) { log('WARN', `my113: could not read back chat ${s.id}: ${String(e?.message || e).slice(0, 120)}`); }
}

// my91: a chat past 150k whose reply has finished, not yet tried, not busy with anything else
function autoCandidate(waitingSlot) {
  if (modeState().free) return null;
  const tried = new Set(readAuto().tried);
  for (const s of chats.values()) {
    if (s.free || s.query || !s.sessionId || s.id === waitingSlot) continue;
    seedAfterRestart(s);                                    // my113
    if (!s.ctx || s.ctx.sid !== s.sessionId || s.ctx.tokens < AUTO_TOKENS || !(s.lastOk || s.lastCut)) continue;   // my100: cut short moves too
    if (s.bgTasks && s.bgTasks.size) continue;              // a background job of this chat is still running
    if (s.asks) continue;                                   // my110: a question is waiting for his answer: never move before he answers
    if (Date.now() - s.ctx.at < 5000) continue;             // let the reply settle on screen first
    if (tried.has(s.sessionId)) { warnKept(s); continue; }   // my100: never kept quietly
    return s;
  }
  return null;
}

async function autoTick(waitingSlot) {
  const s = autoCandidate(waitingSlot);
  if (!s) return;
  const a = readAuto();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/London' });
  a.log = (a.log || []).filter((x) => x.day === today);
  a.tried = [s.sessionId, ...a.tried].slice(0, 100);        // one try per old chat, even if it fails
  // my100: no daily cap any more (his rule beats any limit)
  a.log.push({ day: today, at: Date.now(), from: s.sessionId, k: Math.round(s.ctx.tokens / 1000) });
  saveAuto(a);
  busy = true;
  try {
    await moveOn(s, '', 'auto');
    log('INFO', `my91: chat ${s.id} passed ${Math.round(s.ctx.tokens / 1000)}k, moved to a new chat by itself`);
  } catch (e) {
    log('ERROR', `my91: could not move the long chat: ${String(e?.message || e).slice(0, 200)}`);
    broadcast({ type: 'handover_status', text: 'Could not move this long chat to a new one by itself. Nothing was lost.' });
  } finally { busy = false; }
}

async function tick() {
  if (busy || !runner || runtime.handoverBusy) return;
  const j = read();
  const now = Date.now();
  // my115: a move left 'running' by a restart part-way is closed off, so it can never block the moves for ever
  if (j && j.status === 'running' && now - (j.startedAt || j.at || 0) > RUNNING_MAX_MS) {
    j.status = 'failed'; j.error = 'cut off part-way (haAi restarted?)'; save(j);
    log('WARN', 'my87: a next-chat move was left running part-way; closed it off');
    broadcast({ type: 'handover_status', text: 'A move to a new chat was cut off part-way. Nothing was lost: tap New chat if this chat is long.' });
    return;
  }
  if (!j || j.status !== 'wait') return autoTick(null);
  const asking = j.slot && chats.get(j.slot)?.asks;          // my110: waiting for his answer never expires the request
  const age = now - (j.at || 0);
  if ((!asking && age > 3 * 3600 * 1000) || age > ASK_WAIT_MAX_MS) { j.status = 'expired'; save(j); log('INFO', 'my87: next-chat request expired'); return; }
  if (!j.slot) {
    const s = pickSlot();
    if (!s) return autoTick(null);
    j.slot = s.id; j.session = s.sessionId || null; save(j);
    return;
  }
  const slot = chats.get(j.slot);
  if (!slot) { j.status = 'dropped'; save(j); return; }
  // my115: while the waiting request's chat is busy or waits on him, the OTHER chats can still move at 150k
  if (slot.query || slot.asks) return autoTick(j.slot);     // still writing its reply / my110: a question is waiting
  if (j.session && slot.sessionId && slot.sessionId !== j.session) { j.status = 'dropped'; save(j); log('INFO', 'my87: he started something else in that chat, request dropped'); return; }
  busy = true;
  j.status = 'running'; j.startedAt = Date.now(); save(j);
  try {
    await moveOn(slot, j.text, 'ask');
    j.status = 'done'; j.ranAt = Date.now(); save(j);
    log('INFO', `my87: job moved to a new chat in ${slot.id}`);
  } catch (e) {
    j.status = 'failed'; j.error = String(e?.message || e).slice(0, 200); save(j);
    log('ERROR', `my87: could not move to a new chat: ${j.error}`);
    broadcast({ type: 'handover_status', text: 'Could not move to a new chat by itself. Nothing was lost.' });
  } finally { busy = false; }
}

/** my113: he has just answered a question in a chat past 150k: move now, carrying the question and his answer.
 *  Returns true when the new chat has taken his answer (runQuery then stops); false = run it in this chat as usual. */
export async function moveOnAnswer(slot, text) {
  if (!slot || busy || !runner || runtime.handoverBusy || modeState().free || slot.free) return false;
  if (!slot.asks || slot.query || !slot.sessionId || !String(text || '').trim()) return false;
  if (!slot.ctx || slot.ctx.sid !== slot.sessionId || slot.ctx.tokens < AUTO_TOKENS) return false;
  if (slot.bgTasks && slot.bgTasks.size) return false;
  const old = slot.sessionId;
  busy = true;   // my115: set before anything that can throw, and always cleared below
  try {
  const a = readAuto();
  if (a.tried.includes(old)) return false;                  // one try per old chat, as for the 150k move
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/London' });
  a.log = (a.log || []).filter((x) => x.day === today);
  a.tried = [old, ...a.tried].slice(0, 100);
  a.log.push({ day: today, at: Date.now(), from: old, k: Math.round(slot.ctx.tokens / 1000), on: 'answer' });
  saveAuto(a);
  const q = lastReply(old);
  slot.asks = false;
  try {
    await moveOn(slot, '', 'auto', { q, answer: String(text).trim().slice(0, 6000) });
    log('INFO', `my113: chat ${slot.id} passed ${Math.round(slot.ctx.tokens / 1000)}k, moved as soon as he answered`);
    return true;
  } catch (e) {
    log('ERROR', `my113: could not move on his answer: ${String(e?.message || e).slice(0, 200)}`);
    if (slot.sessionId === old) { slot.asks = true; return false; }   // nothing moved: answer it in this chat as usual
    return true;
  }
  } catch (e) {
    log('ERROR', `my113: move on his answer failed before it started: ${String(e?.message || e).slice(0, 200)}`);
    return false;   // his answer is then run in this chat as usual, never lost
  } finally { busy = false; }
}

// my115: errors in the move loop are logged (once a minute at most) and told to him, never thrown away silently
let lastTickErr = 0;
export function startMy87(run) {
  runner = run;
  setInterval(() => {
    tick().catch((e) => {
      busy = false;
      if (Date.now() - lastTickErr < 60000) return;
      lastTickErr = Date.now();
      log('ERROR', `my87: move check failed: ${String(e?.message || e).slice(0, 200)}`);
      broadcast({ type: 'handover_status', text: 'haAi could not check whether this chat should move to a new one. If it is long, tap New chat.' });
    });
  }, 2000);
}

export function my87Prompt() {
  return 'NEXT CHAT BY ITSELF (haAi my87): when a long job is split into parts and Michael said to move to new chats by yourself, finish this part (bookkeeping first), then run exactly: node /opt/server/lib/nextchat-cli.js "the next part written out in full so a fresh chat can do it alone" and, if it prints OK, write your report as usual and say in one line that the next part starts in a fresh chat by itself. haAi waits until your reply is finished, saves the notes and starts the new chat. Only when he asked for it; never for a single short job.';
}
