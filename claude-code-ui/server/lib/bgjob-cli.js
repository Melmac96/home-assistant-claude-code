#!/usr/bin/env node
/*
 * my162: a job that runs by itself tells the working bar how far it has got.
 *   node bgjob-cli.js start <id> "<title>" <total> [pid]   e.g. start alf-file "Filing Alfs" 17 $$
 *   node bgjob-cli.js step  <id> <n> "<what now>"
 *   node bgjob-cli.js done  <id> ["<last words>"]
 *   node bgjob-cli.js fail  <id> "<why, in plain words>"
 * Prints OK, or the problem.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';

const DIR = '/data/haai-bgjobs';
const [cmd, id, a, b, c] = process.argv.slice(2);
const bad = (t) => { console.log(t); process.exit(1); };
if (!cmd || !id || !/^[\w.-]{1,60}$/.test(id)) bad('Use: start|step|done|fail <id> ...');
mkdirSync(DIR, { recursive: true });
const file = `${DIR}/${id}.json`;
let j = {}; try { j = JSON.parse(readFileSync(file, 'utf8')); } catch { /* new job */ }
const now = Date.now();
if (cmd === 'start') j = { id, title: a || id, total: Number(b) || 0, n: 0, now: '', pid: Number(c) || 0, state: 'running', started: now };
else if (cmd === 'step') { if (!j.id) bad(`No job called ${id}`); j.n = Number(a) || 0; if (b != null) j.now = b; }
else if (cmd === 'done') { if (!j.id) bad(`No job called ${id}`); j.state = 'done'; j.n = j.total || j.n; j.now = a || ''; j.endedAt = now; }
else if (cmd === 'fail') { if (!j.id) bad(`No job called ${id}`); j.state = 'failed'; j.now = a || ''; j.endedAt = now; }
else bad('Use: start|step|done|fail <id> ...');
j.updated = now;
writeFileSync(`${file}.tmp`, JSON.stringify(j)); renameSync(`${file}.tmp`, file);
console.log('OK');
