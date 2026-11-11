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
  version: 'my77',
  items: [
    { t: 'Up to three chats at once, all in one window', how: 'Tap the New chat icon (far right), then Open a 2nd chat or Open a 3rd chat. Each chat has its own colour box: Purple, Gold and Teal.', click: 'new-session-btn' },
    { t: 'Colour buttons above the typing box choose where your message goes', how: 'Tap a colour to send your next message to that chat. Tap it again to see only that chat. All shows every chat again.' },
    { t: 'Tabs under the top bar show each chat', how: 'Each tab shows the job name, Working (blue), Needs you (red) or Finished (green), its account and what it has used so far.' },
    { t: 'The phone message says which chat it is from', how: 'Its title starts with the chat name, for example Chat 2 (Gold), in that chat\'s colour.' },
    { t: 'Close a finished chat', how: 'Tap the small x at the top right of its tab. It stays in Sessions if you want it back.' },
    { t: 'Each chat keeps its own account', how: 'A new chat takes the account with the most allowance left. A finished chat folds into Previous chats after 30 minutes.' },
    { t: 'A grey chat on a free account', how: 'In the New chat list, Open a chat on a free account. No health, home security, money or passwords there: those stay in your Claude chats.' },
    { t: 'Clash guard', how: 'If a chat is about to change a file another chat changed in the last 10 minutes, it stops and asks you first.' },
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
