/*
 * my59: haAi ideas list inside haAi (user 2026-11-09). A 💡 button by the microphone (it sits under More on the tidy screen)
 * opens a full-page list of the haAi ideas: tap one to open it, then Done / Edit / Remove. Add an idea at the top.
 * No pop-ups: Add and Edit open a form in the page, Remove asks with a second tap. The server does the writing (server/lib/ideas.js).
 */
import { S } from './state.js';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const wsSend = (o) => { if (S.ws && S.isConnected) S.ws.send(JSON.stringify(o)); };

const panel = mk('div', 'haai-ideas hidden');
const head = mk('div', 'haai-ideas-head');
const title = mk('div', 'haai-ideas-title', 'haAi ideas');
const close = mk('button', 'haai-ideas-btn', 'Close'); close.type = 'button';
head.append(title, close);
const formBox = mk('div', 'haai-ideas-form');
const listBox = mk('div', 'haai-ideas-list');
panel.append(head, formBox, listBox);
document.body.append(panel);

let items = [];
let openId = '';
let askId = '';
let note = '';

function form(id, t, b) {
  formBox.textContent = '';
  formBox.append(mk('div', 'haai-ideas-sub', id ? 'Edit idea' : 'New idea'));
  const ti = mk('input', 'haai-ideas-input'); ti.placeholder = 'Title'; ti.value = t;
  const bo = mk('textarea', 'haai-ideas-input'); bo.placeholder = 'Details (optional)'; bo.rows = 5; bo.value = b;
  const row = mk('div', 'haai-ideas-row');
  const save = mk('button', 'haai-ideas-btn on', 'Save'); save.type = 'button';
  const cancel = mk('button', 'haai-ideas-btn', 'Cancel'); cancel.type = 'button';
  row.append(save, cancel);
  formBox.append(ti, bo, row);
  save.onclick = () => {
    if (!ti.value.trim()) { note = 'Please write a title first.'; draw(); return; }
    wsSend({ type: 'ideas_op', op: id ? 'edit' : 'add', id, title: ti.value.trim(), body: bo.value });
    formBox.textContent = ''; openId = ''; note = 'Saving…'; draw();
  };
  cancel.onclick = () => { formBox.textContent = ''; };
  ti.focus();
}

function draw() {
  listBox.textContent = '';
  const add = mk('button', 'haai-ideas-btn on wide', '+ Add an idea'); add.type = 'button';
  add.onclick = () => form('', '', '');
  listBox.append(add);
  if (note) listBox.append(mk('div', 'haai-ideas-note', note));
  for (const it of items) {
    const card = mk('div', 'haai-ideas-card' + (it.done ? ' done' : ''));
    const t = mk('div', 'haai-ideas-t', (it.done ? '✓ ' : '') + it.title);
    t.onclick = () => { openId = openId === it.id ? '' : it.id; askId = ''; draw(); };
    card.append(t);
    if (openId === it.id) {
      card.append(mk('div', 'haai-ideas-body', it.body || '(nothing written under this idea)'));
      const row = mk('div', 'haai-ideas-row');
      const d = mk('button', 'haai-ideas-btn', it.done ? 'Not done' : 'Done'); d.type = 'button';
      const e = mk('button', 'haai-ideas-btn', 'Edit'); e.type = 'button';
      const r = mk('button', 'haai-ideas-btn' + (askId === it.id ? ' bad' : ''), askId === it.id ? 'Remove? tap again' : 'Remove'); r.type = 'button';
      d.onclick = () => { askId = ''; wsSend({ type: 'ideas_op', op: it.done ? 'undone' : 'done', id: it.id }); };
      e.onclick = () => form(it.id, it.title, it.body);
      r.onclick = () => { if (askId === it.id) { askId = ''; openId = ''; wsSend({ type: 'ideas_op', op: 'remove', id: it.id }); } else { askId = it.id; draw(); } };
      row.append(d, e, r);
      card.append(row);
    }
    listBox.append(card);
  }
}

export function onIdeas(msg) {
  items = msg.items || [];
  note = msg.error ? 'That did not work: ' + msg.error : '';
  if (!panel.classList.contains('hidden')) draw();
}

function openPanel() { panel.classList.remove('hidden'); openId = ''; askId = ''; note = ''; formBox.textContent = ''; draw(); wsSend({ type: 'ideas_get' }); }
close.onclick = () => panel.classList.add('hidden');

const mic = document.getElementById('mic-btn');
const btn = mk('button', 'attach-btn h3-btn', '💡'); btn.type = 'button'; btn.id = 'ideas-btn';
btn.title = 'haAi ideas'; btn.setAttribute('aria-label', btn.title);
if (mic) mic.after(btn); else document.querySelector('.composer-actions')?.append(btn);
btn.onclick = openPanel;
