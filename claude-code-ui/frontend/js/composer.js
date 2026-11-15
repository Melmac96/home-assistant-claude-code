/*
 * The message box: sending, stopping, the send button's two states, and the
 * keyboard shortcuts.
 */
import { noteAdded } from './batch4.js';   // my48
import { S } from './state.js';
import { askNewChat } from './multichat.js';   // my58
import { contextLine } from './embed.js';
import { attachments, clearAttachments, fileToDataURL } from './attachments.js';
import { ADD_ICON, SEND_ICON, STOP_ICON, UI_COMMANDS, clearScreen, hideCmdMenu, showHelp, showUsage } from './commands.js';
import { confirmInterrupt } from './confirm.js';
import { inputForm, permModeSelect, promptInput, sendBtn, statusDot } from './dom.js';
import { openFind } from './find.js';
import { scrollBottom } from './scroll.js';
import { openSessions } from './sessions.js';
import { hideThinking, showThinking } from './thinking.js';
import { openNewChat } from './quick.js';   // my28
import { appendErrorBubble, appendInfoLine, appendUserBubble } from './transcript.js';
import { joinKept, keepItems, keepSettled, updateKeepBtn } from './keep.js';   // my35
import { queueOffline } from './my74.js';   // my74
import { sendPromptFrame, setSendHooks } from './send.js';   // my115

// my115: the send path (send.js) draws the bubble and the Working state through these, for button messages too
setSendHooks({
  queueOffline: (t, cid) => queueOffline(t, cid),
  info: (t) => appendInfoLine(t),
  bubble: (t, adding) => { if (adding) noteAdded(t); appendUserBubble(t); scrollBottom(true); },
  started: () => { S.isRunning = true; S.usage.messages++; updateSendBtn(); showThinking(); },
  ended: (quiet) => { hideThinking(); S.isRunning = false; updateSendBtn(); if (quiet) S.lastAssistantBubble = null; },
});
// my115: a button that sends with photos borrows the typing box; what he had typed is put back afterwards
const takeKeptDraft = () => { const d = S.keepDraft; S.keepDraft = null; return d || ''; };
const restoreBox = () => {
  const d = takeKeptDraft();
  promptInput.value = d;
  if (d) localStorage.setItem('draft', d); else localStorage.removeItem('draft');
};

// ── Input form ─────────────────────────────────────────────────────────────

// my26: while Claude is working, text (or a photo) in the box turns Stop into Add.
const hasDraft = () => !!(promptInput.value.trim() || attachments.length);

sendBtn.onclick = (e) => {
  if (S.isRunning && !hasDraft()) {
    e.preventDefault();
    S.isRunning = false;
    hideThinking();
    updateSendBtn();
    if (S.ws && S.isConnected) S.ws.send(JSON.stringify({ type: 'abort' }));
  }
};

inputForm.onsubmit = async (e) => {
  e.preventDefault();
  hideCmdMenu();
  // my35: only the real Send takes the waiting tray. Buttons that send for you (quick jobs,
  // answers, Ask Claude to look) leave it alone, so nothing goes before you are ready.
  const useKeep = e.isTrusted;
  if (useKeep && !(await keepSettled())) {
    appendInfoLine('Your photos are still being saved. Nothing has been sent, please press Send again in a moment.');
    return;
  }
  const kept = useKeep ? keepItems.slice() : [];
  const boxText = promptInput.value.trim();
  const text = joinKept(kept, boxText);
  const hasAtt = attachments.some((a) => useKeep || !a.cid);
  if (!text && !hasAtt && !kept.length) return;
  if (!S.isConnected) {   // my74 H8: no connection: the words wait and go by themselves when haAi is back
    if (hasAtt || kept.length || !text || text.startsWith('/')) { appendInfoLine('No connection. Photos and commands cannot wait, so nothing was sent. Press Send again when haAi is back.'); return; }
    // my115: the box is only cleared once the message is safely in the waiting list
    if (!queueOffline(text)) { appendInfoLine('No connection, and this phone has no room left to keep the message, so it is still in the box. Press Send again when haAi is back.'); return; }
    restoreBox();
    resizeTextarea();
    updateSendBtn();
    return;
  }

  // UI slash command? handle locally (only when there's no attachment).
  const ui = !hasAtt && !kept.length && UI_COMMANDS.find((c) => '/' + c.name === text);
  if (ui) {
    runUiCommand(ui.name);
    restoreBox();
    resizeTextarea();
    updateSendBtn();
    return;
  }

  const adding = S.isRunning;   // my26: Add into the running chat, never a stop

  // Read the attachments to base64 for upload + the message bubble thumbnails.
  const pending = attachments.filter((a) => useKeep || !a.cid);
  let payload = [];
  let bubbleAtts = kept.filter((i) => i.kind === 'file').map((i) => ({ name: i.name, isImage: i.isImage, dataUrl: i.thumb }));
  let readFailed = 0;
  for (const a of pending) {
    let dataUrl = null;
    try { dataUrl = await fileToDataURL(a.file, a.isImage); } catch { dataUrl = null; }
    if (!dataUrl) { readFailed++; continue; }
    // The media type / extension may have changed (e.g. an image re-encoded to JPEG).
    const mt = (dataUrl.match(/^data:([^;]+);/) || [])[1] || a.mediaType || 'application/octet-stream';
    let name = a.name;
    if (a.isImage && /jpeg/.test(mt) && !/\.jpe?g$/i.test(name)) name = name.replace(/\.[^.]+$/, '') + '.jpg';
    payload.push({ name, mediaType: mt, data: dataUrl });
    bubbleAtts.push({ name, isImage: a.isImage, dataUrl });
  }
  if (readFailed) appendErrorBubble(`${readFailed} attachment${readFailed > 1 ? 's' : ''} could not be read and ${readFailed > 1 ? 'were' : 'was'} skipped.`);
  if (!payload.length && !text && !kept.length) { updateSendBtn(); return; }   // nothing usable to send

  // Only send a model override if the user explicitly picked one; otherwise let
  // the SDK use its default (which it reports back via the 'model' event).
  // my115: sent with a receipt number (send.js); if it cannot go, the words stay in the box and nothing is drawn
  const cid = sendPromptFrame({
    type: 'prompt',
    text: contextLine() + text,
    attachments: payload.length ? payload : undefined,
    keepIds: kept.length ? kept.map((i) => i.id) : undefined,   // my35
    permissionMode: permModeSelect.value,
    model: localStorage.getItem('model') || undefined,
    effort: localStorage.getItem('effort') || undefined,
    add: adding || undefined,
  }, text);
  if (!cid) { appendInfoLine('The link to haAi dropped just as you pressed Send, so nothing went. Your message is still in the box: press Send again in a moment.'); updateSendBtn(); return; }

  if (adding) noteAdded(text);   // my48
  appendUserBubble(text, undefined, bubbleAtts);
  scrollBottom(true);   // sending a prompt re-pins to the bottom
  restoreBox();
  clearAttachments();
  resizeTextarea();
  S.isRunning = true;
  S.usage.messages++;
  updateSendBtn();
  showThinking();
  window.dispatchEvent(new CustomEvent('haai-sent', { detail: { text, button: !e.isTrusted } }));   // my115: Lots to send count, rest nudge
};

// my26: "What were you doing?" button: one tap asks Claude to repeat its last full report.
const repeatBtn = document.getElementById('repeat-btn');
if (repeatBtn) repeatBtn.onclick = () => {
  if (!S.isConnected) { appendInfoLine('No connection, so nothing was sent. Try again when haAi is back.'); return; }   // my115: never a silent nothing
  const ask = 'What were you doing? Please repeat your last full report: what you did, and any question still waiting.';
  promptInput.value = promptInput.value.trim() ? promptInput.value.trim() + '\n\n' + ask : ask;
  promptInput.dispatchEvent(new Event('input'));
  inputForm.dispatchEvent(new Event('submit'));
};

export function doNewSession(mode) {
  if (mode !== 'alongside') {   // my58: alongside keeps this chat on screen until the server opens the new one
    clearScreen();
    S.isRunning = false;
    updateSendBtn();
  }
  if (S.ws && S.isConnected) S.ws.send(JSON.stringify({ type: 'new_session', save: true, mode }));   // my28
}

/**
 * Start a new chat, warning first if that would abandon a turn in progress.
 * Every route to a new chat goes through here — the button, /new — so the guard
 * cannot be reached around.
 */
export async function requestNewSession() {
  if (S.isRunning) {   // my58: ask each time (alongside / stop)
    const mode = await askNewChat();
    if (mode) doNewSession(mode);
    return;
  }
  doNewSession();
}

export function runUiCommand(name) {
  if (name === 'new')   openNewChat();   // my28
  else if (name === 'clear') clearScreen();
  else if (name === 'usage') showUsage();
  else if (name === 'resume') openSessions();
  else if (name === 'find')  openFind();
  else if (name === 'help')  showHelp();
}

export function resizeTextarea() {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 200) + 'px';
}

export function updateSendBtn() {
  updateKeepBtn();   // my35
  if (S.isRunning && hasDraft()) {
    sendBtn.disabled = !S.isConnected;
    sendBtn.innerHTML = ADD_ICON;
    sendBtn.setAttribute('aria-label', 'Add to the chat without stopping');
    sendBtn.classList.remove('stop');
    sendBtn.classList.add('add');
  } else if (S.isRunning) {
    sendBtn.classList.remove('add');
    sendBtn.disabled = false;
    sendBtn.innerHTML = STOP_ICON;
    sendBtn.setAttribute('aria-label', 'Stop');
    sendBtn.classList.add('stop');
  } else {
    sendBtn.disabled = (!promptInput.value.trim() && !attachments.length && !keepItems.length) || (!S.isConnected && !promptInput.value.trim());   // my74: words can wait offline
    sendBtn.innerHTML = SEND_ICON;
    sendBtn.setAttribute('aria-label', 'Send');
    sendBtn.classList.remove('stop');
    sendBtn.classList.remove('add');
  }
}

export function setStatus(state) {
  statusDot.className = `status-dot ${state}`;
}

// Auto-scroll only when the user is already pinned to the bottom. If they've
// scrolled up to read or copy something, incoming responses must NOT yank them
// back down. `S.stickToBottom` tracks whether the viewport is at (or near) the
// bottom; it's updated on every user scroll and re-armed when the user sends a
// prompt or the screen is reset. Pass force=true to re-pin explicitly.
