// my102: Claude runs this to rest / wake a saved Claude account.
//   node rest-cli.js status | rest <main|2nd|3rd|email-part> <6h|90m|2d|"YYYY-MM-DD HH:MM" UK> | wake <account|all>
import { readFileSync } from 'fs';
import { restedMap, setRest } from './my90.js';
const acctDir = '/data/claude-accounts';
import { readdirSync } from 'fs';
const emails = () => readdirSync(acctDir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(readFileSync(acctDir + '/' + f, 'utf8')).email; } catch { return null; } }).filter(Boolean);
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const all = emails();
function pick(w) {
  w = String(w || '').toLowerCase();
  if (w === '2nd') w = 'thereades.uk@gmail.com'; if (w === '3rd') w = 'rf.mike@gmail.com';
  if (w === 'main') w = (JSON.parse(readFileSync('/data/haai-prefs.json', 'utf8')).mainAccount || 'thereades@gmail.com').toLowerCase();
  const hit = all.filter((e) => e.toLowerCase() === w);
  const part = hit.length ? hit : all.filter((e) => e.toLowerCase().includes(w));
  return part.length === 1 ? part[0] : null;
}
function ukToEpoch(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/); if (!m) return null;
  const want = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]); let g = want;
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  for (let i = 0; i < 3; i++) { const p = Object.fromEntries(f.formatToParts(new Date(g)).map((x) => [x.type, x.value])); g += want - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute); }
  return g;
}
const [cmd, who, len] = process.argv.slice(2);
const show = () => { const m = restedMap(); const k = Object.keys(m); console.log(k.length ? k.map((e) => `${e} rests until ${fmt.format(new Date(m[e]))} UK time`).join('\n') : 'No account is resting.'); };
if (cmd === 'status' || !cmd) show();
else if (cmd === 'wake') {
  if (who === 'all') for (const e of Object.keys(restedMap())) setRest(e, 0); else { const e = pick(who); if (!e) { console.error('FAILED: which account?'); process.exit(1); } setRest(e, 0); }
  console.log('OK'); show();
} else if (cmd === 'rest') {
  const e = pick(who); if (!e) { console.error('FAILED: which account? ' + all.join(', ')); process.exit(1); }
  let until = null; const m = String(len || '').match(/^(\d+(?:\.\d+)?)\s*(m|h|d)/i);
  if (m) until = Date.now() + Number(m[1]) * { m: 60000, h: 3600000, d: 86400000 }[m[2].toLowerCase()]; else until = ukToEpoch(len);
  if (!until || until <= Date.now() + 30000 || until > Date.now() + 14 * 86400000) { console.error('FAILED: give a length like 6h, 90m, 2d or a UK time "YYYY-MM-DD HH:MM" (up to 14 days)'); process.exit(1); }
  setRest(e, until); console.log('OK'); show();
} else { console.error('FAILED: status | rest <account> <length> | wake <account|all>'); process.exit(1); }
