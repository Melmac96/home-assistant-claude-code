/*
 * my34: the Home health heart on the top bar (look C). Green = checked and fine, red with a
 * number = needs a look, red with ! = the check has stopped or haAi has lost touch.
 */
import { sendText } from './quick.js';
import { homeChip } from './batch5.js';   // my49

const SILENCE_MS = 3 * 60 * 1000;
const btn = document.getElementById('health-btn');
const num = document.getElementById('health-num');
let data = null;
let heardAt = 0;
let panel = null;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const lostTouch = () => !!data && Date.now() - heardAt > SILENCE_MS;

function closePanel() {
  if (panel) panel.remove();
  panel = null;
  document.removeEventListener('pointerdown', outside, true);
}

function outside(e) {
  if (panel && !panel.contains(e.target) && !btn.contains(e.target)) closePanel();
}

function fillPanel() {
  panel.textContent = '';
  const add = (cls, text) => panel.append(el('div', cls, text));
  const lost = lostTouch();
  let ask = null;
  if (lost) {
    add('hh-title', 'haAi has lost touch');
    add('hh-line', 'I cannot tell you if your home is alright until haAi reconnects.');
  } else if (data.status === 'stale') {
    add('hh-title', 'The home check has stopped updating');
    add('hh-line', 'I cannot tell you if your home is alright until it runs again.');
    ask = 'The Home health check in haAi says it has stopped updating. Please find out why and tell me in plain English.';
  } else if (data.status === 'bad') {
    add('hh-title', data.count === 1 ? '1 thing needs a look' : `${data.count} things need a look`);
    data.lines.forEach((l) => add('hh-line', l));
    ask = `Please look at what the Home health check is showing and tell me in plain English what needs me:\n${data.lines.join('\n')}`;
  } else {
    add('hh-title', 'Everything checked and fine');
  }
  if (data.last) add('hh-when', `Last checked ${data.last} UK time`);
  const own = Array.isArray(data.haai) ? data.haai : [];   // my79 H12 (Look A): haAi's own checks at the bottom
  if (own.length) {
    const nBad = own.filter((c) => !c.ok).length;
    add('hh-group', nBad ? `haAi: ${nBad} need${nBad === 1 ? 's' : ''} a look` : 'haAi: all fine');
    for (const c of own) add('hh-line ' + (c.ok ? 'hh-ok' : 'hh-bad'), (c.ok ? '✓ ' : '✗ ') + c.text);
    const badOwn = own.filter((c) => !c.ok).map((c) => c.text);
    if (badOwn.length && !ask) ask = `The haAi part of the Home health heart shows a problem. Please find out why and tell me in plain English:\n${badOwn.join('\n')}`;
  }
  if (ask) {
    const b = el('button', 'hh-ask', 'Ask Claude to look');
    b.type = 'button';
    b.onclick = () => { closePanel(); sendText(ask); };
    panel.append(b);
  }
}

function draw() {
  if (!data || data.status === 'wait') return;
  const lost = lostTouch();
  const bad = lost || data.status !== 'good';
  btn.classList.remove('hidden');
  btn.classList.toggle('bad', bad);
  num.textContent = lost || data.status === 'stale' ? '!' : data.status === 'bad' ? String(data.count) : '';
  num.classList.toggle('hidden', !bad);
  btn.setAttribute('aria-label', bad ? 'Home health: needs a look' : 'Home health: all fine');
  homeChip(lost ? '! No contact' : data.status === 'stale' ? '! Check stopped' : data.status === 'bad' ? `● ${data.count} need${data.count === 1 ? 's' : ''} a look` : '✔ Home fine', bad);   // my49
  if (panel) fillPanel();
  window.dispatchEvent(new CustomEvent('haai-health', { detail: { data, lost } }));   // my51: status bar
}

btn.addEventListener('click', () => {
  if (panel) { closePanel(); return; }
  if (!data || data.status === 'wait') return;
  panel = el('div', 'hh-panel');
  panel.style.top = `${btn.getBoundingClientRect().bottom + 8}px`;
  fillPanel();
  document.body.append(panel);
  document.addEventListener('pointerdown', outside, true);
});

setInterval(() => { if (!document.hidden) draw(); }, 30 * 1000);   // my88: rests while haAi is not on screen
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });   // my88

export function onHomeHealth(msg) {
  data = msg;
  heardAt = Date.now();
  draw();
}
