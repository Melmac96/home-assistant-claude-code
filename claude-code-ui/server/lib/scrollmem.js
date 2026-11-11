/*
 * my73: remember where Michael was reading in each chat, on the server, so the phone and the
 * tablet open at the SAME place. A place is "message number + how far into it" (pixels differ
 * between screens), or "at the bottom". Only the newest place per chat is kept.
 */
import { readFileSync, writeFileSync, renameSync } from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';

const FILE = path.join(DATA_DIR, 'haai-scroll-pos.json');
const MAX = 300;
let cache = null;

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(readFileSync(FILE, 'utf8')); } catch { cache = {}; }
  if (!cache || typeof cache !== 'object') cache = {};
  return cache;
}

export function getPos(sid) {
  if (!sid) return null;
  return load()[sid] || null;
}

export function setPos(msg) {
  const sid = String(msg.sid || '');
  if (!/^[A-Za-z0-9-]{8,80}$/.test(sid)) return null;
  const all = load();
  const pos = {
    bottom: !!msg.bottom,
    idx: Math.max(0, Math.min(100000, parseInt(msg.idx, 10) || 0)),
    frac: Math.max(0, Math.min(1, Number(msg.frac) || 0)),
    dev: String(msg.dev || '').slice(0, 40),
    at: Date.now(),
  };
  delete all[sid];
  all[sid] = pos;
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete all[k];
  try { writeFileSync(FILE + '.tmp', JSON.stringify(all)); renameSync(FILE + '.tmp', FILE); } catch { /* next scroll saves again */ }
  return pos;
}
