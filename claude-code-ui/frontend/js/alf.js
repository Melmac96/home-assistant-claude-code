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
 * my163 (Michael 27 Nov 2026, Q1 C): the still job Alfs from his list (ALF-WORK-04..26, Look C: Alf and his tools trimmed to fill the box,
 * alf/wNN.webp) show what I am doing, by the 'For' line of each one in his list. Not wired: Listening (no voice messages here yet).
 */
import { S } from './state.js';
import { every } from './util.js';
import { messagesEl } from './dom.js';
import { allowanceNow } from './usage.js';

const FILE = { start: 'm21', calm: 'm22', idea: 'm03', sleepy: 'm27', fedup: 'm19', cheeky: 'm24', happy: 'm25', sorry: 'm26', thinking: 'm23', working: 'm16', files: 'm17', web: 'm18',
  notes: 'w04', build: 'w05', install: 'w06', switches: 'w07', backup: 'w08', slow: 'w09', restart: 'w10', photo: 'w11', measure: 'w12', test: 'w13',
  message: 'w14', helper: 'w15', filing: 'w16', painting: 'w17', fixing: 'w18', download: 'w19', counting: 'w20', cleaning: 'w22', offline: 'w24', back: 'w25', quiet: 'w26' };
const NAME = { start: 'New chat', calm: 'Waiting for you', thinking: 'Reading', idea: 'Big idea', working: 'Working', cheeky: 'Question waiting', files: 'Reading your files', web: 'Looking it up online',
  happy: 'Job finished', sorry: 'Something failed', sleepy: 'You are asleep', fedup: 'Account nearly used up',
  notes: 'Writing notes', build: 'Building your app', install: 'Installing on the TV', switches: 'Controlling the house', backup: 'Making a backup', slow: 'Waiting for something slow',
  restart: 'Restarting', photo: 'Taking a picture of a page', measure: 'Checking it lines up', test: 'Testing it works', message: 'Sending to your phone and tablet',
  helper: 'Handing part of the job to a helper', filing: 'Saving notes and records', painting: 'Making pictures or a looks page', fixing: 'Fixing a fault',
  download: 'Downloading', counting: 'Adding up figures', cleaning: 'Tidying old files', offline: 'Not connected', back: 'Connected again', quiet: 'Working quietly while you rest' };
const src = (m) => `alf/${FILE[m]}.webp?v=my163`;
// my163: which job Alf a command shows, first match wins (his list's 'For' lines)
const JOBS = [
  ['install', /\badb\b(?![^\n]*192\.168\.1\.142)[^\n]*\b(install|install-multiple)\b/],
  ['build', /\b(build\.sh|build_apk|gradlew?|aapt2?|apksigner|zipalign|d8)\b/],
  ['backup', /\/data\/backups\/|\bbackup\b/i],
  ['restart', /\b(restart|reboot)\b|homeassistant\/(restart|reload)/i],
  ['download', /\b(wget|git clone|pip3? install|apt(-get)? install|apk add|npm (i|install)|yt-dlp)\b|\bcurl\b[^\n|]*\s(-o|-O|--output)\b/],
  ['message', /\bnotify[./]|remind-cli|timedjob-cli/],
  ['photo', /screenshot|playwright|page_pic|chromium/i],
  ['measure', /measur/i],
  ['test', /check_config|core check|--check\b|pytest|verify|_test\.(py|js)\b/],
  ['painting', /alf_still|alf_bar|morph5|\bcwebp\b|\bffmpeg\b|img2webp|_looks?\.py|\bPIL\b|\bconvert\b/],
  ['counting', /money|spend|octopus|energy|kwh/i],
  ['cleaning', /\brm -r|\bfind\b[^\n]*-delete|cache[-_]tidy|\bclean(up|_up)?\b|\btidy\b/i],
  ['switches', /ha-tools call|\/api\/services\//],
  ['filing', /git commit|asks_ledger|CHANGES\.md|open-jobs\/|handovers\//],
];
const FILING = /CHANGES\.md|\/open-jobs\/|\/handovers\/|\/memory\/|\/decisions|waiting-for-you\.json|\.claude\/skills\//;
let toolSeen = null, toolSince = 0, offSince = 0, backUntil = 0;
function jobNow() {   // the JOB line in the reply being written now
  const m = /⟦JOB\|([^⟧]*)⟧(?![\s\S]*⟦JOB\|)/.exec(lastReply());
  return m ? m[1] : '';
}
function job(t) {
  const n = (t && t.name) || '', inp = (t && t.input) || {};
  if (/^(Agent|Task)$/.test(n)) return 'helper';
  if (/^(WebFetch|WebSearch)$/.test(n)) return 'web';
  if (/^(Read|Grep|Glob|LS|NotebookRead)$/.test(n)) return 'files';
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(n)) return FILING.test(String(inp.file_path || inp.notebook_path || '')) ? 'filing' : 'notes';
  if (reading(t)) return 'thinking';
  if (n === 'Bash') { const c = String(inp.command || ''); for (const [k, re] of JOBS) if (re.test(c)) return k; }
  return /\bfix|\brepair|put(ting)? (it )?right/i.test(jobNow()) ? 'fixing' : 'working';
}
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

Object.values(FILE).forEach((f) => { const i = new Image(); i.src = `alf/${f}.webp?v=my163`; });   // all loaded at the start

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
  const now = Date.now();
  if (!S.isConnected) { if (!offSince) offSince = now; if (now - offSince > 3000) return 'offline'; }   // a short blip shows nothing
  else if (offSince) { if (now - offSince > 3000) backUntil = now + 5000; offSince = 0; }
  if (backUntil > now) return 'back';
  if (S.isRunning) {
    if (S.lastTool !== toolSeen) { toolSeen = S.lastTool; toolSince = now; }
    if (window.haaiAsleep) return 'quiet';
    if (S.lastTool && now - toolSince > 60000) return 'slow';   // one step running over a minute
    return job(S.lastTool);
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
