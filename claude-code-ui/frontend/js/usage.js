/*
 * My Claude Code UI: the two usage bars under the header (look 2) and the detail
 * panel they open. Top bar = 5 hours, lower bar = 7 days. Fed by the server's
 * 'rate_limit' messages, which carry both windows (utilization is a fraction,
 * 0.33 = 33%) and when each resets.
 */
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

function draw() {
  if (!windows) return;
  let html = '';
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

export function updateUsage(msg) {
  const w = msg && msg.unifiedWindows;
  if (!w || (!w.five_hour && !w.seven_day)) return;
  windows = w;
  bars.classList.remove('hidden');
  draw();
}

function toggle() {
  panel.classList.toggle('hidden');
  clearInterval(timer);
  if (!panel.classList.contains('hidden')) { draw(); timer = setInterval(draw, 30000); }
}
bars.onclick = toggle;
bars.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
panel.onclick = toggle;
