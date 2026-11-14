/*
 * my97 (Michael 2026-11-14): 'Lots to send' button (stack symbol, his Look B) next to the … button.
 *  Press it = he is about to send lots of changes. Claude works on each message quietly in the background and asks NO questions,
 *  keeping its questions for later. The button turns into a green Done; pressing Done = Claude asks all its questions in one go
 *  (marker layout) and does whatever is left. The state is shared by every device, like U decide (my96).
 */
import { readFileSync, renameSync, writeFileSync } from 'fs';
import { log } from './log.js';
import { broadcast } from './broadcast.js';

const FILE = '/data/haai-lots.json';
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')) || d; } catch { return d; } };
let st = readJson(FILE, { on: false });

export const lotsState = () => ({ on: !!st.on, since: st.since || 0 });
export function setLots(on) {
  st = on ? { on: true, since: Date.now() } : { on: false, since: 0, doneAt: Date.now() };
  try { writeFileSync(FILE + '.tmp', JSON.stringify(st)); renameSync(FILE + '.tmp', FILE); } catch (e) { log('WARN', `lots save failed: ${e?.message || e}`); }
  log('INFO', on ? 'Lots to send: on' : 'Lots to send: Done');
  broadcast({ type: 'lots_state', ...lotsState() });
}

export function my97Prompt() {
  return 'LOTS TO SEND (haAi my97): a message starting "Lots to send:" means Michael is about to send many changes one after another. ' +
    'While it is on, work on each message quietly (back up first, as always), ask NO questions and use no question markers; when a real choice comes up, pick nothing, note the question and carry on with what does not depend on it. ' +
    'Reply to each message in one or two short plain lines (what you did or noted). A message starting "Done:" means he has finished: ask ALL the saved questions in ONE marked question block (Q1, Q2 ... his marker layout), then do whatever is left.' +
    (st.on ? ' Right now Lots to send IS ON: no questions until he presses Done.' : '');
}
