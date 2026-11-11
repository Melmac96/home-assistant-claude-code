/*
 * my40: five extras the user picked on 2026-11-08 (test page five-extras-looks.html):
 *  - Starred replies (look C): kept in haAi's own /data, shared by every device.
 *  - Refresh screens (quick replies, look C): reloads both Shields through Home Assistant.
 *  - Accounts quota: 5-hour and weekly use for EACH saved paid account. Live from Anthropic with
 *    that account's saved sign-in while its key is still fresh; otherwise the last figures seen.
 *    It never renews a saved sign-in (that would change it), and never sends a token to the page.
 *  - haAi phone app: the newest published version (www/claude/haai-latest.json) for Settings.
 *  - Chat length: the last context figure, so the strip survives a page reload.
 */
import { readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { CLAUDE_CONFIG_DIR, DATA_DIR, SUPERVISOR_URL } from './config.js';
import { currentIdentity } from './accounts.js';
import { log } from './log.js';

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
const CACHE_MS = 60 * 1000;
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
  if (!res.ok) throw new Error(`Anthropic answered ${res.status}`);
  const j = await res.json();
  return { five_hour: toWin(j.five_hour), seven_day: toWin(j.seven_day) };
}

export async function getQuota(force = false) {
  const store = readJson(QUOTA) || {};
  if (!force && Date.now() - lastFetch < CACHE_MS) return { accounts: store };
  lastFetch = Date.now();
  const cur = currentIdentity();
  let files = [];
  try { files = readdirSync(ACC_DIR).filter((f) => f.endsWith('.json')); } catch { /* none saved */ }
  for (const f of files) {
    const a = readJson(path.join(ACC_DIR, f));
    if (!a || !a.email) continue;
    const active = !!cur && cur.email === a.email;
    // The account in use: the live sign-in (Claude keeps it fresh). Others: their saved copy.
    const credText = active ? (() => { try { return readFileSync(path.join(CLAUDE_CONFIG_DIR, '.credentials.json'), 'utf8'); } catch { return a.credentials; } })() : a.credentials;
    let oauth = null;
    try { oauth = JSON.parse(credText).claudeAiOauth; } catch { /* unreadable */ }
    const key = a.email.toLowerCase();
    if (!oauth || !oauth.accessToken || !(Number(oauth.expiresAt) > Date.now() + 60000)) {
      if (store[key]) store[key].live = false;
      continue;   // key too old to use without renewing it: keep the last figures seen
    }
    if (!force && restUntil[key] > Date.now()) { if (store[key]) store[key].live = false; continue; }
    try {
      store[key] = { ...(await fetchUsage(oauth.accessToken)), at: Date.now(), live: true };
      delete restUntil[key];
    } catch (e) {
      if (e?.status === 429) restUntil[key] = Date.now() + BACKOFF_MS;
      log('WARN', `quota for ${key.split('@')[0]}: ${e?.message || e}${e?.status === 429 ? ' - resting it for 30 min' : ''}`);
      if (store[key]) store[key].live = false;
    }
  }
  try { writeJson(QUOTA, store); } catch (e) { log('WARN', `quota save failed: ${e?.message || e}`); }
  return { accounts: store };
}

/** The account in use: a usage update from the chat itself also counts as "seen". */
export function noteUsage(unified) {
  const cur = currentIdentity();
  if (!cur || !unified) return;
  const w = (x) => (x && x.utilization != null ? { used: Math.round(x.utilization <= 1 ? x.utilization * 100 : x.utilization), resetsAt: x.resetsAt || null } : null);
  const store = readJson(QUOTA) || {};
  const key = cur.email.toLowerCase();
  store[key] = { five_hour: w(unified.five_hour) || store[key]?.five_hour || null, seven_day: w(unified.seven_day) || store[key]?.seven_day || null, at: Date.now(), live: true };
  try { writeJson(QUOTA, store); } catch { /* not important */ }
}

// ── haAi phone app: newest published version ────────────────────────────────
export function appLatest() {
  const j = readJson('/config/www/claude/haai-latest.json');
  return j && j.versionCode ? { versionCode: Number(j.versionCode), url: String(j.url || ''), notes: String(j.notes || '') } : null;
}
