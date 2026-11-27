/*
 * my161 (Michael 2026-11-27): Alf Ai 2 and Alf Ai 3, two more whole Alf Ai apps. Each app is one "window" fixed to its own
 * chat (slot.win 1, 2 or 3). His answers (27 Nov, Q1 B, Q2 A, Q3 A):
 *  - the main window (1) follows the account turns exactly as before;
 *  - in windows 2 and 3 he picks the account by hand (slot.pin);
 *  - a window whose account runs out moves on to the next free account by itself and keeps the chat (the pin moves with it);
 *  - when every usable account is in use, two windows share one and the tab says so.
 * Holds and Main's 75% still win, and the 4th outside its turn is never offered (his fixed rule, 23 Nov).
 */
import { chooseAccount, isRested, capFor, five, week, fourthEmail, fourthWindow, isMain } from './my90.js';
import { log } from './log.js';

const lc = (e) => String(e || '').toLowerCase();

/** Why this account cannot be picked by hand right now ('' = it can). */
export function whyNot(a, saved) {
  if (!a) return 'Not saved';
  if (isRested(a.email)) return 'On hold';
  const f = five(a.email), w = week(a.email), cap = capFor(a.email);
  if ((f.used ?? 0) >= cap || (w.used ?? 0) >= cap) return isMain(a.email) ? 'At its 75% limit' : 'Used up for now';
  if (lc(a.email) === fourthEmail()) { const t = fourthWindow(saved); if (t && !t.on) return 'Not its turn yet'; }
  return '';
}

/** The accounts a window can be put on, in the Accounts page order is done on the page. */
export function pinOptions(saved) {
  return (saved || []).map((a) => {
    const f = five(a.email), w = week(a.email);
    return { email: a.email, why: whyNot(a, saved), five: f.used == null ? null : Math.round(f.used), week: w.used == null ? null : Math.round(w.used) };
  });
}

/**
 * The next free account by the usual turn rules, sharing another window's account only when nothing else is left.
 * The 4th outside its turn is kept out of the first try, so sharing comes before it (his 23 Nov rule: last resort only
 * when the 2nd and 3rd are full and Main is at 75%).
 */
export function chooseFree(saved, used, on) {
  const t = fourthWindow(saved), e4 = fourthEmail();
  const ex = new Set(used);
  if (t && !t.on) for (const a of saved) if (lc(a.email) === e4) ex.add(a.email);
  return chooseAccount(saved, ex, on) || chooseAccount(saved, new Set(), on);
}

/**
 * The account for a window chat with a hand pick. Its own pick while that one can be used; otherwise the next free account
 * by the usual turn rules (another window's account only when nothing else is left), and the pick moves there.
 * null = nothing usable at all: the usual path (red warning) carries on.
 */
export function pinPick(slot, saved, used, on) {
  const mine = saved.find((a) => lc(a.email) === lc(slot.pin));
  const why = whyNot(mine, saved);
  if (mine && !why) return mine;
  const nx = chooseFree(saved, used, on);
  if (!nx) return null;
  log('INFO', `my161: window ${slot.win} moves from ${slot.pin} (${why}) to ${nx.email}`);
  slot.pinNote = `Moved from ${slot.pin} (${why.toLowerCase()})`;
  slot.pin = nx.email;
  return nx;
}
