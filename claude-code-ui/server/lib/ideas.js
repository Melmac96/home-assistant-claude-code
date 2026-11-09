/*
 * my59: the haAi ideas list inside haAi (user 2026-11-09, ideas-lists page plan).
 * Uses the same helper as the Companion app page: /config/opencode/tools/ideas_lists.py (backup before every write,
 * Remove moves the item to opencode/ideas-removed.md). Only the 'haai' list is reachable from here.
 */
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';

const HELPER = '/config/opencode/tools/ideas_lists.py';
const OUT = '/config/www/ha-player/ideas.json';
const OPS = new Set(['add', 'edit', 'done', 'undone', 'remove']);

function items() {
  try { return JSON.parse(readFileSync(OUT, 'utf8')).lists.haai || []; } catch { return []; }
}

export function ideasList() {
  spawnSync('python3', ['-I', HELPER, 'list'], { encoding: 'utf8', timeout: 20000 });
  return { items: items() };
}

export function ideasOp(msg) {
  if (!OPS.has(msg.op)) return { ...ideasList(), error: 'unknown change' };
  const req = { op: msg.op, list: 'haai', id: String(msg.id || '').slice(0, 16), title: String(msg.title || '').slice(0, 300), body: String(msg.body || '').slice(0, 4000) };
  const payload = Buffer.from(JSON.stringify(req), 'utf8').toString('base64');
  const r = spawnSync('python3', ['-I', HELPER, 'op', payload], { encoding: 'utf8', timeout: 20000 });
  const out = String(r.stdout || '').trim();
  return { items: items(), error: out === 'ok' ? null : (out || 'the helper did not answer') };
}
