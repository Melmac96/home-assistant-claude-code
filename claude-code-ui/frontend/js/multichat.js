/*
 * my58: SEVERAL CHATS AT ONCE. my77 (Michael 2026-11-11, three-chats plan, Way 1, colours A):
 *  - up to THREE chats; each keeps its own account; tabs under the top bar show name, state, account and cost so far;
 *  - ALL-IN-ONE window: the chats stay separate behind the scenes, but every chat's messages are shown together,
 *    each in its own colour box (Purple, Gold, Teal; a free-account chat is grey);
 *  - colour buttons above the typing box choose which chat the next message goes to; tap the chosen one again to
 *    see only that chat; All shows everything again. Answer buttons inside a colour box go to that box's chat;
 *  - a pinned line at the top when a chat needs your answer (tap to jump to it);
 *  - the New chat icon opens a small list: New chat here, Open a 2nd chat, Open a 3rd chat, Open a chat on a free account.
 * With only one chat everything looks exactly as before.
 *
 * How: the page keeps ONE message list. While a message for chat X is drawn, the few values the drawing code keeps
 * (the reply being written, the tool group, the Working… line, running or not) are swapped to chat X's own copy,
 * then swapped back. Every top-level item in the list is tagged with its chat (data-chat) and time (data-t).
 */
import { S } from './state.js';
import { messagesEl, newSessionBtn, promptInput } from './dom.js';
import { renderHistory, toolCallEls, appendInfoLine } from './transcript.js';
import { showThinking } from './thinking.js';
import { updateSendBtn } from './composer.js';
import { refreshBgTasksStrip } from './banners.js';
import { openNewChat } from './quick.js';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const send = (o) => { if (S.ws && S.isConnected) S.ws.send(JSON.stringify(o)); };
const toast = (text) => { const t = mk('div', 'guard-toast', text); t.onclick = () => t.remove(); document.body.append(t); setTimeout(() => t.remove(), 7000); };

S.chat = S.chat || null;      // the chat the next message goes to
S.chatList = [];
S.chatsMax = 3;
S.chatsWorking = 0;
S.only = null;                // a chat shown by itself, or null = all chats together
S.renderChat = null;          // the chat whose drawing values are in S right now

// Messages that belong to ONE chat. Everything else (usage, accounts, settings...) is for every screen.
const PER_CHAT = new Set(['history', 'background_tasks', 'task_notice', 'agent_report', 'cleared', 'user', 'text', 'tool_use', 'tool_result',
  'permission_request', 'permission_resolved', 'result', 'run_idle', 'context_usage', 'compacted', 'user_dialog', 'user_dialog_cancelled',
  'error', 'aborted', 'session', 'model']);

export const merged = () => S.chatList.length > 1;
const byId = (id) => S.chatList.find((c) => c.id === id);
const label = (c) => (c ? `Chat ${c.n}${c.colourName ? ` (${c.colourName})` : ''}` : 'this chat');

/** True when this message is about another chat and must not touch the screen (only while there is ONE chat listed). */
export function isOtherChat(msg) {
  if (merged()) return false;
  return !!(msg.chat && S.chat && msg.chat !== S.chat && PER_CHAT.has(msg.type));
}

// ── each chat's own drawing values ───────────────────────────────────────────
const FIELDS = ['lastAssistantBubble', 'currentToolGroup', 'thinkingEl', 'isRunning', 'backgroundTasks', 'usage', 'ctxUsage', 'limitOffer'];
const fresh = () => ({ lastAssistantBubble: null, currentToolGroup: null, thinkingEl: null, isRunning: false, backgroundTasks: [],
  usage: { messages: 0, turns: 0, cost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, ctxUsage: null, limitOffer: null });
const ctx = {};
function swapTo(id) {
  if (!id || id === S.renderChat) return;
  if (S.renderChat) { const cur = ctx[S.renderChat] || (ctx[S.renderChat] = {}); for (const f of FIELDS) cur[f] = S[f]; }
  const nx = ctx[id] || fresh();
  for (const f of FIELDS) S[f] = nx[f];
  S.renderChat = id;
}

/** Tag every untagged top-level item with its chat and time. inherit = history (take the time of the item before). */
function sweep(id, inherit = false) {
  if (!id) return;
  let lastT = 0;
  for (const n of messagesEl.children) {
    if (n.id === 'quick-tiles') continue;
    if (!n.dataset.chat) n.dataset.chat = id;
    if (!n.dataset.t) n.dataset.t = String(inherit && n.dataset.chat === id && lastT ? lastT : Date.now());
    if (n.dataset.chat === id) lastT = Number(n.dataset.t) || lastT;
  }
  if (merged()) markFirsts();
}

/** The small "Chat 2 · Gold" name above the first item of each run of one chat's items. */
function markFirsts() {
  let prev = null;
  for (const n of messagesEl.children) {
    if (n.id === 'quick-tiles' || n.classList.contains('thinking')) { if (n.classList.contains('thinking')) n.dataset.mclabel = label(byId(n.dataset.chat)); continue; }
    const c = n.dataset.chat;
    const first = c !== prev;
    n.classList.toggle('mc-first', first);
    if (first) n.dataset.mclabel = label(byId(c));
    prev = c;
  }
}

/** Put the items of all chats in time order (each chat's own order is kept). Working… lines go last. */
function reorder() {
  const items = [...messagesEl.children].filter((n) => n.id !== 'quick-tiles' && !n.classList.contains('thinking'));
  const thinking = [...messagesEl.children].filter((n) => n.classList.contains('thinking'));
  const groups = {};
  for (const n of items) (groups[n.dataset.chat || '?'] = groups[n.dataset.chat || '?'] || []).push(n);
  const queues = Object.values(groups);
  const out = [];
  while (queues.some((q) => q.length)) {
    let best = null;
    for (const q of queues) if (q.length && (!best || Number(q[0].dataset.t) < Number(best[0].dataset.t))) best = q;
    out.push(best.shift());
  }
  for (const n of [...out, ...thinking]) messagesEl.appendChild(n);
  if (out.length) document.getElementById('quick-tiles')?.remove();
  markFirsts();
}

// ── drawing a message for the right chat ─────────────────────────────────────
/** Called by connection.js for every server message that is not about the chat list. */
export function dispatch(msg, handleOne) {
  if (!merged()) {
    handleOne(msg);
    try { sweep(S.chat, msg.type === 'history'); } catch { /* tagging is only a help */ }
    return;
  }
  const id = (PER_CHAT.has(msg.type) && (msg.chat || S.chat)) || null;
  if (!id) { handleOne(msg); return; }
  if (msg.type === 'permission_request' && !msg.clash && msg.title && !msg.title.startsWith('Chat ')) msg = { ...msg, title: `${label(byId(id))}: ${msg.title}` };
  if (msg.type === 'history') { historyFor(id, msg, handleOne); return; }
  if (msg.type === 'cleared') { clearedFor(id); return; }
  const back = S.chat;
  swapTo(id);
  try { handleOne(msg); }
  finally {
    try { sweep(id, false); } catch { /* tagging is only a help */ }
    swapTo(back);
    if (id !== back) { updateSendBtn(); refreshBgTasksStrip(); }
  }
  if (msg.type === 'result' || msg.type === 'text') applyOnly();
}

const loaded = new Set();
const justOpened = new Set();   // chats opened from the New chat list on this screen
function historyFor(id, msg, handleOne) {
  loaded.add(id);
  const keepTools = [...toolCallEls].filter(([, el]) => { const c = el.closest && el.closest('[data-chat]'); return c && c.dataset.chat !== id; });
  const others = [...messagesEl.children].filter((n) => n.id !== 'quick-tiles' && n.dataset.chat && n.dataset.chat !== id);
  for (const n of others) n.remove();
  const back = S.chat;
  swapTo(id);
  try {
    if (id === back) handleOne(msg);   // the chat being sent to: the full way (scroll place, What's new, costs...)
    else {
      renderHistory(msg.items || []);
      S.isRunning = !!msg.running;
      if (S.isRunning) showThinking();
    }
    sweep(id, true);
    if (justOpened.has(id) && !(msg.items || []).length && !S.isRunning) {
      justOpened.delete(id);
      appendInfoLine(`${label(byId(id))} is open. Choose its colour button below, then type your first message.`);
      sweep(id, false);
    }
  } finally {
    swapTo(back);
    for (const n of others) messagesEl.appendChild(n);
    for (const [k, el] of keepTools) toolCallEls.set(k, el);
    reorder();
    applyOnly();
    updateSendBtn(); refreshBgTasksStrip();
    if (S.stickToBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function clearedFor(id) {
  for (const n of [...messagesEl.querySelectorAll(':scope > [data-chat]')]) if (n.dataset.chat === id) n.remove();
  if (id === S.renderChat) { const f = fresh(); for (const k of FIELDS) S[k] = f[k]; } else ctx[id] = fresh();
  updateSendBtn(); refreshBgTasksStrip(); markFirsts();
}

// ── colours and "only this chat" ─────────────────────────────────────────────
const styleEl = mk('style'); styleEl.id = 'mc-style'; document.head.append(styleEl);
function paintStyle() {
  let css = '';
  for (const c of S.chatList) if (c.hex) css += `#messages.mc-on > [data-chat="${c.id}"]{--mc:${c.hex}}\n`;
  if (S.only) css += `#messages.mc-on > [data-chat]:not([data-chat="${S.only}"]){display:none !important}\n#messages.mc-on > [data-chat="${S.only}"]::before{display:none !important}\n`;
  styleEl.textContent = css;
}
function applyOnly() {
  messagesEl.classList.toggle('mc-on', merged()); messagesEl.classList.toggle('mc-only', !!S.only); paintStyle();
  if ((messagesEl.dataset.only || '') !== (S.only || '')) {
    if (S.only) messagesEl.dataset.only = S.only; else delete messagesEl.dataset.only;
    window.dispatchEvent(new Event('mc-view'));   // the A / B / C chips redraw for what is shown
  }
}

/** Choose which chat the next message goes to (the screen is not reloaded). */
export function setTarget(id) {
  if (!id || id === S.chat || !byId(id)) return;
  swapTo(id);
  S.chat = id;
  send({ type: 'chat_target', id });
  updateSendBtn(); refreshBgTasksStrip();
  renderBars();
}

// ── tabs under the top bar ───────────────────────────────────────────────────
const LABEL = { working: 'Working', needs: 'Needs you', finished: 'Finished', idle: 'Ready' };
const COLOUR = { working: '#4da3ff', needs: '#f3736c', finished: '#46bb68', idle: '#8a8d91' };
const tabs = mk('div', 'mc-tabs hidden'); tabs.id = 'mc-tabs';
(document.getElementById('usage-panel') || document.querySelector('.header')).after(tabs);
const pin = mk('div', 'mc-pin hidden'); pin.id = 'mc-pin';
document.getElementById('chat-scroll').before(pin);
const row = mk('div', 'mc-send hidden'); row.id = 'mc-send';
document.querySelector('#input-form .composer').before(row);

const shortAcct = (a) => (a === 'Free' ? 'Free' : String(a || '').replace(/@.*/, '') || 'Main');

function renderBars() {
  const on = merged();
  tabs.classList.toggle('hidden', !on); row.classList.toggle('hidden', !on);
  document.body.classList.toggle('mc-many', on);
  applyOnly();
  const target = byId(S.chat);
  if (on && target) { if (promptInput.dataset.basePh == null) promptInput.dataset.basePh = promptInput.placeholder; promptInput.placeholder = `Message ${label(target)}…`; }
  else if (promptInput.dataset.basePh != null) { promptInput.placeholder = promptInput.dataset.basePh; delete promptInput.dataset.basePh; }
  document.getElementById('input-form').style.setProperty('--mc-target', on && target ? target.hex : 'transparent');
  // tabs
  tabs.textContent = '';
  if (on) {
    const all = mk('button', 'mc-tab mc-all' + (!S.only ? ' sel' : ''), 'All'); all.type = 'button';
    all.onclick = () => { S.only = null; renderBars(); };
    tabs.append(all);
    for (const c of S.chatList) {
      const t = mk('button', 'mc-tab' + (S.only === c.id ? ' sel' : '') + (c.id === S.chat ? ' target' : '') + (c.free ? ' free' : '')); t.type = 'button';
      t.style.setProperty('--mc', c.hex || '#8a8d91');
      const top = mk('span', 'mc-t1'); top.append(mk('b', 'mc-n', String(c.n)), mk('span', 'mc-name', c.name || 'New chat'));
      const st = mk('span', 'mc-t2');
      const s = mk('span', 'mc-st', LABEL[c.status] || ''); s.style.color = COLOUR[c.status] || ''; st.append(s);
      st.append(mk('span', 'mc-acct', c.free ? 'Free' : shortAcct(c.account)));
      if (!c.free) st.append(mk('span', 'mc-cost', `${c.cost || 0}%`));
      t.append(top, st);
      t.title = `${label(c)}: ${LABEL[c.status] || ''}`;
      t.onclick = () => { setTarget(c.id); S.only = c.id; renderBars(); messagesEl.scrollTop = messagesEl.scrollHeight; };
      tabs.append(t);
    }
  }
  // colour buttons above the typing box
  row.textContent = '';
  if (on) {
    row.append(mk('span', 'mc-to', 'Send to'));
    for (const c of S.chatList) {
      const b = mk('button', 'mc-btn' + (c.id === S.chat ? ' sel' : '') + (S.only === c.id ? ' only' : '')); b.type = 'button';
      b.style.setProperty('--mc', c.hex || '#8a8d91');
      b.append(mk('b', null, String(c.n)), mk('span', null, c.free ? 'Free' : c.colourName || ''));
      b.setAttribute('aria-label', `Send to ${label(c)}${c.id === S.chat ? ' (tap again to see only this chat)' : ''}`);
      b.onclick = () => {
        if (c.id !== S.chat) setTarget(c.id);
        else S.only = S.only === c.id ? null : c.id;   // tapped twice: only this chat (again: all)
        renderBars();
        if (S.only) messagesEl.scrollTop = messagesEl.scrollHeight;
      };
      row.append(b);
    }
    const a = mk('button', 'mc-btn mc-allbtn' + (!S.only ? ' sel-all' : ''), 'All'); a.type = 'button';
    a.onclick = () => { S.only = null; renderBars(); };
    row.append(a);
  }
  // pinned "needs your answer" line
  pin.textContent = '';
  const needs = on ? S.chatList.filter((c) => c.status === 'needs' && !(S.only === c.id)) : [];
  pin.classList.toggle('hidden', !needs.length);
  for (const c of needs) {
    const p = mk('button', 'mc-pinrow'); p.type = 'button'; p.style.setProperty('--mc', c.hex || '#f3736c');
    p.append(mk('i'), mk('span', null, `${label(c)} needs your answer`), mk('em', null, 'Tap to see it'));
    p.onclick = () => {
      setTarget(c.id);
      if (S.only && S.only !== c.id) S.only = null;
      renderBars();
      const mine = [...messagesEl.querySelectorAll(':scope > [data-chat]')].filter((n) => n.dataset.chat === c.id);
      const last = mine[mine.length - 1];
      if (last) { last.scrollIntoView({ block: 'end', behavior: 'smooth' }); last.classList.add('flash'); setTimeout(() => last.classList.remove('flash'), 1700); }
    };
    pin.append(p);
  }
}

// An answer button (or any button) inside a colour box goes to that box's chat.
messagesEl.addEventListener('click', (e) => {
  if (!merged()) return;
  const b = e.target.closest && e.target.closest('button, .answer-card, [role="button"], .h2-btn');
  if (!b) return;
  const box = b.closest(':scope > [data-chat]') || b.closest('[data-chat]');
  if (box && box.dataset.chat !== S.chat) setTarget(box.dataset.chat);
}, true);

// ── New chat list ────────────────────────────────────────────────────────────
const menu = mk('div', 'sessions-panel mc-menu hidden'); menu.id = 'mc-menu';
document.getElementById('app').append(menu);
let menuInfo = null;
const ORD = ['', '', '2nd', '3rd'];
function renderMenu() {
  menu.textContent = '';
  menu.append(mk('div', 'sessions-head', 'New chat'));
  const count = S.chatList.length || 1;
  const max = S.chatsMax || 3;
  const item = (title, sub, ok, why, fn, cls = '') => {
    const b = mk('button', 'mc-item' + (ok ? '' : ' off') + (cls ? ' ' + cls : '')); b.type = 'button'; b.disabled = !ok;
    const t = mk('span', 'mc-it'); t.append(mk('span', null, title));
    if (cls === 'free') t.append(mk('em', 'mc-free', 'Free'));
    b.append(t, mk('span', 'mc-sub', ok ? sub : why));
    b.onclick = () => { menu.classList.add('hidden'); fn(); };
    menu.append(b);
  };
  item('New chat here', 'Starts this chat again. The old one is kept in Previous chats.', true, '', () => openNewChat());
  for (const k of [2, 3]) {
    const ok = count === k - 1 && count < max;
    item(`Open a ${ORD[k]} chat`, 'Runs alongside, on the account with the most allowance left.', ok,
      count >= k ? `A ${ORD[k]} chat is already open.` : `Open a ${ORD[k - 1]} chat first.`,
      () => send({ type: 'new_session', mode: 'extra' }));
  }
  const fi = menuInfo;
  const hasFree = S.chatList.some((c) => c.free) || (fi && fi.hasFree);
  const freeOk = !!(fi && fi.freeOk) && !hasFree && count < max;
  const why = !fi ? 'Checking the free models…' : hasFree ? 'A free chat is already open.' : count >= max ? `You already have ${max} chats open.` : (fi.freeWhy || 'No free model is ready.');
  item('Open a chat on a free account', 'Grey chat. No health, home security, money or passwords: those stay on Claude.', freeOk, why,
    () => send({ type: 'new_session', mode: 'extra_free' }), 'free');
  menu.append(mk('div', 'chat-note', 'Several chats at once use your allowance faster.'));
}
newSessionBtn.onclick = (e) => {
  e.stopPropagation();
  if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
  menuInfo = null; renderMenu(); menu.classList.remove('hidden');
  send({ type: 'new_chat_menu' });
};
document.addEventListener('click', (e) => { if (!menu.contains(e.target) && !newSessionBtn.contains(e.target)) menu.classList.add('hidden'); });

/** Server messages about chats. Returns true when it handled the message. */
export function onChatsMessage(msg) {
  switch (msg.type) {
    case 'chats': {
      const wasMerged = merged();
      S.chatList = msg.list || []; S.chatsMax = msg.max || 3; S.chatsWorking = msg.working || 0;
      if (msg.viewing) S.chat = msg.viewing;
      else if (!S.chat && S.chatList.length) S.chat = S.chatList[0].id;
      if (S.chat && !byId(S.chat) && S.chatList.length) { swapTo(S.chatList[0].id); S.chat = S.chatList[0].id; send({ type: 'chat_target', id: S.chat }); }
      if (!S.renderChat && S.chat) S.renderChat = S.chat;
      if (S.only && !byId(S.only)) S.only = null;
      // a chat that folded away: take its items off the screen
      const ids = new Set(S.chatList.map((c) => c.id));
      if (merged() || wasMerged) for (const n of [...messagesEl.querySelectorAll(':scope > [data-chat]')]) if (!ids.has(n.dataset.chat)) n.remove();
      for (const k of Object.keys(ctx)) if (!ids.has(k) && k !== S.renderChat) delete ctx[k];
      if (S.chat) loaded.add(S.chat);
      const missing = S.chatList.filter((c) => !loaded.has(c.id)).map((c) => c.id);
      if (merged() && missing.length) { for (const m of missing) loaded.add(m); send({ type: 'chat_histories', ids: missing }); }
      if (!merged()) { S.only = null; for (const k of [...loaded]) if (!ids.has(k)) loaded.delete(k); }
      renderBars();
      if (merged() !== wasMerged) markFirsts();
      if (!menu.classList.contains('hidden')) renderMenu();
      return true;
    }
    case 'chat_opened':
      swapTo(msg.id); S.chat = msg.id; S.only = null; loaded.add(msg.id); justOpened.add(msg.id); return true;
    case 'chat_limit': toast(msg.text); return true;
    case 'chat_overlap': toast(`Two chats are changing the same thing (${String(msg.what).split('/').pop()}): ${label(byId(msg.chat))} and ${label(byId(msg.with))}. Check they do not undo each other.`); return true;
    case 'new_chat_ask': askNewChat().then((mode) => { if (mode) send({ type: 'new_session', save: true, mode }); }); return true;
    case 'new_chat_menu': menuInfo = msg; if (!menu.classList.contains('hidden')) renderMenu(); return true;
    default: return false;
  }
}

/** New chat while this chat is working: ask each time (user's choice B). Resolves 'alongside', 'stop' or null. */
export function askNewChat() {
  return new Promise((resolve) => {
    const wrap = mk('div', 'permission-overlay chat-ask'); const card = mk('div', 'permission-card confirm-card');
    const head = mk('div', 'card-head'); head.append(mk('h3', 'perm-title', 'This chat is still working')); card.append(head);
    card.append(mk('p', 'confirm-body', S.chatsWorking >= S.chatsMax
      ? `${S.chatsMax} chats are already working, so another cannot run alongside. You can stop this one and start a new chat.`
      : 'Start the new chat alongside it, so this one keeps working? (Several chats at once use your allowance faster.)'));
    const row2 = mk('div', 'perm-buttons');
    const done = (v) => { wrap.remove(); resolve(v); };
    const c = mk('button', 'btn btn-deny', 'Cancel'); c.type = 'button'; c.onclick = () => done(null); row2.append(c);
    const b = mk('button', 'btn btn-danger', 'Stop it, then new chat'); b.type = 'button'; b.onclick = () => done('stop'); row2.append(b);
    if (S.chatsWorking < S.chatsMax && S.chatList.length < S.chatsMax) { const a = mk('button', 'btn btn-allow', 'Run alongside'); a.type = 'button'; a.onclick = () => done('alongside'); row2.append(a); }
    card.append(row2); wrap.append(card); wrap.onclick = (e) => { if (e.target === wrap) done(null); };
    document.body.append(wrap);
  });
}

// Updating haAi restarts it and stops every chat: warn first (the Update button is a link, so a second tap within 8 s goes ahead).
const upd = document.getElementById('update-btn');
let warnedAt = 0;
if (upd) upd.addEventListener('click', (e) => {
  if (S.chatsWorking > 0 && Date.now() - warnedAt > 8000) {
    e.preventDefault(); warnedAt = Date.now();
    toast(`${S.chatsWorking} chat${S.chatsWorking > 1 ? 's are' : ' is'} still working. Updating restarts haAi and stops them. Tap Update again to go ahead anyway.`);
  }
}, true);
