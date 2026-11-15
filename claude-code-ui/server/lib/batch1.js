/*
 * my45: haAi batch 1 (user picks 2026-11-09, test page batch1-looks.html).
 *  - Remind me: a small list in /data/haai-reminders.json. Claude adds one with the command line tool
 *    (node /opt/server/lib/remind-cli.js "YYYY-MM-DD HH:MM" "text", UK time); this file sends the silent
 *    message to phone and tablet when it is due and tells every open page the list.
 *  - A standing instruction for the chat: hard-word notes, the pinned summary line, and how to set a reminder.
 */
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { SUPERVISOR_URL } from './config.js';
import { log } from './log.js';
import { broadcast } from './broadcast.js';

const FILE = '/data/haai-reminders.json';
const SERVICES = ['mobile_app_pixel_10_pro_xl', 'mobile_app_pixel_tablet'];

export function listReminders() {
  try { const l = JSON.parse(readFileSync(FILE, 'utf8')); return (Array.isArray(l) ? l : []).filter((r) => r && r.id && r.at && r.text).sort((a, b) => a.at - b.at); } catch { return []; }
}
function save(l) { writeFileSync(FILE + '.tmp', JSON.stringify(l)); renameSync(FILE + '.tmp', FILE); }
export function removeReminder(id) { save(listReminders().filter((r) => r.id !== id)); return listReminders(); }

/** Returns how many devices took it (my115: a reminder that reached neither is kept and tried again). */
async function push(text, late) {
  if (!process.env.SUPERVISOR_TOKEN) return 0;
  let ok = 0;
  for (const s of SERVICES) {
    try {
      const res = await fetch(`${SUPERVISOR_URL}/core/api/services/notify/${s}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Reminder', message: late ? `${text} (a little late, haAi was restarting)` : text, data: { channel: 'Reminders', importance: 'low', tag: 'haai-reminder' } }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) log('WARN', `reminder push ${s} returned ${res.status}`); else ok++;
    } catch (e) { log('WARN', `reminder push failed: ${e.message}`); }
  }
  return ok;
}

let last = '';
async function tick() {
  try {
    const l = listReminders();
    const now = Date.now();
    const due = l.filter((r) => r.at <= now && (!r.nextTry || r.nextTry <= now));
    if (due.length) {
      const sentIds = new Set(), keepBack = new Map();
      for (const r of due) {
        const n = await push(r.text, now - r.at > 5 * 60 * 1000);
        if (n > 0) { sentIds.add(r.id); continue; }
        // my115: it reached neither device. Try again in a minute, 5 tries, then show it on screen so it is never lost.
        const tries = (r.tries || 0) + 1;
        if (tries >= 5) { sentIds.add(r.id); log('WARN', `reminder ${r.id} could not reach phone or tablet 5 times`); broadcast({ type: 'handover_status', text: `⏰ Reminder (it could not reach your phone): ${r.text}` }); }
        else keepBack.set(r.id, { tries, nextTry: Date.now() + 60000 });
      }
      save(listReminders().filter((r) => !sentIds.has(r.id)).map((r) => (keepBack.has(r.id) ? { ...r, ...keepBack.get(r.id) } : r)));
    }
    const cur = JSON.stringify(listReminders());
    if (cur !== last) { last = cur; broadcast({ type: 'reminders', list: JSON.parse(cur) }); }
  } catch (e) { log('WARN', `reminder check failed: ${e?.message || e}`); }
}
export function startReminders() { tick(); setInterval(tick, 15000).unref?.(); }

// The standing instruction added to every chat turn.
export function batch1Prompt() {
  return [
    'HARD WORDS (haAi): Michael reads plain English. The FIRST time a technical word he may not know appears in a reply, write it as ⟦?word|plain note⟧ (the page shows the word underlined and a tap shows the note).',
    'The note is one short plain sentence, no | and no ⟧. At most 3 per reply. Never inside code, a heading, a link, a table, a question option or a question line, and never for words he uses himself.',
    'PINNED SUMMARY (haAi): when the job of this chat changes or a step is finished, put ONE line on its own line directly under your bold heading (never at the end): ⟦PIN|title|done|next⟧ where title = 3-6 plain words, done = what is finished so far in one short line, next = what comes next in one short line; no | and no ⟧ inside them. Otherwise write nothing about it. Not more than once every few replies.',
    'REMIND ME (haAi): when Michael says "remind me ..." (or asks for a reminder), first run `date` to know the UK time, then run exactly: node /opt/server/lib/remind-cli.js "YYYY-MM-DD HH:MM" "short reminder text"  (UK time, 24-hour, a future time). If it prints OK, say in one plain line when it will arrive on phone and tablet. If it fails, say so plainly; never pretend a reminder is set.',
  ].join(' ');
}
