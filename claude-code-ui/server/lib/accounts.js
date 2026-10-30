/*
 * My Claude Code UI: saved Claude sign-ins and switching between them.
 *
 * Each saved account is one private file in /data/claude-accounts holding that
 * account's credentials plus its identity block (email, name) from
 * ~/.claude.json, so a switch swaps both and the two never disagree. Tokens are
 * never sent to the browser and never logged; the browser only ever sees the
 * email and display name. Before any switch the live sign-in is backed up.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, readdirSync, unlinkSync } from 'fs';
import path from 'path';
import { CLAUDE_CONFIG_DIR, DATA_DIR } from './config.js';
import { log } from './log.js';

const DIR = path.join(DATA_DIR, 'claude-accounts');
const BACKUPS = path.join(DIR, 'backups');
const LIVE = () => path.join(CLAUDE_CONFIG_DIR, '.credentials.json');
const IDENT = () => path.join(process.env.HOME || path.join(DATA_DIR, 'home'), '.claude.json');

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

/** What the browser may see: emails and which one is signed in now. */
export function listAccounts() {
  const cur = currentIdentity();
  const saved = [];
  try {
    for (const f of readdirSync(DIR)) {
      if (!f.endsWith('.json')) continue;
      const a = readJson(path.join(DIR, f));
      if (a && a.email) saved.push({ id: f.slice(0, -5), email: a.email, displayName: a.displayName || '',
        active: !!cur && cur.email === a.email });
    }
  } catch { /* nothing saved yet */ }
  saved.sort((a, b) => a.email.localeCompare(b.email));
  return { current: cur, saved };
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
