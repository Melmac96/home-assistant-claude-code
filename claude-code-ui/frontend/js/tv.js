/*
 * my104 (Michael 15 Nov, mock-up www/my-claude-code-ui/haai-tv-mock.html): haAi on the HA Shield TV.
 * Only on a TV (the Shield's browser says "SHIELD Android TV"); phones and tablets are not touched.
 * ?tvlayout=1 / ?tvlayout=0 forces it on or off on any screen (kept on that screen).
 *  - no top buttons; one thin top line: the star stays still, everything else scrolls slowly right to left:
 *    the account box, waiting things, the 3 accounts' 5-hour and Week allowance LEFT, model, Now on TV
 *  - the reply buttons (Broke a rule, Explain it, Another way, speaker, star, time) on ONE line
 *  - the whole width; his own messages across the whole width with the blue lines above and below
 *  - typing box with no buttons; a button shows only while its feature is on (green Done for Lots to send)
 *  - white text becomes the normal haAi grey
 */
import { S } from './state.js';
import { mk } from './util.js';   // my115: shared helpers

const q = /[?&]tvlayout=([01])/.exec(location.search);
if (q) { try { localStorage.setItem('haai-tvlayout', q[1]); } catch { /* ignore */ } }
const forced = (() => { try { return localStorage.getItem('haai-tvlayout'); } catch { return null; } })();
const isTv = forced === '1' || (forced !== '0' && /Android ?TV|SHIELD|AFT[A-Z]|BRAVIA|Google ?TV/i.test(navigator.userAgent));

const SHORT = { 'thereades@gmail.com': 'Main', 'thereades.uk@gmail.com': '2nd', 'rf.mike@gmail.com': '3rd', 'readerufus@gmail.com': '4th' };
const ORDER = ['thereades@gmail.com', 'thereades.uk@gmail.com', 'rf.mike@gmail.com', 'readerufus@gmail.com'];

if (isTv) {
  document.documentElement.classList.add('haai-tv');
  const css = mk('style');
  css.textContent = `
.haai-tv{--text:#7d8087}
.haai-tv body,.haai-tv .bubble-content,.haai-tv .bubble-user .bubble-content,.haai-tv .svc-badge .sb-a,.haai-tv strong,.haai-tv b,.haai-tv h1,.haai-tv h2,.haai-tv h3,.haai-tv h4,.haai-tv #prompt-input,.haai-tv .way-chip,.haai-tv .tv-acct{color:#7d8087}
.haai-tv #app{max-width:none!important;width:100%}
.haai-tv .icon-group,.haai-tv #tidy-menu-btn,.haai-tv #tidy-sbar,.haai-tv .h93-tv,.haai-tv .header-left>.svc-badge{display:none!important}
.haai-tv .header{min-height:0!important;height:34px;padding:0 8px!important;border-bottom:1px solid var(--border)}
.haai-tv .header-left{flex:1;min-width:0;gap:10px;display:flex;align-items:center}
.haai-tv .tidy-star{flex:none}
.tv-tick{flex:1;min-width:0;overflow:hidden;white-space:nowrap;-webkit-mask-image:linear-gradient(90deg,transparent,#000 24px,#000 calc(100% - 24px),transparent);mask-image:linear-gradient(90deg,transparent,#000 24px,#000 calc(100% - 24px),transparent)}
.tv-run{display:inline-flex;white-space:nowrap;animation:tv-tick linear infinite;will-change:transform}
.tv-grp{display:inline-flex;align-items:center;gap:14px;padding-right:14px;font-size:13px;color:var(--lite)}
.tv-grp .tv-dot{color:var(--border-2)}
.tv-grp .tv-badge{display:inline-flex;align-items:center;justify-content:center;background:#f3736c;color:#000;border-radius:50%;min-width:18px;height:18px;font-size:11px;font-weight:700}
.tv-acct{border:1px solid var(--accent);border-radius:8px;padding:1px 8px;font-weight:600}
.tv-qbox{border:1px solid;border-radius:8px;padding:1px 8px}
.tv-acct small{color:var(--text-muted);font-weight:400;margin-left:5px;font-size:1em}
.tv-grp .cy{color:#e8b84a}.tv-grp .cr{color:#f3736c}
@keyframes tv-tick{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.haai-tv .bubble-user{align-self:stretch!important;width:100%;max-width:100%!important;box-sizing:border-box;background:transparent!important;border:0!important;border-top:2px solid var(--line-blue,#1f5fae)!important;border-bottom:2px solid var(--line-blue,#1f5fae)!important;border-radius:0!important}
/* my105 (Michael 15 Nov): no buttons under replies or his messages on the TV - Broke a rule, Explain it, Another way, speaker, star, time and Remember are tablet only */
.haai-tv .bubble-assistant>.reply-foot,.haai-tv .bubble-assistant>.reply-chips,.haai-tv .bubble-assistant>.read-top,.haai-tv .bubble-assistant>.msg-time,.haai-tv .bubble-user>.h93-rem,.haai-tv .bubble-user>.msg-time{display:none!important}
/* my105: questions = one line on the TV (gone once answered); no answer buttons, no card buttons; Claude's working shows again since my107 */
.haai-tv .q-tv{display:block!important;margin:6px 0;padding:6px 12px;border:1px solid var(--accent);border-radius:8px;color:#9cc8ff;font-weight:600}
.haai-tv .q-tv.q-done,.haai-tv .q-part,.haai-tv #tidy-chips,.haai-tv .bubble-assistant .h2-btn,.haai-tv .bubble-assistant .h2-row{display:none!important}
/* my107 (Michael 15 Nov, Q2 B): the working panel (my steps, thinking, progress bar) shows on the TV all the time, like the phone and tablet - my105's hide removed */
.haai-tv #attach-btn,.haai-tv .tidy-morebtn,.haai-tv #keep-btn,.haai-tv #send-btn,.haai-tv .h97-hand,.haai-tv .h97-lots:not(.h97-done){display:none!important}`;
  document.head.append(css);

  // ── the top line ──
  const tick = mk('div', 'tv-tick');
  const run = mk('div', 'tv-run');
  tick.append(run);
  const star = document.querySelector('.tidy-star');
  if (star) star.after(tick); else document.querySelector('.header-left')?.append(tick);

  let quota = {};
  window.addEventListener('haai-quota', (e) => { quota = e.detail || {}; draw(); });

  const left = (w) => (w && w.used != null ? Math.max(0, 100 - Math.round(w.used)) : null);
  // my106 (Michael 15 Nov): when each allowance starts again, UK time (5h = time, Week = day and time)
  const at = (w, day) => {
    if (!w || !w.resetsAt) return '';
    const o = { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false };
    if (day) o.weekday = 'short';
    return ' (' + new Date(w.resetsAt * 1000).toLocaleString('en-GB', o).replace(',', '') + ')';
  };
  // my128 (Michael 15 Nov): each account's box takes the colour of its fuller bar, the same colours as the usage bars (extras.js colour())
  const boxCol = (v) => { const u = (w) => (w && w.used != null ? Math.round(w.used) : 0), f = Math.max(u(v.five_hour), u(v.seven_day)); return f >= 95 ? '#e87777' : f >= 80 ? '#e0a93b' : u(v.seven_day) > u(v.five_hour) ? '#6b9fd4' : '#6bbf8a'; };
  const tone = (p) => (p == null ? '' : p <= 15 ? 'cr' : p <= 40 ? 'cy' : '');

  function parts() {
    const a = [];
    const badge = document.getElementById('svc-badge');
    const sa = badge?.querySelector('.sb-a')?.textContent.trim() || 'Claude';
    const sm = badge?.querySelector('.sb-m')?.textContent.trim() || '';
    a.push({ acct: [sa, sm] });
    const w = /\d+/.exec(document.getElementById('waiting-count')?.textContent || '');
    const items = (window.haaiStatusItems ? window.haaiStatusItems() : []).filter((x) => !/allowance/i.test(x[0]));
    for (const [t, c] of items) {
      if (/waiting for you to test/.test(t) && w) a.push({ badge: w[0], text: t, cls: c });
      else a.push({ text: t, cls: c });
    }
    const emails = Object.keys(quota).sort((x, y) => (ORDER.indexOf(x) + 99 * (ORDER.indexOf(x) < 0)) - (ORDER.indexOf(y) + 99 * (ORDER.indexOf(y) < 0)));
    for (const e of emails) {
      const v = quota[e] || {}, f = left(v.five_hour), k = left(v.seven_day);
      const name = SHORT[e] || e.split('@')[0];
      a.push({ text: `${name} 5h ${f == null ? '?' : f + '%'} left${at(v.five_hour)} · Week ${k == null ? '?' : k + '%'} left${at(v.seven_day, true)}`, cls: tone(Math.min(f ?? 100, k ?? 100)), box: boxCol(v) });
    }
    const tv = document.querySelector('.h93-tv')?.textContent.trim();
    if (tv) a.push({ text: tv });
    return a;
  }

  function group(list) {
    const g = mk('span', 'tv-grp');
    for (const p of list) {
      if (p.acct) { const b = mk('span', 'tv-acct', p.acct[0]); if (p.acct[1]) b.append(mk('small', null, p.acct[1])); g.append(b); }
      else { if (p.badge) g.append(mk('span', 'tv-badge', p.badge)); const t = mk('span', p.box ? 'tv-qbox ' + (p.cls || '') : p.cls || '', p.text); if (p.box) t.style.borderColor = p.box; g.append(t); }
      g.append(mk('span', 'tv-dot', '·'));
    }
    return g;
  }

  let lastKey = '';
  function draw() {
    if (document.hidden) return;
    const list = parts();
    const key = JSON.stringify(list);
    if (key === lastKey) return;   // same words: leave the scroll running smoothly
    lastKey = key;
    const g1 = group(list), g2 = g1.cloneNode(true);
    run.replaceChildren(g1, g2);
    // about 25 seconds to cross the screen, whatever the length of the words
    const speed = Math.max(400, tick.clientWidth || window.innerWidth) / 25;
    run.style.animationDuration = `${Math.max(10, (g1.offsetWidth || 1000) / speed).toFixed(1)}s`;
  }
  draw();
  setInterval(draw, 5000);
  document.addEventListener('visibilitychange', draw);
  // first figures straight away, then the server sends fresh ones every 5 minutes
  const ask = () => { try { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify({ type: 'quota_get' })); } catch { /* ignore */ } };
  setTimeout(ask, 1500);

  // my113 (Michael 15 Nov): while the mini TV (picture-in-picture) is on the screen, the working bar and the typing box
  // end just left of it, so nothing of theirs sits behind it. No mini TV = normal width. The server tells us where it is.
  let pip = null, pipTimer = null;
  const fitPip = () => {
    const els = [document.querySelector('.h6-bar'), document.querySelector('.h2-step'), document.getElementById('input-form')].filter(Boolean);
    for (const el of els) el.style.maxWidth = '';
    if (!pip || !pip.on) return;
    const k = window.innerWidth / (pip.sw || 1920);         // the Shield gives screen points; the page may be scaled
    const edge = pip.l * k - 10, top = pip.t * k - 6;        // a small gap before the mini TV
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.height && r.bottom > top && r.right > edge) el.style.maxWidth = `${Math.max(120, Math.floor(edge - r.left))}px`;
    }
  };
  window.addEventListener('haai-pip', (e) => {
    pip = e.detail || null;
    fitPip();
    clearInterval(pipTimer); pipTimer = null;
    if (pip && pip.on) pipTimer = setInterval(fitPip, 1000);   // the bar comes and goes and grows: keep it clear
  });
  window.addEventListener('resize', fitPip);
}
