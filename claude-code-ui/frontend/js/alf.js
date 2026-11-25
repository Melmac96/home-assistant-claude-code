/*
 * my151 (Michael 24 Nov 2026, Q1 B, Q2 A "make him as big as possible in the bar"): Alf sits in the working bar in place
 * of the dot and changes mood with what I am doing. Mood plan (his yes): new chat = Starting look, waiting for him = Calm,
 * reading = Thinking, working = Big idea, question waiting = Cheeky, job finished = Happy, something failed = Sorry,
 * he is asleep in bed = Sleepy, account nearly used up (5-hour or 7-day 90%+) = Fed up.
 * Two pictures on top of each other; a new mood fades in over 1 s (his Alf changing speed). Every picture is loaded
 * at the start and the size is fixed in the CSS, so nothing jumps or resizes.
 * my153 (Michael 25 Nov 2026, Look C): his own moving Alf GIFs (whole Alf, animated WebP 107x60) replace the smoke Alf.
 */
import { S } from './state.js';
import { every } from './util.js';
import { messagesEl } from './dom.js';
import { allowanceNow } from './usage.js';

const FILE = { start: 'm01', calm: 'm02', idea: 'm03', sleepy: 'm06', fedup: 'm08', cheeky: 'm10', happy: 'm11', sorry: 'm12', thinking: 'm14' };
const NAME = { start: 'New chat', calm: 'Waiting for you', thinking: 'Reading', idea: 'Working', cheeky: 'Question waiting',
  happy: 'Job finished', sorry: 'Something failed', sleepy: 'You are asleep', fedup: 'Account nearly used up' };
const src = (m) => `alf/${FILE[m]}.webp?v=my153`;
const READING = /^(Read|Grep|Glob|LS|WebFetch|WebSearch|NotebookRead|ToolSearch)$/;

Object.values(FILE).forEach((f) => { const i = new Image(); i.src = `alf/${f}.webp?v=my153`; });   // all loaded at the start

const box = document.createElement('span'); box.className = 'alf';
const a = new Image(), b = new Image(); a.alt = b.alt = ''; a.className = 'on';
box.append(a, b);
let shown = '', front = a;

function used(w) {
  if (!w) return 0;
  if (w.resetsAt && w.resetsAt * 1000 <= Date.now()) return 0;
  return w.utilization <= 1 ? w.utilization * 100 : w.utilization;
}
function lastReply() {   // the newest reply after his last message (raw words, markers still in)
  const all = messagesEl.querySelectorAll('.bubble-user, .bubble-assistant');
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].classList.contains('bubble-user')) return '';
    const c = all[i].querySelector('.bubble-content');
    if (c && c._rawMd) return c._rawMd;
  }
  return '';
}
function mood() {
  if (window.haaiAlfTest && FILE[window.haaiAlfTest]) return window.haaiAlfTest;
  if (S.isRunning) return S.lastTool && !READING.test(S.lastTool.name || '') ? 'idea' : 'thinking';
  if (window.haaiAsleep) return 'sleepy';
  if (!messagesEl.querySelector('.bubble-user, .bubble-assistant')) return 'start';
  const r = lastReply();
  if (r.includes('⟦ERR|')) return 'sorry';
  if (r.includes('⟦/QUESTION⟧')) return 'cheeky';
  const w = allowanceNow().w;
  if (w && Math.max(used(w.five_hour), used(w.seven_day)) >= 90) return 'fedup';
  if (r.includes('⟦DONE|')) return 'happy';
  return 'calm';
}
function draw() {
  const bar = document.querySelector('.h6-bar');
  if (!bar) return;
  if (box.parentNode !== bar) { bar.prepend(box); bar.classList.add('has-alf'); }
  const m = mood();
  if (m === shown) return;
  box.title = NAME[m];
  if (!shown) { front.src = src(m); shown = m; return; }   // first picture: no fade
  shown = m;
  const back = front === a ? b : a;
  back.src = src(m);
  back.decode().catch(() => {}).then(() => {   // swap only once the new picture is ready, and only if it is still the wanted one
    if (shown !== m || back === front) return;
    back.classList.add('on'); front.classList.remove('on'); front = back;
  });
}
draw();
every(1000, draw);
