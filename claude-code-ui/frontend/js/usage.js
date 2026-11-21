/*
 * My Claude Code UI: the two usage bars under the header (look 2) and the detail
 * panel they open. Top bar = 5 hours, lower bar = 7 days. Fed by the server's
 * 'rate_limit' messages, which carry both windows (utilization is a fraction,
 * 0.33 = 33%) and when each resets.
 */
import { S } from './state.js';
const bars = document.getElementById('usage-bars');
const panel = document.getElementById('usage-panel');
const fills = { five_hour: document.getElementById('ub-5h'), seven_day: document.getElementById('ub-7d') };
const NAMES = { five_hour: '5 hours', seven_day: '7 days' };
let windows = null;
let timer = null;

const pctOf = (u) => Math.max(0, Math.min(100, Math.round(u <= 1 ? u * 100 : u)));
const colour = (key, p) => (p >= 95 ? '#e87777' : p >= 80 ? '#e0a93b' : key === 'five_hour' ? '#6bbf8a' : '#6b9fd4');
const hm = (d) => d.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
const day = (d) => d.toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' });

function resetText(epoch) {
  const d = new Date(epoch * 1000);
  const ms = d - Date.now();
  if (ms <= 0) return 'Has reset. The figure updates after your next reply.';
  const mins = Math.round(ms / 60000);
  const left = mins >= 1440 ? `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`
    : mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  const same = day(d) === day(new Date());
  const when = same ? 'today' : d.toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'long' }) + ' ' + day(d);
  return `Resets ${when} at ${hm(d)} (UK time), in ${left}`;
}

// my45 (user look B): allowance forecast card at the top of the panel. Replies are counted on this device (every reply is
// sent to every open page); pace = percent used in the current 5-hour window / replies counted in it.
const LOG = 'reply-log';
export function noteReply() {
  let l = []; try { l = JSON.parse(localStorage.getItem(LOG) || '[]'); } catch { /* start again */ }
  l.push(Date.now());
  try { localStorage.setItem(LOG, JSON.stringify(l.slice(-500))); } catch { /* my115: storage full must never leave "Working" stuck */ }
  try { draw(); } catch (e) { console.warn('allowance card', e); }
}
function forecast() {
  const w = windows && windows.five_hour;
  if (!w) return '';
  const expired = w.resetsAt && w.resetsAt * 1000 <= Date.now();
  const used = expired ? 0 : pctOf(w.utilization), left = 100 - used;
  let l = []; try { l = JSON.parse(localStorage.getItem(LOG) || '[]'); } catch { /* none */ }
  const since = w.resetsAt ? w.resetsAt * 1000 - 5 * 3600000 : 0;
  const n = l.filter((t) => t >= since).length;
  let replies = null;
  if (!expired && n >= 3 && used >= 5) { const r = Math.floor(left / (used / n)); replies = r > 20 ? Math.round(r / 5) * 5 : r; }
  const [word, colourCls] = left >= 30 ? ['Plenty left', 'fc-ok'] : left >= 10 ? ['Getting low', 'fc-mid'] : ['Running low', 'fc-low'];
  const tokens = S.ctxUsage ? S.ctxUsage.totalTokens : 0;
  const tip = tokens >= 100000 ? 'This long chat is using a lot. A new chat is cheaper.' : '';
  return `<div class="fc-card"><b>Allowance</b><div class="fc-bar"><i class="${colourCls}" style="width:${left}%"></i></div>` +
    `<span class="${colourCls}">${word}</span> · ${replies != null ? `about ${replies} more replies at this pace` : `${left}% of the 5 hours left`}` +
    (tip ? `<div class="fc-tip">${tip}</div>` : '') + '</div>';
}

function draw() {
  if (!windows) return;
  let html = forecast();
  for (const key of ['five_hour', 'seven_day']) {
    const w = windows[key];
    if (!w) continue;
    const expired = w.resetsAt && w.resetsAt * 1000 <= Date.now();
    const p = expired ? 0 : pctOf(w.utilization);
    const f = fills[key];
    f.style.width = p + '%';
    f.style.background = colour(key, p);
    html += `<div class="up-row"><b>${NAMES[key]}: ${p}% used, ${100 - p}% left</b>` +
      `<div class="up-sub">${w.resetsAt ? resetText(w.resetsAt) : ''}</div></div>`;
  }
  panel.innerHTML = html || '<div class="up-sub">No usage figures yet.</div>';
}

// my120 (Michael 15 Nov): the bars always show the account in use (the header's). Every figure is kept under its own
// account; after a move the new account's own figure is shown at once (its last saved one until its first reply).
let curEmail = '';
export const allowanceNow = () => ({ w: windows, email: curEmail });   // my138: the What's going on box reads the figures in use
const figs = {};   // email -> { w, at }
const lc = (e) => String(e || '').toLowerCase();
function show(w) {
  windows = w;
  bars.classList.toggle('hidden', !w);
  if (w) { draw(); return; }
  for (const f of Object.values(fills)) f.style.width = '0%';
  panel.innerHTML = '<div class="up-sub">No usage figures yet.</div>';
}
export function updateUsage(msg) {
  const w = msg && msg.unifiedWindows;
  if (!w || (!w.five_hour && !w.seven_day)) return;
  const acc = lc(msg.account) || curEmail;
  if (acc) figs[acc] = { w, at: Date.now() };
  window.dispatchEvent(new Event('haai-usage'));   // my54
  if (!curEmail || !acc || acc === curEmail) show(w);
}
window.addEventListener('haai-accounts', (e) => {
  const em = lc(e.detail && e.detail.cur && e.detail.cur.email);
  if (!em || em === curEmail) return;
  const first = !curEmail;
  curEmail = em;
  if (figs[em]) show(figs[em].w);
  else if (!first) { show(null); window.dispatchEvent(new Event('haai-usage')); }   // ask for the saved figures (guard.js quota_get)
});
window.addEventListener('haai-quota', (e) => {
  const q = (e && e.detail) || {};
  const win = (x) => (x && x.used != null ? { utilization: x.used / 100, resetsAt: x.resetsAt || null } : null);
  for (const [k, v] of Object.entries(q)) {
    if (!v || !v.at || !(v.five_hour || v.seven_day)) continue;
    if (!figs[k] || v.at > figs[k].at) figs[k] = { w: { five_hour: win(v.five_hour), seven_day: win(v.seven_day) }, at: v.at };
  }
  if (curEmail && figs[curEmail] && figs[curEmail].w !== windows) show(figs[curEmail].w);
});

function toggle() {
  panel.classList.toggle('hidden');
  clearInterval(timer);
  if (!panel.classList.contains('hidden')) { draw(); timer = setInterval(draw, 30000); }
}
bars.onclick = toggle;
bars.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
panel.onclick = toggle;
