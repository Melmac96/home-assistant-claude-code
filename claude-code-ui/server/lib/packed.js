/*
 * my93 I2 (Michael's Look A, nine-picks-looks.html, 2026-11-13): pack old chats.
 * A chat nobody has touched for 2 months (his answer A) is squeezed into /data/haai-packed/<id>.jsonl.gz
 * every night. It stays in the chat list and in Search; opening it unpacks it back where it was first.
 * Kept free of sessions.js imports so sessions.js can use it.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'fs';
import { gunzipSync, gzipSync } from 'zlib';
import path from 'path';
import { STORE_DIR } from './config.js';

export const PACK_DIR = process.env.HAAI_PACK_DIR || '/data/haai-packed';
const INDEX = path.join(PACK_DIR, 'index.json');   // id -> { title, updatedAt, size, packedAt }
const readIndex = () => { try { return JSON.parse(readFileSync(INDEX, 'utf8')) || {}; } catch { return {}; } };
const saveIndex = (o) => { mkdirSync(PACK_DIR, { recursive: true }); writeFileSync(INDEX + '.tmp', JSON.stringify(o)); renameSync(INDEX + '.tmp', INDEX); };
const gzFile = (id) => path.join(PACK_DIR, `${id}.jsonl.gz`);
const safeId = (id) => /^[\w-]+$/.test(String(id || ''));

export function packedList() {
  const ix = readIndex();
  return Object.entries(ix).filter(([id]) => existsSync(gzFile(id))).map(([id, v]) => ({ id, title: v.title, updatedAt: v.updatedAt, packed: true }));
}
export function packedBody(id) {
  try { return gunzipSync(readFileSync(gzFile(id))).toString('utf8'); } catch { return null; }
}

// Put a packed chat back as a normal chat file, with its old date, so it opens and carries on as before.
export function unpack(id) {
  if (!safeId(id)) return false;
  const dest = path.join(STORE_DIR, `${id}.jsonl`);
  if (existsSync(dest)) return true;
  const gz = gzFile(id);
  if (!existsSync(gz)) return false;
  const body = gunzipSync(readFileSync(gz));
  writeFileSync(dest + '.tmp', body); renameSync(dest + '.tmp', dest);
  const ix = readIndex();
  const t = (ix[id] && ix[id].updatedAt) || Date.now();
  try { utimesSync(dest, new Date(t), new Date(t)); } catch { /* the date only orders the list */ }
  unlinkSync(gz);
  delete ix[id]; saveIndex(ix);
  return true;
}

// Pack one chat. Only removes the original after the packed copy reads back byte for byte.
export function pack(id, title) {
  if (!safeId(id)) return 0;
  const src = path.join(STORE_DIR, `${id}.jsonl`);
  const st = statSync(src);
  const raw = readFileSync(src);
  const gz = gzipSync(raw, { level: 9 });
  mkdirSync(PACK_DIR, { recursive: true });
  writeFileSync(gzFile(id) + '.tmp', gz);
  if (!gunzipSync(readFileSync(gzFile(id) + '.tmp')).equals(raw)) { unlinkSync(gzFile(id) + '.tmp'); throw new Error(`pack check failed for ${id}`); }
  renameSync(gzFile(id) + '.tmp', gzFile(id));
  const ix = readIndex();
  ix[id] = { title: title || 'Chat', updatedAt: st.mtimeMs, size: st.size, packedAt: Date.now() };
  saveIndex(ix);
  if (statSync(src).mtimeMs !== st.mtimeMs) { unlinkSync(gzFile(id)); delete ix[id]; saveIndex(ix); return 0; }   // written to meanwhile: leave it
  unlinkSync(src);
  return st.size - gz.length;
}

export function oldChatFiles(days) {
  if (!existsSync(STORE_DIR)) return [];
  const cut = Date.now() - days * 86400000;
  const out = [];
  for (const f of readdirSync(STORE_DIR)) {
    if (!f.endsWith('.jsonl')) continue;
    let st; try { st = statSync(path.join(STORE_DIR, f)); } catch { continue; }
    if (st.isFile() && st.mtimeMs < cut) out.push(f.slice(0, -6));
  }
  return out;
}
