/*
 * my87 (Michael 2026-11-12, app check Q3 A): Claude moves a long job on to a NEW chat by itself, no input from him.
 *   Claude runs:  node /opt/server/lib/nextchat-cli.js "what the next chat must do, written out in full"
 * When the chat that asked has finished its reply, haAi writes the handover note for it (as the New chat card does),
 * starts that same chat fresh (same colour; the account is picked as for any new chat, my83) and sends
 * "Continue this job: ..." with the note and the job. One waiting request at a time, at most 12 a day,
 * dropped after 3 hours or if he starts a new chat there himself.
 */
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { log } from './log.js';
import { broadcast } from './broadcast.js';
import { chats, view, inChat, runningChats, hooks } from './chats.js';
import { runtime } from './state.js';
import { DEFAULT_PERMISSION_MODE } from './config.js';
import { sessionTitle, saveActive, listSessions } from './sessions.js';
import { writeNotes } from './handover.js';

export const NEXT_FILE = '/data/haai-nextchat.json';
const read = () => { try { const j = JSON.parse(readFileSync(NEXT_FILE, 'utf8')); return j && typeof j === 'object' ? j : null; } catch { return null; } };
const save = (j) => { writeFileSync(NEXT_FILE + '.tmp', JSON.stringify(j, null, 1)); renameSync(NEXT_FILE + '.tmp', NEXT_FILE); };
let runner = null, busy = false;

function pickSlot() {   // the chat that is working now (the one whose Claude ran the command); else the chat last looked at
  const run = runningChats().filter((s) => !s.free);
  const last = chats.get(view.last);
  if (last && run.includes(last)) return last;
  return run[0] || (last && !last.free ? last : null);
}

async function tick() {
  if (busy || !runner) return;
  const j = read();
  if (!j || j.status !== 'wait') return;
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
    await inChat(slot, async () => {
      const id = runtime.activeSessionId;
      const title = ((id && sessionTitle(id)) || 'Chat').replace(/^Continue this job:\s*/, '');
      broadcast({ type: 'handover_status', text: 'Moving this job to a new chat by itself…' });
      const { file } = id ? await writeNotes(id, title, 'sonnet', 60000) : { file: '(no notes: the old chat was empty)' };
      runtime.activeSessionId = null; saveActive();
      broadcast({ type: 'cleared', chat: slot.id });
      broadcast({ type: 'sessions', sessions: listSessions(), activeId: null });
      hooks.changed();
      const text = `Continue this job: ${title}\n\nRead the notes at ${file}, then carry on from where we left off. [haAi started this new chat by itself, as Michael asked (my87): no greeting.]\n\nNEXT STEP:\n${j.text}`;
      runner({ readyState: 3 }, { text, permissionMode: DEFAULT_PERMISSION_MODE });
    });
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
