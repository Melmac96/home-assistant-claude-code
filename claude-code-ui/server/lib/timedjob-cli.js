// my79 (H17): Claude sets a job to run at a time Michael chose (UK time).  node timedjob-cli.js "2026-11-12 15:00" "Check the Toilet humidity and tell me"
//   node timedjob-cli.js list            node timedjob-cli.js cancel <id>
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { randomBytes } from 'crypto';
const FILE = '/data/haai-timed.json';
const read = () => { try { const l = JSON.parse(readFileSync(FILE, 'utf8')); return Array.isArray(l) ? l : []; } catch { return []; } };
const save = (l) => { writeFileSync(FILE + '.tmp', JSON.stringify(l, null, 1)); renameSync(FILE + '.tmp', FILE); };
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function ukToEpoch(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return null;
  const want = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    guess += want - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  }
  return guess;
}
const [cmd, a] = process.argv.slice(2);
if (cmd === 'list') {
  for (const j of read().sort((x, y) => x.at - y.at)) console.log(j.id, fmt.format(new Date(j.at)), j.status, j.text.slice(0, 100));
} else if (cmd === 'cancel') {
  const l = read(); const j = l.find((x) => x.id === a);
  if (!j) { console.error('FAILED: no job with that id'); process.exit(1); }
  if (j.status !== 'wait') { console.log(`OK nothing to cancel (it is ${j.status})`); process.exit(0); }
  j.status = 'cancelled'; save(l); console.log('OK cancelled');
} else {
  const at = ukToEpoch(cmd), text = String(a || '').trim().slice(0, 4000);
  if (at == null || !text) { console.error('FAILED: use  node timedjob-cli.js "YYYY-MM-DD HH:MM" "the job"  (UK time)'); process.exit(1); }
  if (at <= Date.now() + 30000) { console.error('FAILED: that time has already passed'); process.exit(1); }
  if (at > Date.now() + 60 * 86400000) { console.error('FAILED: more than 60 days ahead; use a reminder instead'); process.exit(1); }
  const l = read();
  if (l.filter((j) => j.status === 'wait').length >= 20) { console.error('FAILED: 20 jobs are already waiting; cancel one first'); process.exit(1); }
  const id = randomBytes(4).toString('hex');
  l.push({ id, at, text, status: 'wait', setAt: Date.now() }); save(l);
  console.log(`OK id=${id} set for ${fmt.format(new Date(at))} UK time`);
}
