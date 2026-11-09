// my45: command line for Claude to set / list / remove haAi reminders (UK time).  node remind-cli.js "2026-11-09 15:00" "take the tablet"
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { randomBytes } from 'crypto';
const FILE = '/data/haai-reminders.json';
const read = () => { try { const l = JSON.parse(readFileSync(FILE, 'utf8')); return Array.isArray(l) ? l : []; } catch { return []; } };
const save = (l) => { writeFileSync(FILE + '.tmp', JSON.stringify(l)); renameSync(FILE + '.tmp', FILE); };
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function ukToEpoch(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return null;
  const want = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    guess += want - shown;
  }
  return guess;
}
const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'list') {
  for (const r of read().sort((x, y) => x.at - y.at)) console.log(r.id, fmt.format(new Date(r.at)), r.text);
} else if (cmd === 'remove') {
  save(read().filter((r) => r.id !== a)); console.log('OK removed');
} else {
  const at = ukToEpoch(cmd), text = String(a || '').trim().slice(0, 200);
  if (at == null || !text) { console.error('FAILED: use  node remind-cli.js "YYYY-MM-DD HH:MM" "text"  (UK time)'); process.exit(1); }
  if (at <= Date.now() + 20000) { console.error('FAILED: that time has already passed'); process.exit(1); }
  const l = read(); l.push({ id: randomBytes(4).toString('hex'), at, text }); save(l);
  console.log('OK reminder set for ' + fmt.format(new Date(at)) + ' UK time');
}
