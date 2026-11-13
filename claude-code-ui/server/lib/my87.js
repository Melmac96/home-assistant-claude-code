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
 * at most 20 a day. Not in Free mode. The page's "nearly full" pop-up and warnings are gone; the colour bar stays.
 */
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { log } from './log.js';
import { broadcast } from './broadcast.js';
import { chats, view, inChat, runningChats, hooks } from './chats.js';
import { runtime } from './state.js';
import { DEFAULT_PERMISSION_MODE } from './config.js';
import { sessionTitle, saveActive, listSessions, parseSession } from './sessions.js';
import { modeState } from './accounts.js';   // my91
import { writeNotes } from './handover.js';

export const NEXT_FILE = '/data/haai-nextchat.json';
const read = () => { try { const j = JSON.parse(readFileSync(NEXT_FILE, 'utf8')); return j && typeof j === 'object' ? j : null; } catch { return null; } };
const save = (j) => { writeFileSync(NEXT_FILE + '.tmp', JSON.stringify(j, null, 1)); renameSync(NEXT_FILE + '.tmp', NEXT_FILE); };
let runner = null, busy = false;
export const AUTO_TOKENS = 150000;   // my91: same 150k as the chat colour bar
const AUTO_FILE = '/data/haai-automove.json';
const readAuto = () => { try { const j = JSON.parse(readFileSync(AUTO_FILE, 'utf8')); return j && Array.isArray(j.tried) ? j : { tried: [], log: [] }; } catch { return { tried: [], log: [] }; } };
const saveAuto = (j) => { writeFileSync(AUTO_FILE + '.tmp', JSON.stringify(j, null, 1)); renameSync(AUTO_FILE + '.tmp', AUTO_FILE); };

function pickSlot() {   // the chat that is working now (the one whose Claude ran the command); else the chat last looked at
  const run = runningChats().filter((s) => !s.free);
  const last = chats.get(view.last);
  if (last && run.includes(last)) return last;
  return run[0] || (last && !last.free ? last : null);
}

/** The text Michael last saw from Claude in this chat: the reply after his last message. */
function lastReply(id) {
  const items = parseSession(id);
  let i = items.length - 1;
  while (i >= 0 && items[i].kind !== 'user') i--;
  const texts = items.slice(i + 1).filter((it) => it.kind === 'text' && it.text && it.text.trim()).map((it) => it.text.trim());
  return (texts[texts.length - 1] || '').slice(-8000);
}

/** Moves one chat on to a fresh chat in the same slot. Used by the request (my87) and the 150k move (my91). */
async function moveOn(slot, nextStep, why) {
  await inChat(slot, async () => {
    const id = runtime.activeSessionId;
    const title = ((id && sessionTitle(id)) || 'Chat').replace(/^Continue this job:\s*/, '');
    broadcast({ type: 'handover_status', text: why === 'auto' ? 'This chat has passed 150k, so haAi is moving it to a new chat by itself…' : 'Moving this job to a new chat by itself…' });
    const last = why === 'auto' && id ? lastReply(id) : '';
    const { file } = id ? await writeNotes(id, title, 'sonnet', 60000) : { file: '(no notes: the old chat was empty)' };
    runtime.activeSessionId = null; saveActive();
    broadcast({ type: 'cleared', chat: slot.id });
    broadcast({ type: 'sessions', sessions: listSessions(), activeId: null });
    hooks.changed();
    const text = why === 'auto'
      ? `Continue this job: ${title}\n\nRead the notes at ${file}, then carry on from where we left off. [haAi moved this chat to a new one by itself because the old chat passed 150k tokens, as Michael asked (my91): no greeting.]\n\nNEXT STEP:\nThe old chat had just finished a reply, and the move took it off Michael's screen, so he may not have read it. Read the notes, then write that last reply again IN FULL (keep its layout and any question with its markers exactly as they were, but leave out any DONE, TIMED or PIN card lines so they are not shown twice), and add one short line at the top saying haAi moved to a new chat because the old one was long. Then stop and wait for his answer. Do not start new work and do not redo anything already done.\n\nLAST REPLY IN THE OLD CHAT:\n${last || '(could not be read: use the notes)'}`
      : `Continue this job: ${title}\n\nRead the notes at ${file}, then carry on from where we left off. [haAi started this new chat by itself, as Michael asked (my87): no greeting.]\n\nNEXT STEP:\n${nextStep}`;
    runner({ readyState: 3 }, { text, permissionMode: DEFAULT_PERMISSION_MODE });
  });
}

// my91: a chat past 150k whose reply has finished, not yet tried, not busy with anything else
function autoCandidate(waitingSlot) {
  if (modeState().free) return null;
  const tried = new Set(readAuto().tried);
  for (const s of chats.values()) {
    if (s.free || s.query || !s.sessionId || s.id === waitingSlot) continue;
    if (!s.ctx || s.ctx.sid !== s.sessionId || s.ctx.tokens < AUTO_TOKENS || !s.lastOk) continue;
    if (s.bgTasks && s.bgTasks.size) continue;              // a background job of this chat is still running
    if (Date.now() - s.ctx.at < 5000) continue;             // let the reply settle on screen first
    if (tried.has(s.sessionId)) continue;
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
  if (a.log.length >= 20) { saveAuto(a); log('WARN', 'my91: 20 moves today already, this long chat stays'); return; }
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
  if (!j || j.status !== 'wait') return autoTick(null);
  const now = Date.now();
  if (now - (j.at || 0) > 3 * 3600 * 1000) { j.status = 'expired'; save(j); log('INFO', 'my87: next-chat request expired'); return; }
  if (!j.slot) {
    const s = pickSlot();
    if (!s) return;
    j.slot = s.id; j.session = s.sessionId || null; save(j);
    return;
  }
  const slot = chats.get(j.slot);
  if (!slot) { j.status = 'dropped'; save(j); return; }
  if (slot.query) return;                                   // still writing its reply
  if (j.session && slot.sessionId && slot.sessionId !== j.session) { j.status = 'dropped'; save(j); log('INFO', 'my87: he started something else in that chat, request dropped'); return; }
  busy = true;
  j.status = 'running'; save(j);
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

export function startMy87(run) { runner = run; setInterval(() => { tick().catch(() => {}); }, 2000); }

export function my87Prompt() {
  return 'NEXT CHAT BY ITSELF (haAi my87): when a long job is split into parts and Michael said to move to new chats by yourself, finish this part (bookkeeping first), then run exactly: node /opt/server/lib/nextchat-cli.js "the next part written out in full so a fresh chat can do it alone" and, if it prints OK, write your report as usual and say in one line that the next part starts in a fresh chat by itself. haAi waits until your reply is finished, saves the notes and starts the new chat. Only when he asked for it; never for a single short job.';
}
