/*
 * my148 (Michael 24 Nov 2026, his Q1 A + Look B): each account's own page.
 *  - every Claude reply (helpers too) is written to a private token log WITH the account it ran on, so token
 *    figures are exact from now on (before this, chats from every account shared one folder: estimated);
 *  - account_details: the figures for one account (plan facts, allowance, forecast, tokens, models, free helpers)
 *    from opencode/tools/haai_account_stats.py. Never any secret: no tokens, no keys.
 */
import { appendFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { log } from './log.js';

const TOKEN_LOG = '/data/haai-token-log.jsonl';
const STATS = '/config/opencode/tools/haai_account_stats.py';
const seen = new Set();
let cache = { at: 0, data: null };

export function noteReply(acct, event) {
  const m = event.message || {}, u = m.usage;
  if (!u || !acct?.email || m.model === '<synthetic>') return;
  const id = m.id || event.uuid;
  if (seen.has(id)) return;
  seen.add(id); if (seen.size > 5000) seen.clear();
  const row = { t: Date.now(), e: acct.email, free: !!acct.free, m: m.model || '', h: !!event.parent_tool_use_id, s: event.session_id || '',
    i: u.input_tokens || 0, o: u.output_tokens || 0, r: u.cache_read_input_tokens || 0, w: u.cache_creation_input_tokens || 0 };
  try { appendFileSync(TOKEN_LOG, JSON.stringify(row) + '\n', { mode: 0o600 }); } catch (e) { log('WARN', `my148: token log: ${e?.message || e}`); }
}

export function accountDetails(ws, msg, send) {
  const email = String(msg.email || '').toLowerCase();
  const reply = (d) => {
    const a = d && Object.entries(d.accounts || {}).find(([k]) => k.toLowerCase() === email);
    send(ws, a ? { type: 'account_details', email: a[0], made: d.made, details: a[1] }
      : { type: 'account_details', email, error: 'I could not get the figures for this account.' });
  };
  if (cache.data && Date.now() - cache.at < 60000) { reply(cache.data); return; }
  execFile('python3', ['-I', STATS], { timeout: 30000, maxBuffer: 8 << 20 }, (err, out) => {
    if (err) { log('WARN', `my148: account figures failed: ${err.message}`); reply(null); return; }
    try { cache = { at: Date.now(), data: JSON.parse(out) }; } catch { reply(null); return; }
    reply(cache.data);
  });
}
