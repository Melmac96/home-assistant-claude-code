/*
 * my97 (Michael 2026-11-14): two buttons just after the … button in the bottom row of the typing box.
 *  1. Lots to send (stack, his Look B): Claude works quietly and asks no questions; the button turns into a green Done.
 *  2. Waving hand (line drawing, his Look A): the same as the menu's U decide (my96); the I'm back bar then shows.
 *  The buttons sit in their own span so tidy.js does not tuck them into the More list.
 */
import { S } from './state.js';
import { mk, wsSend } from './util.js';   // my115: shared helpers
import { inputForm } from './dom.js';
import { sendText } from './quick.js';
import { appendInfoLine } from './transcript.js';   // my115
import { goAway, isAway } from './my96.js';

const svg = (p, n) => `<svg viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const STACK = '<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/>';
const HAND = '<path d="M18 11V6a2 2 0 0 0-4 0"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/><path d="M2.5 6.5a5 5 0 0 1 2.5-3.5"/><path d="M20 2.5a4 4 0 0 1 2 2"/>';
const TICK = '<path d="M20 6 9 17l-5-5"/>';

const css = mk('style');
css.textContent = `
.h97{display:inline-flex;align-items:center;gap:6px;flex:none}
.h97 .h97-done{border-color:#46bb68!important;background:rgba(70,187,104,.14)!important;color:#86a98e!important;width:auto!important;padding:0 10px!important;font:700 13px system-ui,sans-serif;gap:5px;display:inline-flex;align-items:center}
.h97-strip{display:flex;align-items:center;gap:10px;margin:6px 10px;padding:8px 12px;border:1px solid #8aa4b5;border-radius:14px;background:#202830;color:#8aa4b5;font-size:13px}
.h97-strip.hidden{display:none}.h97-strip span{flex:1;min-width:0}
.tv-view .h97,.tv-view .h97-strip{display:none!important}`;
document.head.append(css);

let on = false, count = 0;
const box = mk('span', 'h97');
const lots = mk('button', 'attach-btn h97-lots'); lots.type = 'button'; lots.title = 'Lots to send'; lots.setAttribute('aria-label', 'Lots to send');
const hand = mk('button', 'attach-btn h97-hand'); hand.type = 'button'; hand.title = "U decide (I'm going away)"; hand.setAttribute('aria-label', "U decide (I'm going away)");
hand.innerHTML = svg(HAND, 18);
box.append(lots, hand);
const strip = mk('div', 'h97-strip hidden');
const stxt = mk('span');
strip.innerHTML = svg(STACK, 16); strip.append(stxt);
inputForm.before(strip);

function draw() {
  lots.classList.toggle('h97-done', on);
  lots.innerHTML = on ? svg(TICK, 15) + 'Done' : svg(STACK, 18);
  lots.title = on ? 'Done: ask me your questions now' : 'Lots to send';
  strip.classList.toggle('hidden', !on);
  stxt.textContent = `Lots to send is on${count ? ': ' + count + (count === 1 ? ' message' : ' messages') + ' so far' : ''}. No questions until you press Done.`;
  hand.style.display = isAway() ? 'none' : '';
}
lots.onclick = () => {
  if (!S.isConnected) { appendInfoLine('No connection, so Lots to send was not changed. Try again when haAi is back.'); return; }   // my115
  if (!on) {
    on = true; count = 0; draw(); wsSend({ type: 'lots_set', on: true });
    sendText("Lots to send: I'm listing changes. Work on each one quietly in the background, ask me no questions, and keep your questions until I press Done.");
    setTimeout(() => { count = 0; draw(); }, 20);   // the first message is the button's own, not one of his
  } else {
    on = false; draw(); wsSend({ type: 'lots_set', on: false });
    sendText('Done: ask me all your saved questions now in one go, then do whatever is left.');
  }
};
hand.onclick = () => { goAway(); setTimeout(draw, 50); };
// my115: counts every message that really went (typed or from a button), not every press of Send
window.addEventListener('haai-sent', () => { if (on) setTimeout(() => { if (on) { count++; draw(); } }, 0); });

let placeTries = 0;
function place() {   // after the … button (made by tidy.js), before the token text
  const more = document.querySelector('.tidy-morebtn');
  if (!more) { if (++placeTries < 150) setTimeout(place, 200); else inputForm.before(box); return; }   // my115: gives up after 30 s
  more.after(box); draw();
}
place();
window.addEventListener('haai-away', () => draw());   // my115: told when U decide / I'm back changes (was asked every 2 s)

export function onMy97Message(msg) {
  if (msg.type === 'lots_state') { const was = on; on = !!msg.on; if (on && !was) count = 0; draw(); }
}
