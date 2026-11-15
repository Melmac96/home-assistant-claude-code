/**
 * my106 (Michael 15 Nov, Q1 B): only my FINAL reply of each turn is shown, on every device.
 * The short lines I write part-way through a job ("I'm saving this change quickly") are hidden:
 * an assistant message is hidden when another assistant message comes after it before his next
 * message (counted per chat). A message with a question or a card is never hidden.
 */
import { messagesEl } from './dom.js';

const css = document.createElement('style');
css.textContent = '#messages > .bubble-assistant.mid-text{display:none!important}';
document.head.append(css);

const keep = (b) => b.querySelector('.answer-card, .q-tv, .h2-card');
function mark() {
  const last = new Map();   // chat id -> the newest assistant message so far in this turn
  for (const n of messagesEl.children) {
    const id = n.dataset.chat || '';
    if (n.classList.contains('bubble-user')) { last.delete(id); continue; }
    if (!n.classList.contains('bubble-assistant')) continue;
    const prev = last.get(id);
    if (prev && !keep(prev)) prev.classList.add('mid-text');
    n.classList.remove('mid-text');
    last.set(id, n);
  }
}
let t = 0;
new MutationObserver(() => { clearTimeout(t); t = setTimeout(mark, 150); }).observe(messagesEl, { childList: true });
mark();
