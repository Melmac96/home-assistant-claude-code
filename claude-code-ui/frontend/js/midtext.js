/**
 * my106 (Michael 15 Nov, Q1 B): only my FINAL reply of each turn is shown, on every device.
 * The short lines I write part-way through a job ("I'm saving this change quickly") are hidden:
 * an assistant message is hidden when another assistant message comes after it before his next
 * message (counted per chat). A message with a question or a card is never hidden.
 */
import { messagesEl } from './dom.js';
import { every } from './util.js';   // my115
import { S } from './state.js';

const css = document.createElement('style');
css.textContent = '#messages > .bubble-assistant.mid-text{display:none!important}';
document.head.append(css);

// my112 (Michael 15 Nov: 'why do the questions keep vanishing?'): a message holding a question is NEVER hidden, even
// before its answer buttons are drawn and even while haAi still thinks I am working (it was hidden then).
const QRX = /⟦\/?QUESTION⟧|\[\[\/?QUESTION\]\]/;
const keep = (b) => b.querySelector('.answer-card, .q-tv, .h2-card') || QRX.test(b.textContent || '') ||
  [...b.querySelectorAll('.bubble-content')].some((c) => QRX.test(c._rawMd || ''));
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
  // my108 (Michael 15 Nov): while I am still working, even the newest line of this turn stays hidden; it shows when
  // the turn ends (that is my final reply). The progress bar and step panel still show what I am doing.
  running = S.isRunning;
  for (const [id, b] of last) if (running && id === (S.chat || id) && !keep(b)) b.classList.add('mid-text');
}
let running = false;
every(400, () => { if (S.isRunning !== running) mark(); });   // my115: the one shared page timer
let t = 0;
new MutationObserver(() => { clearTimeout(t); t = setTimeout(mark, 150); }).observe(messagesEl, { childList: true });
mark();
