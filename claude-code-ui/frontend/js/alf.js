/*
 * my151 (Michael 24 Nov 2026, Q1 B, Q2 A "make him as big as possible in the bar"): Alf sits in the working bar in place
 * of the dot and changes mood with what I am doing. Mood plan (his yes): new chat = Starting look, waiting for him = Calm,
 * reading = Thinking, working = Big idea, question waiting = Cheeky, job finished = Happy, something failed = Sorry,
 * he is asleep in bed = Sleepy, account nearly used up (5-hour or 7-day 90%+) = Fed up.
 * Two pictures on top of each other; a new mood fades in over 1 s (his Alf changing speed). Every picture is loaded
 * at the start and the size is fixed in the CSS, so nothing jumps or resizes.
 * my153 (Michael 25 Nov 2026, Look C): his own moving Alf GIFs (whole Alf, animated WebP 107x60) replace the smoke Alf.
 * my154 (Michael 25 Nov 2026, Q1 D "Do A" + the keyboard one for working): a command that only reads or looks something up
 * counts as reading (Thinking); real changes and builds show his Working Alf typing on the keyboard (m16, GIF 5).
 * my156 (Michael 27 Nov 2026, Q1 B): his NEW Gemini Alfs (master 360 Alf, keyed see-through, 214x120) replace all 10, plus two new
 * ones from his list: reading his files (Read/Grep/Glob) = Reading a Book (m17), looking something up on the internet = Surfing the Web (m18).
 * my159 (Michael 27 Nov 2026, Q3 B): allowance nearly used up (the Fed up mood) now shows his Low Allowance Alf (m19, fuel can and tiny car).
 */
import { S } from './state.js';
import { every } from './util.js';
import { messagesEl } from './dom.js';
import { allowanceNow } from './usage.js';

const FILE = { start: 'm01', calm: 'm02', idea: 'm03', sleepy: 'm06', fedup: 'm19', cheeky: 'm10', happy: 'm11', sorry: 'm12', thinking: 'm14', working: 'm16', files: 'm17', web: 'm18' };
const NAME = { start: 'New chat', calm: 'Waiting for you', thinking: 'Reading', idea: 'Big idea', working: 'Working', cheeky: 'Question waiting', files: 'Reading your files', web: 'Looking it up online',
  happy: 'Job finished', sorry: 'Something failed', sleepy: 'You are asleep', fedup: 'Account nearly used up' };
const src = (m) => `alf/${FILE[m]}.webp?v=my156`;
const READING = /^(Read|Grep|Glob|LS|WebFetch|WebSearch|NotebookRead|ToolSearch|Skill|TodoRead)$/;
// a command line only counts as reading when every part of it is a look-only command and nothing is written to a file
const LOOK = /^(cat|head|tail|grep|egrep|zgrep|rg|ls|find|wc|sort|uniq|cut|tr|awk|diff|cmp|stat|file|which|type|echo|printf|date|pwd|du|df|md5sum|sha256sum|ps|pgrep|uptime|free|jq|less|tree|basename|dirname|realpath|readlink|nl|column|true|sleep|test|\[|unzip -l|webpmux -info|ffprobe|git (status|log|diff|show|branch|check-ignore)|ha-tools (state|states|get|history|logs?|search|list))\b/;
const WRITES = /(^|[^0-9&])>(?!\s*\/dev\/null)|\bsed\s+-i|\btee\b|-X\s*(POST|PUT|DELETE)|\brm\b|\bmv\b|\bcp\b|\bmkdir\b/;
function lookOnly(cmd) {
  if (!cmd || WRITES.test(cmd)) return false;
  return cmd.split(/&&|\|\||;|\||\n/).map((p) => p.trim().replace(/^(cd\s+\S+|[A-Z_]+=\S*)\s*/g, '').trim())
    .filter(Boolean).every((p) => LOOK.test(p) || /^(sed|awk)\s+-n\b/.test(p) || /^(cd|export)\b/.test(p));
}
function reading(t) {
  if (!t) return true;                                        // no tool yet = thinking it through
  if (READING.test(t.name || '')) return true;
  return t.name === 'Bash' && lookOnly(String((t.input || {}).command || ''));
}

Object.values(FILE).forEach((f) => { const i = new Image(); i.src = `alf/${f}.webp?v=my156`; });   // all loaded at the start

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
  if (S.isRunning) {
    const n = (S.lastTool && S.lastTool.name) || '';
    if (/^(WebFetch|WebSearch)$/.test(n)) return 'web';
    if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(n)) return 'files';
    return reading(S.lastTool) ? 'thinking' : 'working';
  }
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
