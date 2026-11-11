/*
 * The working indicator, with elapsed seconds. Long silent thinking is the usual
 * cause of the "chat looks stuck" perception, so the count is the reassurance.
 */
import { S } from './state.js';
import { messagesEl } from './dom.js';
import { scrollBottom } from './scroll.js';

// ── Working indicator ────────────────────────────────────────────────────────
// The working indicator shows elapsed seconds so a long silent stretch (deep
// thinking, a slow tool, a retry/backoff, or auto-compaction) reads as "still
// going" rather than "stuck". The timer restarts each time the indicator
// reappears, so it measures the *current* wait.
export let thinkingTimer = null;
export function showThinking() {
  if (S.thinkingEl) { messagesEl.appendChild(S.thinkingEl); scrollBottom(); return; }
  // my77: each chat has its own Working… line, so the timer belongs to the line (not one shared timer).
  const start = Date.now();
  S.thinkingEl = document.createElement('div');
  S.thinkingEl.className = 'thinking';
  S.thinkingEl.innerHTML =
    '<span class="thinking-dots"><i></i><i></i><i></i></span>' +
    '<span class="thinking-label">Working…</span>';
  messagesEl.appendChild(S.thinkingEl);
  const label = S.thinkingEl.querySelector('.thinking-label');
  const el = S.thinkingEl;
  thinkingTimer = el._timer = setInterval(() => {
    if (!el.isConnected && el !== S.thinkingEl) { clearInterval(el._timer); return; }
    const s = Math.round((Date.now() - start) / 1000);
    if (s >= 30) { label.textContent = `Working… ${s}s — long turns can take a minute or more`; el.classList.add('slow'); }
    else if (s >= 3) label.textContent = `Working… ${s}s`;
  }, 1000);
  scrollBottom();
}
export function hideThinking() {
  if (S.thinkingEl && S.thinkingEl._timer) { clearInterval(S.thinkingEl._timer); if (thinkingTimer === S.thinkingEl._timer) thinkingTimer = null; }   // my77
  else if (thinkingTimer && !S.thinkingEl) { clearInterval(thinkingTimer); thinkingTimer = null; }
  if (S.thinkingEl) { S.thinkingEl.remove(); S.thinkingEl = null; }
}
