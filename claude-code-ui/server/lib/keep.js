/*
 * my35: Keep. Bits of text, photos and files waiting in the tray above the typing box. Saved
 * in haAi's own /data folder, so they survive a restart and show on every device, until Send.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import path from 'path';
import { log } from './log.js';

const DIR = process.env.HAAI_KEEP_DIR || '/data/haai-keep';
const LIST = path.join(DIR, 'list.json');
const MAX_ITEMS = 100;
const MAX_FILES = 40;
const MAX_BYTES = 30 * 1024 * 1024;   // the photos together, as stored
const MAX_TEXT = 100000;

function load() {
  try { const l = JSON.parse(readFileSync(LIST, 'utf8')); return Array.isArray(l) ? l : []; } catch { return []; }
}
function save(items) {
  mkdirSync(DIR, { recursive: true });
  const tmp = `${LIST}.tmp`;
  writeFileSync(tmp, JSON.stringify(items));
  renameSync(tmp, LIST);   // never leaves a half-written list
}
const filePath = (i) => path.join(DIR, `${i.id}.data`);
const drop = (i) => { if (i.kind === 'file') try { unlinkSync(filePath(i)); } catch {} };

export const list = () => load().map(({ size, ...i }) => i);

export function add(msg) {
  const items = load();
  const cid = String(msg.cid || '').slice(0, 40);
  if (!cid) return { error: 'That could not be kept. Please try again.' };
  if (items.some((i) => i.cid === cid)) return {};   // already saved (a resend after a reconnect)
  if (items.length >= MAX_ITEMS) return { error: `The waiting tray is full (${MAX_ITEMS} bits). Press Send first.` };
  const id = randomBytes(6).toString('hex');
  if (msg.kind === 'text') {
    const text = String(msg.text || '').trim();
    if (!text || text.length > MAX_TEXT) return { error: 'That bit of text could not be kept (empty or too long).' };
    items.push({ id, cid, kind: 'text', text });
  } else if (msg.kind === 'file') {
    const data = String(msg.data || '');
    if (!data.startsWith('data:')) return { error: 'That file could not be kept.' };
    const files = items.filter((i) => i.kind === 'file');
    if (files.length >= MAX_FILES) return { error: `The waiting tray already holds ${MAX_FILES} photos and files. Press Send first.` };
    if (files.reduce((n, i) => n + (i.size || 0), 0) + data.length > MAX_BYTES) return { error: 'The waiting tray is full of photos. Press Send first.' };
    const item = { id, cid, kind: 'file', name: String(msg.name || 'file').slice(0, 200), mediaType: String(msg.mediaType || '').slice(0, 100), isImage: !!msg.isImage, thumb: String(msg.thumb || '').slice(0, 60000), size: data.length };
    mkdirSync(DIR, { recursive: true });
    writeFileSync(filePath(item), data);
    items.push(item);
  } else {
    return { error: 'That could not be kept.' };
  }
  save(items);
  return {};
}

export function remove(id) {
  const items = load();
  const gone = items.find((i) => i.id === id);
  if (!gone) return;
  save(items.filter((i) => i !== gone));
  drop(gone);
}

/** Send time: hands back the named files ready to attach, and empties those bits from the tray. */
export function take(ids) {
  const items = load();
  const out = [];
  const taken = items.filter((i) => ids.includes(i.id));
  for (const i of taken) {
    if (i.kind !== 'file') continue;
    try {
      if (existsSync(filePath(i))) out.push({ name: i.name, mediaType: i.mediaType, data: readFileSync(filePath(i), 'utf8') });
    } catch (e) { log('WARN', `keep: could not read ${i.name}: ${e?.message || e}`); }
  }
  save(items.filter((i) => !taken.includes(i)));
  taken.forEach(drop);
  return out;
}
