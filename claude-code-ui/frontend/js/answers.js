/*
 * my28: tap your answer inside each question. A marked question block (⟦QUESTION⟧ ... ⟦/QUESTION⟧,
 * options **A.** **B.**, several questions labelled **Q1** **Q2**) has each option turned into a
 * full-width card right where it stands, then one "Send my answers" button at the end.
 * Picks are remembered in localStorage, because the chat is rebuilt whenever the app reconnects
 * (coming back to the phone) and anything held only in memory was lost: that was the my26 bug.
 */
import { inputForm, messagesEl, promptInput } from './dom.js';

const KEY = 'haai-answers';
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); };
function load(id) { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.id === id ? v.picks : {}; } catch { return {}; } }
function save(id, picks) { try { localStorage.setItem(KEY, JSON.stringify({ id, picks })); } catch { /* storage full or blocked */ } }

const leadStrong = (p) => { const f = p.firstElementChild; return f && f.tagName === 'STRONG' && p.textContent.trim().startsWith(f.textContent.trim()) ? f.textContent.trim() : ''; };

function isStale(content) {
  const bubble = content.parentElement;
  for (let n = bubble && bubble.nextElementSibling; n; n = n.nextElementSibling) {
    if (n.classList.contains('bubble-user') || n.querySelector?.('.answer-card')) return true;
  }
  return false;
}

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
        box.oninput = () => { box._grow(); if (picks[k]) { picks[k].t = box.value; save(id, picks); } };
        c.after(box);
        c._box = box;
      }
      c.onclick = () => {
        if (picks[k] && picks[k].l === c._letter) delete picks[k];
        else picks[k] = { l: c._letter, t: c._box ? c._box.value : '' };
        save(id, picks);
        paint();
        if (c._box && !c._box.hidden) c._box.focus();
      };
    }
  }

  send.onclick = () => {
    const lines = usable.filter((g) => picks[g.label || '_']).map((g) => {
      const p = picks[g.label || '_'];
      const a = p.t && p.t.trim() ? `${p.l}: ${p.t.trim()}` : p.l;
      return g.label ? `${g.label}. ${a}` : a;
    });
    if (!lines.length) return;
    const draft = promptInput.value.trim();
    promptInput.value = lines.join('\n') + (draft ? '\n\n' + draft : '');
    promptInput.dispatchEvent(new Event('input'));
    localStorage.removeItem(KEY);
    inputForm.dispatchEvent(new Event('submit'));
  };

  const last = usable[usable.length - 1].cards.slice(-1)[0];
  (last._box || last).after(send);
  paint();
  if (isStale(content)) lock(content);
}

function lock(root) {
  root.querySelectorAll('.answer-send').forEach((b) => b.remove());
  root.querySelectorAll('.answer-other').forEach((b) => { if (!b.value) b.remove(); else b.disabled = true; });
  root.querySelectorAll('.answer-card').forEach((b) => { b.disabled = true; b.classList.add('locked'); });
}

/** A message has gone in, so every question above it is finished with. */
export function lockAnswers() { lock(messagesEl); }

/** After the chat is rebuilt, only the newest unanswered question can still be answered. */
export function syncAnswers() {
  for (const c of messagesEl.querySelectorAll('.bubble-assistant .bubble-content')) {
    if (c.querySelector('.answer-card') && isStale(c)) lock(c);
  }
}
