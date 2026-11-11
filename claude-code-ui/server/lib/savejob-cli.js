// my74 (H20): Claude saves a finished job as a one-tap Quick job.  node savejob-cli.js "Refresh Shields" "Saved job: ..."
//   node savejob-cli.js list            node savejob-cli.js remove "button name"
import { readFileSync, writeFileSync, renameSync } from 'fs';
const FILE = '/data/haai-quick.json';
import { DEFAULT_QUICK } from './quick-default.js';
import { existsSync } from 'fs';
const read = () => { if (!existsSync(FILE)) return JSON.parse(JSON.stringify(DEFAULT_QUICK)); try { const q = JSON.parse(readFileSync(FILE, 'utf8')); return { jobs: Array.isArray(q.jobs) ? q.jobs : [], replies: Array.isArray(q.replies) ? q.replies : [] }; } catch { return null; } };
const save = (q) => { writeFileSync(FILE + '.tmp', JSON.stringify(q, null, 1)); renameSync(FILE + '.tmp', FILE); };
const [cmd, a] = process.argv.slice(2);
const q = read();
if (cmd === 'list') {
  for (const j of (q || DEFAULT_QUICK).jobs) console.log(`${j.label}  =>  ${j.text.slice(0, 120)}`);
} else if (cmd === 'remove') {
  if (!q) { console.error('FAILED: no Quick jobs file yet'); process.exit(1); }
  const before = q.jobs.length;
  q.jobs = q.jobs.filter((j) => j.label !== String(a || ''));
  save(q); console.log(before === q.jobs.length ? 'OK nothing matched' : 'OK removed');
} else {
  const label = String(cmd || '').trim().slice(0, 24), text = String(a || '').trim().slice(0, 2000);
  if (!label || !text) { console.error('FAILED: use  node savejob-cli.js "button name" "what it asks Claude to do"'); process.exit(1); }
  if (!q) { console.error('FAILED: the Quick jobs file could not be read; open haAi once and try again'); process.exit(1); }
  const i = q.jobs.findIndex((j) => j.label === label);
  if (i >= 0) q.jobs[i].text = text; else q.jobs.push({ label, text });
  if (q.jobs.length > 60) { console.error('FAILED: the Quick list is full (60); remove one first'); process.exit(1); }
  save(q); console.log(`OK saved "${label}" in the Quick list (${i >= 0 ? 'updated' : 'new'})`);
}
