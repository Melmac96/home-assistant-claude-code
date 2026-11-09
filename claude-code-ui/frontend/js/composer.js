/*
 * The message box: sending, stopping, the send button's two states, and the
 * keyboard shortcuts.
 */
import { noteAdded } from './batch4.js';   // my48
import { S } from './state.js';
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
  if ((!text && !hasAtt && !kept.length) || !S.isConnected) return;

  // UI slash command? handle locally (only when there's no attachment).
  const ui = !hasAtt && !kept.length && UI_COMMANDS.find((c) => '/' + c.name === text);
  if (ui) {
    runUiCommand(ui.name);
    promptInput.value = '';
    localStorage.removeItem('draft');
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

  if (adding) noteAdded(text);   // my48
  appendUserBubble(text, undefined, bubbleAtts);
  scrollBottom(true);   // sending a prompt re-pins to the bottom
  promptInput.value = '';
  localStorage.removeItem('draft');
  clearAttachments();
  resizeTextarea();
  S.isRunning = true;
  S.usage.messages++;
  updateSendBtn();
  showThinking();

  // Only send a model override if the user explicitly picked one; otherwise let
  // the SDK use its default (which it reports back via the 'model' event).
  S.ws.send(JSON.stringify({
    type: 'prompt',
    text: contextLine() + text,
    attachments: payload.length ? payload : undefined,
    keepIds: kept.length ? kept.map((i) => i.id) : undefined,   // my35
    permissionMode: permModeSelect.value,
    model: localStorage.getItem('model') || undefined,
    effort: localStorage.getItem('effort') || undefined,
    add: adding || undefined,
  }));
};

// my26: "What were you doing?" button: one tap asks Claude to repeat its last full report.
const repeatBtn = document.getElementById('repeat-btn');
if (repeatBtn) repeatBtn.onclick = () => {
  if (!S.isConnected) return;
  const ask = 'What were you doing? Please repeat your last full report: what you did, and any question still waiting.';
  promptInput.value = promptInput.value.trim() ? promptInput.value.trim() + '\n\n' + ask : ask;
  promptInput.dispatchEvent(new Event('input'));
  inputForm.dispatchEvent(new Event('submit'));
};

export function doNewSession() {
  clearScreen();
  S.isRunning = false;
  updateSendBtn();
  if (S.ws && S.isConnected) S.ws.send(JSON.stringify({ type: 'new_session', save: true }));   // my28
}

/**
 * Start a new chat, warning first if that would abandon a turn in progress.
 * Every route to a new chat goes through here — the button, /new — so the guard
 * cannot be reached around.
 */
export async function requestNewSession() {
  if (S.isRunning) {
    const ok = await confirmInterrupt({
      body: 'Starting a new chat will stop what it is doing now. This conversation is '
          + 'saved either way — you can come back to it from Sessions.',
      confirm: 'Stop and start a new chat',
    });
    if (!ok) return;
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
    sendBtn.disabled = (!promptInput.value.trim() && !attachments.length && !keepItems.length) || !S.isConnected;
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
