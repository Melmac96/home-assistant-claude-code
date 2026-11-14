/*
 * my96 (Michael 2026-11-14, idea list 'U decide / I'm back', his answer A):
 *  U decide: he presses it when he will be away from haAi for a while. Claude then gets on by itself, but ONLY with
 *  jobs he has already said yes to, plus checks and tidy-ups (backed up first). Anything new waits for him.
 *  While he is away the page shows an I'm back button (only then). When he presses it, Claude finishes what it is
 *  doing, then tells him what it did and that it is ready for him. The away state is shared by every device.
 */
import { readFileSync, renameSync, writeFileSync } from 'fs';
import { log } from './log.js';
import { broadcast } from './broadcast.js';

const FILE = '/data/haai-away.json';
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')) || d; } catch { return d; } };
let st = readJson(FILE, { away: false });

export const awayState = () => ({ away: !!st.away, since: st.since || 0 });
export function setAway(on) {
  st = on ? { away: true, since: Date.now() } : { away: false, since: 0, backAt: Date.now() };
  try { writeFileSync(FILE + '.tmp', JSON.stringify(st)); renameSync(FILE + '.tmp', FILE); } catch (e) { log('WARN', `away save failed: ${e?.message || e}`); }
  log('INFO', on ? 'U decide: Michael is away' : "I'm back: Michael has returned");
  broadcast({ type: 'away_state', ...awayState() });
}

export function my96Prompt() {
  const since = st.away && st.since ? new Date(st.since).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }) : '';
  return 'U DECIDE / I\'M BACK (haAi): a message starting "U decide" means Michael is going away from haAi for a while. Get on by yourself with ONLY jobs he has already said yes to (open lines in his plan and idea files, the waiting list, CHANGES.md items marked not finished), plus checks and tidy-ups; back up first; anything new or any real choice waits for him and goes in the I\'m back report; ask no questions while he is away and do not message his phone unless a job needs it. Keep going job after job until nothing agreed is left, using nextchat-cli if the chat gets long. A message starting "I\'m back" means he has returned: finish the step you are on, do the bookkeeping, then write ONE plain report: what you did while he was away, what is waiting for him (with lettered questions in his marker layout), and that you are ready for him. Call nothing fixed.'
    + (st.away ? ` Right now he IS away (pressed U decide at ${since} UK).` : '');
}
