/*
 * my122 (Michael 2026-11-15, REPLACES the 95% hold below): 75% is only a WARNING, never a stop. haAi still moves a chat between the
 * paid accounts by itself, but always to the one that keeps all saved accounts as equal as possible (5-hour AND 7-day left, and when each
 * resets). When EVERY account is at 75% or more it never moves or holds: it shows a red warning (cycle_warn) with all the figures
 * and a recommendation of which account to go over 75% on. No carry on / stop any more.
 * my90 (Michael 2026-11-13): all saved Claude Pro accounts (four since 2026-11-21) take turns by themselves.
 *  - The account whose 5-HOUR allowance resets soonest is used first (an account with no 5 hours running counts last).
 *  - my95 (Michael 2026-11-13): a reply is never stopped part-way just to move. Before each reply haAi checks whether
 *    the account would go past 95% during it (estimate = the most any of the last 5 replies used, at least 3%);
 *    if so the reply starts on the next soonest account instead. 95% is only the safety net while a reply runs.
 *  - If no account has room for the next reply, haAi STOPS and tells him; he picks Carry on or Wait.
 *  - Carry on lets the others go up to their limit, but the MAIN account never goes past 95% of its 5 hours.
 *  - Only the 5-hour allowance counts for this (his Q3 B); the weekly one is shown and forecast, not used to skip.
 *  - A pick in the Accounts menu is used first while it is under its limit.
 * Also keeps a small per-account usage history (/data/haai-usage-history.jsonl) for the weekly forecast
 * on the Accounts page ("at your current rate ... by Thursday at 5pm").
 * This file only decides; accounts.js and run-query.js act on it.
 */
import { appendFileSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';
import { log } from './log.js';

export const WARN_AT = 75;   // my122: the warning level (was a 95% hold)
export const SWITCH_AT = WARN_AT, MAIN_CAP = WARN_AT;
export const BALANCE_GAP = 25;   // cache-opt phase 2 (Michael 2026-11-20, was 10): a chat only moves for balance when another account is this many points less used (a move = cold cache)
export const BIG_CHAT_TOKENS = 45000;   // cache-opt phase 2: above this a chat never hops accounts before a reply (re-reading it on a cold cache costs too much)
export const HARD_STOP_AT = 95;
const MAIN_DEFAULT = 'thereades@gmail.com';
const STATE = path.join(DATA_DIR, 'haai-cycle.json');
const QUOTA = path.join(DATA_DIR, 'haai-quota.json');
const HIST = path.join(DATA_DIR, 'haai-usage-history.jsonl');
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const saveJson = (p, v) => { writeFileSync(p + '.tmp', JSON.stringify(v)); renameSync(p + '.tmp', p); };
const lc = (e) => String(e || '').toLowerCase();
/** my99: Claude always sends usage as a fraction (0.86 = 86%, 1.04 = 104%). The old "<= 1 ? x100 : as is" read 104% as 1.04%. */
export const pctOf = (u) => Number(u) * 100;
export const STALE_MS = 10 * 60 * 1000;   // my99: a figure older than this is never trusted for a move
export const MOVE_COST_DEFAULT = 20;      // my99: moving a long chat re-reads it all on the new account (86% -> 104% on 14 Nov)

// ── state: { carryOn, manual: {email, at}, stopped: {at, text}, costs: [% of 5 hours per reply] } ─────────────
export const cycleState = () => readJson(STATE) || {};
function setState(patch) {
  const s = { ...cycleState(), ...patch };
  try { saveJson(STATE, s); } catch (e) { log('WARN', `my90: state save failed: ${e?.message || e}`); }
  return s;
}
// ── my102 (Michael 2026-11-15): REST an account for a length of time. { "<email>": untilEpochMs } in /data/haai-rest.json.
// A rested account is never picked for a new reply (a reply already running finishes first). It ends by itself at the time; no setting beats it.
const REST = path.join(DATA_DIR, 'haai-rest.json');
export function restedMap() {
  const m = readJson(REST) || {}, now = Date.now(), out = {};
  for (const [e, t] of Object.entries(m)) if (Number(t) > now) out[lc(e)] = Number(t);
  return out;
}
export const isRested = (email) => !!restedMap()[lc(email)];
export function setRest(email, untilMs) {
  const m = restedMap();
  if (untilMs) m[lc(email)] = untilMs; else delete m[lc(email)];
  saveJson(REST, m);
  log('INFO', `my102: ${email} ${untilMs ? 'rested until ' + new Date(untilMs).toISOString() : 'rest cleared'}`);
  return m;
}
export const mainEmail = () => lc(readJson('/data/haai-prefs.json')?.mainAccount || MAIN_DEFAULT);
export const isMain = (email) => lc(email) === mainEmail();

/** 5-hour figures for an account: { used, resetsAt } (used 0 and resetsAt null once the 5 hours have run out). */
export function five(email, q = readJson(QUOTA) || {}) {
  const w = q[lc(email)]?.five_hour;
  if (!w || w.used == null) return { used: null, resetsAt: null };
  if (w.resetsAt && w.resetsAt * 1000 <= Date.now()) return { used: 0, resetsAt: null };
  return { used: Number(w.used), resetsAt: w.resetsAt || null };
}

/** my122: 7-day figures for an account: { used, resetsAt } (0 once the week has reset). */
export function week(email, q = readJson(QUOTA) || {}) {
  const w = q[lc(email)]?.seven_day;
  if (!w || w.used == null) return { used: null, resetsAt: null };
  if (w.resetsAt && w.resetsAt * 1000 <= Date.now()) return { used: 0, resetsAt: null };
  return { used: Number(w.used), resetsAt: w.resetsAt || null };
}
/** my122: how loaded an account is (the week counts a little more than the 5 hours; no week figure = the 5 hours alone). */
export const loadOf = (f, w) => (w.used == null ? (f.used ?? 0) : 0.6 * w.used + 0.4 * (f.used ?? 0));
/** my122: is this account at the warning level (5 hours or 7 days at 75% or more)? */
export const isHit = (email, q = readJson(QUOTA) || {}) => Math.max(five(email, q).used ?? 0, week(email, q).used ?? 0) >= WARN_AT;

/** my95: how much of the 5 hours the next reply may use: the most of the last 5 replies, at least 3%, at most 20%. */
export function nextReplyCost(st = cycleState()) {
  const c = (st.costs || []).slice(-5);
  return Math.min(20, Math.max(3, ...c));
}
/** my95: a reply finished; remember how much of the 5 hours it used. my99: a reply that was the first one after a move counts separately. */
export function recordReplyCost(pct, moved = false) {
  if (!(pct >= 0) || pct > 60) return;
  const st = cycleState();
  const v = Math.round(pct * 10) / 10;
  if (moved) setState({ moveCosts: [...(st.moveCosts || []), v].slice(-10) });
  else setState({ costs: [...(st.costs || []), v].slice(-10) });
}
/** my99: how much the FIRST reply after moving the chat to another account may use: the most of the last 5 moves, at least 20%, at most 40%. */
export function moveCost(st = cycleState()) {
  const c = (st.moveCosts || []).slice(-5);
  return Math.min(40, Math.max(MOVE_COST_DEFAULT, ...c));
}
/** my99: is this account's saved figure recent enough to decide on? */
export function isFresh(email, q = readJson(QUOTA) || {}) {
  const r = q[lc(email)];
  return !!(r && r.at && Date.now() - r.at < STALE_MS && r.five_hour && r.five_hour.used != null);
}

/** my122: the level an account is warned at (never a stop). */
export const limitFor = () => WARN_AT;

/**
 * Which saved account to use, or null when every one is at 75% or more (then only a warning is shown, nothing moves).
 * `exclude` = emails busy in other chats. my122: only accounts under 75% (5 hours AND 7 days) are used. His Accounts-menu pick comes
 * first. Otherwise the chat stays where it is unless another account is clearly less used (BALANCE_GAP points of load), then it goes to the
 * least loaded one (7-day and 5-hour use together; ties: the 5 hours that reset soonest). That keeps the accounts level with each other.
 */
export function chooseAccount(saved, exclude = new Set(), current = null) {
  const st = cycleState(), q = readJson(QUOTA) || {}, est = nextReplyCost(st), mv = Math.max(est, moveCost(st));
  const need = (a) => (current && lc(a.email) === lc(current) ? est : mv);
  const rested = restedMap();
  const under = saved.filter((a) => !exclude.has(a.email) && !rested[lc(a.email)])
    .map((a) => { const f = five(a.email, q), w = week(a.email, q); return { a, f, w, load: loadOf(f, w), fresh: f.used != null && (isFresh(a.email, q) || !!(current && lc(a.email) === lc(current))) }; })
    .filter((x) => (x.f.used ?? 0) < WARN_AT && (x.w.used ?? 0) < WARN_AT);
  // never move on a stale or unknown figure while an account with a fresh one has room
  const fresh = under.some((x) => x.fresh) ? under.filter((x) => x.fresh) : under;
  // prefer an account with room for the whole next reply under 75%; if none, any under 75% (going a little over is only a warning)
  const roomy = fresh.filter((x) => (x.f.used ?? 0) + need(x.a) < WARN_AT);
  const open = roomy.length ? roomy : fresh;
  if (!open.length) return null;
  if (st.manual?.email) { const m = open.find((x) => lc(x.a.email) === lc(st.manual.email)); if (m) return m.a; }
  open.sort((x, y) => x.load - y.load || (x.f.resetsAt || Infinity) - (y.f.resetsAt || Infinity));
  const cur = current && open.find((x) => lc(x.a.email) === lc(current));
  if (cur && cur.load <= open[0].load + BALANCE_GAP) return cur.a;   // level enough: a move costs a long re-read, so stay
  return open[0].a;
}

/**
 * cache-opt phase 2 (Michael 2026-11-20): a chat bigger than BIG_CHAT_TOKENS stays on its account for balance, unless that account has reached
 * the 95% hard stop (5 hours or 7 days). His own Accounts-menu pick (manual / pending) still wins. A refused reply still moves on (checkRun).
 */
export function holdBigChat(email, tokens) {
  if (!email || !(tokens > BIG_CHAT_TOKENS)) return false;
  const st = cycleState();
  if (st.manual?.email || st.pending?.email) return false;
  const q = readJson(QUOTA) || {};
  const f = five(email, q), w = week(email, q);
  if (f.used == null && w.used == null) return false;
  return (f.used ?? 0) < HARD_STOP_AT && (w.used ?? 0) < HARD_STOP_AT;
}

/** my123 (Michael 2026-11-15): he picked an account while haAi was busy: the switch happens right after the current turn. { id, email, at } */
export const getPending = () => cycleState().pending || null;
export const setPending = (p) => setState({ pending: p ? { id: p.id, email: p.email, at: Date.now() } : null });

/** He picked an account in the Accounts menu. */
export const setManual = (email) => setState({ manual: email ? { email, at: Date.now() } : null });

/** my122: Carry on / Wait no longer exist (there is no stop). Kept so an old page that still sends it does nothing. */
export function setCarryOn(on) {
  log('INFO', `my122: carry on ${on ? 'ON' : 'off'} ignored (75% is a warning only)`);
  return cycleState();
}

/** Called after every usage figure: forget an old Carry on / stop and a manual pick that has reached the warning level. */
export function tidyState(saved) {
  const st = cycleState(), q = readJson(QUOTA) || {};
  const patch = {};
  if (st.carryOn || st.stopped) { patch.carryOn = false; patch.stopped = null; }
  if (st.manual?.email && isHit(st.manual.email, q)) patch.manual = null;
  if (Object.keys(patch).length) setState(patch);
}

/**
 * A usage figure arrived for the account a running chat is on. my122: a reply is NEVER stopped part-way for a percentage.
 * Only when Claude itself refused the reply (the account is full) does the chat carry on with an account that is under 75%.
 * Returns null (carry on) or { move: account }.
 */
export function checkRun(email, used, saved, busy = new Set(), rejected = false) {
  if (!rejected) return null;
  const next = chooseAccount(saved, new Set([...busy, email])) || chooseAccount(saved.filter((a) => a.email !== email), new Set([email]));
  return next ? { move: next } : null;
}

/**
 * my122: when EVERY account is at 75% or more (5 hours or 7 days) this returns what the red warning shows:
 * { accounts: [{ name, email, five, fiveText, week, weekText }], recommend: index, why }, else null.
 * Nothing is ever moved because of it. Unknown figures never count as "at 75%".
 */
export function warnState(saved) {
  const q = readJson(QUOTA) || {};
  if (!saved || !saved.length) return null;
  const rows = saved.map((a, i) => ({ a, i, f: five(a.email, q), w: week(a.email, q) }));
  if (rows.some((r) => r.f.used == null && r.w.used == null)) return null;
  if (rows.some((r) => Math.max(r.f.used ?? 0, r.w.used ?? 0) < WARN_AT)) return null;
  const room = (r) => Math.min(100 - (r.f.used ?? 0), 100 - (r.w.used ?? 0));
  const best = [...rows].sort((x, y) => room(y) - room(x) || (x.f.resetsAt || Infinity) - (y.f.resetsAt || Infinity))[0];
  const r0 = (n) => (n == null ? 'unknown' : `${Math.round(n)}%`);
  return {
    accounts: rows.map((r) => ({ name: `Claude Pro Account ${r.i + 1}`, email: r.a.email, five: r.f.used, week: r.w.used,
      fiveText: r.f.resetsAt ? ukDay(r.f.resetsAt * 1000) : 'no 5 hours running', weekText: r.w.resetsAt ? ukDay(r.w.resetsAt * 1000) : 'unknown' })),
    recommend: best.i,
    why: `Claude Pro Account ${best.i + 1} has the most left (5 hours ${r0(best.f.used)} used, 7 days ${r0(best.w.used)} used).`,
  };
}
/** my122: the warning, but only once every 30 minutes (so it never nags); null when there is nothing to warn about or it was shown recently. */
export function takeWarning(saved, force = false) {
  const w = warnState(saved);
  if (!w) { if (cycleState().warnedAt) setState({ warnedAt: 0 }); return null; }   // under 75% again: the next time it shows at once
  const st = cycleState();
  if (!force && st.warnedAt && Date.now() - st.warnedAt < 30 * 60 * 1000) return null;
  setState({ warnedAt: Date.now() });
  return w;
}

// ── usage history and the weekly forecast ────────────────────────────────────
const lastRec = {};
export function recordUsage(email, fiveW, weekW) {
  if (!email || (!fiveW && !weekW)) return;
  if (Date.now() - (lastRec[lc(email)] || 0) < 120000) return;   // one reading every 2 minutes per account is plenty
  lastRec[lc(email)] = Date.now();
  try {
    try { if (statSync(HIST).size > 600000) trimHistory(); } catch { /* new file */ }
    appendFileSync(HIST, JSON.stringify({ t: Date.now(), e: lc(email), f: fiveW?.used ?? null, w: weekW?.used ?? null, wr: weekW?.resetsAt ?? null }) + '\n');
  } catch { /* not important */ }
}
function trimHistory() {
  const keep = Date.now() - 9 * 86400000;
  const lines = readFileSync(HIST, 'utf8').split('\n').filter((l) => { try { return JSON.parse(l).t >= keep; } catch { return false; } });
  writeFileSync(HIST, lines.join('\n') + (lines.length ? '\n' : ''));
}
const ukDay = (ms) => {
  const d = new Date(ms);
  const day = d.toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long' });
  const h = Number(d.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }));
  const m = d.toLocaleString('en-GB', { timeZone: 'Europe/London', minute: '2-digit' }).padStart(2, '0');
  const time = `${h % 12 || 12}${m !== '00' ? ':' + m : ''}${h < 12 ? 'am' : 'pm'}`;
  const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
  const which = d.toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
  return `${which === today ? 'today' : which === tomorrow ? 'tomorrow' : day} at ${time}`;
};

/** One plain sentence per account: when this week's allowance runs out at the rate of the last 3 days. */
export function forecasts() {
  let lines = [];
  try { lines = readFileSync(HIST, 'utf8').split('\n'); } catch { return {}; }
  const by = {};
  for (const l of lines) { try { const r = JSON.parse(l); if (r.w != null && r.wr) (by[r.e] = by[r.e] || []).push(r); } catch { /* skip */ } }
  const out = {}, now = Date.now();
  for (const [e, rows] of Object.entries(by)) {
    const last = rows[rows.length - 1];
    const reset = last.wr * 1000;
    if (reset <= now) continue;
    const win = rows.filter((r) => r.wr === last.wr && r.t >= now - 3 * 86400000);
    const first = win[0];
    const hours = (last.t - first.t) / 3600000;
    if (!first || hours < 12) { out[e] = 'Forecast: still collecting readings for this account (needs about half a day of use).'; continue; }
    const rate = (last.w - first.w) / (last.t - first.t);   // % per ms
    if (last.w >= 100) { out[e] = `This week's allowance is used up. It resets ${ukDay(reset)} (UK time).`; continue; }
    if (rate <= 0) { out[e] = `Forecast: no weekly use over the last ${Math.round(hours / 24) || 1} day(s), so it will not run out before it resets ${ukDay(reset)}.`; continue; }
    const full = last.t + (100 - last.w) / rate;
    const span = hours >= 48 ? 'few days' : hours >= 24 ? 'day or so' : 'hours';
    out[e] = full < reset
      ? `At your current rate of use over the last ${span} on this account, I predict you will use up all of this week's allowance by ${ukDay(full)} (UK time), before it resets ${ukDay(reset)}.`
      : `At your current rate of use over the last ${span}, this account will not run out this week: about ${Math.min(99, Math.round(last.w + rate * (reset - last.t)))}% used when it resets ${ukDay(reset)} (UK time).`;
  }
  return out;
}
