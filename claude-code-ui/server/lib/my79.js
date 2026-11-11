/*
 * my79 (the last 6 of Michael's 12 picks, twelve-ideas-looks.html, 2026-11-11):
 *  H5  weekly rule clash check (Look A): Claude writes ⟦CLASH|…⟧ in the weekly checks; the card is drawn by the page.
 *  H9  typing follows him between phone and tablet (Look A): the last words typed, per browser, passed to the others.
 *  H10 dated checks (Look B): Waiting-list lines with show_from become "Checks for today" once due; a line's
 *      optional `check` (a Home Assistant template) is worked out first, so he only has to agree.
 *  H11 next thing to expire (Look B): one line in the morning brief, from /config/opencode/expiry.json.
 *  H12 haAi checks itself (Look A): free-mode switch, phone tools (adb), backup size, shown under the heart.
 *  H17 a job at a set time (Look B): Claude sets it with timedjob-cli.js and writes ⟦TIMED|…⟧ (card with Cancel).
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { SUPERVISOR_URL, DEFAULT_PERMISSION_MODE } from './config.js';
import { log } from './log.js';
import { broadcast } from './broadcast.js';
import { getWaiting } from './handover.js';
import { chats, view, inChat } from './chats.js';

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')) ?? d; } catch { return d; } };
const saveJson = (f, o) => { writeFileSync(f + '.tmp', JSON.stringify(o, null, 1)); renameSync(f + '.tmp', f); };
const ha = (path, opts = {}) => fetch(`${SUPERVISOR_URL}${path}`, { ...opts, headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000) });
const ukFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const ukDay = (ms) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/London' });

// ── H17 jobs at a set time ───────────────────────────────────────────────────
const TIMED = '/data/haai-timed.json';
const readTimed = () => { const l = readJson(TIMED, []); return Array.isArray(l) ? l : []; };
let runner = null;
export function setTimedRunner(fn) { runner = fn; }
export const listTimed = () => readTimed().map((j) => ({ id: j.id, at: j.at, text: j.text, status: j.status, ranAt: j.ranAt || null }));
let timedKey = '';
function timedChanged() { const k = JSON.stringify(listTimed()); if (k !== timedKey) { timedKey = k; broadcast({ type: 'timed', list: listTimed() }); } }
export function cancelTimed(id) {
  const l = readTimed();
  const j = l.find((x) => x.id === id);
  if (j && j.status === 'wait') { j.status = 'cancelled'; saveJson(TIMED, l); log('INFO', `my79: timed job ${id} cancelled`); }
  timedChanged();
}
function pickSlot() {   // the chat he last looked at, else any other not working; never the grey free chat (privacy)
  const ok = (s) => s && !s.free && !s.query;
  const last = chats.get(view.last);
  if (ok(last)) return last;
  return [...chats.values()].find(ok) || null;
}
function timedTick() {
  try {
    const l = readTimed();
    const now = Date.now();
    let dirty = false;
    const keep = l.filter((j) => j.status === 'wait' || now - (j.ranAt || j.at) < 3 * 86400000);   // done/cancelled lines go after 3 days
    if (keep.length !== l.length) dirty = true;
    const due = keep.find((j) => j.status === 'wait' && j.at <= now);
    if (due && runner) {
      const slot = pickSlot();
      if (slot) {
        due.status = 'ran'; due.ranAt = now; dirty = true;
        saveJson(TIMED, keep);
        log('INFO', `my79: starting timed job ${due.id} in ${slot.id}`);
        const when = ukFmt.format(new Date(due.at));
        inChat(slot, () => runner({ readyState: 3 }, { text: `[Job Michael set earlier for ${when} UK time. Do it now, then report in a few plain lines. If Sleep as Android shows he is asleep, send no message that makes a sound.]\n\n${due.text}`, permissionMode: DEFAULT_PERMISSION_MODE }));
      }
    }
    if (dirty) saveJson(TIMED, keep);
  } catch (e) { log('WARN', `timed job check failed: ${e?.message || e}`); }
  timedChanged();
}

// ── H10 checks for today ─────────────────────────────────────────────────────
let checks = [];
export const getDatedChecks = () => checks;
async function render(tpl) {
  try {
    const r = await ha('/core/api/template', { method: 'POST', body: JSON.stringify({ template: String(tpl) }) });
    if (!r.ok) return null;
    const t = (await r.text()).replace(/\s+/g, ' ').trim().slice(0, 160);
    return t || null;
  } catch { return null; }
}
let checksKey = null;
async function checksRound() {
  try {
    const due = getWaiting().filter((w) => w.show_from);
    const out = [];
    for (const w of due) out.push({ id: w.id, text: w.text, found: w.check ? await render(w.check) : null });
    checks = out;
    const k = JSON.stringify(out);
    if (k !== checksKey) { checksKey = k; broadcast({ type: 'dated_checks', list: out }); }
  } catch (e) { log('WARN', `dated checks failed: ${e?.message || e}`); }
}
export function checksAfterTick() { setTimeout(checksRound, 500); }

// ── H11 next thing to expire ─────────────────────────────────────────────────
const EXPIRY = '/config/opencode/expiry.json';
export function nextExpiry(now = Date.now()) {
  const l = readJson(EXPIRY, []);
  if (!Array.isArray(l)) return null;
  const today = Date.parse(ukDay(now) + 'T00:00:00Z');
  const rows = l.map((x) => ({ name: String(x.name || '').slice(0, 40), date: String(x.date || ''), approx: !!x.approx }))
    .filter((x) => x.name && /^\d{4}-\d\d-\d\d$/.test(x.date))
    .map((x) => ({ ...x, days: Math.round((Date.parse(x.date + 'T00:00:00Z') - today) / 86400000) }))
    .filter((x) => x.days >= -7)
    .sort((a, b) => a.days - b.days);
  const n = rows[0];
  if (!n) return null;
  const d = new Date(n.date + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const text = n.days < 0 ? `${n.name} ran out on ${d}` : n.days === 0 ? `${n.name} runs out today` : `${n.name} in ${n.approx ? 'about ' : ''}${n.days} day${n.days === 1 ? '' : 's'} (${d})`;
  return { text, soon: n.days < 7 };
}

// ── H12 haAi checks itself ───────────────────────────────────────────────────
const BACKUP_LIMIT_GB = 5, BACKUP_WARN_GB = 4.5;
let self = [];
export const getHaaiChecks = () => self;
async function selfRound() {
  const out = [];
  let watch = false;
  try { const pid = readFileSync('/data/.config/claude/openrouter-watch.pid', 'utf8').trim(); watch = /^\d+$/.test(pid) && readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('openrouter_switch.py'); } catch { watch = false; }
  out.push(watch ? { ok: true, text: 'Free-mode switch running' } : { ok: false, text: 'Free-mode switch is not running (a new chat starts it again)' });
  out.push(existsSync('/usr/bin/adb') ? { ok: true, text: 'Phone and TV tools (adb) installed' } : { ok: false, text: 'Phone and TV tools (adb) missing after an update' });
  try {
    const r = await ha('/backups');
    const list = ((await r.json()).data?.backups || []).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const b = [...list].reverse().find((x) => /^Automatic backup/.test(x.name || '')) || list[list.length - 1];
    if (!b) out.push({ ok: false, text: 'No backup found' });
    else {
      const gb = Number(b.size) / 1000;
      out.push({ ok: gb < BACKUP_WARN_GB, text: `Last backup ${gb.toFixed(1)} of ${BACKUP_LIMIT_GB} GB${gb < BACKUP_WARN_GB ? '' : ' (close to the Cloud limit)'}` });
    }
  } catch { out.push({ ok: false, text: 'Could not read the backup size' }); }
  self = out;
}

// ── H9 the words being typed, passed between his devices ─────────────────────
let draft = { text: '', from: '', kind: '', at: 0 };
export const getDraft = () => (Date.now() - draft.at < 2 * 3600 * 1000 ? draft : null);
export function setDraft(msg) {
  const text = String(msg.text || '').slice(0, 8000);
  const from = String(msg.from || '').slice(0, 40);
  if (!from || (text === draft.text && from === draft.from)) return;
  draft = { text, from, kind: msg.kind === 'tablet' ? 'tablet' : 'phone', at: Date.now() };
  broadcast({ type: 'draft', ...draft });
}

export function startMy79() {
  setInterval(timedTick, 30 * 1000).unref?.(); timedTick();
  setTimeout(checksRound, 25 * 1000); setInterval(checksRound, 5 * 60 * 1000).unref?.();
  selfRound(); setInterval(selfRound, 10 * 60 * 1000).unref?.();
}

export function my79Prompt() {
  return [
    'AT A SET TIME (haAi): when Michael asks for a job at a time ("at 3pm check the Toilet humidity"), first run `date` for the UK time, then run exactly: node /opt/server/lib/timedjob-cli.js "YYYY-MM-DD HH:MM" "the job written out in full so a fresh reply can do it alone" (UK time, 24-hour, future). If it prints OK with an id, write ⟦TIMED|that id|the time in plain words, e.g. 15:00 UK time today|the job in one short line⟧ (the card has Cancel). Never claim it is set if it failed.',
    'DATED CHECKS (haAi): a check that can only be done on a later day goes on /config/opencode/waiting-for-you.json with show_from "YYYY-MM-DD HH:MM" (UK). When Home Assistant itself can answer it, add "check": a template that prints one short plain answer ending in ✓ or ✗ (e.g. went up 1.2 kWh ✓); haAi works it out and he just agrees.',
    'RULE CLASH (haAi): in the weekly checks, for each pair of his rules that say different things write ⟦CLASH|rule 1 in his words, short|rule 2 in his words, short|where they are⟧ (Keep rule 1 / Keep rule 2 / Both buttons); if none, say "No rule clashes found".',
  ].join(' ');
}
