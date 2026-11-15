/*
 * my115 (Michael C, 15 Nov 2026): the one way a message goes to haAi, for the Send button AND every button that
 * sends for him (quick jobs, answers, Remember, I'm back, Lots to send, Broke a rule, cards, waiting ticks).
 *
 *  - Every message carries a receipt number. The server answers "got it" at once. If no answer comes within
 *    8 seconds, or the link drops first, the message is put in the "Waiting to send" list and goes again by itself
 *    when haAi is back (the server ignores a copy it already has, so nothing is sent twice).
 *  - A button that sends for him never touches what he is typing.
 *  - With no link, or while a start-up pop-up is open, a button's message waits instead of being thrown away, and
 *    the button is told it did not go yet (callers only change their own state when it really went).
 *  - "Working" can never stick: while it shows, the page asks the server every 45 s whether that chat is really
 *    still working, and clears it if not.
 */
import { S } from './state.js';

let hooks = { queueOffline: null, info: null, bubble: null, started: null, ended: null };
/** Filled in by composer.js (it owns the bubble, the Working state and the offline list), to avoid an import loop. */
export function setSendHooks(h) { hooks = { ...hooks, ...h }; }

export const newCid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const unacked = new Map();   // cid -> { text, hasAtt, timer }
const ACK_MS = 8000;

export const linkOpen = () => !!(S.ws && S.isConnected && S.ws.readyState === 1);

/** Sends one prompt frame. Returns the receipt number, or null when it could not be sent at all. */
export function sendPromptFrame(frame, text) {
  if (!linkOpen()) return null;
  const cid = frame.cid || newCid();
  const out = { ...frame, cid, chat: S.chat || undefined };
  try { S.ws.send(JSON.stringify(out)); } catch { return null; }
  const timer = setTimeout(() => lost(cid, 'no answer'), ACK_MS);
  unacked.set(cid, { text, hasAtt: !!(frame.attachments && frame.attachments.length), timer });
  return cid;
}

/** The server's "got it". */
export function promptAcked(cid) {
  const u = unacked.get(cid);
  if (!u) return;
  clearTimeout(u.timer);
  unacked.delete(cid);
}

/** The link dropped: every message still without a receipt is kept to go again. */
export function linkDropped() {
  for (const cid of [...unacked.keys()]) lost(cid, 'link dropped');
}

function lost(cid, why) {
  const u = unacked.get(cid);
  if (!u) return;
  clearTimeout(u.timer);
  unacked.delete(cid);
  if (S.ws && S.isConnected && why === 'no answer') {
    // still looks open but said nothing: treat the link as dead, so it is replaced at once
    try { S.ws.close(); } catch { /* replaced by the reconnect */ }
  }
  if (u.text && hooks.queueOffline) hooks.queueOffline(u.text, cid);
  hooks.info?.(u.hasAtt
    ? 'Your last message may not have reached haAi, and its photos could not be kept. The words will be sent again by themselves; please attach the photos again.'
    : 'Your last message may not have reached haAi, so it will be sent again by itself when the link is back.');
  hooks.ended?.();
}

/** A held-back button message (no link, or a pop-up open) waits here and goes when it can. */
const held = [];
const popupOpen = () => !!document.querySelector('.start-check');

/**
 * Sends text for a button. Returns 'sent', 'queued' (it will go by itself; the caller may still say "Sent") or
 * 'failed'. Never changes the typing box.
 */
export function sendForButton(text, opts = {}) {
  const t = String(text || '').trim();
  if (!t) return 'failed';
  if (!linkOpen()) {
    if (hooks.queueOffline) { hooks.queueOffline(t); return 'queued'; }
    hooks.info?.('No connection, so nothing was sent. Try again when haAi is back.');
    return 'failed';
  }
  if (popupOpen()) {
    held.push({ t, opts });
    hooks.info?.('Your message waits until the pop-up on screen is closed, then goes by itself.');
    return 'queued';
  }
  return sendNow(t, opts) ? 'sent' : 'failed';
}

function sendNow(t, opts) {
  const adding = S.isRunning;
  hooks.bubble?.(t, adding);
  const cid = sendPromptFrame({
    type: 'prompt',
    cid: opts.cid || undefined,
    text: (opts.context || '') + t,
    permissionMode: opts.permissionMode,
    model: localStorage.getItem('model') || undefined,
    effort: localStorage.getItem('effort') || undefined,
    add: adding || undefined,
  }, t);
  if (!cid) { hooks.queueOffline?.(t); return true; }
  hooks.started?.();
  window.dispatchEvent(new CustomEvent('haai-sent', { detail: { text: t, button: true } }));
  return true;
}

// held-back messages go once the pop-up has closed
setInterval(() => {
  if (!held.length || popupOpen() || !linkOpen()) return;
  const all = held.splice(0);
  for (const h of all) sendNow(h.t, h.opts);
}, 1000);

// ── "Working" can never stick ────────────────────────────────────────────────
let lastCheck = 0;
setInterval(() => {
  if (!S.isRunning || !linkOpen() || document.hidden) return;
  if (Date.now() - lastCheck < 45000) return;
  lastCheck = Date.now();
  try { S.ws.send(JSON.stringify({ type: 'run_check', chat: S.chat || undefined })); } catch { /* the heartbeat replaces the link */ }
}, 5000);
export function runStateAnswer(msg) {
  if (msg.running || !S.isRunning) return;
  if (msg.chat && S.chat && msg.chat !== S.chat) return;
  hooks.ended?.(true);
}
