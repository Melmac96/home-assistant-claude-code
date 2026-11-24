/*
 * my148 (Michael 24 Nov 2026, Look B + Helpers tab): tap an account on the Accounts page and its own page opens.
 * A forecast box at the top, then 4 tabs: Allowance, Tokens, Helpers (every model that did work for it, and
 * the free helpers, with what each cost), Account. Figures come from the server (account_details), never a secret.
 */
import { S } from './state.js';

const G = '#46bb68', R = '#a6746f', A = '#ba9c69', B = '#859eaf', M = '#78808a';
const TABS = ['Allowance', 'Tokens', 'Helpers', 'Account'];
let page = null, want = null, info = null, tab = 'Allowance';

const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const html = (tag, cls, h) => { const e = mk(tag, cls); e.innerHTML = h; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ukf = (o) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ...o });
const uk = (t, day = true) => !t ? 'not known' : day
  ? ukf({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t * 1000)).replace(/,? (\d\d:\d\d)$/, ', $1')
  : ukf({ hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t * 1000));
const date = (iso) => iso ? ukf({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : 'not known';
const big = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n || 0);
const num = (n) => Number(n || 0).toLocaleString('en-GB');
const col = (p) => p >= 90 ? R : p >= 75 ? A : G;
const D = ['1', '3', '7'];

function table(rows) {   // rows: [label, d => text]
  return '<table><tr><th></th><th>24 hours</th><th>3 days</th><th>7 days</th></tr>' +
    rows.map(([l, f]) => `<tr><td>${esc(l)}</td>` + D.map((d) => `<td>${esc(f(d))}</td>`).join('') + '</tr>').join('') + '</table>';
}

function bar(label, p, reset) {
  p = p || 0;
  return `<div class="ap-bar"><div class="ap-bl"><span>${label}</span><b style="color:${col(p)}">${p}%</b></div>` +
    `<div class="acc-track"><i style="width:${Math.min(p, 100)}%;background:${col(p)}"></i></div><small>Resets ${uk(reset)} UK time</small></div>`;
}

function graph(a, now) {
  const pts = a.week_graph || [], fc = a.forecast || {}, nw = a.now || {}, w = 340, h = 120;
  if (pts.length < 2) return '<small>Not enough history yet</small>';
  const t0 = now - 7 * 86400, t1 = Math.max(now, nw.seven_reset || now);
  const x = (t) => ((t - t0) / (t1 - t0) * w).toFixed(1), y = (p) => (h - Math.min(p, 100) / 100 * h).toFixed(1);
  const last = pts[pts.length - 1];
  const fx = a.forecast ? `<line x1="${x(last[0])}" y1="${y(last[1])}" x2="${x(t1)}" y2="${y(fc.at_reset ?? nw.seven_day ?? 0)}" stroke="${A}" stroke-width="1" stroke-dasharray="4 3"/>` : '';
  return `<svg viewBox="0 -4 ${w} ${h + 8}" class="ap-g"><line x1="0" y1="${y(100)}" x2="${w}" y2="${y(100)}" stroke="${R}" stroke-width="1" stroke-dasharray="2 3"/>` +
    `<line x1="0" y1="${h}" x2="${w}" y2="${h}" stroke="#27303a" stroke-width="1"/><line x1="${x(now)}" y1="0" x2="${x(now)}" y2="${h}" stroke="${M}" stroke-width="1" stroke-dasharray="2 3"/>` +
    `<polyline points="${pts.map(([t, p]) => x(t) + ',' + y(p)).join(' ')}" fill="none" stroke="${B}" stroke-width="1.5"/>${fx}</svg>` +
    `<div class="ap-gx"><span>7 days ago</span><span>Now, then the forecast to the reset at ${uk(nw.seven_reset, false)}</span></div>`;
}

function fbox(a) {
  const fc = a.forecast || {}, nw = a.now || {}, runs = fc.runs_out, c = runs ? R : G;
  const warn = !a.forecast ? 'Forecast: not enough figures yet' : runs
    ? `Forecast: runs out ${uk(runs)} UK time, before it resets at ${uk(nw.seven_reset, false)}`
    : `Forecast: about ${fc.at_reset ?? 0}% used when it resets`;
  return `<div class="ap-fore" style="border-color:${c}"><b style="color:${c}">${runs ? '⚠ ' : ''}${esc(warn)}</b>` +
    (a.forecast ? `<small>Using about ${fc.per_day}% a day. Safe pace: ${fc.safe_per_day}% a day until it resets.</small>` : '') + '</div>';
}

const card = (title, inner) => `<div class="ap-card">${title ? `<h4>${esc(title)}</h4>` : ''}${inner}</div>`;

function paneHtml(name, a, now) {
  const tk = a.tokens || {}, nw = a.now || {}, est = D.some((d) => tk[d]?.estimated);
  const note = est ? '<small>Estimated where a figure is from before 24 Nov 2026: matched to this account from the usage history. Exact from then on.</small>' : '';
  if (name === 'Allowance') return card('Allowance now', bar('5 hours', nw.five_hour, nw.five_reset) + bar('7 days', nw.seven_day, nw.seven_reset)) +
    card('7-day use this week', graph(a, now));
  if (name === 'Tokens') {
    const m = tk['7']?.models || {}, n = Object.values(m).reduce((s, v) => s + v, 0) || 1;
    const names = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable', other: 'Other' };
    const hs = a.hours || [], mx = Math.max(...hs, 1), top = hs.indexOf(Math.max(...hs, 0));
    return card('Tokens', table([['Replies', (d) => num(tk[d]?.replies)], ['Chats', (d) => num(tk[d]?.chats)], ['Sent', (d) => big(tk[d]?.sent)],
      ['Written', (d) => big(tk[d]?.written)], ['Memory reused', (d) => big(tk[d]?.reused)], ['Memory saved', (d) => big(tk[d]?.saved)],
      ['Worth*', (d) => '$' + Math.round(tk[d]?.worth_usd || 0)]]) + '<small>*What it would cost at pay-as-you-go prices.</small>' + note) +
      card('Models (7 days)', Object.entries(m).sort((p, q) => q[1] - p[1]).map(([k, v]) => `<div class="ap-bl"><span>${names[k] || esc(k)}</span><b>${Math.round(v * 100 / n)}%</b></div>`).join('') || '<small>None yet</small>') +
      card('When it is used', `<div class="ap-hrs">${hs.map((v) => `<i style="height:${Math.max(Math.round(v / mx * 48), 1)}px"></i>`).join('')}</div>` +
        `<div class="ap-gl"><span>00:00</span><span>12:00</span><span>23:00</span></div><small>Busiest hour: ${String(top).padStart(2, '0')}:00 to ${String(top + 1).padStart(2, '0')}:00 UK time</small>`);
  }
  if (name === 'Helpers') {
    const models = Object.keys(tk['7']?.by_model || {}).sort((p, q) => tk['7'].by_model[q].replies - tk['7'].by_model[p].replies);
    const free = Object.keys(tk['7']?.free || {}).sort((p, q) => tk['7'].free[q].uses - tk['7'].free[p].uses);
    const bm = (d, n) => tk[d]?.by_model?.[n], fr = (d, n) => tk[d]?.free?.[n];
    return '<small>Every model that did work for this account. Helper jobs = work handed to a helper.</small>' +
      (models.map((n) => card(n, table([['Replies', (d) => num(bm(d, n)?.replies)], ['Helper jobs', (d) => num(bm(d, n)?.helper_replies)],
        ['Written', (d) => big(bm(d, n)?.written)], ['Memory reused', (d) => big(bm(d, n)?.reused)],
        ['Cost*', (d) => bm(d, n)?.free ? 'free' : '$' + (bm(d, n)?.worth_usd || 0).toFixed(2)]]))).join('') || card('', '<small>No replies in the last 7 days</small>')) +
      '<small>Free helpers: they read big files or do quick jobs at no cost. Their record keeps sizes and times only.</small>' +
      (free.map((n) => card(n, table([['Uses', (d) => num(fr(d, n)?.uses)], ['No answer', (d) => num(fr(d, n)?.failed)], ['Letters read', (d) => big(fr(d, n)?.chars)],
        ['Words back', (d) => big(fr(d, n)?.words)], ['Time', (d) => Math.round(fr(d, n)?.secs || 0) + ' s'], ['Cost', () => '$0.00']]))).join('') || card('', '<small>No free helper jobs in the last 7 days</small>')) +
      '<small>*What it would cost on that model at pay-as-you-go prices.</small>' + note;
  }
  const x = info || {};
  const facts = [['Name', a.name || ''], ['Email', x.email || ''], ['Plan', a.plan || 'not known'], ['Opened', date(a.opened)], ['Plan started', date(a.plan_started)],
    ['Paid by', a.billing === 'stripe_subscription' ? 'Card subscription' : (a.billing || 'not known')], ['Extra usage', a.extra_usage ? 'On' : 'Off'],
    ['Limit haAi keeps to', (x.cap || 95) + '%'], ['On hold', x.held ? 'Yes, until you tap ON HOLD' : 'No'], ['Name in haAi', x.label || ''], ['Now', x.chip || ''],
    ['Figures checked', uk(nw.checked) + ' UK time']];
  return card('The account', facts.filter((f) => f[1]).map(([k, v]) => `<div class="ap-bl"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join(''));
}

function provPane(name, p, f) {   // his Q2 A (24 Nov): Other Paid / Free accounts
  if (name === 'Overview') return card(p.label, (p.lines || []).map((l) => `<div class="ap-line">${esc(l)}</div>`).join('') || '<small>No figures yet</small>');
  if (name === 'Helper jobs') {
    if (!f) return card('', '<small>No free helper jobs on this account in the last 7 days. The figures above count chats run on it.</small>');
    const w = f.windows || {}, jobs = { long: 'Reading big files and logs', fast: 'Quick small jobs' };
    return card(f.name, table([['Uses', (d) => num(w[d]?.uses)], ['No answer', (d) => num(w[d]?.failed)], ['Letters read', (d) => big(w[d]?.chars)],
      ['Words back', (d) => big(w[d]?.words)], ['Time', (d) => Math.round(w[d]?.secs || 0) + ' s'], ['Cost', () => '$0.00']])) +
      card('Kinds of job (7 days)', Object.entries(f.jobs || {}).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<div class="ap-bl"><span>${esc(jobs[k] || k)}</span><b>${num(v)}</b></div>`).join('')) +
      `<small>Last used ${uk(f.last)} UK time. The free helpers' record keeps sizes and times only, never what was read.</small>`;
  }
  const facts = [['Name', p.label], ['Kind', p.paid ? 'Paid' : 'Free'], ['Ready to use', p.ready ? 'Yes' : 'No'], ['In use now', p.active ? 'Yes' : 'No'],
    ['Model', p.model ? p.model.replace(/^[^/]+\//, '') : 'none set'], ['Its id in haAi', p.id]];
  return card('The account', facts.map(([k, v]) => `<div class="ap-bl"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join(''));
}

function draw() {
  if (!page) return;
  const body = page.querySelector('.ap-body'); body.innerHTML = '';
  if (info && info.prov) {
    const names = ['Overview', 'Helper jobs', 'Account'];
    if (!names.includes(tab)) tab = 'Overview';
    const tabs = mk('div', 'ap-tabs');
    for (const t of names) { const b = mk('button', t === tab ? 'ap-on' : '', t); b.type = 'button'; b.onclick = () => { tab = t; draw(); }; tabs.append(b); }
    body.append(tabs);
    if (tab === 'Helper jobs' && !want) { body.append(mk('div', 'ap-wait', 'Getting the figures...')); return; }
    if (tab === 'Helper jobs' && want.error) { body.append(mk('div', 'ap-wait', want.error)); return; }
    body.append(html('div', 'ap-pane', provPane(tab, info.prov, want && want.provider)));
    return;
  }
  const a = want && want.details;
  if (!a) { body.append(mk('div', 'ap-wait', want && want.error ? want.error : 'Getting the figures...')); return; }
  body.append(html('div', '', fbox(a)));
  const tabs = mk('div', 'ap-tabs');
  for (const t of TABS) { const b = mk('button', t === tab ? 'ap-on' : '', t); b.type = 'button'; b.onclick = () => { tab = t; draw(); }; tabs.append(b); }
  body.append(tabs, html('div', 'ap-pane', paneHtml(tab, a, want.made || Date.now() / 1000)));
}

export function closeAccountPage() { if (page) { page.remove(); page = null; } }

// a = the saved account; extra = { chip, chipCls, cap, held, place }
export function openAccountPage(a, extra) {
  closeAccountPage();
  info = { ...extra, email: a.email }; want = null; tab = 'Allowance';
  page = mk('div', 'ap-page');
  const top = mk('div', 'ap-top'), back = mk('button', 'ap-back', '‹ Accounts'); back.type = 'button';
  back.onclick = () => { if (history.state && history.state.apPage) history.back(); else closeAccountPage(); };
  top.append(back, mk('b', '', extra.short || a.email), mk('span', 'acc-chip ' + (extra.chipCls || ''), extra.chip || ''));
  page.append(top, mk('div', 'ap-body'));
  document.body.append(page);
  try { history.pushState({ apPage: 1 }, ''); } catch { /* not needed */ }
  draw();
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify({ type: 'account_details', email: a.email }));
  else { want = { error: 'haAi is not connected just now, so I could not get the figures.' }; draw(); }
}

// his Q2 A: the Other Paid / Free tiles open a page too. p = the provider from the stats message
export function openProviderPage(p) {
  closeAccountPage();
  info = { prov: p, email: 'provider:' + p.id }; want = null; tab = 'Overview';
  page = mk('div', 'ap-page');
  const top = mk('div', 'ap-top'), back = mk('button', 'ap-back', '‹ Accounts'); back.type = 'button';
  back.onclick = () => { if (history.state && history.state.apPage) history.back(); else closeAccountPage(); };
  top.append(back, mk('b', '', p.label), mk('span', 'acc-chip ' + (p.active ? 'acc-b' : p.ready ? 'acc-g' : 'acc-a'), p.active ? 'In use' : p.ready ? 'Ready' : 'Not ready'));
  page.append(top, mk('div', 'ap-body'));
  document.body.append(page);
  try { history.pushState({ apPage: 1 }, ''); } catch { /* not needed */ }
  draw();
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify({ type: 'account_details', email: info.email }));
  else want = { error: 'haAi is not connected just now, so I could not get the figures.' };
}

export function showAccountDetails(msg) {
  if (!page || !info || String(msg.email).toLowerCase() !== String(info.email).toLowerCase()) return;
  want = msg; draw();
}

window.addEventListener('popstate', () => closeAccountPage());   // the phone's own Back closes it
