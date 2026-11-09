/*
 * my48: haAi batch 4 (user picks AAABA, test page batch4-looks.html, 2026-11-09). Server side of "Overnight jobs" (look A):
 *  jobs saved for tonight wait in /data/haai-overnight.json and start one at a time once Sleep as Android has been on for 30 minutes
 *  (so the bedtime routine has finished). They run in the current chat, headless, like auto-continue. The morning brief counts them.
 */
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { SUPERVISOR_URL } from './config.js';
import { log } from './log.js';
import { broadcast } from './broadcast.js';
import { runtime } from './state.js';

const FILE = '/data/haai-overnight.json';
const SLEEP = 'binary_sensor.sleeping_bedroom_sleep_as_android';
const WAIT_MS = 30 * 60 * 1000;
const read = () => { try { const d = JSON.parse(readFileSync(FILE, 'utf8')); return { jobs: d.jobs || [], done: d.done || [] }; } catch { return { jobs: [], done: [] }; } };
const save = (o) => { writeFileSync(FILE + '.tmp', JSON.stringify(o)); renameSync(FILE + '.tmp', FILE); };

let runner = null;
export function setOvernightRunner(fn) { runner = fn; }

export const listOvernight = () => { const d = read(); return { list: d.jobs.map((j) => ({ id: j.id, text: j.text })), done: d.done.length }; };
export function addOvernight(text, permissionMode) {
  const t = String(text || '').trim().slice(0, 4000);
  if (!t) return;
  const d = read(); d.jobs.push({ id: String(Date.now()) + Math.random().toString(36).slice(2, 5), text: t, permissionMode: permissionMode || 'default' });
  save(d); broadcast({ type: 'overnight', ...listOvernight() });
}
export function removeOvernight(id) { const d = read(); d.jobs = d.jobs.filter((j) => j.id !== id); save(d); broadcast({ type: 'overnight', ...listOvernight() }); }
export function overnightDoneCount() { return read().done.length; }
export function clearOvernightDone() { const d = read(); if (d.done.length) { d.done = []; save(d); broadcast({ type: 'overnight', ...listOvernight() }); } }

async function tick() {
  try {
    const d = read();
    if (!d.jobs.length || !runner || runtime.activeQuery) return;
    const res = await fetch(`${SUPERVISOR_URL}/core/api/states/${SLEEP}`, { headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` } });
    if (!res.ok) return;
    const st = await res.json();
    if (st.state !== 'on' || Date.now() - new Date(st.last_changed).getTime() < WAIT_MS) return;
    const job = d.jobs.shift();
    d.done.push({ id: job.id, at: Date.now() });
    save(d);
    broadcast({ type: 'overnight', ...listOvernight() });
    log('INFO', `my48: starting overnight job ${job.id} (${job.text.length} chars)`);
    runner({ readyState: 3 }, { text: `[Overnight job he saved earlier. He is asleep: do not ask questions, do not make loud or disruptive changes, and leave a short plain-English report of what you did for the morning.]\n\n${job.text}`, permissionMode: job.permissionMode });
  } catch (e) { log('WARN', `overnight check failed: ${e?.message || e}`); }
}
export function startOvernight() { setInterval(tick, 60000).unref?.(); }
