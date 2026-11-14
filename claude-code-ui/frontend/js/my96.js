/*
 * my96 (Michael 2026-11-14): U decide / I'm back.
 *  Menu row 'U decide' (and the quick card button): he is going away; Claude works on agreed jobs by itself.
 *  While away, a blue I'm back bar sits above the typing box on every device (only then).
 */
import { S } from './state.js';
import { inputForm } from './dom.js';
import { sendText } from './quick.js';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const wsSend = (o) => { if (S.ws && S.isConnected) { S.ws.send(JSON.stringify(o)); return true; } return false; };

const css = mk('style');
css.textContent = `
.h96-back{display:flex;align-items:center;gap:10px;margin:6px 10px;padding:10px 12px;border:1.5px solid #4da3ff;border-radius:14px;background:#0b1522;color:#9cc8ff;font-size:13.5px}
.h96-back.hidden{display:none}
.h96-back span{flex:1;min-width:0}
.h96-back button{flex:none;background:#4da3ff;color:#000;border:0;border-radius:11px;padding:9px 16px;font:700 15px system-ui,sans-serif;cursor:pointer}
.tv-view .h96-back{display:none!important}`;
document.head.append(css);

let away = false, since = 0;
const bar = mk('div', 'h96-back hidden');
const txt = mk('span');
const back = mk('button', null, "👋 I'm back"); back.type = 'button';
bar.append(txt, back);
inputForm.before(bar);

const hm = (ms) => new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
function draw() {
  bar.classList.toggle('hidden', !away);
  txt.textContent = since ? `You're away since ${hm(since)}. I'm getting on with jobs you already agreed, plus checks and tidy-ups.` : "You're away. I'm getting on with jobs you already agreed.";
}

export function goAway() {
  if (!S.isConnected || away) return;
  away = true; since = Date.now(); draw();
  wsSend({ type: 'away_set', on: true });
  sendText("U decide: I'm going away from haAi for a while. Get on by yourself with jobs I have already said yes to, plus checks and tidy-ups (back up first). Anything new waits for me: list it in the I'm back report.");
}
back.onclick = () => {
  if (!S.isConnected) return;
  away = false; draw();
  wsSend({ type: 'away_set', on: false });
  sendText("I'm back. Finish the step you are on, then tell me what you did while I was away, what is waiting for me, and that you are ready for me.");
};

// hidden button the menu row clicks (tidy.js 'go' pattern)
const btn = mk('button'); btn.id = 'udecide-btn'; btn.type = 'button'; btn.style.display = 'none';
btn.onclick = goAway;
document.body.append(btn);

export function onMy96Message(msg) {
  if (msg.type === 'away_state') { away = !!msg.away; since = msg.since || 0; draw(); }
}
export const isAway = () => away;
