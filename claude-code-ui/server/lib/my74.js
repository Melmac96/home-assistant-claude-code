/*
 * my74 (Michael's picks 2026-11-11, twelve-ideas-looks.html):
 *  H4  "Broke a rule" button: the page logs the slip here; Claude answers with a ⟦RULE|…⟧ card.
 *  H6  cost of each job, shown only on the Finished box (Look C): every usage update adds its 5-hour
 *      step to the chat it came from; when a reply carrying ⟦DONE|…⟧ ends, that sum is the job's cost.
 *  H16 What's new card after this update (Look A), until Got it is pressed on any device.
 *  H20 Save as button (Look A): Claude saves the steps with savejob-cli.js into the Quick jobs file;
 *      this file notices the change and tells every page.
 */
import { appendFileSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { log } from './log.js';
import { broadcast } from './broadcast.js';
import { getQuick } from './handover.js';

const COST = '/data/haai-jobcost.json';
const SEEN = '/data/haai-whatsnew-seen.json';
const QUICK = '/data/haai-quick.json';
const RULE_LOG = '/config/opencode/broke-a-rule.log';
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')) || d; } catch { return d; } };
const saveJson = (f, o) => { writeFileSync(f + '.tmp', JSON.stringify(o)); renameSync(f + '.tmp', f); };
const ukNow = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/London' }).slice(0, 16);
const DONE = /⟦DONE\|([^⟧\n]*)⟧/g;
export const costKey = (fields) => fields.slice(0, 2).map((s) => String(s || '').trim()).join('|').slice(0, 300);

// ── H6 job cost ──────────────────────────────────────────────────────────────
let cost = readJson(COST, {});
cost.acc = cost.acc || {}; cost.costs = cost.costs || {};
const turnUse = {};   // my111: session id -> share of the 5 hours used by the turn running now
const pending = {};   // session id -> DONE keys seen in this turn
let saveTimer = null;
const saveCost = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { saveJson(COST, cost); } catch (e) { log('WARN', `job cost save failed: ${e?.message || e}`); } }, 2000); };

export function noteJobUsage(sid, unified) {
  const w = unified && unified.five_hour;
  if (!sid || !w || w.utilization == null) return;
  const used = Number(w.utilization) * 100;   // my99: always a fraction (1.04 = 104%)
  const now = { used, resetsAt: w.resetsAt || null };
  const last = cost.last;
  let step = 0;
  if (last && last.resetsAt === now.resetsAt) step = Math.max(0, used - last.used);
  else if (last && last.resetsAt && Date.now() / 1000 >= last.resetsAt) step = used;   // the old 5 hours ran out: a fresh window
  // otherwise: first figure ever, or a different account: start counting from here
  cost.last = now;
  cost.acc[sid] = (cost.acc[sid] || 0) + step;
  turnUse[sid] = (turnUse[sid] || 0) + step;   // my111
  saveCost();
}

export function noteDoneText(sid, text) {
  if (!sid || !text || !text.includes('⟦DONE|')) return;
  for (const m of text.matchAll(DONE)) (pending[sid] = pending[sid] || []).push(costKey(m[1].split('|')));
}

export function finishTurn(sid) {
  // my111 (Michael 15 Nov): every turn's share of the 5-hour allowance goes to the Finished bar (only the last one is shown)
  if (sid) { broadcast({ type: 'turncost', sid, pct: Math.round((turnUse[sid] || 0) * 10) / 10 }); delete turnUse[sid]; }
  const keys = sid && pending[sid];
  if (!keys || !keys.length) return;
  delete pending[sid];
  const pct = Math.round(cost.acc[sid] || 0);
  cost.acc[sid] = 0;
  for (const k of keys) { cost.costs[k] = pct; broadcast({ type: 'jobcost', key: k, pct }); }
  const ks = Object.keys(cost.costs);
  if (ks.length > 400) for (const k of ks.slice(0, ks.length - 400)) delete cost.costs[k];
  const acc = Object.keys(cost.acc);
  if (acc.length > 200) for (const k of acc.slice(0, acc.length - 200)) delete cost.acc[k];
  saveCost();
}
export const jobCosts = () => cost.costs;

// ── H16 What's new (this list ships with the update itself) ─────────────────
const WHATS_NEW = {
  version: 'my111',
  items: [
    { t: 'Working bar always there', how: 'The working bar above the typing box now stays on the screen all the time. While I work it shows my progress; when I have finished it says Finished in green, with how long my last reply took and how much of your 5-hour allowance it used.' },
    { t: 'Replies stay one size', how: 'In Settings there is a new My replies text size. My replies stay at that size on the phone and tablet, and pinching no longer changes them. Pinching still changes your own messages. It starts at the size you have now.' },
    { t: 'No move while a question waits', how: 'A long chat no longer moves to a new one while a question of mine is waiting for you. haAi waits for your answer and my reply to it, then moves, taking the question and your answer along so the new chat just carries on.' },
    { t: 'Working bar on the TV', how: 'When you send a message from the phone or tablet, the TV now shows the working bar, my steps and Working too, until my reply is finished.' },
    { t: 'The real model by the typing box', how: 'Next to the typing box (and on the top line) haAi now shows the model and effort the chat is really on, for example Opus 5.5 · High, never Default (recommended).' },
    { t: 'Typing stays private until you send', how: 'On the TV your words no longer appear while you type on the phone or tablet. The TV just says Typing on the Phone (or Tablet), and your message shows once you press send.' },
    { t: 'Working bar lined up', how: 'The working bar above the typing box is now the same width as everything else.' },
    { t: 'No in-between lines while I work', how: 'While I am still working, the short lines I write part-way are hidden on every device. You see the progress bar and my steps, then only my final reply.' },
    { t: 'A short line when haAi moves you on', how: 'When a chat gets long and haAi moves you to a new one, you no longer see the long note it sends me. You just see one line: haAi moved to a new chat because the old one was long.' },
    { t: 'My working shows on the TV again', how: 'On the TV you can see my steps, my thinking and the progress bar all the time again, like on the phone and tablet.' },
    { t: 'Only my final reply shows', how: 'The short lines I write part-way through a job are now hidden on every device. You only see my final reply each time. The thin progress bar still shows what I am doing.' },
    { t: 'Reset times on the TV', how: 'The top line on the TV now also says when each account\'s 5-hour and Week allowance starts again, in UK time.' },
    { t: 'A quieter TV', how: 'On the TV haAi now shows only the chat. A question shows as one line, Question - Waiting For An Answer, and you answer it on the phone or tablet. The buttons under replies and your messages (Broke a rule, Explain it, Another way, speaker, star, Remember) and my working steps are gone from the TV. Phone and tablet keep them all.' },
    { t: 'A TV layout on the HA Shield', how: 'On the TV haAi now has no top buttons and one thin top line: the star stays still and everything else scrolls slowly across, including each account\'s 5-hour and Week allowance left. Reply buttons sit on one line, your messages go across the whole screen between the blue lines, and the text is grey. Phone and tablet are unchanged.' },
    { t: 'The star shows the connection', how: 'The green star fades slowly on and off while haAi is connected. If the connection is lost for 5 seconds it flashes red.' },
    { t: 'Account figures always up to date', how: 'haAi now renews an account\'s sign-in by itself when it runs out, so all 3 accounts are checked every 5 minutes, even one you have not used for days. The Accounts page shows the fresh figures on every device.' },
    { t: 'The model box clears everywhere', how: 'Pressing the cross on Using a different model, or answering a Suggestion, now clears it on every device, the TV included.' },
    { t: 'No more lost reports when you send a message mid-job', how: 'If you send a message while I am still working, haAi now tells me privately to start my next reply with a full report of what I had done and any question waiting, so you never get only "No response requested".' },
    { t: 'Long chats always move by themselves', how: 'A chat that grows past 150k now always moves to a fresh chat by itself, with no daily limit (before, it stopped after 20 moves a day). It also moves when the last reply was cut short. If a move ever fails, haAi tells you instead of keeping the long chat quietly.' },
    { t: 'Accounts never run out while another has room', how: 'haAi now checks each account\'s real figure before moving to it, allows for the bigger first reply after a move, and if an account ever hits its 5-hour limit it moves straight to an account with room and carries on there. It only waits for a reset when every account is full.' },
    { t: 'U decide left the menu', how: 'U decide is no longer in the menu. Use the waving hand just after the … button under the typing box instead. The blue I\'m back button still shows while you are away.' },
    { t: 'Lots to send, and a waving hand', how: 'Two new buttons just after the … button under the typing box. The stack is Lots to send: press it before you send lots of changes, and I work on each one quietly with no questions. It turns into a green Done; press Done and I ask all my questions at once. The waving hand is U decide, for when you are going away for a while.' },
    { t: 'U decide and I\'m back', how: 'When you are going away from haAi for a while, tap the waving hand. I then get on by myself, but only with jobs you have already said yes to, plus checks and tidy-ups. A blue I\'m back button shows above the typing box until you return. Tap it and I finish what I am on, then tell you what I did and what is waiting for you.' },
    { t: 'A Messages page', click: 'msgs-btn', how: 'Open the menu and tap Messages. It shows the messages Home Assistant sent to your phone and tablet in the last 7 days, grouped into Home, Health check, TV and Claude. It starts keeping them from this update on.' },
    { t: 'A Remember button on your messages', how: 'Under each message you send there is a small Remember button. Tap it and I file what you wrote in the right place in your notes. A green line then says where it went.' },
    { t: 'Now on TV at the top of the chat', how: 'When something is playing, a small line at the top of the chat says what it is. Tap it to ask me about it.' },
    { t: 'Old chats are packed at night', how: 'Every night at 3am, chats nobody has opened for 2 months are squeezed into a smaller file. They stay in History and Search, and open again as normal. The morning line says how many were packed.' },
  ],
};
export function getWhatsNew() {
  const s = readJson(SEEN, {});
  return s.seen === WHATS_NEW.version ? { items: null } : WHATS_NEW;
}
export function whatsNewSeen() {
  try { saveJson(SEEN, { seen: WHATS_NEW.version, at: Date.now() }); } catch (e) { log('WARN', `what's new save failed: ${e?.message || e}`); }
  broadcast({ type: 'whatsnew', items: null });
}

// ── H4 the slip log ──────────────────────────────────────────────────────────
export function ruleBroken(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  try { appendFileSync(RULE_LOG, `${ukNow()} UK | reply that broke a rule: ${t}\n`); } catch (e) { log('WARN', `rule log failed: ${e?.message || e}`); }
}

// ── H20 Quick jobs saved by Claude from the command line ─────────────────────
let quickMtime = null;
function quickTick() {
  let m = 0; try { m = statSync(QUICK).mtimeMs; } catch { m = 0; }   // 0 = no file yet (the starting list is in use)
  if (quickMtime === null) { quickMtime = m; return; }
  if (m !== quickMtime) { quickMtime = m; broadcast({ type: 'quick', ...getQuick() }); }
}
export function startMy74() { quickTick(); setInterval(quickTick, 4000).unref?.(); }

export function my74Prompt() {
  return [
    'BROKE A RULE (haAi): when Michael\'s message starts with "That broke a rule", find which of his rules the quoted reply broke (his rule files), then answer briefly with ⟦RULE|the rule, short, in his words|what the reply did wrong|the fix you suggest⟧ (Fix it / Not now buttons). haAi has already logged the slip in /config/opencode/broke-a-rule.log. When he says fix it, back up first, make the fix and log it.',
    'SAVE AS BUTTON (haAi): when he asks to save a finished job as a button, write a short recipe of the exact steps that worked (commands, entity ids, files, checks) so next time needs no exploring, then run exactly: node /opt/server/lib/savejob-cli.js "short button name, at most 24 characters" "Saved job: <recipe>. Follow these steps exactly, no exploring, then report in a few lines." If it prints OK, say in one plain line that it is in the Quick list (the lightning button). Never put passwords or keys in a recipe.',
  ].join(' ');
}
