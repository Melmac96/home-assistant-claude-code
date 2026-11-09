/*
 * my40: the five extras picked on 2026-11-08 (test page five-extras-looks.html) plus Accounts quota.
 *  1. Chat length (look D): nothing until the chat is 80% full, then a red strip above the typing box.
 *  2. Jump to my question (look D): an unanswered question stays pinned above the chat; tap = go to it.
 *  3. Star a reply (look C): a star by each reply, and a star button in the top bar with the list.
 *  4. Refresh screens (look C): first pill in Quick replies (the pill itself is drawn in quick.js).
 *  5. haAi phone app: "Check for app update" in Settings (the phone message is sent when a new app is published).
 *  6. Accounts: 5-hour and weekly use for each paid account, as USED bars matching the top bars.
 */
import { S } from './state.js';
import { inputForm, messagesEl, modelSelect, effortSelect } from './dom.js';
import { openNewChat } from './quick.js';
import { onAdvisorMessage } from './advisor.js';   // my42
import { MODEL_LABELS } from './model.js';   // my54
import './guard.js';   // my54
import './autoswitch.js';   // my55 (after guard.js so a blocked message never switches)
import { speakerButton } from './read.js';   // my43
import { stripMarks, replyChips, onBatch1Message } from './batch1.js';   // my45
import { onBriefMessage } from './batch2.js';   // my46
import { onScreenShot } from './batch3.js';   // my47
import { onOvernight } from './batch4.js';   // my48
import { onQuiet } from './batch5.js';   // my49

const send = (o) => { if (S.ws && S.isConnected) S.ws.send(JSON.stringify(o)); };
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return 'h' + (h >>> 0).toString(36) + '-' + s.length.toString(36); };
const UK = { timeZone: 'Europe/London' };
const hm = (d) => d.toLocaleTimeString('en-GB', { ...UK, hour: '2-digit', minute: '2-digit' });
const dayKey = (d) => d.toLocaleDateString('en-GB', { ...UK, day: 'numeric', month: 'short' });
function whenText(ms) {
  const d = new Date(ms);
  if (dayKey(d) === dayKey(new Date())) return 'today ' + hm(d);
  return d.toLocaleDateString('en-GB', { ...UK, weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + hm(d);
}

// ── 1. Chat length strip ─────────────────────────────────────────────────────
const strip = mk('button', 'ctx-strip hidden');
strip.type = 'button';
inputForm.prepend(strip);
strip.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openNewChat(); };
function drawCtx() {
  const u = S.ctxUsage;
  const limit = u ? ((u.autoCompactEnabled && u.autoCompactThreshold) || u.maxTokens) : 0;
  const pct = u && limit ? Math.min(100, Math.round(u.totalTokens / limit * 100)) : 0;
  // my41 (user, 2026-11-08): warn when the chat gets COSTLY (150,000 tokens), not only when the memory is nearly full.
  const tokens = u ? u.totalTokens : 0;
  const costly = tokens >= 150000;
  strip.classList.toggle('hidden', !(costly || pct >= 80));
  strip.textContent = costly ? `This chat is long (${Math.round(tokens / 1000)}k tokens) and costs more each reply. Tap to start a new chat` : `Chat is ${pct}% full. Tap to start a new chat`;
}
window.addEventListener('haai-ctx', drawCtx);

// ── 2. Question pinned above the chat ────────────────────────────────────────
const pin = mk('button', 'q-pin hidden');
pin.type = 'button';
document.getElementById('chat-scroll').before(pin);
let pinTarget = null;
pin.onclick = () => { if (pinTarget && pinTarget.isConnected) pinTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
function drawPin() {
  const open = [...messagesEl.querySelectorAll('.bubble-assistant .answer-card:not([disabled])')];
  if (!open.length) { pin.classList.add('hidden'); pinTarget = null; return; }
  const content = open[open.length - 1].closest('.bubble-content');
  const cards = [...content.querySelectorAll('.answer-card:not([disabled])')];
  pinTarget = cards[0];
  const qs = [...content.querySelectorAll('p')].filter((p) => /^Q\d+$/.test(p.firstElementChild?.tagName === 'STRONG' ? p.firstElementChild.textContent.trim() : ''));
  let text = '';
  if (qs.length > 1) text = `${qs.length} questions are waiting for you. Tap to see them`;
  else {
    for (let n = cards[0].previousElementSibling; n; n = n.previousElementSibling) {
      const t = n.textContent.trim();
      if (n.tagName === 'P' && t && !t.includes('⟦')) { text = t.replace(/^Q\d+\s*/, ''); break; }
    }
    text = (text || 'A question is waiting for you') + ' (tap to see it)';
  }
  pin.textContent = '❓ ' + text;
  pin.classList.remove('hidden');
}
let pinTimer = null;
new MutationObserver(() => { clearTimeout(pinTimer); pinTimer = setTimeout(drawPin, 200); })
  .observe(messagesEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

// ── 3. Starred replies ───────────────────────────────────────────────────────
let stars = [];
const starIds = () => new Set(stars.map((s) => s.id));
export function decorateStar(content) {
  const bubble = content.parentElement;
  if (!bubble || !bubble.classList.contains('bubble-assistant')) return;
  const raw = (content._rawMd || '').trim();
  if (!raw) return;
  // my43: the star lives at the BOTTOM of the reply (with a speaker); another speaker sits at the top.
  let foot = bubble.querySelector(':scope > .reply-foot');
  if (!foot) {
    foot = mk('div', 'reply-foot');
    const getRaw = () => stripMarks(content._rawMd || '');
    const top = speakerButton(getRaw); top.classList.add('read-top');
    const bottom = speakerButton(getRaw);
    foot.append(bottom);
    bubble.append(foot);
    replyChips(bubble, content);   // my45
    bubble.prepend(top);
  }
  let b = foot.querySelector('.star-btn');
  if (!b) {
    b = mk('button', 'star-btn');
    b.type = 'button';
    b.setAttribute('aria-label', 'Star this reply');
    b.onclick = (e) => {
      e.stopPropagation();
      const text = (content._rawMd || '').trim();
      const id = hash(text);
      if (starIds().has(id)) send({ type: 'star_remove', id });
      else send({ type: 'star_add', id, text, ts: Date.now() });
    };
    foot.append(b);
  }
  const on = starIds().has(hash(raw));
  b.textContent = on ? '★' : '☆';
  b.classList.toggle('on', on);
}
const repaintStars = () => messagesEl.querySelectorAll('.bubble-assistant > .bubble-content').forEach(decorateStar);

const starBtn = document.getElementById('stars-btn');
const starPanel = document.getElementById('stars-panel');
const starList = document.getElementById('stars-list');
function drawStarList() {
  starList.innerHTML = '';
  document.getElementById('stars-count').textContent = stars.length ? `(${stars.length})` : '';
  if (!stars.length) { starList.append(mk('div', 'settings-hint', 'Nothing starred yet. Tap the star beside any of my replies to keep it here.')); return; }
  for (const s of stars) {
    const row = mk('div', 'star-row');
    const head = mk('div', 'star-when', 'Starred ' + whenText(s.starredAt || s.ts));
    const plain = stripMarks(s.text).replace(/🔹/g, '').replace(/[*_#`>⟦⟧]/g, '').replace(/\s+/g, ' ').trim();
    const snip = mk('div', 'star-snip', plain.length > 180 ? plain.slice(0, 180) + '…' : plain);
    const full = mk('div', 'star-full bubble-content hidden');
    snip.onclick = () => {
      if (!full.dataset.done) { full.innerHTML = window.marked ? window.marked.parse(stripMarks(s.text)) : ''; if (!full.innerHTML) full.textContent = stripMarks(s.text); full.dataset.done = '1'; }
      full.classList.toggle('hidden');
      snip.classList.toggle('hidden');
    };
    full.onclick = snip.onclick;
    const rm = mk('button', 'star-rm', 'Remove');
    rm.type = 'button';
    rm.onclick = (e) => {
      e.stopPropagation();
      if (rm.dataset.armed) { send({ type: 'star_remove', id: s.id }); return; }
      rm.dataset.armed = '1'; rm.textContent = 'Press again to remove';
      setTimeout(() => { delete rm.dataset.armed; rm.textContent = 'Remove'; }, 4000);
    };
    row.append(head, snip, full, rm);
    starList.append(row);
  }
}
if (starBtn) {
  starBtn.onclick = (e) => {
    e.stopPropagation();
    const nowHidden = starPanel.classList.toggle('hidden');
    starBtn.classList.toggle('active', !nowHidden);
    if (!nowHidden) {
      for (const id of ['settings', 'sessions', 'accounts']) {
        document.getElementById(id + '-panel')?.classList.add('hidden');
        document.getElementById(id + '-btn')?.classList.remove('active');
      }
      drawStarList();
    }
  };
  starPanel.onclick = (e) => e.stopPropagation();
  document.addEventListener('click', () => { starPanel.classList.add('hidden'); starBtn.classList.remove('active'); });
  for (const id of ['settings', 'sessions', 'accounts', 'new-session']) {
    document.getElementById(id + '-btn')?.addEventListener('click', () => { starPanel.classList.add('hidden'); starBtn.classList.remove('active'); });
  }
}

// ── 7. Model and thinking effort: one shared choice, default newest Sonnet on Medium ──
let prefs = null;
const verOf = (s) => (String(s).match(/\d+/g) || []).map(Number);
const cmpVer = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (b[i] || 0) - (a[i] || 0); if (d) return d; } return 0; };
function latestSonnet() {
  const opts = [...modelSelect.options].filter((o) => /sonnet/i.test(o.value + ' ' + (o.dataset.resolvedModel || '')));
  if (!opts.length) return 'claude-sonnet-5-5';
  opts.sort((x, y) => cmpVer(verOf(x.dataset.resolvedModel || x.value), verOf(y.dataset.resolvedModel || y.value)));
  return opts[0].value;
}
function applyPrefs() {
  if (!prefs) return;
  const id = prefs.model === 'latest-sonnet' ? latestSonnet() : prefs.model;
  if (![...modelSelect.options].some((o) => o.value === id)) {
    const op = document.createElement('option'); op.value = id; op.textContent = id; modelSelect.appendChild(op);
  }
  modelSelect.value = id;
  localStorage.setItem('model', id);
  effortSelect.value = prefs.effort;
  localStorage.setItem('effort', prefs.effort);
}
window.addEventListener('haai-models', applyPrefs);

// my54: on a real start of haAi (not just coming back to the front) a centre pop-up checks the model and effort.
// sessionStorage survives the page reloading when the app comes back, but not the app being closed and reopened.
function startCheck() {
  if (!prefs || sessionStorage.getItem('haai-start-checked')) return;
  sessionStorage.setItem('haai-start-checked', '1');
  const sonnetId = latestSonnet();
  if ((prefs.model === 'latest-sonnet' || prefs.model === sonnetId) && prefs.effort === 'medium') return;
  const label = (id) => { const o = [...modelSelect.options].find((x) => x.value === id); return (o && o.textContent) || MODEL_LABELS[id] || id; };
  const now = prefs.model === 'latest-sonnet' ? label(sonnetId) : label(prefs.model);
  const eff = String(prefs.effort || 'medium'); const effName = eff[0].toUpperCase() + eff.slice(1);
  const ov = document.createElement('div'); ov.className = 'start-check';
  ov.setAttribute('role', 'alertdialog'); ov.setAttribute('aria-modal', 'true');
  const card = document.createElement('div'); card.className = 'sc-card';
  const t = document.createElement('div'); t.className = 'sc-title'; t.textContent = `You are currently set to ${now} on ${effName} effort`;
  const q = document.createElement('div'); q.className = 'sc-q'; q.textContent = `Do you want to stay on this setting or switch to your normal Sonnet model (${label(sonnetId)}) on Medium effort?`;
  const stay = document.createElement('button'); stay.type = 'button'; stay.className = 'sc-stay'; stay.textContent = 'Stay on this setting';
  const sw = document.createElement('button'); sw.type = 'button'; sw.className = 'sc-switch'; sw.textContent = `Switch to ${label(sonnetId)} · Medium`;
  stay.onclick = () => ov.remove();
  sw.onclick = () => { send({ type: 'prefs_set', model: 'latest-sonnet', effort: 'medium' }); send({ type: 'advisor_set', advised: false }); ov.remove(); };
  card.append(t, q, stay, sw); ov.append(card);
  ov.addEventListener('click', (e) => e.stopPropagation());
  document.body.append(ov);
}
const savePrefs = () => {
  const m = modelSelect.value === latestSonnet() ? 'latest-sonnet' : modelSelect.value;
  send({ type: 'prefs_set', model: m, effort: effortSelect.value || 'medium' });
};
modelSelect.addEventListener('change', savePrefs);
effortSelect.addEventListener('change', savePrefs);

// ── 5. haAi phone app update (Settings) ──────────────────────────────────────
let latest = null;
const appBtn = document.getElementById('app-update-check');
const appOut = document.getElementById('app-update-out');
const appVersion = () => { const m = navigator.userAgent.match(/haAiApp\/(\d+)/); return m ? Number(m[1]) : 0; };
let asked = false;
function drawApp() {
  if (!appOut || !asked) return;
  appOut.innerHTML = '';
  if (!latest) { appOut.append(mk('span', '', 'I could not find a published haAi app just now.')); return; }
  const mine = appVersion();
  if (mine && mine >= latest.versionCode) { appOut.append(mk('span', '', `You have the newest haAi app (version ${mine}).`)); return; }
  appOut.append(mk('span', '', mine ? `A newer haAi app is ready: version ${latest.versionCode} (you have ${mine}). ` : `The newest haAi app is version ${latest.versionCode}. `));
  const a = mk('a', 'settings-btn app-get', `Install version ${latest.versionCode}`);
  a.href = latest.url; a.target = '_blank'; a.rel = 'noopener';
  appOut.append(a);
}
if (appBtn) appBtn.onclick = () => { asked = true; appOut.textContent = 'Checking…'; send({ type: 'app_latest_get' }); };

// ── 6. Accounts: 5-hour and weekly use for each paid account ─────────────────
let quota = {};
const NAMES = { five_hour: '5 hours', seven_day: 'Weekly' };
const colour = (key, p) => (p >= 95 ? '#e87777' : p >= 80 ? '#e0a93b' : key === 'five_hour' ? '#6bbf8a' : '#6b9fd4');   // same as the top bars
function drawQuota() {
  for (const row of document.querySelectorAll('#accounts-list .acc-row')) {
    const email = (row.querySelector('.acc-email')?.firstChild?.textContent || '').trim().toLowerCase();
    if (!email) continue;
    row.querySelector('.acc-quota')?.remove();
    const box = mk('div', 'acc-quota');
    const q = quota[email];
    if (!q || (!q.five_hour && !q.seven_day)) {
      box.append(mk('div', 'aq-note', 'No figures yet. They show once this account has been used in haAi.'));
    } else {
      for (const key of ['five_hour', 'seven_day']) {
        const w = q[key];
        if (!w) continue;
        const reset = w.resetsAt ? w.resetsAt * 1000 : 0;
        const over = reset && reset <= Date.now();
        const p = over ? 0 : w.used;
        const line = mk('div', 'aq-line');
        line.append(mk('span', 'aq-name', NAMES[key]), mk('b', 'aq-pct', over ? 'reset' : `${p}% used`));
        const bar = mk('div', 'aq-bar');
        const fill = mk('i');
        fill.style.width = p + '%';
        fill.style.background = colour(key, p);
        bar.append(fill);
        box.append(line, bar, mk('div', 'aq-sub', over ? 'Has reset since these figures were seen' : reset ? `Resets ${whenText(reset)} (UK time)` : ''));
      }
      if (!q.live && q.at) box.append(mk('div', 'aq-note', `Last seen ${whenText(q.at)} (UK time). Live figures show again once this account is used.`));
    }
    row.append(box);
  }
}
new MutationObserver(drawQuota).observe(document.getElementById('accounts-list'), { childList: true });
document.getElementById('accounts-btn')?.addEventListener('click', () => send({ type: 'quota_get' }));

// ── Messages from the server ─────────────────────────────────────────────────
export function onExtrasMessage(msg) {
  switch (msg.type) {
    case 'advisor': onAdvisorMessage(msg); break;   // my42
    case 'reminders': onBatch1Message(msg); break;   // my45
    case 'brief': onBriefMessage(msg); break;   // my46
    case 'screen_shot': onScreenShot(msg); break;   // my47
    case 'overnight': onOvernight(msg); break;   // my48
    case 'quiet': onQuiet(msg); break;   // my49
    case 'prefs': prefs = { model: msg.model, effort: msg.effort }; applyPrefs(); startCheck(); break;
    case 'stars': stars = msg.list || []; repaintStars(); if (!starPanel.classList.contains('hidden')) drawStarList(); else document.getElementById('stars-count').textContent = stars.length ? `(${stars.length})` : ''; break;
    case 'refresh_result': {
      const p = document.querySelector('.quick-refresh');
      if (p) { p.textContent = (msg.ok ? '✓ ' : '✗ ') + msg.text; p.disabled = false; setTimeout(() => { p.textContent = '⟳ Refresh screens'; }, 5000); }
      break;
    }
    case 'app_latest': latest = msg.latest || null; drawApp(); break;
    case 'quota': quota = msg.accounts || {}; drawQuota(); window.dispatchEvent(new CustomEvent('haai-quota', { detail: quota })); break;
  }
}
