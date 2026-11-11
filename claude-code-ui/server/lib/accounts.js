/*
 * My Claude Code UI: saved Claude sign-ins and switching between them.
 *
 * Each saved account is one private file in /data/claude-accounts holding that
 * account's credentials plus its identity block (email, name) from
 * ~/.claude.json, so a switch swaps both and the two never disagree. Tokens are
 * never sent to the browser and never logged; the browser only ever sees the
 * email and display name. Before any switch the live sign-in is backed up.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, readdirSync, unlinkSync, symlinkSync, lstatSync, rmSync } from 'fs';
import path from 'path';
import { spawnSync, execFile } from 'child_process';
import { CLAUDE_CONFIG_DIR, DATA_DIR } from './config.js';
import { log } from './log.js';

const DIR = path.join(DATA_DIR, 'claude-accounts');
const BACKUPS = path.join(DIR, 'backups');
const LIVE = () => path.join(CLAUDE_CONFIG_DIR, '.credentials.json');
const IDENT = () => path.join(process.env.HOME || path.join(DATA_DIR, 'home'), '.claude.json');

// my16: Free (OpenRouter) / Paid (Claude) mode, a third choice next to the saved accounts. The switching itself is done by the
// house tool openrouter_switch.py (the same one the dashboard button and the 'free mode' / 'paid mode' phrases use), so the
// Home Assistant helper, the chat settings and the lighter rules all stay in step. It never touches the Claude sign-in.
const SWITCH = '/config/opencode/tools/openrouter_switch.py';
const SETTINGS = () => path.join(CLAUDE_CONFIG_DIR, 'settings.json');
const KEYFILE = () => path.join(CLAUDE_CONFIG_DIR, 'openrouter.key');

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const slug = (email) => email.toLowerCase().replace(/[^a-z0-9._-]+/g, '_');
const writePrivate = (p, text) => {
  const tmp = p + '.tmp';
  writeFileSync(tmp, text, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, p);
};

/** Who the live sign-in belongs to, or null (signed out / API key). */
export function currentIdentity() {
  const o = readJson(IDENT())?.oauthAccount;
  return o && o.emailAddress ? { email: o.emailAddress, displayName: o.displayName || '' } : null;
}

/** Save (or refresh) the live sign-in as a saved account. Returns the identity or null. */
export function saveCurrent() {
  const who = currentIdentity();
  if (!who || !existsSync(LIVE())) return null;
  mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const oauthAccount = readJson(IDENT()).oauthAccount;
  const credentials = readFileSync(LIVE(), 'utf8');
  writePrivate(path.join(DIR, slug(who.email) + '.json'),
    JSON.stringify({ email: who.email, displayName: who.displayName, oauthAccount, credentials,
      savedAt: new Date().toISOString() }));
  return who;
}

/** Which mode the chat settings are in. Never includes the key itself. */
export function modeState() {
  const env = readJson(SETTINGS())?.env || {};
  // my17: any free provider counts (OR_PROVIDER is written by openrouter_switch.py), not just OpenRouter's address.
  const free = !!env.OR_PROVIDER || String(env.ANTHROPIC_BASE_URL || '').startsWith('https://openrouter.ai');
  const pool = readJson(path.join(CLAUDE_CONFIG_DIR, 'openrouter-models.json'))?.models || [];
  return { free, provider: env.OR_PROVIDER || (free ? 'openrouter' : ''), model: free ? (env.ANTHROPIC_MODEL || '') : '',
           hasKey: existsSync(KEYFILE()) && existsSync(SWITCH),
           pool: pool.slice(0, 40).map((m) => ({ id: m.id, context: m.context || 0 })) };
}

/** my17: the model to use for every new prompt while Free mode is on, so a model chosen mid-chat (from the menu, or by the
 *  model advisor running 'openrouter_switch.py setmodel') applies to the NEXT message of the SAME chat. Null in Paid mode. */
export function freeModelOverride() {
  const env = readJson(SETTINGS())?.env || {};
  return env.OR_PROVIDER && env.ANTHROPIC_MODEL ? env.ANTHROPIC_MODEL : null;
}

/** my17: choose a free model from the live pool. Returns { ok, model } or { ok:false, error }. */
export function setFreeModel(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._:\/-]{3,120}$/.test(id)) return { ok: false, error: 'That model name is not valid.' };
  if (!modeState().free) return { ok: false, error: 'Free mode is not on.' };
  try {
    const r = spawnSync('python3', ['-I', SWITCH, 'setmodel', id], { encoding: 'utf8', timeout: 25000, env: process.env });
    if (r.status !== 0) { log('ERROR', `setmodel failed: ${(r.stderr || r.stdout || '').trim()}`); return { ok: false, error: 'That model is not on the free list right now. Nothing was changed.' }; }
    log('INFO', `free model set to ${id}`);
    return { ok: true, model: id };
  } catch (e) {
    log('ERROR', `setmodel failed: ${e?.message || e}`);
    return { ok: false, error: 'The model change did not work. Nothing was changed.' };
  }
}

/** Switch to Free (true) or Paid (false). Returns { ok, free } or { ok:false, error }. */
export function setMode(free) {
  if (free && !modeState().hasKey) return { ok: false, error: 'No OpenRouter key is saved yet.' };
  try {
    const r = spawnSync('python3', ['-I', SWITCH, free ? 'on' : 'off'], { encoding: 'utf8', timeout: 20000, env: process.env });
    if (r.status !== 0) { log('ERROR', `mode switch failed: ${(r.stderr || r.stdout || '').trim()}`); return { ok: false, error: 'The mode switch did not work. Nothing was changed.' }; }
    log('INFO', `mode switched to ${free ? 'free' : 'paid'}`);
    return { ok: true, free: !!free, mode: true };
  } catch (e) {
    log('ERROR', `mode switch failed: ${e?.message || e}`);
    return { ok: false, error: 'The mode switch did not work. Nothing was changed.' };
  }
}

/** What the browser may see: emails and which one is signed in now. */
export function listAccounts() {
  const cur = currentIdentity();
  const saved = [];
  try {
    for (const f of readdirSync(DIR)) {
      if (!f.endsWith('.json') || f.length <= 5) continue;   // my77: never a nameless file
      const a = readJson(path.join(DIR, f));
      if (a && a.email) saved.push({ id: f.slice(0, -5), email: a.email, displayName: a.displayName || '',
        active: !!cur && cur.email === a.email });
    }
  } catch { /* nothing saved yet */ }
  saved.sort((a, b) => a.email.localeCompare(b.email));
  return { current: cur, saved, mode: modeState() };
}

/** Switch the live sign-in to a saved account. Returns { ok, error? }. */
export function switchTo(id) {
  if (typeof id !== 'string' || !/^[a-z0-9._@-]+$/.test(id)) return { ok: false, error: 'Unknown account.' };
  const target = readJson(path.join(DIR, id + '.json'));
  if (!target || !target.credentials || !target.oauthAccount) return { ok: false, error: 'That account is not saved.' };
  const cur = currentIdentity();
  if (cur && cur.email === target.email) return { ok: true, same: true };
  try {
    saveCurrent();   // keep the one we leave fresh
    mkdirSync(BACKUPS, { recursive: true, mode: 0o700 });
    if (existsSync(LIVE())) {
      writePrivate(path.join(BACKUPS, `live-${Date.now()}.json`), readFileSync(LIVE(), 'utf8'));
      const old = readdirSync(BACKUPS).filter((f) => f.startsWith('live-')).sort();
      for (const f of old.slice(0, Math.max(0, old.length - 5))) unlinkSync(path.join(BACKUPS, f));
    }
    const ident = readJson(IDENT()) || {};
    ident.oauthAccount = target.oauthAccount;
    writePrivate(IDENT(), JSON.stringify(ident));
    writePrivate(LIVE(), target.credentials);
    log('INFO', `account switched to ${target.email}`);
    return { ok: true };
  } catch (e) {
    log('ERROR', `account switch failed: ${e?.message || e}`);
    return { ok: false, error: 'The switch failed. Your previous sign-in is backed up.' };
  }
}

/** my25: per-provider usage lines for the Accounts menu (tools/provider_stats.py: translator usage log, OpenRouter credit, rate-limit headers). */
const STATS = '/config/opencode/tools/provider_stats.py';
export function providerStats(cb) {
  execFile('python3', ['-I', STATS], { encoding: 'utf8', timeout: 60000, maxBuffer: 1 << 20 }, (err, out) => {
    if (err) { log('ERROR', `provider stats failed: ${err.message}`); return cb({ providers: [], error: 'Could not read the usage figures just now.' }); }
    try { cb(JSON.parse(out)); } catch { cb({ providers: [], error: 'Could not read the usage figures just now.' }); }
  });
}

/** my25: pick which provider Free mode uses for the NEXT new chat. Only while Free mode is on. */
export function useProvider(id) {
  if (typeof id !== 'string' || !/^[a-z0-9]{2,20}$/.test(id)) return { ok: false, error: 'That provider name is not valid.' };
  if (!modeState().free) return { ok: false, error: 'Free mode is not on. Switch to Free models first.' };
  try {
    const r = spawnSync('python3', ['-I', SWITCH, 'useprovider', id], { encoding: 'utf8', timeout: 25000, env: process.env });
    if (r.status !== 0) { log('ERROR', `useprovider failed: ${(r.stderr || r.stdout || '').trim()}`); return { ok: false, error: 'That provider is not ready, so nothing was changed.' }; }
    log('INFO', `free provider set to ${id}`);
    return { ok: true, providerSet: true, provider: id };
  } catch (e) { return { ok: false, error: 'The provider change did not work. Nothing was changed.' }; }
}

// ── my58: one account per running chat ──────────────────────────────────────
// The first chat uses the shared main sign-in. A second chat that runs at the same time gets its OWN
// settings folder (/data/chat-config/<account>) signed in as the other saved account. Everything else in
// the main settings folder (chat history, notes, skills, plugins) is linked, so both chats see the same files.
const CHAT_CFG = path.join(DATA_DIR, 'chat-config');
const NOT_LINKED = new Set(['.credentials.json', '.claude.json', 'sessions', 'session-env', 'shell-snapshots', 'backups', 'cache', '.last-cleanup']);

/** my77: how much of an account's allowance is used (higher of 5-hour and weekly), or null with no figures. */
function useOf(email) {
  const q = readJson(path.join(DATA_DIR, 'haai-quota.json')) || {};
  const r = q[String(email || '').toLowerCase()];
  if (!r) return null;
  const a = r.five_hour?.used, b = r.seven_day?.used;
  if (a == null && b == null) return null;
  return { max: Math.max(a || 0, b || 0), week: b || 0 };
}

/**
 * Which saved account a chat that is about to start should use. { email, dir } - dir is null for the shared main sign-in.
 * my77 (Michael 2026-11-11): each chat KEEPS its own account while no other working chat is using it; a chat opened
 * alongside others takes the not-busy account with the MOST allowance left (accounts with no figures only when none has any).
 */
export function pickChatAccount(otherAccounts, slot = null, alone = true) {
  const cur = currentIdentity();
  if (!cur || modeState().free) return { email: cur ? cur.email : '', dir: null };
  const saved = listAccounts().saved;
  const used = new Set(otherAccounts);
  const as = (a) => {
    if (a.email === cur.email) return { email: cur.email, dir: null };
    try { return { email: a.email, dir: prepareChatDir(a.id) }; }
    catch (e) { log('WARN', `my58: could not prepare a separate sign-in (${e?.message || e}); sharing the main one`); return { email: cur.email, dir: null }; }
  };
  // Keep the account this chat already had, if nobody else is on it now.
  if (slot && slot.account) {
    const mine = saved.find((a) => a.email === slot.account);
    if (mine && !used.has(mine.email)) return as(mine);
  }
  // The only chat (or no other saved accounts): the main sign-in, as before.
  if (saved.length < 2 || (alone && !used.size)) return { email: cur.email, dir: null };
  const open = saved.filter((a) => !used.has(a.email));
  if (!open.length) return { email: cur.email, dir: null };   // every saved account is busy: share
  const ranked = open.map((a) => ({ a, u: useOf(a.email) }));
  const withFig = ranked.filter((r) => r.u);
  const pool = withFig.length ? withFig.sort((x, y) => x.u.max - y.u.max || x.u.week - y.u.week) : ranked;
  return as(pool[0].a);
}

// ── my77: a chat on a FREE account (grey) ───────────────────────────────────
// Its own settings folder /data/chat-config/free: the free provider's connection settings and the lighter rules
// (exactly what Free mode writes for the whole app, but only for this one chat). The privacy guard reads this
// folder's settings, so health, home security, money and passwords stay off the free model.
const FREE_DIR = path.join(CHAT_CFG_DIR(), 'free');
function CHAT_CFG_DIR() { return path.join(DATA_DIR, 'chat-config'); }
const CTX_SRC = '/config/opencode/free-mode-context.md';
const FREE_OWN = new Set(['settings.json', 'CLAUDE.md', 'free-mode-context.md', '.credentials.json', '.claude.json']);

/** Can a free-account chat be opened? { ok, why } (cheap check, no translator start). */
export function freeChatReady() {
  if (!existsSync(SWITCH)) return { ok: false, why: 'The free-model tool is missing.' };
  try {
    const r = spawnSync('python3', ['-I', SWITCH, 'chatenv', '--check'], { encoding: 'utf8', timeout: 15000, env: process.env });
    if (r.status === 0) return { ok: true, provider: (r.stdout || '').trim() };
    return { ok: false, why: (r.stderr || r.stdout || '').trim().slice(0, 200) || 'No free provider is ready.' };
  } catch (e) { return { ok: false, why: 'Could not check the free providers.' }; }
}

/** The same check without holding up the other chats while it runs. */
export function freeChatReadyAsync(cb) {
  if (!existsSync(SWITCH)) return cb({ ok: false, why: 'The free-model tool is missing.' });
  execFile('python3', ['-I', SWITCH, 'chatenv', '--check'], { encoding: 'utf8', timeout: 15000, env: process.env }, (err, out, errText) => {
    if (!err) return cb({ ok: true, provider: String(out || '').trim() });
    cb({ ok: false, why: String(errText || out || '').trim().slice(0, 200) || 'No free provider is ready.' });
  });
}

/** Build the free chat's settings folder. Returns { email:'', dir, model, provider } or throws with a plain reason. */
export function prepareFreeDir() {
  const r = spawnSync('python3', ['-I', SWITCH, 'chatenv'], { encoding: 'utf8', timeout: 60000, env: process.env });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || '').trim().slice(0, 200) || 'No free provider is ready.');
  const j = JSON.parse(r.stdout);
  mkdirSync(FREE_DIR, { recursive: true, mode: 0o700 });
  const main = readJson(SETTINGS()) || {};
  const st = { ...main, env: { ...(main.env || {}), ...j.env }, claudeMdExcludes: j.excludes || [] };
  writePrivate(path.join(FREE_DIR, 'settings.json'), JSON.stringify(st, null, 2));
  writePrivate(path.join(FREE_DIR, 'free-mode-context.md'), readFileSync(CTX_SRC, 'utf8'));
  try { writePrivate(path.join(FREE_DIR, 'CLAUDE.md'), readFileSync(path.join(CLAUDE_CONFIG_DIR, 'CLAUDE.md'), 'utf8')); } catch { /* none */ }
  const ident = readJson(IDENT()) || {};
  delete ident.oauthAccount;   // no Claude sign-in in this folder: it must only ever talk to the free provider
  writePrivate(path.join(FREE_DIR, '.claude.json'), JSON.stringify(ident));
  for (const name of readdirSync(CLAUDE_CONFIG_DIR)) {
    if (NOT_LINKED.has(name) || FREE_OWN.has(name) || name.endsWith('.key') || name.endsWith('.account')) continue;
    const to = path.join(FREE_DIR, name);
    try { lstatSync(to); continue; } catch { /* not there yet */ }
    try { symlinkSync(path.join(CLAUDE_CONFIG_DIR, name), to); } catch { /* best effort */ }
  }
  return { email: '', dir: FREE_DIR, model: j.env.ANTHROPIC_MODEL || '', provider: j.provider || '', free: true };
}

function prepareChatDir(id) {
  const a = readJson(path.join(DIR, id + '.json'));
  if (!a || !a.credentials || !a.oauthAccount) throw new Error('account not saved');
  const dir = path.join(CHAT_CFG, id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writePrivate(path.join(dir, '.credentials.json'), a.credentials);
  const ident = readJson(IDENT()) || {};
  ident.oauthAccount = a.oauthAccount;
  writePrivate(path.join(dir, '.claude.json'), JSON.stringify(ident));
  for (const name of readdirSync(CLAUDE_CONFIG_DIR)) {
    if (NOT_LINKED.has(name)) continue;
    const to = path.join(dir, name);
    try { lstatSync(to); continue; } catch { /* not there yet */ }
    try { symlinkSync(path.join(CLAUDE_CONFIG_DIR, name), to); } catch { /* best effort */ }
  }
  return dir;
}

/** After a chat on a separate sign-in ends: keep the refreshed token in the saved copy so it never goes stale. */
export function syncChatAccount(dir) {
  if (!dir) return;
  try {
    const live = readFileSync(path.join(dir, '.credentials.json'), 'utf8');
    const id = path.basename(dir);
    const f = path.join(DIR, id + '.json');
    const a = readJson(f);
    if (a && a.credentials !== live) { a.credentials = live; a.savedAt = new Date().toISOString(); writePrivate(f, JSON.stringify(a)); }
  } catch (e) { log('WARN', `my58: could not save the refreshed sign-in: ${e?.message || e}`); }
}
