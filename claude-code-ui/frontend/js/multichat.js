/*
 * my58: SEVERAL CHATS AT ONCE (user chose Look D, 2026-11-09; at most 2 working at once; New chat asks each time).
 * One "Chats" button in the top bar opens a list: number, short name, status. Working = blue, Needs you = red, Finished = green.
 * The server tags every chat message with a chat id; this file drops the ones for a chat you are not looking at.
 */
import { S } from './state.js';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const send = (o) => { if (S.ws && S.isConnected) S.ws.send(JSON.stringify(o)); };
const toast = (text) => { const t = mk('div', 'guard-toast', text); t.onclick = () => t.remove(); document.body.append(t); setTimeout(() => t.remove(), 7000); };

S.chat = S.chat || null;      // the chat this screen is looking at
S.chatList = [];
S.chatsMax = 2;
S.chatsWorking = 0;

// Messages that belong to ONE chat. Everything else (usage, accounts, settings...) is for every screen.
const PER_CHAT = new Set(['history', 'background_tasks', 'task_notice', 'agent_report', 'cleared', 'user', 'text', 'tool_use', 'tool_result',
  'permission_request', 'permission_resolved', 'result', 'run_idle', 'context_usage', 'compacted', 'user_dialog', 'user_dialog_cancelled',
  'error', 'aborted', 'session', 'model']);

/** True when this message is about another chat and must not touch the screen. */
export function isOtherChat(msg) {
  return !!(msg.chat && S.chat && msg.chat !== S.chat && PER_CHAT.has(msg.type));
}

const LABEL = { working: 'Working', needs: 'Needs you', finished: 'Finished', idle: '' };
const COLOUR = { working: '#4da3ff', needs: '#f3736c', finished: '#46bb68', idle: '#8a8d91' };

const btn = mk('button', 'icon-btn'); btn.type = 'button'; btn.id = 'chats-btn'; btn.title = 'Chats'; btn.setAttribute('aria-label', 'Chats');
btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8l-4 3v-3H3a0 0 0 0 1 0 0V5z"/><path d="M18 9h1a2 2 0 0 1 2 2v7l-3-2h-5"/></svg><span class="chats-num"></span>';
document.querySelector('.icon-group').prepend(btn);
const num = btn.querySelector('.chats-num');

const panel = mk('div', 'sessions-panel chats-panel hidden'); panel.id = 'chats-panel';
document.getElementById('app').append(panel);

function render() {
  const list = S.chatList;
  const any = (st) => list.some((c) => c.status === st);
  const top = any('needs') ? 'needs' : any('working') ? 'working' : any('finished') ? 'finished' : 'idle';
  btn.style.color = top === 'idle' ? '' : COLOUR[top];
  num.textContent = list.length > 1 ? String(list.length) : '';
  num.classList.toggle('hidden', list.length <= 1);
  num.style.background = COLOUR[top];
  panel.textContent = '';
  panel.append(mk('div', 'sessions-head', `Chats (${S.chatsWorking} of ${S.chatsMax} working)`));
  for (const c of list) {
    const row = mk('button', 'chat-row' + (c.id === S.chat ? ' current' : '')); row.type = 'button';
    row.append(mk('span', 'chat-n', String(c.n)));
    const mid = mk('span', 'chat-mid');
    mid.append(mk('span', 'chat-name', c.name));
    if (c.account) mid.append(mk('span', 'chat-acct', c.account.replace(/@.*/, '')));
    row.append(mid);
    const st = mk('span', 'chat-st', LABEL[c.status] || ''); st.style.color = COLOUR[c.status]; row.append(st);
    const dot = mk('i', 'chat-dot'); dot.style.background = COLOUR[c.status]; row.append(dot);
    row.onclick = () => { panel.classList.add('hidden'); if (c.id !== S.chat) { S.chat = c.id; send({ type: 'chat_view', id: c.id }); } };
    panel.append(row);
  }
  if (S.chatsWorking >= S.chatsMax) panel.append(mk('div', 'chat-note', 'Two chats are working, so another cannot start yet. Using two uses your allowance faster.'));
  else if (S.chatsWorking > 1) panel.append(mk('div', 'chat-note', 'Using several chats at once uses your allowance faster.'));
}

btn.onclick = (e) => { e.stopPropagation(); render(); panel.classList.toggle('hidden'); };
document.addEventListener('click', (e) => { if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) panel.classList.add('hidden'); });

/** Server messages about chats. Returns true when it handled the message. */
export function onChatsMessage(msg) {
  switch (msg.type) {
    case 'chats':
      S.chatList = msg.list || []; S.chatsMax = msg.max || 2; S.chatsWorking = msg.working || 0;
      if (msg.viewing) S.chat = msg.viewing;
      else if (!S.chat && S.chatList.length) S.chat = S.chatList[0].id;
      render(); return true;
    case 'chat_opened': S.chat = msg.id; return true;
    case 'chat_limit': toast(msg.text); return true;
    case 'chat_overlap': toast(`Two chats are changing the same thing (${String(msg.what).split('/').pop()}). Check they do not undo each other.`); return true;
    case 'new_chat_ask': askNewChat().then((mode) => { if (mode) send({ type: 'new_session', save: true, mode }); }); return true;
    default: return false;
  }
}

/** New chat while this chat is working: ask each time (user's choice B). Resolves 'alongside', 'stop' or null. */
export function askNewChat() {
  return new Promise((resolve) => {
    const wrap = mk('div', 'permission-overlay chat-ask'); const card = mk('div', 'permission-card confirm-card');
    const head = mk('div', 'card-head'); head.append(mk('h3', 'perm-title', 'This chat is still working')); card.append(head);
    card.append(mk('p', 'confirm-body', S.chatsWorking >= S.chatsMax
      ? 'Two chats are already working, so another cannot run alongside. You can stop this one and start a new chat.'
      : 'Start the new chat alongside it, so this one keeps working? (Two chats at once use your allowance faster.)'));
    const row = mk('div', 'perm-buttons');
    const done = (v) => { wrap.remove(); resolve(v); };
    const c = mk('button', 'btn btn-deny', 'Cancel'); c.type = 'button'; c.onclick = () => done(null); row.append(c);
    const b = mk('button', 'btn btn-danger', 'Stop it, then new chat'); b.type = 'button'; b.onclick = () => done('stop'); row.append(b);
    if (S.chatsWorking < S.chatsMax) { const a = mk('button', 'btn btn-allow', 'Run alongside'); a.type = 'button'; a.onclick = () => done('alongside'); row.append(a); }
    card.append(row); wrap.append(card); wrap.onclick = (e) => { if (e.target === wrap) done(null); };
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
