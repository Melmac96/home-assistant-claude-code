/*
 * my26: tap-to-answer buttons. When Claude's reply holds a marked question block
 * (⟦QUESTION⟧ ... ⟦/QUESTION⟧ with **A.** **B.** options, several questions labelled
 * **Q1** **Q2**), the options also show as buttons under that reply. Tapping one puts
 * the answer into the message box ("A", or "Q1. A" / "Q2. B" for several questions);
 * Michael then taps Send. The question itself stays as normal chat text.
 */
import { promptInput } from './dom.js';

export function parseQuestions(md) {
  const open = md.lastIndexOf('⟦QUESTION⟧');
  if (open < 0) return null;
  const close = md.indexOf('⟦/QUESTION⟧', open);
  if (close < 0) return null;
  const qs = [];
  let cur = null;
  for (const line of md.slice(open, close).split('\n')) {
    const qm = line.match(/^\s*\*\*(Q\d+)\*\*/);
    if (qm) { cur = { label: qm[1], opts: [] }; qs.push(cur); continue; }
    const om = line.match(/^\s*\*\*([A-Z])\.\*\*\s*(.*)$/);
    if (om) {
      if (!cur || (om[1] === 'A' && cur.opts.length)) { cur = { label: '', opts: [] }; qs.push(cur); }
      cur.opts.push({ letter: om[1], text: om[2].replace(/\*\*/g, '').trim() });
    }
  }
  const usable = qs.filter((q) => q.opts.length >= 2);
  if (!usable.length) return null;
  if (usable.length > 1) usable.forEach((q, i) => { if (!q.label) q.label = 'Q' + (i + 1); });
  return usable;
}

export function refreshAnswerButtons(content) {
  const bubble = content && content.parentElement;
  if (!bubble) return;
  const old = bubble.querySelector(':scope > .answer-bar');
  if (old) old.remove();
  const qs = parseQuestions(content._rawMd || '');
  if (!qs) return;
  // only the newest question gets buttons
  document.querySelectorAll('.answer-bar').forEach((b) => b.remove());
  const bar = document.createElement('div');
  bar.className = 'answer-bar';
  const chosen = {};
  const fill = () => {
    const parts = qs.filter((q) => chosen[q.label || '_']).map((q) =>
      q.label ? `${q.label}. ${chosen[q.label]}` : chosen['_']);
    promptInput.value = parts.join('\n');
    promptInput.dispatchEvent(new Event('input'));
    promptInput.focus();
  };
  for (const q of qs) {
    const row = document.createElement('div');
    row.className = 'answer-row';
    if (q.label) { const l = document.createElement('span'); l.className = 'answer-label'; l.textContent = q.label; row.appendChild(l); }
    for (const o of q.opts) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'answer-btn'; b.textContent = o.letter;
      b.title = o.text; b.setAttribute('aria-label', o.letter + ': ' + o.text);
      b.onclick = () => {
        chosen[q.label || '_'] = o.letter;
        row.querySelectorAll('.answer-btn').forEach((x) => x.classList.toggle('picked', x === b));
        fill();
      };
      row.appendChild(b);
    }
    bar.appendChild(row);
  }
  bubble.appendChild(bar);
}
