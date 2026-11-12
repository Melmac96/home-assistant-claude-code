// my87: Claude asks haAi to carry the job on in a fresh chat once this reply is finished.
//   node nextchat-cli.js "what the next chat must do"      node nextchat-cli.js status      node nextchat-cli.js cancel
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { randomBytes } from 'crypto';
const FILE = '/data/haai-nextchat.json', LOG = '/data/haai-nextchat-log.json';
const read = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const save = (f, j) => { writeFileSync(f + '.tmp', JSON.stringify(j, null, 1)); renameSync(f + '.tmp', f); };
const [cmd] = process.argv.slice(2);
const cur = read(FILE, null);
if (cmd === 'status') { console.log(cur ? `${cur.status} ${new Date(cur.at).toISOString()} ${String(cur.text).slice(0, 120)}` : 'nothing waiting'); process.exit(0); }
if (cmd === 'cancel') { if (cur && cur.status === 'wait') { cur.status = 'cancelled'; save(FILE, cur); console.log('OK cancelled'); } else console.log('OK nothing waiting'); process.exit(0); }
const text = String(cmd || '').trim().slice(0, 4000);
if (!text) { console.error('FAILED: use  node nextchat-cli.js "what the next chat must do"'); process.exit(1); }
if (cur && (cur.status === 'wait' || cur.status === 'running')) { console.error('FAILED: a move to a new chat is already waiting (status, or cancel it first)'); process.exit(1); }
const day = Date.now() - 86400000, log = read(LOG, []).filter((t) => t > day);
if (log.length >= 12) { console.error('FAILED: 12 new chats were already started by themselves today; ask Michael'); process.exit(1); }
log.push(Date.now()); save(LOG, log);
save(FILE, { id: randomBytes(4).toString('hex'), text, at: Date.now(), status: 'wait', slot: null });
console.log('OK the next part starts in a fresh chat as soon as this reply is finished');
