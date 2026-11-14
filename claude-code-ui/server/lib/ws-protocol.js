/*
 * The WebSocket protocol: what a connecting browser is told, and what it may
 * ask for.
 *
 * The inbound half is a dispatch table rather than a chain of `else if`s, so the
 * set of messages the client may send is a list you can read.
 */
import { setManual, setCarryOn } from './my90.js';   // my90
import { readFileSync } from 'fs';
import { DEFAULT_PERMISSION_MODE } from './config.js';
import { log } from './log.js';
import { runtime } from './state.js';
import { connections, send, broadcast } from './broadcast.js';
import {
  isAuthenticated, isSubscriptionAuth, startLoginFlow, loginUrl, loginProcess, stopLoginProc,
} from './auth.js';
import { listSessions, parseSession, deleteSession, saveActive, searchSessions, itemSum } from './sessions.js';   // my88 itemSum
import * as handover from './handover.js';   // my28
import { pendingDialogs, answerDialog } from './dialogs.js';
import { pendingPermissions, resolvePermission, resolvePromptsAllowedBy } from './permissions.js';
import { saveAttachments, describeAttachments } from './uploads.js';
import { runQuery, abortActive, canStartRun } from './run-query.js';
import { chats, view, makeSlot, inChat, anyRunning, runningChats, MAX_RUNNING, pickColour } from './chats.js';   // my58, my77
import { chatsMessage, broadcastChats, chatList } from './chatlist.js';   // my58, my77
import { saveCurrent, listAccounts, switchTo, setMode, setFreeModel, providerStats, useProvider, freeChatReadyAsync } from './accounts.js';
import * as autoContinue from './auto-continue.js';
import * as notifier from './notify.js';
import * as deviceAuth from './device-auth.js';
import { getSelfUpdate, startSelfUpdateCheck } from './selfupdate.js';   // my33
import { getHomeHealth, startHomeHealthCheck } from './homehealth.js';   // my34
import * as keep from './keep.js';   // my35
import * as extras from './extras.js';   // my40
import { getPrefs, setPrefs } from './prefs.js';   // my41
import { getAdvisor, setAdvisor } from './advisor.js';   // my42
import { listReminders, removeReminder, startReminders } from './batch1.js';   // my45
import { getBrief, startBrief } from './batch2.js';   // my46
import { getWhatsNew, whatsNewSeen, jobCosts, ruleBroken, startMy74 } from './my74.js';   // my74
import { startQuiet, quietState, clearHeld } from './batch5.js';   // my49
import { listOvernight, addOvernight, removeOvernight, clearOvernightDone, startOvernight } from './batch4.js';   // my48
import { takeScreenshot } from './screen.js';   // my47
import { ideasList, ideasOp } from './ideas.js';   // my59
import * as scrollmem from './scrollmem.js';   // my73
import { startMy93, getMessages, getNowTv } from './my93.js';   // my93
import { awayState, setAway, startMy96 } from './my96.js';   // my96
import { startMy79, listTimed, cancelTimed, getDatedChecks, checksAfterTick, getDraft, setDraft } from './my79.js';   // my79
const withPos = (sid) => ({ sid: sid || null, scrollPos: scrollmem.getPos(sid) });   // my73: where he was reading

// my88: a page that is still open and only reconnects says what it already has (ws.have, from the address it
// connects to: sid, n = how many items, h = fingerprint of the last one). If that still matches the chat file,
// only the items after n are sent (delta), so nothing is read, sent or drawn twice. Anything that does not match
// gets the whole chat, as before.
function historyFor(ws, sid) {
  const items = parseSession(sid);
  const base = { type: 'history', ...withPos(sid), n: items.length, h: items.length ? itemSum(items[items.length - 1]) : '' };
  const have = ws.have; ws.have = null;
  if (have && sid && have.sid === sid && have.n > 0 && have.n <= items.length && itemSum(items[have.n - 1]) === have.h) {
    return { ...base, delta: true, from: have.n, items: items.slice(have.n) };
  }
  return { ...base, items };
}
const sums = (items) => ({ n: items.length, h: items.length ? itemSum(items[items.length - 1]) : '' });   // my88

startSelfUpdateCheck();
startHomeHealthCheck();
startReminders();   // my45
startBrief();   // my46
startMy74();   // my74
startOvernight();   // my48
startQuiet();   // my49
startMy79();   // my79
startMy93();   // my93
startMy96();   // my96 AP40

/** Everything a newly connected (or reconnected) tab needs to render the app. */
function greet(ws) {
  ws.chat = chats.has(view.last) ? view.last : 'c1';   // my58: a new browser starts on the chat last looked at
  inChat(chats.get(ws.chat), () => greetFor(ws));
}

function greetFor(ws) {
  send(ws, { type: 'connected' });
  send(ws, {
    type: 'config',
    defaultPermMode: DEFAULT_PERMISSION_MODE,
    autoContinue: autoContinue.autoContinue.enabled,
    autoContinueSupported: isSubscriptionAuth(),
  });
  send(ws, { ...chatsMessage(), viewing: ws.chat });   // my58
  sendNotifyState(ws);
  send(ws, { type: 'auth_status', authenticated: isAuthenticated() && !runtime.credentialsExpired });
  if (runtime.credentialsExpired) send(ws, { type: 'auth_expired', subscription: isSubscriptionAuth() });
  // A login is mid-flight (reconnected while waiting to paste the code) — restore
  // the URL and code box, so switching to the browser and back does not lose it.
  const url = loginUrl();
  if (url) send(ws, { type: 'auth_url', url });
  send(ws, { type: 'slash_commands', commands: runtime.cachedSlashCommands });
  send(ws, { type: 'models', models: runtime.cachedModels });
  send(ws, { type: 'ha_links', entities: runtime.haLinks.entities, automations: runtime.haLinks.automations });
  send(ws, { type: 'sessions', sessions: listSessions(), activeId: runtime.activeSessionId });
  send(ws, {
    ...historyFor(ws, runtime.activeSessionId),   // my88: only what is new when the page already has the rest
    running: !!runtime.activeQuery,
    // The foreground turn is done but a background task it spawned (a
    // subagent, a backgrounded shell command) is still running — distinct from
    // `running` so the UI can show "finishing up in the background" rather
    // than either idle or the ordinary thinking indicator.
    background: runtime.backgroundTasks.size > 0,
  });
  if (runtime.backgroundTasks.size) {
    send(ws, { type: 'background_tasks', tasks: [...runtime.backgroundTasks.values()] });
  }

  // my28: quick jobs/replies, and a Continue this job that finished while this tab was away
  send(ws, { type: 'quick', ...handover.getQuick() });
  send(ws, { type: 'self_update', ...getSelfUpdate() });   // my33
  send(ws, { type: 'home_health', ...getHomeHealth() });   // my34
  send(ws, { type: 'keep', list: keep.list() });   // my35
  send(ws, { type: 'stars', list: extras.listStars() });   // my40
  send(ws, { type: 'prefs', ...getPrefs() });   // my41
  send(ws, { type: 'advisor', ...getAdvisor() });   // my42
  send(ws, { type: 'reminders', list: listReminders() });   // my45
  send(ws, { type: 'brief', brief: getBrief() });   // my46
  send(ws, { type: 'jobcost', map: jobCosts() });   // my74
  send(ws, { type: 'whatsnew', ...getWhatsNew() });   // my74
  send(ws, { type: 'overnight', ...listOvernight() });   // my48
  send(ws, { type: 'timed', list: listTimed() });   // my79 H17
  send(ws, { type: 'dated_checks', list: getDatedChecks() });   // my79 H10
  send(ws, { type: 'now_tv', ...getNowTv() });   // my93 H19
  send(ws, { type: 'away_state', ...awayState() });   // my96
  { const d = getDraft(); if (d) send(ws, { type: 'draft', ...d }); }   // my79 H9
  send(ws, { type: 'quiet', ...quietState() });   // my49
  send(ws, { type: 'app_latest', latest: extras.appLatest() });   // my40
  if (runtime.lastCtx && runtime.lastCtx.sid && runtime.lastCtx.sid === runtime.activeSessionId) send(ws, runtime.lastCtx);   // my40
  if (runtime.pendingContinue) { send(ws, { type: 'handover_ready', text: runtime.pendingContinue }); runtime.pendingContinue = null; }

  // My Claude Code UI: keep the live sign-in saved (this is how the first
  // account is registered) and tell the tab who is signed in.
  try { saveCurrent(); } catch { /* never block a connection on this */ }
  send(ws, { type: 'accounts', ...listAccounts() });

  // My Claude Code UI: show the usage bars straight away on connect, from the
  // last update this run saw, or failing that the last one saved to disk.
  let lastUsage = runtime.lastUsage;
  if (!lastUsage) {
    try {
      const lines = readFileSync('/data/usage-events.jsonl', 'utf8').trim().split('\n');
      const i = JSON.parse(lines[lines.length - 1]).event.rate_limit_info;
      lastUsage = { status: i.status, rateLimitType: i.rateLimitType, resetsAt: i.resetsAt,
        utilization: i.utilization, unifiedWindows: i.unifiedWindows };
    } catch { /* nothing recorded yet */ }
  }
  if (lastUsage) send(ws, { type: 'rate_limit', ...lastUsage });

  // Replay a scheduled resume so a reconnecting tab shows the countdown, or —
  // when nothing is scheduled — the standing offer to turn one on.
  const pending = autoContinue.autoContinue.pending;
  const offer = autoContinue.liveLimitOffer();
  if (pending) {
    send(ws, { type: 'auto_continue_pending', resetsAt: pending.resetsAt,
      rateLimitType: pending.rateLimitType, attempts: pending.attempts });
  } else if (offer) {
    send(ws, { type: 'limit_offer', resetsAt: offer.resetsAt,
      rateLimitType: offer.rateLimitType, supported: isSubscriptionAuth() });
  }

  // A question Claude asked while this tab was away belongs to the run, not to
  // the socket that happened to be open — so it is still waiting, and this is
  // what shows it rather than leaving the turn silently paused.
  for (const [id, d] of pendingDialogs) {
    send(ws, { type: 'user_dialog', id, dialogKind: 'askUserQuestion', payload: d.payload, chat: d.chat });
  }

  // Likewise a permission prompt: it belongs to the run, not to whichever tab
  // was open when it was asked (see permissions.js's pendingPermissions).
  for (const [, entry] of pendingPermissions) send(ws, { ...entry.req, chat: entry.chat || entry.req.chat });
}

function sendNotifyState(ws) {
  notifier.listNotifyServices().then((services) =>
    send(ws, { type: 'notify_state', ...notifier.notifySettings, services }));
}

function broadcastSessions() {
  broadcast({ type: 'sessions', sessions: listSessions(), activeId: runtime.activeSessionId });
}

function startFresh() {
  autoContinue.cancel('new-session');
  autoContinue.clearLimitOffer('new-session');
  runtime.activeSessionId = null;
  saveActive();
  broadcast({ type: 'cleared' });
  broadcastSessions();
}

/** Everything the browser may send. One entry per message type. */
const handlers = {
  auth_check(ws) {
    send(ws, { type: 'auth_status', authenticated: isAuthenticated() });
  },

  auth_login() {
    startLoginFlow(broadcast, () => {
      runtime.credentialsExpired = false;
      saveCurrent();   // a newly signed-in account is saved straight away
      broadcast({ type: 'accounts', ...listAccounts() });
    });
  },

  // Abandon an 'add another account' sign-in; the current sign-in was never touched.
  auth_cancel() {
    stopLoginProc();
  },

  account_switch(ws, msg) {
    if (anyRunning()) {
      send(ws, { type: 'account_result', ok: false, error: 'Claude is busy. Wait for the reply to finish, then switch.' });
      return;
    }
    const r = switchTo(msg.id);
    // my83 (Michael 2026-11-11): the account he picks is the one the next message uses. Without this a chat kept the
    // account it had before (my77 'keep its own account') and every switch went on hitting the old account's limit.
    if (r.ok) for (const s of chats.values()) if (!s.free) s.account = null;
    if (r.ok) { const a = listAccounts().saved.find((x) => x.id === msg.id); setManual(a ? a.email : null); }   // my90: his pick goes first while under its limit
    send(ws, { type: 'account_result', ...r });
    broadcast({ type: 'accounts', ...listAccounts() });
  },

  // my90: after "all accounts at 90%" he picks Carry on (main still stops at 95%) or Wait.
  cycle_carry_on(_ws, msg) {
    setCarryOn(!!msg.on);
    extras.getQuota(false).then((q) => broadcast({ type: 'quota', ...q }));
  },

  // my17: pick another FREE model; applies to the very next message of this same chat (no new chat needed).
  model_set(ws, msg) {
    const r = setFreeModel(msg.model);
    if (r.ok && runtime.activeRun?.q?.setModel) {
      runtime.activeRun.q.setModel(r.model).catch((e) => log('WARN', `setModel on the running chat failed: ${e?.message || e}`));
    }
    send(ws, { type: 'account_result', ...r, modelSet: true });
    broadcast({ type: 'accounts', ...listAccounts() });
  },

  // my25: usage lines for every provider (read-only) and choosing the Free-mode provider
  stats_get(ws) { providerStats((r) => send(ws, { type: 'provider_stats', ...r })); },
  provider_use(ws, msg) {
    const r = useProvider(msg.id);
    send(ws, { type: 'account_result', ...r });
    broadcast({ type: 'accounts', ...listAccounts() });
    providerStats((x) => broadcast({ type: 'provider_stats', ...x }));
  },

  // my16: Free / Paid mode from the Accounts menu (same busy rule as an account switch).
  mode_switch(ws, msg) {
    if (anyRunning()) {
      send(ws, { type: 'account_result', ok: false, error: 'Claude is busy. Wait for the reply to finish, then switch.' });
      return;
    }
    const r = setMode(!!msg.free);
    send(ws, { type: 'account_result', ...r });
    broadcast({ type: 'accounts', ...listAccounts() });
  },

  auth_code(_ws, msg) {
    const proc = loginProcess();
    if (proc && proc.stdin) proc.stdin.write(msg.code + '\n');
  },

  prompt(ws, msg) {
    if (Array.isArray(msg.keepIds) && msg.keepIds.length) {   // my35: Send takes everything waiting in the tray
      msg.attachments = [...keep.take(msg.keepIds.map(String)), ...(Array.isArray(msg.attachments) ? msg.attachments : [])];
      broadcast({ type: 'keep', list: keep.list() });
    }
    delete msg.keepIds;
    if (Array.isArray(msg.attachments) && msg.attachments.length) {
      msg.text = describeAttachments(msg.text, saveAttachments(msg.attachments));
    }
    delete msg.attachments;   // do not carry the base64 payload any further
    if (!canStartRun()) { send(ws, { type: 'chat_limit', max: MAX_RUNNING, text: `${MAX_RUNNING} chats are already working. Wait for one to finish, or stop one, then send this again.` }); return; }
    runQuery(ws, msg);
  },

  abort() {
    abortActive();
  },

  new_session(ws, msg) {
    // my77: Open a 2nd / 3rd chat, or a grey chat on a free account, from the New chat list (up to three chats).
    if (msg.mode === 'extra' || msg.mode === 'extra_free') {
      if (chatList().length >= MAX_RUNNING) { send(ws, { type: 'chat_limit', max: MAX_RUNNING, text: `You already have ${MAX_RUNNING} chats open. A finished one folds away 30 minutes after it ends, or start a New chat here instead.` }); return; }
      if (msg.mode === 'extra_free' && [...chats.values()].some((c) => c.free)) { send(ws, { type: 'chat_limit', max: MAX_RUNNING, text: 'A grey free-account chat is already open.' }); return; }
      const slot = makeSlot();
      slot.opened = true;
      if (msg.mode === 'extra_free') { slot.free = true; slot.colour = pickColour(slot); }
      ws.chat = slot.id; view.last = slot.id;
      send(ws, { type: 'chat_opened', id: slot.id });
      broadcastChats();
      send(ws, { type: 'history', chat: slot.id, merge: true, items: [], running: false, background: false });
      return;
    }
    // my58 (user 2026-11-09, option B): if this chat is working, ask each time whether to start another alongside or stop it.
    if (runtime.activeQuery && msg.mode !== 'stop' && msg.mode !== 'alongside') { send(ws, { type: 'new_chat_ask' }); return; }
    if (runtime.activeQuery && msg.mode === 'alongside') {
      if (runningChats().length >= MAX_RUNNING) { send(ws, { type: 'chat_limit', max: MAX_RUNNING, text: `${MAX_RUNNING} chats are already working, so I cannot start another alongside. Stop one or wait for one to finish.` }); return; }
      const slot = makeSlot();
      slot.opened = true;   // my77
      ws.chat = slot.id; view.last = slot.id;
      send(ws, { type: 'chat_opened', id: slot.id });
      send(ws, { type: 'cleared', chat: slot.id });
      send(ws, { type: 'history', chat: slot.id, items: [], running: false, background: false });
      broadcastChats();
      return;
    }
    const old = runtime.activeSessionId;
    if (getAdvisor().advised) { broadcast({ type: 'prefs', ...setPrefs({ model: 'latest-sonnet', effort: 'medium' }) }); broadcast({ type: 'advisor', ...setAdvisor({ advised: false }) }); }   // my42: a new chat starts on Sonnet/Medium
    abortActive();
    startFresh();
    { const sl = chats.get(ws.chat); if (sl) { sl.asks = false; sl.cost = 0; sl.costLast = {}; sl.finishedAt = 0; } }   // my77: a fresh start in the same chat
    if (msg.save) handover.saveInBackground(old);   // my28: the old chat's notes, behind the scenes
    broadcastChats();
  },

  // my77: the colour buttons - which chat the next message goes to, without reloading the screen.
  chat_target(ws, msg) {
    const slot = chats.get(String(msg.id || ''));
    if (!slot) return;
    ws.chat = slot.id; view.last = slot.id;
    if (slot.finishedUnseen) { slot.finishedUnseen = false; broadcastChats(); }
  },

  // my78: close a finished chat from the x on its tab. Like a folded chat it stays in Sessions. Never the last chat, never one still working.
  close_chat(ws, msg) {
    const slot = chats.get(String(msg.id || ''));
    if (!slot || chats.size <= 1) return;
    if (slot.query) { send(ws, { type: 'chat_limit', text: 'That chat is still working. Wait until it has finished, or stop it first.' }); return; }
    chats.delete(slot.id);
    const next = [...chats.values()][0];
    for (const c of connections) if (c.chat === slot.id) c.chat = next.id;
    if (view.last === slot.id) view.last = next.id;
    log('INFO', `my78: chat ${slot.id} closed from its tab`);
    broadcastChats();
  },

  // my77: the other chats' messages for the all-in-one view (each shown in its own colour box).
  chat_histories(ws, msg) {
    const want = Array.isArray(msg.ids) ? msg.ids.map(String) : null;
    for (const slot of [...chats.values()]) {
      if (want && !want.includes(slot.id)) continue;
      inChat(slot, () => {
        send(ws, { type: 'history', chat: slot.id, merge: true, items: slot.sessionId ? parseSession(slot.sessionId) : [], running: !!slot.query, background: slot.bgTasks.size > 0 });
        if (slot.id === ws.chat) return;   // the chat being sent to already had its questions replayed
        for (const [id, d] of pendingDialogs) if (d.chat === slot.id) send(ws, { type: 'user_dialog', id, dialogKind: 'askUserQuestion', payload: d.payload, chat: d.chat });
        for (const [, e] of pendingPermissions) if (e.chat === slot.id) send(ws, { ...e.req, chat: slot.id });
      });
    }
  },

  // my77: what the New chat list may offer right now (lines that cannot be used are greyed out).
  new_chat_menu(ws) {
    freeChatReadyAsync((r) => send(ws, { type: 'new_chat_menu', freeOk: !!r.ok, freeWhy: r.ok ? '' : r.why,
      hasFree: [...chats.values()].some((c) => c.free), count: chatList().length, working: runningChats().length, max: MAX_RUNNING }));
  },

  // my58: look at another chat
  chat_view(ws, msg) {
    const slot = chats.get(String(msg.id || ''));
    if (!slot) return;
    ws.chat = slot.id; view.last = slot.id; slot.finishedUnseen = false;
    inChat(slot, () => {
      send(ws, { type: 'history', chat: slot.id, ...withPos(slot.sessionId), ...(() => { const items = parseSession(slot.sessionId); return { items, ...sums(items) }; })(), running: !!slot.query, background: slot.bgTasks.size > 0 });
      send(ws, { type: 'session', chat: slot.id, id: slot.sessionId });
      for (const [id, d] of pendingDialogs) if (d.chat === slot.id) send(ws, { type: 'user_dialog', id, dialogKind: 'askUserQuestion', payload: d.payload, chat: d.chat });
      for (const [, e] of pendingPermissions) if (e.chat === slot.id) send(ws, { ...e.req, chat: slot.id });
    });
    broadcastChats();
  },

  // my28: quick jobs and replies, Waiting for you, search, Continue this job
  whatsnew_seen(_ws) { whatsNewSeen(); },   // my74
  rule_broken(_ws, msg) { ruleBroken(msg.text); },   // my74
  away_set(_ws, msg) { setAway(!!msg.on); },   // my96
  messages_get(ws) { send(ws, { type: 'messages_list', list: getMessages() }); },   // my93 H2
  quick_save(_ws, msg) { broadcast({ type: 'quick', ...handover.saveQuick(msg) }); },
  keep_add(ws, msg) {   // my35
    const r = keep.add(msg);
    if (r.error) send(ws, { type: 'keep_error', cid: msg.cid, text: r.error });
    else broadcast({ type: 'keep', list: keep.list() });
  },
  keep_remove(_ws, msg) { keep.remove(String(msg.id || '')); broadcast({ type: 'keep', list: keep.list() }); },
  advisor_set(_ws, msg) { broadcast({ type: 'advisor', ...setAdvisor({ enabled: typeof msg.enabled === 'boolean' ? msg.enabled : undefined, advised: typeof msg.advised === 'boolean' ? msg.advised : undefined, declineKind: msg.declineKind, clearDeclined: msg.clearDeclined === true }) }); },   // my42
  overnight_add(_ws, msg) { addOvernight(msg.text, msg.permissionMode); },   // my48
  quiet_clear(_ws) { clearHeld(); },   // my49
  overnight_clear(_ws) { clearOvernightDone(); },   // my48
  overnight_remove(_ws, msg) { removeOvernight(String(msg.id || '')); },   // my48
  async screen_shot(ws, msg) { send(ws, { type: 'screen_shot', device: String(msg.device || ''), ...(await takeScreenshot(String(msg.device || ''))) }); },   // my47
  reminder_remove(_ws, msg) { broadcast({ type: 'reminders', list: removeReminder(String(msg.id || '')) }); },   // my45
  prefs_set(_ws, msg) { broadcast({ type: 'prefs', ...setPrefs(msg) }); },   // my41
  star_add(_ws, msg) { broadcast({ type: 'stars', list: extras.addStar(msg, runtime.activeSessionId) }); },   // my40
  star_remove(_ws, msg) { broadcast({ type: 'stars', list: extras.removeStar(msg.id) }); },
  ideas_get(ws) { send(ws, { type: 'ideas', ...ideasList() }); },   // my59
  ideas_op(_ws, msg) { broadcast({ type: 'ideas', ...ideasOp(msg) }); },
  async refresh_screens(ws) { send(ws, { type: 'refresh_result', ...(await extras.refreshScreens()) }); },
  async quota_get(ws, msg) { send(ws, { type: 'quota', ...(await extras.getQuota(!!msg.force)) }); },
  app_latest_get(ws) { send(ws, { type: 'app_latest', latest: extras.appLatest() }); },
  scrollpos_set(_ws, msg) { scrollmem.setPos(msg); },   // my73
  timed_cancel(_ws, msg) { cancelTimed(String(msg.id || '')); },   // my79 H17
  draft(_ws, msg) { setDraft(msg); },   // my79 H9
  waiting_get(ws) { send(ws, { type: 'waiting', list: handover.getWaiting() }); },
  waiting_done(_ws, msg) {
    handover.waitingDone(String(msg.id || ''));
    broadcast({ type: 'waiting', list: handover.getWaiting() });
    checksAfterTick();   // my79 H10: the Checks for today card drops that line
  },
  sessions_search(ws, msg) {
    searchSessions(msg.q).then((results) => send(ws, { type: 'search_results', seq: msg.seq, results }))
      .catch((e) => { log('ERROR', `search failed: ${e?.message || e}`); send(ws, { type: 'search_results', seq: msg.seq, results: [] }); });
  },
  handover(ws) { handover.continueJob(ws, startFresh); },

  sessions_list(ws) {
    send(ws, { type: 'sessions', sessions: listSessions(), activeId: runtime.activeSessionId });
  },

  session_switch(_ws, msg) {
    abortActive();
    autoContinue.cancel('session-switch');
    autoContinue.clearLimitOffer('session-switch');
    runtime.activeSessionId = msg.id || null;
    saveActive();
    broadcast({ type: 'history', ...withPos(runtime.activeSessionId), ...(() => { const items = parseSession(runtime.activeSessionId); return { items, ...sums(items) }; })(), running: false });
    broadcastSessions();
  },

  session_delete(_ws, msg) {
    deleteSession(msg.id);
    if (msg.id === runtime.activeSessionId) {
      runtime.activeSessionId = null;
      saveActive();
      broadcast({ type: 'cleared' });
    }
    broadcastSessions();
  },

  permission_response(_ws, msg) {
    // 'allow' | 'always' | 'deny' — 'always' also persists the SDK's suggested
    // rule so this tool stops prompting. Answerable from any tab — the prompt
    // is not tied to the one that raised it (see permissions.js).
    resolvePermission(msg.id, msg.decision);
  },

  user_dialog_response(_ws, msg) {
    // An answer to an AskUserQuestion. `result` absent means Skip — Claude is
    // told nobody answered and carries on. (Closing the card to read the chat
    // first sends nothing at all: the question stays pending, and the strip above
    // the composer is the way back to it.)
    answerDialog(msg.id, msg.result);
  },

  set_perm_mode(_ws, msg) {
    // Takes effect immediately for ask/acceptEdits/bypass, which route through
    // canUseTool. A run started in 'auto' keeps the SDK classifier for its
    // duration.
    runtime.activePermMode = msg.mode;
    resolvePromptsAllowedBy(msg.mode);
  },

  set_auto_continue(_ws, msg) {
    autoContinue.setEnabled(msg.enabled);
  },

  cancel_auto_continue() {
    autoContinue.cancel('user');
  },

  // Whether this tab is on screen right now. The push is suppressed while any
  // tab is — a dropped or hidden socket is exactly the phone-in-pocket case.
  presence(ws, msg) {
    ws.visible = !!msg.visible;
  },

  // haAi (my23): device pairing. ONLY from the ingress port (inside Home Assistant); never from a paired device.
  pair_start(ws) {
    if (ws.direct) return;
    send(ws, { type: 'pair_code', ...deviceAuth.startPairing() });
  },
  devices_list(ws) {
    if (ws.direct) return;
    send(ws, { type: 'devices', list: deviceAuth.listDevices() });
  },
  device_remove(ws, msg) {
    if (ws.direct) return;
    deviceAuth.removeDevice(String(msg.id || ''));
    send(ws, { type: 'devices', list: deviceAuth.listDevices() });
  },

  set_notify(_ws, msg) {
    notifier.setSettings(msg);
    broadcast({ type: 'notify_state', ...notifier.notifySettings });
  },

  // my88: the page's heartbeat (every 30 s while on screen). The answer proves the link still works both ways.
  ping(ws, msg) { send(ws, { type: 'pong', t: msg.t || 0 }); },

  // my88: the page could not use a delta (it no longer had the start), so it asks for the whole chat once.
  history_full(ws) {
    send(ws, { ...historyFor(ws, runtime.activeSessionId), running: !!runtime.activeQuery, background: runtime.backgroundTasks.size > 0 });
  },

  async test_notify(ws) {
    send(ws, { type: 'notify_test', ...(await notifier.sendTest()) });
  },
};

export function attach(wss) {
  // my88: heartbeat. Every 30 s each link is pinged; one that has not answered (or sent anything) for 3 rounds
  // is a dead phone link and is closed, so the server stops sending to it.
  setInterval(() => {
    for (const ws of connections) {
      if ((ws.misses || 0) >= 3) { try { ws.terminate(); } catch { /* gone */ } connections.delete(ws); continue; }
      ws.misses = (ws.misses || 0) + 1;
      try { ws.ping(); } catch { /* closed */ }
    }
  }, 30000).unref?.();
  wss.on('connection', (ws, req) => {
    connections.add(ws);
    // my88: what an open page already has (see historyFor)
    try {
      const q = new URL(req?.url || '/', 'http://x').searchParams;
      const n = Number(q.get('n'));
      if (q.get('sid') && Number.isInteger(n) && n > 0) ws.have = { sid: q.get('sid'), n, h: String(q.get('h') || '') };
    } catch { ws.have = null; }
    ws.misses = 0;
    ws.on('pong', () => { ws.misses = 0; });

    greet(ws);

    ws.on('message', (raw) => {
      ws.misses = 0;   // my88
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      const handler = handlers[msg.type];
      if (!handler) return;
      try {
        const slot = chats.get(ws.chat);
        if (slot) inChat(slot, () => handler(ws, msg)); else handler(ws, msg);   // my58: run for the chat this browser is looking at
      } catch (e) {
        log('ERROR', `handling ${msg.type} failed: ${e?.message || e}`);
      }
    });

    ws.on('close', () => {
      connections.delete(ws);
      // The active query is deliberately NOT aborted: it keeps running and
      // persisting, so the chat is complete when the user navigates back.
      // Pending permission prompts and questions are NOT cleared here either —
      // neither is tied to a connection. A phone backgrounding its browser
      // drops the socket routinely, and auto-denying (or auto-answering) on
      // that used to read as the request silently vanishing while the user was
      // away. Both belong to the run, not the socket that happened to be open
      // when they were raised: any tab may still answer, including one that
      // connects later (see greet()'s replay, and dialogs.js / permissions.js).
      // The run itself owns the wait via the tool call's own abort signal, so
      // Stop, a new prompt, or a session switch already end it correctly.
    });
  });
}
