/*
 * my115 (Michael C, 15 Nov 2026): the small helpers that were copied into about a dozen files (my74, my79, my87,
 * my90, my93, my96, my97, batch2, batch4, extras, accounts, handover) now live here once.
 *
 *   readJson(file, fallback)    the parsed file, or `fallback` if it is missing or damaged
 *   saveJson(file, value, pretty) written to a .tmp file first and renamed, so a crash never leaves half a file
 *   cachedJson(file, fallback)  like readJson, but only re-reads the file when it has changed (for timers that
 *                                look at the same file every few seconds); returns a copy the caller may change
 *   fetchT(url, opts, ms)       fetch with a time limit, so a stalled Home Assistant can never pile calls up
 *   guard(name, fn)             runs a timer job; any error is logged with its name instead of being thrown away
 */
import { readFileSync, writeFileSync, renameSync, statSync } from 'fs';
import { log } from './log.js';

export function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')) ?? fallback; } catch { return fallback; }
}

export function saveJson(file, value, pretty = false) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, pretty ? JSON.stringify(value, null, 1) : JSON.stringify(value));
  renameSync(tmp, file);
}

const cache = new Map();   // file -> { key, value }
export function cachedJson(file, fallback = null) {
  let key;
  try { const st = statSync(file); key = `${st.mtimeMs}:${st.size}`; } catch { cache.delete(file); return fallback; }
  const hit = cache.get(file);
  if (!hit || hit.key !== key) cache.set(file, { key, value: readJson(file, undefined) });
  const v = cache.get(file).value;
  return v === undefined || v === null ? fallback : structuredClone(v);
}

export function fetchT(url, opts = {}, ms = 10000) {
  return fetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(ms) });
}

export function guard(name, fn) {
  return (...args) => {
    try {
      const r = fn(...args);
      if (r && typeof r.catch === 'function') r.catch((e) => log('WARN', `${name}: ${String(e?.message || e).slice(0, 200)}`));
      return r;
    } catch (e) { log('WARN', `${name}: ${String(e?.message || e).slice(0, 200)}`); }
  };
}
