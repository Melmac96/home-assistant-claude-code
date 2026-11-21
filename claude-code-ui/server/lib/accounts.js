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
import * as fsSync from 'fs';   // my115
import path from 'path';
import { execFile, spawn } from 'child_process';   // my114 spawn; my115: no spawnSync any more
import { CLAUDE_CONFIG_DIR, DATA_DIR } from './config.js';
import { log } from './log.js';
import { chooseAccount, tidyState, takeWarning, getPending, setPending, holdBigChat } from './my90.js';   // my122   // my90

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

// my115 (Michael C, 15 Nov): Python helpers run WITHOUT freezing haAi (spawnSync held up every chat, socket and watch
// request, up to 60 s on each free-chat turn). Resolves { status, stdout, stderr } like spawnSync did.
function runPy(args, timeout) {
  return new Promise((resolve) => {
    execFile('python3', ['-I', SWITCH, ...args], { encoding: 'utf8', timeout, env: process.env, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      resolve({ status: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: stdout || '', stderr: stderr || (err && !stdout ? String(err.message || err) : '') });
    });
  });
}

// my115: one unreadable moment of settings.json (being rewritten) no longer flips Free/Paid: the last good read is used
let lastEnv = null;
function settingsEnv() {
  const j = readJson(SETTINGS());
  if (j && typeof j === 'object') { lastEnv = j.env || {}; return lastEnv; }
  if (existsSync(SETTINGS()) && lastEnv) return lastEnv;
  return {};
}

/** Which mode the chat settings are in. Never includes the key itself. */
export function modeState() {
  const env = settingsEnv();
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
  const env = settingsEnv();
  return env.OR_PROVIDER && env.ANTHROPIC_MODEL ? env.ANTHROPIC_MODEL : null;
}

/** my17: choose a free model from the live pool. Returns { ok, model } or { ok:false, error }. */
export async function setFreeModel(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9._:\/-]{3,120}$/.test(id)) return { ok: false, error: 'That model name is not valid.' };
  if (!modeState().free) return { ok: false, error: 'Free mode is not on.' };
  try {
    const r = await runPy(['setmodel', id], 25000);
    if (r.status !== 0) { log('ERROR', `setmodel failed: ${(r.stderr || r.stdout || '').trim()}`); return { ok: false, error: 'That model is not on the free list right now. Nothing was changed.' }; }
    log('INFO', `free model set to ${id}`);
    return { ok: true, model: id };
  } catch (e) {
    log('ERROR', `setmodel failed: ${e?.message || e}`);
    return { ok: false, error: 'The model change did not work. Nothing was changed.' };
  }
}

let switching = null;
/** my115: resolves once a Free/Paid switch in progress has finished (at once if none). */
export const modeSwitchDone = () => switching ? switching.then(() => {}, () => {}) : Promise.resolve();

/** Switch to Free (true) or Paid (false). Returns { ok, free } or { ok:false, error }. */
export async function setMode(free) {
  if (free && !modeState().hasKey) return { ok: false, error: 'No OpenRouter key is saved yet.' };
  try {
    // my115: while the switch runs, a chat that wants to start waits for it (so it never starts half-way between modes)
    switching = runPy([free ? 'on' : 'off'], 20000);
    const r = await switching.finally(() => { switching = null; });
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
  const pend = getPending();   // my123: a switch he asked for while haAi was busy, due after the current turn
  return { current: cur, saved, mode: modeState(), pending: pend ? { id: pend.id, email: pend.email } : null };
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
    const oldIdent = existsSync(IDENT()) ? readFileSync(IDENT(), 'utf8') : null;
    ident.oauthAccount = target.oauthAccount;
    // my115: the sign-in goes first, then the name; if the second step fails the first is put back, so the name and
    // the sign-in can never belong to different accounts
    const oldLive = existsSync(LIVE()) ? readFileSync(LIVE(), 'utf8') : null;
    writePrivate(LIVE(), target.credentials);
    try { writePrivate(IDENT(), JSON.stringify(ident)); }
    catch (e) {
      if (oldLive != null) { try { writePrivate(LIVE(), oldLive); } catch { /* backed up above */ } }
      if (oldIdent != null) { try { writePrivate(IDENT(), oldIdent); } catch { /* unchanged */ } }
      throw e;
    }
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
export async function useProvider(id) {
  if (typeof id !== 'string' || !/^[a-z0-9]{2,20}$/.test(id)) return { ok: false, error: 'That provider name is not valid.' };
  if (!modeState().free) return { ok: false, error: 'Free mode is not on. Switch to Free models first.' };
  try {
    const r = await runPy(['useprovider', id], 25000);
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

/**
 * Which saved account a chat that is about to start should use. { email, dir } - dir is null for the shared main sign-in.
 * my90 (Michael 2026-11-13, replaces my77/my83): the not-busy account whose 5 hours reset soonest, with room for the next reply under 95% (my95)
 * my122: 75% is only a warning: no stop; when every account is at 75%+ the chat stays put and `warn` carries the red-warning figures; see my90.js.
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
  if (saved.length < 2) return { email: cur.email, dir: null };
  // my90/my95 (Michael 2026-11-13): the account whose 5 hours reset soonest, moving on BEFORE a reply that would pass 95%; none with room = stop.
  tidyState(saved);
  const on = (slot && slot.account) || cur.email;   // my99: the account this chat is on now (moving costs more)
  // cache-opt phase 2 (Michael 2026-11-20): a chat over ~45k tokens does not hop accounts (cold cache) unless its account is at the 95% hard stop.
  if (slot && slot.account && slot.ctx && slot.ctx.sid === slot.sessionId && holdBigChat(slot.account, slot.ctx.tokens)) {
    const stayBig = saved.find((x) => x.email === slot.account);
    if (stayBig) { log('INFO', `cache-opt: chat is ${Math.round(slot.ctx.tokens / 1000)}k tokens, stays on ${slot.account} (no cold-cache hop)`); return as(stayBig); }
  }
  const pick = chooseAccount(saved, used, on) || chooseAccount(saved, new Set(), on);
  // my122 (Michael 2026-11-15): every account at 75% or more = NO stop and NO move: the chat stays on its account and a red warning is shown.
  if (!pick) {
    const stay = saved.find((a) => a.email === on) || saved.find((a) => a.email === cur.email) || saved[0];
    const r = as(stay);
    r.warn = takeWarning(saved);
    return r;
  }
  // A lone chat moves the live sign-in too, so the header and the Accounts menu show the account really in use.
  if (alone && !used.size && pick.email !== cur.email) {
    const r = switchTo(pick.id);
    if (r.ok) { if (getPending()?.email === pick.email) setPending(null); log('INFO', `my90: moved to ${pick.email} (keeps all saved accounts level: 5-hour and 7-day use, my122)`); return { email: pick.email, dir: null, moved: true }; }
  }
  return as(pick);
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
export async function freeChatReady() {
  if (!existsSync(SWITCH)) return { ok: false, why: 'The free-model tool is missing.' };
  try {
    const r = await runPy(['chatenv', '--check'], 15000);
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

// my78: the free service a free chat runs on, in plain words ("OpenRouter · deepseek-v4.1-flash"), for its typing box.
const PNAME = { openrouter: 'OpenRouter', google: 'Google', groq: 'Groq', mistral: 'Mistral', cerebras: 'Cerebras', huggingface: 'Hugging Face',
  nvidia: 'NVIDIA', ollama: 'Ollama', github: 'GitHub', cloudflare: 'Cloudflare', sambanova: 'SambaNova' };
export function freeServiceText(provider, model) {
  let p = provider || '', m = model || '';
  if (p === 'auto' || !m || ['smart', 'fast', 'long'].includes(m)) {
    try {
      const r = JSON.parse(readFileSync('/data/translator/routes.json', 'utf8'));
      const step = ((r.routes || r)[['fast', 'long'].includes(m) ? m : 'smart'] || [])[0];
      if (step && (p === 'auto' || !p || step.provider === p)) { p = step.provider || p; m = step.model || ''; }
    } catch { /* no routes file: name the provider only */ }
  }
  if (['smart', 'fast', 'long'].includes(m)) m = '';
  const name = PNAME[p] || (p && p !== 'auto' ? p : 'Free');
  const mod = String(m).split('/').pop().replace(/:free$/, '');
  return mod ? `${name} · ${mod}` : name;
}
let freeSvc = { at: 0, text: '' };
/** Cached name of the service a NEW free chat would use (checked at most every 5 minutes, never holds anything up). */
export function freeServiceNow() {
  if (Date.now() - freeSvc.at > 300000) {
    freeSvc.at = Date.now();
    freeChatReadyAsync((r) => { if (r.ok) freeSvc.text = freeServiceText(r.provider, ''); });
  }
  return freeSvc.text;
}

/** Build the free chat's settings folder. Returns { email:'', dir, model, provider } or throws with a plain reason. */
export async function prepareFreeDir() {
  const r = await runPy(['chatenv'], 60000);
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

// my114 (Michael 15 Nov): the Free/Paid watcher runs from the moment haAi starts, not only once a chat has started.
// On 15 Nov it was dead after a restart, so a switch at 11:57 was only noticed at 12:00 and a new chat got locked.
// The script itself refuses to run twice (pid file), so starting it again is harmless.
// my115 (Michael C, 15 Nov): the watcher is checked every 30 s (its pid file must point at a live process) and started
// again at once if it has died; its own error output goes to a log file instead of being thrown away.
let watcherLogged = false, lastStart = 0;
const WATCH_PID = '/data/.config/claude/openrouter-watch.pid';
const WATCH_LOG = '/data/mode-watcher.log';
export function modeWatcherAlive() {
  try {
    const pid = Number(String(readFileSync(WATCH_PID, 'utf8')).trim());
    if (!Number.isInteger(pid) || pid <= 1) return false;
    process.kill(pid, 0);
    // my118: after a restart the old number can belong to another program (haAi itself) - only the real watcher counts
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('openrouter_switch');
  } catch { return false; }
}
export function startModeWatcher() {
  if (modeWatcherAlive()) return;
  if (Date.now() - lastStart < 20000) return;   // just started one: give it time to write its pid file
  lastStart = Date.now();
  try {
    let out = 'ignore';
    try {
      const { openSync, statSync: st } = fsSync;
      try { if (st(WATCH_LOG).size > 200000) writeFileSync(WATCH_LOG, ''); } catch { /* new file */ }
      out = openSync(WATCH_LOG, 'a');
    } catch { out = 'ignore'; }
    const c = spawn('python3', ['-I', SWITCH, 'watch'], { detached: true, stdio: ['ignore', out, out], env: process.env });
    c.on('error', (e) => log('WARN', `my114: mode watcher did not start: ${e?.message || e}`));
    c.on('exit', (code) => { if (code) log('WARN', `my115: mode watcher stopped (exit ${code}); see ${WATCH_LOG}. It is started again within 30 s.`); });
    c.unref();
    log('INFO', watcherLogged ? 'my115: Free/Paid mode watcher was not running, started it again' : 'my114: Free/Paid mode watcher started (checked every 30 s)');
    watcherLogged = true;
  } catch (e) { log('WARN', `my114: mode watcher did not start: ${e?.message || e}`); }
}
