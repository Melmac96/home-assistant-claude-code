/*
 * my90 (Michael 2026-11-13): the three Claude Pro accounts take turns by themselves.
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

export const SWITCH_AT = 95, MAIN_CAP = 95;   // my95: was 90 (stopped replies part-way)
const MAIN_DEFAULT = 'thereades@gmail.com';
const STATE = path.join(DATA_DIR, 'haai-cycle.json');
const QUOTA = path.join(DATA_DIR, 'haai-quota.json');
const HIST = path.join(DATA_DIR, 'haai-usage-history.jsonl');
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const saveJson = (p, v) => { writeFileSync(p + '.tmp', JSON.stringify(v)); renameSync(p + '.tmp', p); };
const lc = (e) => String(e || '').toLowerCase();

// ── state: { carryOn, manual: {email, at}, stopped: {at, text}, costs: [% of 5 hours per reply] } ─────────────
export const cycleState = () => readJson(STATE) || {};
function setState(patch) {
  const s = { ...cycleState(), ...patch };
  try { saveJson(STATE, s); } catch (e) { log('WARN', `my90: state save failed: ${e?.message || e}`); }
  return s;
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

/** my95: how much of the 5 hours the next reply may use: the most of the last 5 replies, at least 3%, at most 20%. */
export function nextReplyCost(st = cycleState()) {
  const c = (st.costs || []).slice(-5);
  return Math.min(20, Math.max(3, ...c));
}
/** my95: a reply finished; remember how much of the 5 hours it used. */
export function recordReplyCost(pct) {
  if (!(pct >= 0) || pct > 60) return;
  const st = cycleState();
  setState({ costs: [...(st.costs || []), Math.round(pct * 10) / 10].slice(-10) });
}

/** The most of its 5 hours an account may use right now. */
export function limitFor(email, st = cycleState()) {
  if (isMain(email)) return st.carryOn ? MAIN_CAP : SWITCH_AT;
  return st.carryOn ? 100 : SWITCH_AT;
}

/**
 * Which saved account to use, or null when every one is at its limit. `exclude` = emails busy in other chats.
 * Order: his Accounts-menu pick (while under its limit), then the 5 hours that reset soonest, then the least used.
 */
export function chooseAccount(saved, exclude = new Set()) {
  const st = cycleState(), q = readJson(QUOTA) || {}, est = nextReplyCost(st);
  // my95: only an account with room for the whole next reply before its limit
  const open = saved.filter((a) => !exclude.has(a.email)).map((a) => ({ a, f: five(a.email, q) }))
    .filter((x) => (x.f.used ?? 0) + est < limitFor(x.a.email, st));
  if (!open.length) return null;
  if (st.manual?.email) { const m = open.find((x) => lc(x.a.email) === lc(st.manual.email)); if (m) return m.a; }
  open.sort((x, y) => (x.f.resetsAt || Infinity) - (y.f.resetsAt || Infinity) || (x.f.used ?? 0) - (y.f.used ?? 0));
  return open[0].a;
}

/** He picked an account in the Accounts menu. */
export const setManual = (email) => setState({ manual: email ? { email, at: Date.now() } : null });

/** He chose Carry on after a stop (or Wait = false). Carry on lasts until some account has room again at 90%. */
export function setCarryOn(on) {
  log('INFO', `my90: carry on ${on ? 'ON (main stops at 95%)' : 'off'}`);
  return setState({ carryOn: !!on, stopped: on ? null : cycleState().stopped });
}

/** Called after every usage figure: forget Carry on / a stale manual pick / the stop once they no longer apply. */
export function tidyState(saved) {
  const st = cycleState(), q = readJson(QUOTA) || {};
  const patch = {};
  const est = nextReplyCost(st);
  if ((st.carryOn || st.stopped) && saved.some((a) => (five(a.email, q).used ?? 0) + est < SWITCH_AT)) { patch.carryOn = false; patch.stopped = null; }
  if (st.manual?.email && (five(st.manual.email, q).used ?? 0) + est >= limitFor(st.manual.email, { ...st, ...patch })) patch.manual = null;
  if (Object.keys(patch).length) setState(patch);
}

/**
 * A usage figure arrived for the account a running chat is on. Returns null (carry on),
 * { move: account } (stop this reply now and carry on with that account) or { stop: text }.
 */
export function checkRun(email, used, saved, busy = new Set()) {
  if (used == null || used < limitFor(email)) return null;
  const next = chooseAccount(saved, new Set([...busy, email])) || chooseAccount(saved.filter((a) => a.email !== email));
  if (next) return { move: next };
  const st = cycleState();
  const text = isMain(email) && st.carryOn
    ? `Your main account has reached ${Math.round(used)}% of its 5 hours. haAi stopped here so you always keep some of it. Wait for an account to reset.`
    : `All your Claude accounts are close to ${SWITCH_AT}% of their 5 hours, so haAi has stopped. Carry on, or wait for one to reset.`;
  setState({ stopped: { at: Date.now(), text } });
  return { stop: text };
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
