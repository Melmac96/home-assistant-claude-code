/*
 * my46: haAi batch 2 (user: look A for every part, test page batch2-looks.html, 2026-11-09).
 *  - Morning brief: watches binary_sensor.sleeping_bedroom_sleep_as_android. When it goes on -> off the time slept is
 *    saved in /data/haai-brief.json and every page is told; the page shows ONE calm card the first time it is opened after waking.
 *  - A standing instruction for the chat: job progress, finished card, error card, approve card, picture card,
 *    "what I told you" card and the Sunday summary, all written as hidden marker lines the page turns into cards.
 */
import { readFileSync, writeFileSync, renameSync } from 'fs';
import { SUPERVISOR_URL } from './config.js';
import { log } from './log.js';
import { broadcast } from './broadcast.js';
import { getWaiting } from './handover.js';
import { getHomeHealth } from './homehealth.js';
import { overnightDoneCount } from './batch4.js';   // my48

const FILE = '/data/haai-brief.json';
const SLEEP = 'binary_sensor.sleeping_bedroom_sleep_as_android';
const read = () => { try { return JSON.parse(readFileSync(FILE, 'utf8')) || {}; } catch { return {}; } };
const save = (o) => { writeFileSync(FILE + '.tmp', JSON.stringify(o)); renameSync(FILE + '.tmp', FILE); };

export function getBrief() {
  const b = read();
  if (!b.wokeAt || Date.now() - b.wokeAt > 6 * 3600 * 1000) return null;
  const h = getHomeHealth();
  return { wokeAt: b.wokeAt, sleptMin: b.sleptMin ?? null, home: h.status === 'good' ? 'fine' : h.status === 'bad' ? `${h.count} thing(s) need a look` : 'not checked', waiting: getWaiting().length, overnight: overnightDoneCount() };
}

async function tick() {
  try {
    const res = await fetch(`${SUPERVISOR_URL}/core/api/states/${SLEEP}`, { headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` } });
    if (!res.ok) return;
    const st = (await res.json()).state;
    const b = read();
    if (st === 'on' && !b.sleepStart) { save({ ...b, sleepStart: Date.now() }); }
    else if (st === 'off' && b.sleepStart) {
      const mins = Math.round((Date.now() - b.sleepStart) / 60000);
      save({ wokeAt: Date.now(), sleptMin: mins >= 60 ? mins : null });   // a short nap is not "last night"
      broadcast({ type: 'brief', brief: getBrief() });
    }
  } catch (e) { log('WARN', `morning brief check failed: ${e?.message || e}`); }
}
export function startBrief() { tick(); setInterval(tick, 60000).unref?.(); }

export function batch2Prompt() {
  return [
    'CARDS (haAi): write these hidden marker lines on their own line; the page turns each into a card. No | and no ⟧ inside any field; keep every field one short plain line.',
    'PROGRESS: while doing a job of 3 or more steps, put ⟦STEP|n|total|what is happening now|what comes next⟧ under your bold heading in each message you write between steps.',
    'FINISHED: when a job that changed something is done, end your reply with ⟦DONE|what changed|how many files|where the undo is⟧ (it shows It works / Not working buttons). Never call it fixed in words; he confirms with the button.',
    'ERROR: when a step fails, write ⟦ERR|likely cause in everyday words|technical detail⟧ instead of pasting error text.',
    'APPROVE: for a real choice that changes a setting write ⟦ASK|what you want to change|from|to|when or where⟧ (Yes / Not now buttons). Do not use it for things he already said yes to, and never as well as a lettered question for the same thing.',
    'PICTURE: only when a real picture file of a page you made exists as an address starting with http://192.168.1.168/local/, write ⟦SHOW|that address|short caption⟧.',
    'WHAT YOU TOLD ME: when he asks what you remember about him or his rules, write ⟦MEM|first thing|second thing|...⟧ (up to 8 short items) with the real facts from your rule files.',
    'WEEK: when he asks for the weekly summary write ⟦WEEK|jobs done|waiting for him|problems found⟧ with the real numbers from CHANGES.md and the waiting list; never invent numbers.',
  ].join(' ');
}
