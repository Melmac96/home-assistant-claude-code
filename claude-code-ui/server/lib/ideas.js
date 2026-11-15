/*
 * my59: the haAi ideas list inside haAi (user 2026-11-09, ideas-lists page plan).
 * Uses the same helper as the Companion app page: /config/opencode/tools/ideas_lists.py (backup before every write,
 * Remove moves the item to opencode/ideas-removed.md). Only the 'haai' list is reachable from here.
 * my115 (Michael C, 15 Nov): the helper runs without freezing haAi (it held every chat up to 20 s), and a helper that
 * fails says so instead of quietly showing the old list.
 */
import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { log } from './log.js';

const HELPER = '/config/opencode/tools/ideas_lists.py';
const OUT = '/config/www/ha-player/ideas.json';
const OPS = new Set(['add', 'edit', 'done', 'undone', 'remove']);

function items() {
  try { return JSON.parse(readFileSync(OUT, 'utf8')).lists.haai || []; } catch { return []; }
}

const run = (args) => new Promise((resolve) => {
  execFile('python3', ['-I', HELPER, ...args], { encoding: 'utf8', timeout: 20000 }, (err, stdout, stderr) => {
    if (err) log('WARN', `ideas helper ${args[0]} failed: ${String(stderr || err.message || err).trim().slice(0, 200)}`);
    resolve({ ok: !err, out: String(stdout || '').trim() });
  });
});

export async function ideasList() {
  const r = await run(['list']);
  return { items: items(), ...(r.ok ? {} : { error: 'The ideas list could not be refreshed, so this may be the older copy.' }) };
}

export async function ideasOp(msg) {
  if (!OPS.has(msg.op)) return { ...(await ideasList()), error: 'unknown change' };
  const req = { op: msg.op, list: 'haai', id: String(msg.id || '').slice(0, 16), title: String(msg.title || '').slice(0, 300), body: String(msg.body || '').slice(0, 4000) };
  const payload = Buffer.from(JSON.stringify(req), 'utf8').toString('base64');
  const r = await run(['op', payload]);
  return { items: items(), error: r.out === 'ok' ? null : (r.out || 'the helper did not answer') };
}
