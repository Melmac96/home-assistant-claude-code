/*
 * my28: tap your answer inside each question. A marked question block (⟦QUESTION⟧ ... ⟦/QUESTION⟧,
 * options **A.** **B.**, several questions labelled **Q1** **Q2**) has each option turned into a
 * full-width card right where it stands, then one "Send my answers" button at the end.
 * Picks are remembered in localStorage, because the chat is rebuilt whenever the app reconnects
 * (coming back to the phone) and anything held only in memory was lost: that was the my26 bug.
 */
import { inputForm, messagesEl, promptInput } from './dom.js';
import { S } from './state.js';

// my78: with several chats in one window, another chat's messages never close this chat's question.
const several = () => (S.chatList || []).length > 1;

const KEY = 'haai-answers2';   // my146: one entry per question block (the old single slot was wiped by the next block)
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
const allSaved = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
function load(id) { const v = allSaved()[id]; return v && v.picks ? v.picks : {}; }
function save(id, picks) {
  const all = allSaved();
  if (Object.keys(picks).length) all[id] = { picks, at: Date.now() }; else delete all[id];
  const ids = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
  for (const old of ids.slice(30)) delete all[old];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage full or blocked */ }
}

// my146 (Michael 23 Nov 2026): every pick and typed word also goes to haAi as he types, so it is never kept on one
// device only; and any message he sends takes the answers waiting under the questions with it.
const live = new Map();   // block id -> { usable, picks, send, content, q }
const timers = new Map();
const answerLines = (usable, picks) => usable.filter((g) => picks[g.label || '_']).map((g) => {
  const p = picks[g.label || '_'];
  const a = p.t && p.t.trim() ? `${p.l}: ${p.t.trim()}` : p.l;
  return g.label ? `${g.label}. ${a}` : a;
});
function tellHaai(id, now) {
  clearTimeout(timers.get(id));
  const go = () => {
    timers.delete(id);
    const b = live.get(id);
    if (!b || !S.ws || !S.isConnected) return;
    try { S.ws.send(JSON.stringify({ type: 'answer_typed', qid: id, q: b.q, chat: (b.content.parentElement && b.content.parentElement.dataset.chat) || S.chat || '', lines: answerLines(b.usable, b.picks) })); } catch { /* sent again on the next keypress */ }
  };
  if (now) go(); else timers.set(id, setTimeout(go, 600));
}
const isOpen = (b) => b.send.isConnected && b.content.isConnected;
const inThisChat = (b) => { if (!several()) return true; const c = b.content.parentElement && b.content.parentElement.dataset.chat; const id = S.renderChat || S.chat; return !c || !id || c === id; };

/** my146: answers picked or typed under questions on screen that have not been sent yet (for the normal Send). */
export function waitingAnswers() {
  const ids = []; const parts = [];
  for (const [id, b] of live) {
    if (!isOpen(b) || !inThisChat(b)) continue;
    const lines = answerLines(b.usable, b.picks);
    if (!lines.length) continue;
    ids.push(id); parts.push(lines.join('\n'));
  }
  return { ids, text: parts.join('\n\n') };
}
/** my146: those answers have gone with his message. */
export function answersWent(ids) {
  for (const id of ids) {
    const b = live.get(id);
    clearTimeout(timers.get(id)); timers.delete(id);
    if (b) { for (const k of Object.keys(b.picks)) delete b.picks[k]; }
    save(id, {});
  }
}

const leadStrong = (p) => { const f = p.firstElementChild; return f && f.tagName === 'STRONG' && p.textContent.trim().startsWith(f.textContent.trim()) ? f.textContent.trim() : ''; };

function isStale(content) {
  const bubble = content.parentElement;
  const mine = several() && bubble && bubble.dataset.chat;
  for (let n = bubble && bubble.nextElementSibling; n; n = n.nextElementSibling) {
    if (mine && n.dataset.chat && n.dataset.chat !== mine) continue;   // my78: another chat's item
    if (n.classList.contains('bubble-user') || n.querySelector?.('.answer-card')) return true;
  }
  return false;
}

// my105: the TV-only question line stays hidden everywhere else (tv.js shows it on the TV)
{ const st = document.createElement('style'); st.textContent = '.q-tv{display:none}'; document.head.append(st); }

export function enhanceQuestions(content) {
  const raw = content._rawMd || '';
  if (!raw.includes('⟦/QUESTION⟧')) return;
  const kids = [...content.children];
  let start = -1, end = -1;
  kids.forEach((k, i) => { if (k.textContent.includes('⟦QUESTION⟧')) start = i; });
  for (let i = start + 1; start >= 0 && i < kids.length; i++) if (kids[i].textContent.includes('⟦/QUESTION⟧')) { end = i; break; }
  if (end < 0) return;

  const groups = [];
  let cur = null;
  for (let i = start + 1; i < end; i++) {
    const p = kids[i];
    if (p.tagName !== 'P') continue;
    const lead = leadStrong(p);
    if (/^Q\d+$/.test(lead)) { cur = { label: lead, cards: [] }; groups.push(cur); continue; }
    if (/^[A-Z]\.$/.test(lead)) {
      const letter = lead[0];
      if (!cur || (letter === 'A' && cur.cards.length)) { cur = { label: '', cards: [] }; groups.push(cur); }
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'answer-card'; b.innerHTML = p.innerHTML;
      b._letter = letter; b._other = /any other answer/i.test(p.textContent);
      // my70 (his Look E): compact row, the letter in a small round badge
      const f = b.firstElementChild;
      if (f && f.tagName === 'STRONG') {
        const l = document.createElement('span'); l.className = 'ans-l'; l.textContent = letter; f.replaceWith(l);
        const t = document.createElement('span'); t.className = 'ans-t'; while (l.nextSibling) t.append(l.nextSibling); b.append(t);
      }
      p.replaceWith(b);
      cur.cards.push(b);
    }
  }
  const usable = groups.filter((g) => g.cards.length >= 2);
  if (!usable.length) return;
  if (usable.length > 1) usable.forEach((g, i) => { if (!g.label) g.label = 'Q' + (i + 1); });

  const id = hash(raw);
  const picks = load(id);
  const send = document.createElement('button');
  send.type = 'button'; send.className = 'answer-send';
  const firstQ = (kids.slice(start + 1, end).find((k) => k.textContent.trim() && !k.textContent.includes('⟦')) || {}).textContent || '';
  live.set(id, { usable, picks, send, content, q: firstQ.trim().slice(0, 120) });   // my146

  const paint = () => {
    let n = 0;
    for (const g of usable) {
      const p = picks[g.label || '_'];
      if (p) n++;
      for (const c of g.cards) {
        const on = !!p && p.l === c._letter;
        c.classList.toggle('picked', on);
        if (c._box) { c._box.hidden = !on; if (on) requestAnimationFrame(c._box._grow); }
      }
    }
    send.disabled = !n;
    send.textContent = usable.length > 1 && n < usable.length ? `Send my answers (${n} of ${usable.length})` : 'Send my answers';
  };

  for (const g of usable) {
    const k = g.label || '_';
    for (const c of g.cards) {
      if (c._other) {
        // my70: grows as he types, so all his words stay in view (was one line that cut them off)
        const box = document.createElement('textarea');
        box.rows = 1; box.className = 'answer-other'; box.placeholder = 'Type your answer'; box.hidden = true;
        box._grow = () => { box.style.height = 'auto'; box.style.height = box.scrollHeight + 'px'; };
        if (picks[k] && picks[k].l === c._letter) box.value = picks[k].t || '';
        box.oninput = () => { box._grow(); if (picks[k]) { picks[k].t = box.value; save(id, picks); tellHaai(id); } };   // my146
        c.after(box);
        c._box = box;
      }
      c.onclick = () => {
        if (picks[k] && picks[k].l === c._letter) delete picks[k];
        else picks[k] = { l: c._letter, t: c._box ? c._box.value : '' };
        save(id, picks);
        tellHaai(id, true);   // my146
        paint();
        if (c._box && !c._box.hidden) c._box.focus();
      };
    }
  }

  send.onclick = () => {
    // my146: the normal Send now takes every waiting answer (this block and any other on screen) with it
    if (!answerLines(usable, picks).length) return;
    inputForm.dispatchEvent(new Event('submit'));
  };

  const last = usable[usable.length - 1].cards.slice(-1)[0];
  (last._box || last).after(send);
  paint();
  // my105 (Michael 15 Nov): the TV shows one line instead of the question; he answers on the phone or tablet
  for (let n = kids[start]; n; n = n.nextElementSibling) { n.classList.add('q-part'); if (n === kids[end]) break; }
  const tvq = document.createElement('div'); tvq.className = 'q-tv'; tvq.textContent = 'Question - Waiting For An Answer';
  kids[start].before(tvq);
  if (isStale(content)) lock(content);
}

function lock(root) {
  root.querySelectorAll('.answer-send').forEach((b) => b.remove());
  root.querySelectorAll('.answer-other').forEach((b) => { if (!b.value) b.remove(); else b.disabled = true; });
  root.querySelectorAll('.answer-card').forEach((b) => { b.disabled = true; b.classList.add('locked'); });
  root.querySelectorAll('.q-tv').forEach((b) => b.classList.add('q-done'));
}

/** A message has gone in, so every question above it is finished with. */
export function lockAnswers() {
  const id = several() && (S.renderChat || S.chat);
  if (!id) { lock(messagesEl); return; }
  for (const n of messagesEl.children) if (!n.dataset.chat || n.dataset.chat === id) lock(n);   // my78: only the chat the message went to
}

/** After the chat is rebuilt, only the newest unanswered question can still be answered. */
export function syncAnswers() {
  for (const c of messagesEl.querySelectorAll('.bubble-assistant .bubble-content')) {
    if (c.querySelector('.answer-card') && isStale(c)) lock(c);
  }
}
