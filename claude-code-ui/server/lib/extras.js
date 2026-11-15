/*
 * my40: five extras the user picked on 2026-11-08 (test page five-extras-looks.html):
 *  - Starred replies (look C): kept in haAi's own /data, shared by every device.
 *  - Refresh screens (quick replies, look C): reloads both Shields through Home Assistant.
 *  - Accounts quota: 5-hour and weekly use for EACH saved paid account. Live from Anthropic with
 *    that account's saved sign-in while its key is still fresh; otherwise the last figures seen.
 *    my104 (Michael 15 Nov, Q1 A): a saved sign-in that has run out is now RENEWED by haAi (backed up first),
 *    so every account is checked even when not used for days. Never sends a token to the page.
 *  - haAi phone app: the newest published version (www/claude/haai-latest.json) for Settings.
 *  - Chat length: the last context figure, so the strip survives a page reload.
 */
import { readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync, unlinkSync, chmodSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { CLAUDE_CONFIG_DIR, DATA_DIR, SUPERVISOR_URL } from './config.js';
import { currentIdentity, saveCurrent } from './accounts.js';
import { anyRunning, runningChats } from './chats.js';   // my104
import { broadcast } from './broadcast.js';   // my104
import { log } from './log.js';
import { recordUsage, forecasts, cycleState, pctOf, STALE_MS } from './my90.js';   // my90, my99

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const writeJson = (p, v) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p + '.tmp', JSON.stringify(v)); renameSync(p + '.tmp', p); };

// ── Starred replies ──────────────────────────────────────────────────────────
const STARS = path.join(DATA_DIR, 'haai-stars.json');
const MAX_STARS = 300;
export const starId = (text) => createHash('sha1').update(String(text)).digest('hex').slice(0, 16);
export function listStars() { const l = readJson(STARS); return Array.isArray(l) ? l : []; }
export function addStar(msg, sid) {
  const text = String(msg.text || '').trim().slice(0, 60000);
  if (!text) return listStars();
  const id = /^[a-z0-9-]{1,24}$/.test(String(msg.id || '')) ? String(msg.id) : starId(text);   // the page's own id, so it can match
  const l = listStars().filter((s) => s.id !== id);
  l.unshift({ id, text, ts: Number(msg.ts) || Date.now(), starredAt: Date.now(), sid: sid || null });
  writeJson(STARS, l.slice(0, MAX_STARS));
  return listStars();
}
export function removeStar(id) {
  writeJson(STARS, listStars().filter((s) => s.id !== String(id)));
  return listStars();
}

// ── Refresh screens (the house rule's two Shields) ───────────────────────────
const SHIELDS = ['browser_mod_48c2d0c1_ce22991f', 'browser_mod_cbb8ede4_7cc6e67f'];
export async function refreshScreens() {
  try {
    const res = await fetch(`${SUPERVISOR_URL}/core/api/services/browser_mod/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ browser_id: SHIELDS }),
    });
    if (!res.ok) throw new Error(`Home Assistant answered ${res.status}`);
    log('INFO', 'refresh screens: both Shields asked to reload');
    return { ok: true, text: 'Both Shields told to reload' };
  } catch (e) {
    log('WARN', `refresh screens failed: ${e?.message || e}`);
    return { ok: false, text: 'I could not refresh your Shields' };
  }
}

// ── Accounts quota ───────────────────────────────────────────────────────────
const QUOTA = path.join(DATA_DIR, 'haai-quota.json');
const ACC_DIR = path.join(DATA_DIR, 'claude-accounts');
const CACHE_MS = 5 * 60 * 1000;   // my80: ask Anthropic every 5 min, not every minute (it answered 429 about 220 times in 2 days)
let lastFetch = 0;
const BACKOFF_MS = 30 * 60 * 1000;   // after Anthropic says "too many requests", leave that account alone this long
const restUntil = {};

const toWin = (w) => (w && w.utilization != null
  ? { used: Math.max(0, Math.min(100, Math.round(Number(w.utilization)))), resetsAt: w.resets_at ? Math.round(Date.parse(w.resets_at) / 1000) : null }
  : null);

async function fetchUsage(token) {
  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) { const err = new Error(`Anthropic answered ${res.status}`); err.status = res.status; throw err; }   // my80: status kept, so the 30-min rest after a 429 really happens
  const j = await res.json();
  return { five_hour: toWin(j.five_hour), seven_day: toWin(j.seven_day) };
}


// ── my104: renew a sign-in that has run out, so an account not used for a while is still checked ────────────
// Same request Claude itself makes (platform.claude.com/v1/oauth/token, refresh_token). The answer gives a NEW
// refresh key and the old one stops working, so the new one is saved at once (old copy backed up first, last 3 kept).
// Never for a sign-in a running chat is using: Claude renews those itself, and two renewals would clash.
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const RENEW_BACKUPS = path.join(ACC_DIR, 'backups');
const renewFailUntil = {};
const writePriv = (p, text) => { mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 }); writeFileSync(p + '.tmp', text, { mode: 0o600 }); chmodSync(p + '.tmp', 0o600); renameSync(p + '.tmp', p); };
const needsRenew = (o) => !!(o && o.refreshToken && !(Number(o.expiresAt) > Date.now() + 5 * 60000));

function backupCred(key, text) {
  try {
    mkdirSync(RENEW_BACKUPS, { recursive: true, mode: 0o700 });
    const tag = key.replace(/[^a-z0-9._-]/g, '_');
    writePriv(path.join(RENEW_BACKUPS, `renew-${tag}-${Date.now()}.json`), text);
    const old = readdirSync(RENEW_BACKUPS).filter((f) => f.startsWith(`renew-${tag}-`)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 3))) unlinkSync(path.join(RENEW_BACKUPS, f));
  } catch (e) { log('WARN', `my104: backup before renewing failed: ${e?.message || e}`); throw e; }
}

async function renewCred(credText) {
  const cred = JSON.parse(credText); const o = cred.claudeAiOauth;
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: o.refreshToken, client_id: CLIENT_ID, scope: (o.scopes || []).join(' ') }),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status !== 200) { const err = new Error(`renewal answered ${res.status}`); err.status = res.status; throw err; }
  const j = await res.json();
  if (!j.access_token || !j.expires_in) throw new Error('renewal answer had no new key');
  o.accessToken = j.access_token;
  if (j.refresh_token) o.refreshToken = j.refresh_token;
  o.expiresAt = Date.now() + Number(j.expires_in) * 1000;
  if (j.refresh_token_expires_in) o.refreshTokenExpiresAt = Date.now() + Number(j.refresh_token_expires_in) * 1000;
  return JSON.stringify(cred);
}

/** The usable sign-in for one saved account, renewed first if it has run out (and it is safe to). null = cannot check now. */
async function usableOauth(a, file, active) {
  const key = a.email.toLowerCase();
  let credText = active ? (() => { try { return readFileSync(path.join(CLAUDE_CONFIG_DIR, '.credentials.json'), 'utf8'); } catch { return a.credentials; } })() : a.credentials;
  let oauth = null;
  try { oauth = JSON.parse(credText).claudeAiOauth; } catch { return null; }
  if (!oauth || !oauth.accessToken) return null;
  if (!needsRenew(oauth)) return oauth;
  if (renewFailUntil[key] > Date.now()) return null;
  // in use right now: the live sign-in while any chat works, or a chat running on this account's own copy
  if (active ? anyRunning() : runningChats().some((s) => (s.account || '').toLowerCase() === key)) return null;
  try {
    backupCred(key, credText);
    const fresh = await renewCred(credText);
    if (active) { writePriv(path.join(CLAUDE_CONFIG_DIR, '.credentials.json'), fresh); try { saveCurrent(); } catch { /* saved copy follows on next switch */ } }
    else { const cur = readJson(file) || a; cur.credentials = fresh; cur.savedAt = new Date().toISOString(); writePriv(file, JSON.stringify(cur)); }
    log('INFO', `my104: renewed the sign-in for ${key.split('@')[0]}`);
    return JSON.parse(fresh).claudeAiOauth;
  } catch (e) {
    renewFailUntil[key] = Date.now() + 30 * 60000;   // do not hammer it; try again in 30 min
    log('WARN', `my104: could not renew the sign-in for ${key.split('@')[0]}: ${e?.message || e}`);
    return null;
  }
}

export async function getQuota(force = false) {
  const store = readJson(QUOTA) || {};
  if (!force && Date.now() - lastFetch < CACHE_MS) return withForecast(store);
  lastFetch = Date.now();
  const cur = currentIdentity();
  let files = [];
  try { files = readdirSync(ACC_DIR).filter((f) => f.endsWith('.json')); } catch { /* none saved */ }
  for (const f of files) {
    const a = readJson(path.join(ACC_DIR, f));
    if (!a || !a.email) continue;
    const active = !!cur && cur.email === a.email;
    // The account in use: the live sign-in (Claude keeps it fresh). Others: their saved copy.
    const key = a.email.toLowerCase();
    if (!force && restUntil[key] > Date.now()) { if (store[key]) store[key].live = false; continue; }
    const oauth = await usableOauth(a, path.join(ACC_DIR, f), active);   // my104: renewed first if it has run out
    if (!oauth) { if (store[key]) store[key].live = false; continue; }   // cannot check now: keep the last figures seen
    try {
      store[key] = { ...(await fetchUsage(oauth.accessToken)), at: Date.now(), live: true };
      recordUsage(key, store[key].five_hour, store[key].seven_day);   // my90
      delete restUntil[key];
    } catch (e) {
      if (e?.status === 429) restUntil[key] = Date.now() + BACKOFF_MS;
      log('WARN', `quota for ${key.split('@')[0]}: ${e?.message || e}${e?.status === 429 ? ' - resting it for 30 min' : ''}`);
      if (store[key]) store[key].live = false;
    }
  }
  try { writeJson(QUOTA, store); } catch (e) { log('WARN', `quota save failed: ${e?.message || e}`); }
  return withForecast(store);
}

/**
 * my99 (Michael 14 Nov: "never break it, ever"): before haAi decides which account a reply runs on, every account
 * whose figure is older than 10 minutes is checked live with Anthropic, so a move is never made on an old figure.
 */
export async function freshenQuota() {
  const store = readJson(QUOTA) || {};
  const cur = currentIdentity();
  let files = [];
  try { files = readdirSync(ACC_DIR).filter((f) => f.endsWith('.json')); } catch { return; }
  let changed = false;
  for (const f of files) {
    const a = readJson(path.join(ACC_DIR, f));
    if (!a || !a.email) continue;
    const key = a.email.toLowerCase();
    if (store[key]?.at && Date.now() - store[key].at < STALE_MS) continue;
    if (restUntil[key] > Date.now()) continue;
    const active = !!cur && cur.email === a.email;
    const oauth = await usableOauth(a, path.join(ACC_DIR, f), active);   // my104
    if (!oauth) continue;
    try {
      store[key] = { ...(await fetchUsage(oauth.accessToken)), at: Date.now(), live: true };
      recordUsage(key, store[key].five_hour, store[key].seven_day);
      changed = true;
      log('INFO', `my99: fresh figure for ${key.split('@')[0]}: ${store[key].five_hour?.used ?? '?'}% of 5 hours`);
    } catch (e) {
      if (e?.status === 429) restUntil[key] = Date.now() + BACKOFF_MS;
      log('WARN', `my99: could not check ${key.split('@')[0]} live: ${e?.message || e}`);
    }
  }
  if (changed) try { writeJson(QUOTA, store); } catch { /* not important */ }
}

/** my99: keep every account's figure fresh in the background (every 5 minutes, the rate Anthropic allows). */
// my104: every screen gets the new figures straight away (TV info line, Accounts page), not only when it asks.
export function startQuotaKeeper() {
  setInterval(() => { getQuota(false).then((q) => broadcast({ type: 'quota', ...q })).catch(() => {}); }, CACHE_MS + 5000).unref?.();
}

/** my90: the weekly forecast sentence for each account, and the cycle state (Carry on / stopped), go out with the figures. */
function withForecast(store) {
  const f = forecasts(), st = cycleState();
  const accounts = {};
  for (const [k, v] of Object.entries(store)) accounts[k] = { ...v, forecast: f[k] || null };
  return { accounts, cycle: { carryOn: !!st.carryOn, stopped: st.stopped || null } };
}

/** The account in use: a usage update from the chat itself also counts as "seen". */
export function noteUsage(unified, email = null) {
  const cur = email ? { email } : currentIdentity();   // my77: a chat on another account reports for THAT account
  if (!cur || !cur.email || !unified) return;
  const w = (x) => (x && x.utilization != null ? { used: Math.round(pctOf(x.utilization)), resetsAt: x.resetsAt || null } : null);
  const store = readJson(QUOTA) || {};
  const key = cur.email.toLowerCase();
  store[key] = { five_hour: w(unified.five_hour) || store[key]?.five_hour || null, seven_day: w(unified.seven_day) || store[key]?.seven_day || null, at: Date.now(), live: true };
  try { writeJson(QUOTA, store); } catch { /* not important */ }
  recordUsage(key, store[key].five_hour, store[key].seven_day);   // my90
}

// ── haAi phone app: newest published version ────────────────────────────────
export function appLatest() {
  const j = readJson('/config/www/claude/haai-latest.json');
  return j && j.versionCode ? { versionCode: Number(j.versionCode), url: String(j.url || ''), notes: String(j.notes || '') } : null;
}
