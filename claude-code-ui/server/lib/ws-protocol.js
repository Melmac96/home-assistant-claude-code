/*
 * The WebSocket protocol: what a connecting browser is told, and what it may
 * ask for.
 *
 * The inbound half is a dispatch table rather than a chain of `else if`s, so the
 * set of messages the client may send is a list you can read.
 */
import { readFileSync } from 'fs';
import { DEFAULT_PERMISSION_MODE } from './config.js';
import { log } from './log.js';
import { runtime } from './state.js';
import { connections, send, broadcast } from './broadcast.js';
import {
  isAuthenticated, isSubscriptionAuth, startLoginFlow, loginUrl, loginProcess, stopLoginProc,
} from './auth.js';
import { listSessions, parseSession, deleteSession, saveActive, searchSessions } from './sessions.js';
import * as handover from './handover.js';   // my28
import { pendingDialogs, answerDialog } from './dialogs.js';
import { pendingPermissions, resolvePermission, resolvePromptsAllowedBy } from './permissions.js';
import { saveAttachments, describeAttachments } from './uploads.js';
import { runQuery, abortActive } from './run-query.js';
import { saveCurrent, listAccounts, switchTo, setMode, setFreeModel, providerStats, useProvider } from './accounts.js';
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

startSelfUpdateCheck();
startHomeHealthCheck();
startReminders();   // my45
startBrief();   // my46

/** Everything a newly connected (or reconnected) tab needs to render the app. */
function greet(ws) {
  send(ws, { type: 'connected' });
  send(ws, {
    type: 'config',
    defaultPermMode: DEFAULT_PERMISSION_MODE,
    autoContinue: autoContinue.autoContinue.enabled,
    autoContinueSupported: isSubscriptionAuth(),
  });
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
    type: 'history',
    items: parseSession(runtime.activeSessionId),
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
    send(ws, { type: 'user_dialog', id, dialogKind: 'askUserQuestion', payload: d.payload });
  }

  // Likewise a permission prompt: it belongs to the run, not to whichever tab
  // was open when it was asked (see permissions.js's pendingPermissions).
  for (const [, entry] of pendingPermissions) send(ws, entry.req);
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
    if (runtime.activeQuery) {
      send(ws, { type: 'account_result', ok: false, error: 'Claude is busy. Wait for the reply to finish, then switch.' });
      return;
    }
    const r = switchTo(msg.id);
    send(ws, { type: 'account_result', ...r });
    broadcast({ type: 'accounts', ...listAccounts() });
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
    if (runtime.activeQuery) {
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
    runQuery(ws, msg);
  },

  abort() {
    abortActive();
  },

  new_session(_ws, msg) {
    const old = runtime.activeSessionId;
    if (getAdvisor().advised) { broadcast({ type: 'prefs', ...setPrefs({ model: 'latest-sonnet', effort: 'medium' }) }); broadcast({ type: 'advisor', ...setAdvisor({ advised: false }) }); }   // my42: a new chat starts on Sonnet/Medium
    abortActive();
    startFresh();
    if (msg.save) handover.saveInBackground(old);   // my28: the old chat's notes, behind the scenes
  },

  // my28: quick jobs and replies, Waiting for you, search, Continue this job
  quick_save(_ws, msg) { broadcast({ type: 'quick', ...handover.saveQuick(msg) }); },
  keep_add(ws, msg) {   // my35
    const r = keep.add(msg);
    if (r.error) send(ws, { type: 'keep_error', cid: msg.cid, text: r.error });
    else broadcast({ type: 'keep', list: keep.list() });
  },
  keep_remove(_ws, msg) { keep.remove(String(msg.id || '')); broadcast({ type: 'keep', list: keep.list() }); },
  advisor_set(_ws, msg) { broadcast({ type: 'advisor', ...setAdvisor({ enabled: typeof msg.enabled === 'boolean' ? msg.enabled : undefined, advised: typeof msg.advised === 'boolean' ? msg.advised : undefined, declineKind: msg.declineKind, clearDeclined: msg.clearDeclined === true }) }); },   // my42
  reminder_remove(_ws, msg) { broadcast({ type: 'reminders', list: removeReminder(String(msg.id || '')) }); },   // my45
  prefs_set(_ws, msg) { broadcast({ type: 'prefs', ...setPrefs(msg) }); },   // my41
  star_add(_ws, msg) { broadcast({ type: 'stars', list: extras.addStar(msg, runtime.activeSessionId) }); },   // my40
  star_remove(_ws, msg) { broadcast({ type: 'stars', list: extras.removeStar(msg.id) }); },
  async refresh_screens(ws) { send(ws, { type: 'refresh_result', ...(await extras.refreshScreens()) }); },
  async quota_get(ws, msg) { send(ws, { type: 'quota', ...(await extras.getQuota(!!msg.force)) }); },
  app_latest_get(ws) { send(ws, { type: 'app_latest', latest: extras.appLatest() }); },
  waiting_get(ws) { send(ws, { type: 'waiting', list: handover.getWaiting() }); },
  waiting_done(_ws, msg) {
    handover.waitingDone(String(msg.id || ''));
    broadcast({ type: 'waiting', list: handover.getWaiting() });
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
    broadcast({ type: 'history', items: parseSession(runtime.activeSessionId), running: false });
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

  async test_notify(ws) {
    send(ws, { type: 'notify_test', ...(await notifier.sendTest()) });
  },
};

export function attach(wss) {
  wss.on('connection', (ws) => {
    connections.add(ws);

    greet(ws);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      const handler = handlers[msg.type];
      if (!handler) return;
      try {
        handler(ws, msg);
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
