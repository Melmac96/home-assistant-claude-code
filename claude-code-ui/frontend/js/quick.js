/*
 * my28: quick jobs (small tiles on a new chat), quick replies (pills beside the typing box),
 * the "Waiting for you" list (Sessions menu) and the New chat card.
 */
import { S } from './state.js';
import { inputForm, messagesEl, promptInput } from './dom.js';
import { requestNewSession } from './composer.js';
import { appendInfoLine } from './transcript.js';

let quick = { jobs: [], replies: [] };
let editing = false;
const wsSend = (o) => { if (S.ws && S.isConnected) S.ws.send(JSON.stringify(o)); };
const saveQuick = () => wsSend({ type: 'quick_save', jobs: quick.jobs, replies: quick.replies });
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function sendText(t) {
  if (!S.isConnected) return;
  promptInput.value = t;
  promptInput.dispatchEvent(new Event('input'));
  inputForm.dispatchEvent(new Event('submit'));
}

function addForm(parent, withName, onSave) {
  const f = el('div', 'quick-form');
  const name = withName ? el('input', 'answer-other') : null;
  if (name) { name.placeholder = 'Button name'; f.append(name); }
  const text = el('input', 'answer-other');
  text.placeholder = withName ? 'What it asks Claude to do' : 'Your reply';
  const ok = el('button', 'quick-save', 'Save');
  ok.type = 'button';
  ok.onclick = (e) => {
    e.stopPropagation();
    const t = text.value.trim();
    if (!t) return;
    onSave(name ? (name.value.trim() || t.slice(0, 24)) : '', t);
  };
  f.append(text, ok);
  parent.append(f);
  (name || text).focus();
}

// ── Quick jobs: small tiles, only on an empty new chat ───────────────────────
export function showQuickJobs() {
  document.getElementById('quick-tiles')?.remove();
  if (!quick.jobs.length) return;
  const wrap = el('div', 'quick-tiles');
  wrap.id = 'quick-tiles';
  const grid = el('div', 'quick-grid');
  quick.jobs.forEach((j, i) => {
    const b = el('button', 'quick-tile', editing ? '✕ ' + j.label : j.label);
    b.type = 'button';
    b.onclick = () => {
      if (editing) { quick.jobs.splice(i, 1); saveQuick(); showQuickJobs(); }
      else sendText(j.text);
    };
    grid.append(b);
  });
  const add = el('button', 'quick-tile quick-extra', '+ Add my own');
  add.type = 'button';
  add.onclick = () => { if (!wrap.querySelector('.quick-form')) addForm(wrap, true, (label, text) => { quick.jobs.push({ label, text }); saveQuick(); showQuickJobs(); }); };
  const edit = el('button', 'quick-tile quick-extra', editing ? 'Finish' : 'Remove some');
  edit.type = 'button';
  edit.onclick = () => { editing = !editing; showQuickJobs(); };
  grid.append(add, edit);
  wrap.append(grid);
  messagesEl.prepend(wrap);
}

// ── Quick replies: pills above the typing box ────────────────────────────────
const sheet = el('div', 'quick-sheet hidden');
inputForm.append(sheet);
let replyEditing = false;

function drawReplies() {
  sheet.innerHTML = '';
  sheet.append(el('div', 'quick-head', 'Quick replies'));
  quick.replies.forEach((r, i) => {
    const b = el('button', 'quick-pill', replyEditing ? '✕ ' + r : r);
    b.type = 'button';
    b.onclick = (e) => {
      e.stopPropagation();
      if (replyEditing) { quick.replies.splice(i, 1); saveQuick(); drawReplies(); return; }
      const cur = promptInput.value.trim();
      promptInput.value = cur ? cur + ' ' + r : r;
      promptInput.dispatchEvent(new Event('input'));
      sheet.classList.add('hidden');
      promptInput.focus();
    };
    sheet.append(b);
  });
  const add = el('button', 'quick-pill quick-extra', '+ Add my own');
  add.type = 'button';
  add.onclick = (e) => { e.stopPropagation(); if (!sheet.querySelector('.quick-form')) addForm(sheet, false, (_n, t) => { quick.replies.push(t); saveQuick(); drawReplies(); }); };
  const edit = el('button', 'quick-pill quick-extra', replyEditing ? 'Finish' : 'Remove some');
  edit.type = 'button';
  edit.onclick = (e) => { e.stopPropagation(); replyEditing = !replyEditing; drawReplies(); };
  sheet.append(add, edit);
}

const quickBtn = document.getElementById('quick-btn');
if (quickBtn) quickBtn.onclick = (e) => {
  e.stopPropagation();
  replyEditing = false;
  drawReplies();
  sheet.classList.toggle('hidden');
};
sheet.onclick = (e) => e.stopPropagation();
document.addEventListener('click', () => sheet.classList.add('hidden'));

// ── Waiting for you (top of the Sessions menu) ───────────────────────────────
const waitingEl = document.getElementById('waiting-list');
function drawWaiting(list) {
  if (!waitingEl) return;
  waitingEl.innerHTML = '';
  document.getElementById('waiting-toggle').classList.toggle('sec-closed', !list.length);   // my29: drop-down heading
  document.getElementById('waiting-count').textContent = `(${list.length})`;
  if (!list.length) return;
  for (const w of list) {
    const row = el('div', 'waiting-row');
    const yes = el('button', 'waiting-ok', '✓');
    const no = el('button', 'waiting-no', '✗');
    yes.type = no.type = 'button';
    yes.setAttribute('aria-label', 'Works');
    no.setAttribute('aria-label', 'Not right');
    yes.onclick = () => { wsSend({ type: 'waiting_done', id: w.id }); sendText(`Works: ${w.text}. Please record that I have confirmed it.`); };
    no.onclick = () => {
      promptInput.value = `Not right: ${w.text}. What went wrong: `;
      promptInput.dispatchEvent(new Event('input'));
      promptInput.focus();
    };
    row.append(el('div', 'waiting-text', w.text), yes, no);
    waitingEl.append(row);
  }
}
if (waitingEl) waitingEl.onclick = (e) => e.stopPropagation();

// ── New chat card ────────────────────────────────────────────────────────────
export function openNewChat() {
  if (!S.activeSessionId && !S.isRunning) { requestNewSession(); return; }   // nothing to save yet
  const back = el('div', 'newchat-back');
  const card = el('div', 'newchat-card');
  card.append(el('div', 'quick-head', 'New chat'));
  const opt = (name, help, cls, fn) => {
    const b = el('button', 'newchat-opt ' + cls, name);
    b.type = 'button';
    b.append(el('small', '', help));
    b.onclick = (e) => { e.stopPropagation(); back.remove(); fn(); };
    card.append(b);
  };
  opt('Continue this job', 'A new chat that picks up where we left off', 'solid', () => wsSend({ type: 'handover' }));
  opt('Start something new', 'A clean chat, old one saved', '', () => requestNewSession());
  back.append(card);
  back.onclick = () => back.remove();
  card.onclick = (e) => e.stopPropagation();
  document.body.append(back);
}

// ── Messages from the server ─────────────────────────────────────────────────
export function onQuickMessage(msg) {
  switch (msg.type) {
    case 'quick':
      quick = { jobs: msg.jobs || [], replies: msg.replies || [] };
      if (!messagesEl.children.length || document.getElementById('quick-tiles')) showQuickJobs();
      break;
    case 'waiting': drawWaiting(msg.list || []); break;
    case 'handover_status': appendInfoLine(msg.text); break;
    case 'handover_ready': sendText(msg.text); break;
  }
}

