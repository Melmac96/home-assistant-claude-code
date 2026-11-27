/*
 * my162 (Michael 27 Nov, Q2 A): jobs that carry on by themselves after my reply ends (filing the Alfs and the like)
 * show live in the working bar with their own count, e.g. "Filing Alfs 12 of 17".
 * A job writes one small file in /data/haai-bgjobs (bgjob-cli.js does it); this reads them every 2 s and tells every
 * screen when anything changed. A job whose process has gone without saying it finished shows as stopped, so he can
 * see when one dies. Finished or stopped jobs stay on the bar for 15 minutes, then the file is tidied away.
 */
import { readdirSync, readFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { broadcast } from './broadcast.js';

export const BG_DIR = '/data/haai-bgjobs';
const KEEP_MS = 15 * 60 * 1000;
let last = '[]';

function alive(pid) {
  if (!pid) return true;   // no process given: trust the file
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export function bgJobs() {
  const out = [];
  let names = [];
  try { names = readdirSync(BG_DIR).filter((n) => n.endsWith('.json')); } catch { return out; }
  const now = Date.now();
  for (const n of names) {
    let j; try { j = JSON.parse(readFileSync(`${BG_DIR}/${n}`, 'utf8')); } catch { continue; }
    if (!j || typeof j !== 'object') continue;
    let state = j.state || 'running';
    if (state === 'running' && (!alive(Number(j.pid)) || now - (Number(j.updated) || now) > 3 * 3600 * 1000)) state = 'stopped';   // gone, or silent for 3 hours
    const end = Number(j.endedAt) || (state === 'stopped' ? Number(j.updated) || now : 0);
    if (state !== 'running' && end && now - end > KEEP_MS) { try { unlinkSync(`${BG_DIR}/${n}`); } catch { /* gone already */ } continue; }
    out.push({ id: String(j.id || n.slice(0, -5)), title: String(j.title || 'Background job').slice(0, 80), n: Number(j.n) || 0,
      total: Number(j.total) || 0, now: String(j.now || '').slice(0, 120), state, started: Number(j.started) || 0 });
  }
  return out.sort((a, b) => a.started - b.started);
}

export const bgJobsMessage = () => ({ type: 'bg_jobs', jobs: bgJobs() });

function tick() {
  const m = bgJobsMessage(), s = JSON.stringify(m.jobs);
  if (s === last) return;
  last = s; broadcast(m);
}

export function startBgJobs() {
  try { mkdirSync(BG_DIR, { recursive: true }); } catch { /* reported by the CLI if it matters */ }
  setInterval(tick, 2000).unref?.();
}
