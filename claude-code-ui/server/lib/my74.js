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
const pending = {};   // session id -> DONE keys seen in this turn
let saveTimer = null;
const saveCost = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { saveJson(COST, cost); } catch (e) { log('WARN', `job cost save failed: ${e?.message || e}`); } }, 2000); };

export function noteJobUsage(sid, unified) {
  const w = unified && unified.five_hour;
  if (!sid || !w || w.utilization == null) return;
  const used = w.utilization <= 1 ? w.utilization * 100 : Number(w.utilization);
  const now = { used, resetsAt: w.resetsAt || null };
  const last = cost.last;
  let step = 0;
  if (last && last.resetsAt === now.resetsAt) step = Math.max(0, used - last.used);
  else if (last && last.resetsAt && Date.now() / 1000 >= last.resetsAt) step = used;   // the old 5 hours ran out: a fresh window
  // otherwise: first figure ever, or a different account: start counting from here
  cost.last = now;
  cost.acc[sid] = (cost.acc[sid] || 0) + step;
  saveCost();
}

export function noteDoneText(sid, text) {
  if (!sid || !text || !text.includes('⟦DONE|')) return;
  for (const m of text.matchAll(DONE)) (pending[sid] = pending[sid] || []).push(costKey(m[1].split('|')));
}

export function finishTurn(sid) {
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
  version: 'my96',
  items: [
    { t: 'U decide and I\'m back', how: 'When you are going away from haAi for a while, open the menu and tap U decide. I then get on by myself, but only with jobs you have already said yes to, plus checks and tidy-ups. A blue I\'m back button shows above the typing box until you return. Tap it and I finish what I am on, then tell you what I did and what is waiting for you.' },
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
