/*
 * haAi (my24): the pop-up inside Home Assistant (look A). When haAi is shown in the small card under the
 * Home Assistant top bar (address ends ?embed=1), the page around it sends which page and device the user
 * is on. That is added as ONE line in front of the message so Claude knows where he is.
 * Only messages from the parent page on the SAME origin are believed.
 */
export const EMBED = new URLSearchParams(location.search).get('embed') === '1';
let ctx = null;
if (EMBED) {
  document.documentElement.classList.add('embedded');
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== window.parent) return;
    const d = e.data;
    if (!d || d.type !== 'haai_context') return;
    ctx = { page: String(d.page || '').slice(0, 300), title: String(d.title || '').slice(0, 120), device: String(d.device || '').slice(0, 60) };
    const chip = document.getElementById('ctx-chip');
    if (chip) { chip.textContent = 'Page: ' + (ctx.title || ctx.page) + '  |  Device: ' + ctx.device; chip.classList.remove('hidden'); }
  });
  window.parent.postMessage({ type: 'haai_ready' }, location.origin);
}
/** One line to put in front of a message, or '' when not in the pop-up. */
export function contextLine() {
  if (!EMBED || !ctx) return '';
  return `[Home Assistant page I am looking at: ${ctx.page} (${ctx.title}) | my device: ${ctx.device}]\n`;
}
