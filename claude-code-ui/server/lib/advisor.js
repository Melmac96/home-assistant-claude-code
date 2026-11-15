/*
 * my42: MODEL ADVISOR (user, 2026-11-08; Look C card, Claude judges after he sends, switches back after the job).
 * Claude is told (standing instruction added to the chat) to put ONE hidden line right under its bold heading
 * when a different model clearly fits the job:   ⟦ADVISE|opus|high|kind|reason⟧   (or haiku|low, or ⟦ADVISE|back⟧ when
 * the job on the advised model is finished). The page hides the line and shows a card with two buttons.
 * Left alone: a model/effort Michael chose himself (only the shared default, Sonnet on Medium, is advised),
 * nothing when the Settings switch is off, and no second offer for the same kind of job after "Stay on Sonnet".
 */
import { readFileSync, writeFileSync, renameSync } from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';

const FILE = path.join(DATA_DIR, 'haai-advisor.json');
const DEF = { enabled: true, advised: false, declined: [], slimGone: false, handled: [] };   // my104: slimGone + handled shared by every device   // declined: [{kind, at}]
const DECLINE_MS = 2 * 60 * 60 * 1000;

export function getAdvisor() {
  try {
    const j = JSON.parse(readFileSync(FILE, 'utf8'));
    return {
      enabled: j.enabled !== false, advised: !!j.advised,
      slimGone: !!j.slimGone, handled: (Array.isArray(j.handled) ? j.handled : []).filter((k) => typeof k === 'string').slice(-40),
      declined: (Array.isArray(j.declined) ? j.declined : []).filter((d) => d && d.kind && Date.now() - d.at < DECLINE_MS).slice(-5),
    };
  } catch { return { ...DEF, declined: [], handled: [] }; }
}
export function setAdvisor(patch) {
  const cur = getAdvisor();
  const next = { ...cur };
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
  if (typeof patch.advised === 'boolean') next.advised = patch.advised;
  if (patch.declineKind) next.declined = [...cur.declined, { kind: String(patch.declineKind).slice(0, 40), at: Date.now() }].slice(-5);
  if (patch.clearDeclined) next.declined = [];
  // my104 (Michael 15 Nov): the ✕ on 'Using a different model' and an answered Suggestion clear on EVERY device
  if (typeof patch.slimGone === 'boolean') next.slimGone = patch.slimGone;
  if (next.advised === false) next.slimGone = false;   // the next switch shows the line again
  if (typeof patch.handledKey === 'string' && patch.handledKey) next.handled = [...new Set([...cur.handled, patch.handledKey.slice(0, 200)])].slice(-40);
  writeFileSync(FILE + '.tmp', JSON.stringify(next));
  renameSync(FILE + '.tmp', FILE);
  return next;
}

const FREE_LINE = 'FREE OR ANOTHER ACCOUNT (Michael 15 Nov, my114): "if the turn can be done just as well for free then it should be done by a free account". So EVERY ⟦ADVISE|...⟧ line ends with two more fields: |free|freenote  where free = same (a free model would do this job just as well), worse (it could, but not as well) or private (health, home security, money, passwords or private files: those NEVER go to a free model), and freenote = one short plain sentence saying why. A free chat starts fresh and cannot see this chat, so say same only when the job stands on its own. Example: ⟦ADVISE|haiku|low|quick check|One state to read back.|same|A free model reads one state just as well.⟧ The card offers the switch on this account, the other paid account with the most room, and the free chat, by itself; you only give the verdict. When no model change is needed but a free model would clearly do the job just as well, write ⟦ADVISE|free|-|kind|reason|same|freenote⟧.';
// my114: used when a model was chosen by hand or advised: only the free suggestion is allowed then.
const FREE_ONLY = 'Only when a free model would CLEARLY do THIS job just as well (it stands on its own and is not private: no health, home security, money, passwords or private files), put this line on its own line under your bold heading: ⟦ADVISE|free|-|kind|reason|same|freenote⟧ (kind = 1-3 plain words, reason and freenote = one short plain sentence each, no | and no ⟧). He gets a button that does it in a free chat. Otherwise write nothing about it.';
const skipText = (a) => a.declined.length ? ` He said "Stay as I am" for these kinds of job, so do NOT suggest again for them: ${a.declined.map((d) => d.kind).join(', ')}.` : '';
const isDefaultChoice = (model, effort) => (!model || /sonnet/i.test(model)) && (!effort || effort === 'medium');

// The standing instruction added to the chat for this turn (or '' = none).
export function advisorPrompt(model, effort) {
  let a = getAdvisor();
  if (!a.enabled) return '';
  // my54: the 'advised' flag could stay stuck on after the model was put back to the default by hand or by a restart, which
  // silenced the advisor for good (found 2026-11-09, flag stuck since 12:45). The real model and effort win.
  if (a.advised && isDefaultChoice(model, effort)) a = setAdvisor({ advised: false });
  if (a.advised) {
    return FREE_ONLY + ' ' + [
      'MODEL ADVISOR (haAi): this chat was switched to a different model for one job. When that job is FINISHED and you are not expecting more steps of it,',
      'put this single line on its own line directly under your bold heading: ⟦ADVISE|back⟧  (nothing else on it). Otherwise write nothing about the advisor.',
    ].join(' ');
  }
  // my114: his own model choice is left alone, but a job a free model does just as well is still offered to the free chat
  if (!isDefaultChoice(model, effort)) return 'MODEL ADVISOR (haAi): ' + FREE_ONLY + skipText(a);
  const skip = skipText(a);
  return [
    'MODEL ADVISOR (haAi), normal turn, costs nothing extra. Judge THIS request before you answer.',
    'Only when it is a CLEAR case, put ONE line on its own line directly under your bold heading (never at the end of the message), exactly in this form:',
    '⟦ADVISE|opus|high|kind|reason⟧  when the job is probably hard enough that Sonnet on Medium is likely to need a redo (a long multi-step build, tricky debugging, a risky change, a big design) -  suggest it also when the job is only PROBABLY hard (user choice);',
    '⟦ADVISE|haiku|low|kind|reason⟧  when the job is clearly small and simple (a one-line fact, a quick status check, a tiny edit, a short rewrite).',
    '"kind" = 1-3 plain words naming the kind of job (e.g. debugging, quick check). "reason" = one short plain-English sentence with no | and no ⟧.',
    'Opus on High uses roughly two-thirds more allowance per reply than Sonnet, but can be cheaper overall if Sonnet would need a redo. Haiku should use less, but that saving is a guess, not measured: say so in the reason.',
    'Judge EVERY request, not only the first one of a chat, and judge the job that is coming up, not only what was literally asked.',
    'MUST: whenever he asks you whether a different model or effort would be better, or you say in words that one would suit the job better, you MUST also put the ⟦ADVISE|...⟧ line in that same reply (he gets the Switch button from it; a plain-words yes with no line is a failure).',
    'Opus on High fits: building or changing an app or add-on, debugging that is not obvious, anything touching several files or devices, security or money, a plan that needs careful thought, work that already went wrong once in this chat.',
    'Haiku on Low fits: a single fact, a status check, reading one file back, a one-line edit, a short rewrite, a yes/no.',
    'Still answer the request normally in the same reply. If it is not a clear case, write NOTHING about the advisor. Never suggest twice in a row for the same kind of job.' + skip,
    FREE_LINE,
  ].join(' ');
}

// my44: JOBS under one chat. Standing instruction so side jobs show up as numbered jobs with the model named.
export function jobsPrompt() {
  return [
    'JOBS (haAi): when a request has a separate side job that can run while you carry on talking (a long check, a tidy-up, a search),',
    'you may run it as a background subagent. Start its description with the model in square brackets, e.g. "[Haiku] check Apple TV drops" or "[Sonnet] tidy the sleep page",',
    'and use the cheapest model that can do it well (Haiku for simple read-only jobs). Never put health, money or security jobs on anything but Claude. Do not start side jobs he did not ask for.',
  ].join(' ');
}
