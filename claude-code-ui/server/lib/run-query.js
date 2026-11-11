/*
 * One turn: build the SDK options, run the query, and map its events onto the
 * wire protocol the browser speaks.
 *
 * The run is owned by the app, not by the socket that started it. Its
 * AbortController is module-level, so navigating away mid-response does not
 * cancel it, and every event is broadcast rather than replied to.
 *
 * The prompt is a streamed AsyncIterable (`input-channel.js`), not a plain
 * string — confirmed live: a string prompt makes the SDK close the CLI's
 * stdin as soon as the turn's own `result` arrives, and once stdin is closed
 * the CLI can no longer send ANY control request back to this host (a
 * PreToolUse hook callback, a canUseTool ask). Every one is then denied
 * locally inside the CLI with its canned "The user doesn't want to take this
 * action right now" text — including a background subagent trying to deliver
 * its report through SubagentHandback, which is exactly the failure this
 * fixes. Keeping the channel open until every background task this run
 * spawned has actually finished defers that close until it is genuinely safe.
 */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { appendFileSync, readFileSync, statSync, writeFileSync } from 'fs';
import {
  WORK_DIR, PLUGINS, EFFORT_LEVELS, DEFAULT_PERMISSION_MODE, STALL_WARN_MS, STALL_CHECK_MS,
} from './config.js';
import { log, vlog } from './log.js';
import { runtime } from './state.js';
import { connections, send, broadcast } from './broadcast.js';
import { isAuthError, isSubscriptionAuth } from './auth.js';
import { freeModelOverride, pickChatAccount, syncChatAccount, prepareFreeDir, freeServiceText } from './accounts.js';
import { slotNow, inChat, runningChats, hooks as chatHooks, MAX_RUNNING, chats, CLASH_MS } from './chats.js';   // my58, my77
import { listSessions, saveActive, isQuestionAnswer, parseTaskNotification, truncateOutput, isNoResponsePlaceholder } from './sessions.js';
import { hooksFor, makeCanUseTool } from './permissions.js';
import { askQuestion } from './dialogs.js';
import { refreshHaLinks } from './ha-links.js';
import { MCP_FREE_SETTINGS } from './mcp.js';
import { usableSlashCommands } from './slash-commands.js';
import { makeInputChannel } from './input-channel.js';
import { notify } from './notify.js';
import * as autoContinue from './auto-continue.js';
import { noteUsage } from './extras.js';   // my40
import { advisorPrompt, jobsPrompt } from './advisor.js';   // my42
import { batch1Prompt } from './batch1.js';   // my45
import { batch2Prompt } from './batch2.js';   // my46
import { my74Prompt, noteDoneText, noteJobUsage, finishTurn } from './my74.js';   // my74
import { my79Prompt } from './my79.js';   // my79

// STALL_WARN_MS / STALL_CHECK_MS (config.js): how long the SDK may go quiet
// before the log says so, and how often it checks — only while a turn is
// actively in flight. A run waiting on a background task is expected to be
// quiet for a long time, so the watchdog is exempt in that phase (see
// runPhase below) and instead logs an occasional heartbeat.
const BACKGROUND_HEARTBEAT_TICKS = Math.max(1, Math.round(300000 / STALL_CHECK_MS)); // ~5 min

/** my58: tell the user when two chats working at the same time change the same file or the same device. */
function noteTouch(slot, tool, input) {
  try {
    const keys = [];
    if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool) && input?.file_path) keys.push(String(input.file_path));
    if (tool === 'Bash' && typeof input?.command === 'string') {
      for (const m of input.command.matchAll(/"entity_id"\s*:\s*"([a-z_]+\.[a-z0-9_]+)"/g)) keys.push(m[1]);
    }
    const now = Date.now();
    for (const [k, t] of slot.touched) if (now - t > CLASH_MS) slot.touched.delete(k);   // my77: keep the last 10 minutes, across turns
    for (const k of keys) {
      // my77: files are stopped and asked about BEFORE they change (permissions.js clash guard); devices still get the warning.
      if (!k.startsWith('/')) for (const other of chats.values()) {
        if (other === slot) continue;
        const t = other.touched.get(k);
        if (t && now - t < CLASH_MS) {
          broadcast({ type: 'chat_overlap', what: k, with: other.id, chat: slot.id });
          log('WARN', `my58: chats ${slot.id} and ${other.id} both change ${k}`);
        }
      }
      slot.touched.set(k, now);
    }
  } catch { /* a warning must never stop a run */ }
}

/** my77: what this chat has used so far, in % of the 5 hours of its own account (shown on its tab). */
function addChatCost(slot, email, unified) {
  const w = unified && unified.five_hour;
  if (!w || w.utilization == null) return;
  const used = w.utilization <= 1 ? w.utilization * 100 : Number(w.utilization);
  const key = String(email || 'main');
  let last = slot.costLast[key];
  if (!last) {   // first figure on this account: start from the last one seen for it, so the first message counts too
    try {
      const q = JSON.parse(readFileSync('/data/haai-quota.json', 'utf8'))[key.toLowerCase()]?.five_hour;
      if (q && q.used != null) last = { used: q.used, resetsAt: q.resetsAt || null };
    } catch { /* no figures yet */ }
  }
  if (last && last.resetsAt === (w.resetsAt || null)) slot.cost += Math.max(0, used - last.used);
  else if (last && last.resetsAt && Date.now() / 1000 >= last.resetsAt) slot.cost += used;
  slot.costLast[key] = { used, resetsAt: w.resetsAt || null };
}

/** my58: refuse a third chat working at the same time. Returns true when a new run may start. */
export function canStartRun() {
  const slot = slotNow();
  return slot.query != null || runningChats().length < MAX_RUNNING;
}

export function abortActive() {
  if (runtime.activeQuery) { runtime.activeQuery.abort(); runtime.activeQuery = null; }
  // Clear this eagerly too (not just in the run's own `finally`), so a prompt
  // arriving in the gap between abort() and that cleanup cannot be pushed into
  // a channel whose run is already being torn down.
  if (runtime.activeRun) { runtime.activeRun.channel.close(); runtime.activeRun = null; }
  if (runtime.backgroundTasks.size) {
    runtime.backgroundTasks = new Map();
    broadcast({ type: 'background_tasks', tasks: [] });
  }
}

export async function runQuery(ws, { text, permissionMode, model, effort, add, autoAttempts = 0 }) {
  // my26: the Add button. A message sent WHILE a turn is running goes into that same
  // running chat instead of stopping it (the old way aborted the turn). If the run has
  // just ended (channel closed), it falls through and is sent as a normal new message.
  if (autoAttempts === 0 && add && runtime.activeRun?.phase === 'turn' && runtime.activeRun.channel.push(text)) {
    runtime.activeRun.pendingAdds = (runtime.activeRun.pendingAdds || 0) + 1;
    slotNow().asks = false;   // my77
    for (const c of connections) if (c !== ws) send(c, { type: 'user', text, chat: slotNow().id });
    log('INFO', `my26: message added into the running turn (no stop): promptLen=${text.length}`);
    return;
  }

  // The previous turn already reported its `result`, but a background task it
  // spawned (a subagent, a backgrounded shell command) is still running. Push
  // the new message into that SAME still-open run instead of aborting it below
  // — aborting would kill the background work, which is the bug this exists to
  // avoid. (autoAttempts !== 0 is a headless auto-continue resume, which always
  // starts its own run.)
  if (autoAttempts === 0 && runtime.activeRun?.phase === 'background') {
    for (const c of connections) if (c !== ws) send(c, { type: 'user', text, chat: slotNow().id });
    runtime.activeRun.channel.push(text);
    slotNow().asks = false;   // my77
    log('INFO', `prompt queued into backgrounded run (waiting on ${runtime.backgroundTasks.size} task(s)): promptLen=${text.length}`);
    const fm0 = freeModelOverride(); if (fm0) model = fm0;   // my17
    if (model && model !== runtime.activeRun.model) {
      runtime.activeRun.model = model;
      runtime.activeRun.q.setModel(model).catch((e) => log('WARN', `setModel on backgrounded run failed: ${e?.message || e}`));
    }
    // Mode changes for ask/acceptEdits/bypass/plan are already picked up live by
    // makeCanUseTool reading runtime.activePermMode at call time; a run that
    // started in 'auto' can't be live-switched regardless of this path.
    if (permissionMode) runtime.activePermMode = permissionMode;
    return;
  }

  abortActive();

  // A run that is not itself the auto-continue firing supersedes any scheduled
  // resume — the user has taken over. (fire() clears `pending` before calling in
  // here, so this is a no-op for that path.)
  if (autoAttempts === 0) {
    if (autoContinue.autoContinue.pending) autoContinue.cancel('superseded-by-prompt');
    autoContinue.clearLimitOffer('superseded-by-prompt');
  }

  const abortController = new AbortController();
  runtime.activeQuery = abortController;
  const startedAt = Date.now();

  // Set if a 5-hour usage-limit rejection stops this run. Trusted over anything
  // that follows it — see the note by the 'result' handler.
  let limitHit = null;
  // tool_use id → tool name for this run: a tool_result carries only the id, and
  // an answered question has to be told apart from a real failure.
  const liveToolNames = new Map();

  // Show the user's message on other clients (the sender rendered it locally,
  // and the SDK persists it to the session store, so nothing is recorded here).
  for (const c of connections) if (c !== ws) send(c, { type: 'user', text, chat: slotNow().id });

  // The CLI only sends `session_state_changed` (idle / running / requires_action)
  // when asked — it is the SDK's own "the turn is over" signal, which is what the
  // reply notification keys off rather than a guess from `result`.
  // my58: this chat's own slot, and which sign-in it runs on (a second chat running at the same time uses the other Pro account).
  const slot = slotNow();
  // my77: a grey free-account chat runs on the free provider in its own settings folder; every other chat keeps
  // its own Claude account, and one opened alongside others takes the account with the most allowance left.
  let acct;
  if (slot.free) {
    try { acct = prepareFreeDir(); }
    catch (e) {
      log('WARN', `my77: free chat ${slot.id} could not start: ${e?.message || e}`);
      if (runtime.activeQuery === abortController) runtime.activeQuery = null;
      broadcast({ type: 'error', message: `The free account could not start: ${e?.message || e}. Nothing was sent. Use one of your Claude chats instead, or try again later.` });
      chatHooks.changed();
      return;
    }
  } else {
    const others = runningChats().filter((x) => x !== slot && x.account && !x.free);
    const alone = ![...chats.values()].some((x) => x !== slot && !x.free && (x.query || x.sessionId || x.opened));
    acct = pickChatAccount(others.map((x) => x.account), slot, alone);
  }
  slot.account = acct.email;
  if (acct.free) slot.service = freeServiceText(acct.provider, acct.model);   // my78: named in its typing box
  slot.finishedUnseen = false;
  slot.asks = false;   // my77: he has answered
  slot.turnText = '';
  const opts = {
    cwd: WORK_DIR, abortController, plugins: PLUGINS, settings: MCP_FREE_SETTINGS,
    env: { ...process.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1', ...(acct.dir ? { CLAUDE_CONFIG_DIR: acct.dir } : {}),
      ...(acct.free ? { HAAI_FREE_CHAT: '1' } : {}) },
  };
  log('INFO', `my58: chat ${slot.id} runs on ${acct.free ? `the free account (${acct.provider})` : (acct.email || 'the main sign-in')}${acct.dir ? ' (own settings folder)' : ''}`);
  const fm = acct.free ? (acct.model || null) : freeModelOverride();   // my17: in Free mode the chosen free model wins over the dropdown; my77: a free chat uses its own
  if (fm) opts.model = fm;
  else if (model) opts.model = model;
  // Only override effort when the UI asked for a level; otherwise the SDK's own
  // model default applies.
  if (effort && EFFORT_LEVELS.has(effort)) opts.effort = effort;

  const advice = [advisorPrompt(model, effort), jobsPrompt(), batch1Prompt(), batch2Prompt(), my74Prompt(), my79Prompt()].filter(Boolean).join(' ');   // my42 + my44 + my45
  if (advice) opts.systemPrompt = { type: 'preset', preset: 'claude_code', append: advice };

  runtime.activePermMode = permissionMode || DEFAULT_PERMISSION_MODE;

  const hooks = hooksFor(runtime.activePermMode, slot);
  if (hooks) opts.hooks = hooks;

  if (runtime.activePermMode === 'auto') {
    // A model classifier approves or denies each tool — no prompts, no canUseTool.
    opts.permissionMode = 'auto';
  } else {
    // 'plan' is SDK-native (read-only, produces a plan) but still routes through
    // canUseTool so the ExitPlanMode approval surfaces as a normal prompt.
    if (runtime.activePermMode === 'plan') opts.permissionMode = 'plan';
    opts.canUseTool = makeCanUseTool(slot);
  }

  // AskUserQuestion is intercepted before it runs (canUseTool, or the PreToolUse
  // hook in `auto` mode), so the tool never executes and the CLI's canned "the
  // user did not answer" cannot happen. `onUserDialog` is still registered — it
  // is the documented contract and costs nothing — in case a future SDK build
  // starts using it; it feeds the same pending-dialog map, so the browser side is
  // identical either way. (It does nothing on its own: the CLI fails closed on
  // any dialog_kind not also in supportedDialogKinds, and the tool needs its
  // toolConfig entry.)
  opts.supportedDialogKinds = ['askUserQuestion'];
  opts.toolConfig = { askUserQuestion: { previewFormat: 'html' } };
  opts.onUserDialog = (request, { signal }) => {
    log('INFO', `onUserDialog: ${request.dialogKind}`);
    return inChat(slot, () => askQuestion(request.payload || {}, signal))
      .then((answer) => (answer ? { behavior: 'completed', result: answer } : { behavior: 'cancelled' }));
  };

  const resuming = !!runtime.activeSessionId;
  if (resuming) opts.resume = runtime.activeSessionId;

  /** Cache-inclusive context usage, pushed to every client after each result. */
  const reportContextUsage = async (q) => {
    try {
      const u = await q.getContextUsage();
      const ctxMsg = {
        type: 'context_usage',
        totalTokens: u.totalTokens,
        maxTokens: u.maxTokens,
        autoCompactThreshold: u.autoCompactThreshold,
        autoCompactEnabled: u.isAutoCompactEnabled,
      };
      broadcast(ctxMsg);
      runtime.lastCtx = { ...ctxMsg, sid: runtime.activeSessionId };   // my40: chat length strip after a reload
      const limit = (u.isAutoCompactEnabled && u.autoCompactThreshold) || u.maxTokens;
      const pct = limit ? Math.round((u.totalTokens / limit) * 100) : 0;
      const detail = `context ${u.totalTokens}/${limit} tokens (${pct}%)` +
        ` maxTokens=${u.maxTokens} autoCompact=${u.isAutoCompactEnabled ? 'on' : 'off'}` +
        ` threshold=${u.autoCompactThreshold || 'n/a'}`;
      if (pct >= 90) log('WARN', `${detail} — near auto-compact; a turn may pause while it compacts`);
      else vlog(detail);
    } catch (e) { vlog(`getContextUsage failed: ${e?.message || e}`); }
  };

  // The SDK's own model catalog — account-filtered, the same list Claude Code's
  // /model picker is built from. Fire-and-forget: never awaited in the event
  // loop, so a slow or unimplemented control request cannot delay the stream,
  // and the catch means an older CLI simply leaves the static list in place.
  const reportModelCatalog = async (q) => {
    try {
      const rows = await q.supportedModels();
      const models = (rows || []).map(({ value, resolvedModel, displayName, description }) =>
        ({ value, resolvedModel, displayName, description }));
      if (!models.length) return;
      runtime.cachedModels = models;
      broadcast({ type: 'models', models });
      vlog(`models: ${models.length} offered`);
    } catch (e) { vlog(`supportedModels failed: ${e?.message || e}`); }
  };

  log('INFO', `query start: mode=${runtime.activePermMode} effort=${opts.effort || 'default'} ` +
    `model=${model || 'default'} resume=${resuming} promptLen=${text.length}`);

  // Streamed input — see the file header. Kept open until every background
  // task this run spawns has finished (maybeEndRun below), not just until the
  // foreground turn's own `result`.
  const channel = makeInputChannel(text);
  runtime.activeRun = { channel, q: null, phase: 'turn', model, effort, permissionMode: runtime.activePermMode };
  chatHooks.changed();   // my58

  // Background tasks spawned by this run (subagents, backgrounded shell
  // commands). `background_tasks_changed` is the authoritative membership
  // signal (REPLACE semantics); `task_progress` only enriches the entries
  // already there. Ambient tasks (housekeeping, not activity) are excluded.
  let resultSeen = false;
  // If this CLI never sends session_state_changed, the run's genuine end (the
  // `finally` below) stands in for it, so a reply is still announced.
  let sawStateEvents = false;
  let failed = false;
  let runPhase = 'turn';
  let backgroundHeartbeatTicks = 0;

  const syncBackgroundTasks = (tasks) => {
    const next = new Map();
    for (const t of (tasks || [])) {
      if (t.ambient) continue;
      const prev = runtime.backgroundTasks.get(t.task_id);
      next.set(t.task_id, {
        id: t.task_id, description: t.description, type: t.task_type,
        lastTool: prev?.lastTool, summary: prev?.summary,
      });
    }
    runtime.backgroundTasks = next;
    broadcast({ type: 'background_tasks', tasks: [...next.values()] });
    maybeEndRun();
  };

  const updateBackgroundTaskProgress = (event) => {
    const t = runtime.backgroundTasks.get(event.task_id);
    if (!t) return;
    if (event.last_tool_name !== undefined) t.lastTool = event.last_tool_name;
    if (event.summary !== undefined) t.summary = event.summary;
    broadcast({ type: 'background_tasks', tasks: [...runtime.backgroundTasks.values()] });
  };

  /** Once the foreground turn has reported `result` AND no background task is
   *  left running, the input channel can close — only then is this run
   *  genuinely over. */
  function maybeEndRun() {
    if (!resultSeen) return;
    if (runtime.backgroundTasks.size > 0) {
      if (runPhase !== 'background') {
        runPhase = 'background';
        if (runtime.activeRun) runtime.activeRun.phase = 'background';
        log('INFO', `turn finished; waiting on ${runtime.backgroundTasks.size} background task(s): ` +
          [...runtime.backgroundTasks.values()].map((t) => t.description).join(', '));
      }
      return;
    }
    if (runPhase === 'background') log('INFO', 'background task(s) finished; ending run');
    channel.close();
  }

  // Stall watchdog — the reported "chat hangs" symptom. If no SDK event arrives
  // for a while during an active TURN (long thinking, a slow tool, a retry, or
  // auto-compaction), log how long it has been quiet so the app log shows
  // whether it is truly stuck or just working. Exempt while waiting on a
  // background task: that silence is expected, not a stall.
  let lastEventAt = Date.now();
  let lastEventKind = 'start';
  const watchdog = setInterval(() => {
    if (abortController.signal.aborted) return;
    if (runPhase === 'background') {
      backgroundHeartbeatTicks += 1;
      if (backgroundHeartbeatTicks % BACKGROUND_HEARTBEAT_TICKS === 0) {
        vlog(`still waiting on ${runtime.backgroundTasks.size} background task(s)`);
      }
      return;
    }
    const idleS = Math.round((Date.now() - lastEventAt) / 1000);
    if (idleS * 1000 >= STALL_WARN_MS) {
      log('WARN', `query quiet for ${idleS}s (last event: ${lastEventKind}) — still awaiting the SDK`);
    }
  }, STALL_CHECK_MS);

  let q;
  try {
    q = query({ prompt: channel.iterable, options: opts });
    runtime.activeRun.q = q;
    for await (const event of q) {
      lastEventAt = Date.now();
      // my26: activity after a result means an added message is being answered
      // my27: only REAL work (a reply, a tool step, streamed text) counts. The CLI's own
      // system events after a result (e.g. session_state_changed idle) used to cancel
      // the 20 s timer, so the run never ended and the screen showed 'working' for ever.
      if (runtime.activeRun?.waitTimer && (event.type === 'assistant' || event.type === 'user' || event.type === 'stream_event')) {
        clearTimeout(runtime.activeRun.waitTimer); runtime.activeRun.waitTimer = null;
      }
      lastEventKind = event.type === 'system' ? `system/${event.subtype}` : event.type;

      if (event.type === 'system' && event.subtype === 'init') {
        runtime.activeSessionId = event.session_id;
        saveActive();
        broadcast({ type: 'session', id: event.session_id });
        if (event.model) broadcast({ type: 'model', model: event.model });
        // Terminal-only commands (/exit, /statusline …) are dropped here rather
        // than in the browser, so there is one place that knows this is a
        // remote UI — see slash-commands.js.
        const commands = usableSlashCommands(event);
        if (commands) {
          runtime.cachedSlashCommands = commands;
          broadcast({ type: 'slash_commands', commands });
          const hidden = event.slash_commands.length - commands.length;
          vlog(`slash commands: ${commands.length} offered${hidden ? `, ${hidden} terminal-only hidden` : ''}`);
        }
        vlog(`init: session=${event.session_id} model=${event.model}`);
        void reportModelCatalog(q);

      } else if (event.type === 'system' && event.subtype === 'compact_boundary') {
        const m = event.compact_metadata || {};
        log('INFO', `compaction (${m.trigger || 'manual'}): ${m.pre_tokens || '?'} → ${m.post_tokens || '?'} tokens`);
        broadcast({ type: 'compacted', trigger: m.trigger, preTokens: m.pre_tokens, postTokens: m.post_tokens });
        await reportContextUsage(q);

      } else if (event.type === 'system' && event.subtype === 'session_state_changed') {
        sawStateEvents = true;
        vlog(`session state: ${event.state}`);
        if (event.state === 'idle') {
          notify('reply', { title: 'Claude finished', message: 'Your reply is ready.' });
        }

      } else if (event.type === 'system' && event.subtype === 'background_tasks_changed') {
        syncBackgroundTasks(event.tasks);

      } else if (event.type === 'system' && event.subtype === 'task_progress') {
        updateBackgroundTaskProgress(event);

      } else if (event.type === 'system' && event.subtype === 'task_notification') {
        // A background task ending — the chat-visible "background agent
        // finished" chip (see sessions.js lineToItems for the stored-transcript
        // equivalent). Ambient/non-transcript tasks say nothing here either.
        if (!event.ambient && !event.skip_transcript) {
          broadcast({ type: 'task_notice', taskId: event.task_id, status: event.status, summary: event.summary });
        }

      } else if (event.type === 'assistant' && !isNoResponsePlaceholder(event)) {
        for (const block of (event.message?.content || [])) {
          if (block.type === 'text' && block.text) {
            vlog(`text: ${block.text.length} chars`);
            broadcast({ type: 'text', text: block.text });
            slot.turnText = (slot.turnText || '').slice(-4000) + block.text;   // my77: does this reply end on a question?
            noteDoneText(event.session_id || runtime.activeSessionId, block.text);   // my74
          } else if (block.type === 'tool_use') {
            vlog(`tool_use: ${block.name}`);
            liveToolNames.set(block.id, block.name);
            noteTouch(slot, block.name, block.input);   // my58
            broadcast({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
          }
        }

      } else if (event.type === 'user') {
        const content = event.message?.content;
        const originKind = event.origin?.kind;
        // A background task's own notification, or a delivered SubagentHandback
        // report, arriving live — never raw harness XML, never a user bubble.
        // Mirrors sessions.js's lineToItems for the exact same record read back
        // from the stored transcript after a reload.
        if (originKind === 'task-notification') {
          const notificationText = typeof content === 'string' ? content : '';
          const n = parseTaskNotification(notificationText) || {};
          broadcast({ type: 'task_notice', taskId: n.taskId || null,
            status: n.status || 'completed', summary: n.summary || 'Background task finished' });
        } else if (originKind === 'peer' && typeof event.origin.body === 'string') {
          broadcast({ type: 'agent_report', from: event.origin.name || event.origin.from || 'background agent',
            text: event.origin.body });
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type !== 'tool_result') continue;
            const raw = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((b) => b.text || '').join('')
                : JSON.stringify(block.content);
            vlog(`tool_result: ${raw.length} chars${block.is_error ? ' (error)' : ''}`);
            // An answered question comes back as an error and must not be
            // rendered as one — see isQuestionAnswer().
            const answered = isQuestionAnswer(liveToolNames.get(block.tool_use_id), !!block.is_error, raw);
            liveToolNames.delete(block.tool_use_id);
            broadcast({ type: 'tool_result', id: block.tool_use_id, output: truncateOutput(raw),
              isError: !!block.is_error && !answered, answered });
          }
        }

      } else if (event.type === 'rate_limit_event') {
        // Subscription usage-limit telemetry. A 'rejected' five_hour is the
        // auto-continue trigger; warnings are surfaced but ignored.
        const info = event.rate_limit_info || {};
        // My Claude Code UI: keep every raw usage update (timestamped) so we can see
        // exactly what the engine reports before designing a usage screen.
        try {
          const f = '/data/usage-events.jsonl';
          try { if (statSync(f).size > 200000) writeFileSync(f, ''); } catch {}
          appendFileSync(f, JSON.stringify({ at: new Date().toISOString(), event }) + '\n');
        } catch {}
        log('INFO', `usage update: ${JSON.stringify(info)}`);
        vlog(`rate_limit: status=${info.status} type=${info.rateLimitType} ` +
          `resetsAt=${info.resetsAt || 'n/a'} util=${info.utilization ?? 'n/a'}`);
        runtime.lastUsage = { status: info.status, rateLimitType: info.rateLimitType,
          resetsAt: info.resetsAt, utilization: info.utilization, unifiedWindows: info.unifiedWindows };
        broadcast({ type: 'rate_limit', ...runtime.lastUsage });
        try { if (!acct.free) addChatCost(slot, acct.email, info.unifiedWindows); } catch {}   // my77: cost so far on the chat's tab (before the store moves on)
        try { if (!acct.free) noteUsage(info.unifiedWindows, acct.email); } catch {}   // my40: Accounts quota, account in use; my77: this chat's own account
        try { noteJobUsage(event.session_id || runtime.activeSessionId, info.unifiedWindows); } catch {}   // my74: job cost
        if (info.status === 'rejected' && info.rateLimitType === 'five_hour' && info.resetsAt) {
          limitHit = { resetsAt: info.resetsAt, rateLimitType: info.rateLimitType };
          log('WARN', `usage limit reached (five_hour); resets at ${new Date(info.resetsAt * 1000).toISOString()}`);
        }

      } else if (event.type === 'result') {
        // my26: an added message may still be waiting for its own answer
        const arun = runtime.activeRun && runtime.activeRun.channel === channel ? runtime.activeRun : null;
        const more = !!(arun && arun.pendingAdds > 0);
        // Not trusted to mean the turn finished: a usage-limit rejection can be
        // followed by a 'result' claiming subtype:'success' (cost $0, 1 turn)
        // before the generator throws for real — confirmed live. `limitHit`, set
        // from the actual rate_limit_event, is what the `finally` block acts on.
        if (runtime.credentialsExpired) {
          runtime.credentialsExpired = false;
          broadcast({ type: 'auth_status', authenticated: true });
        }
        const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
        log('INFO', `result: ${event.subtype} in ${secs}s, ${event.num_turns} turns, ` +
          `$${(event.total_cost_usd || 0).toFixed(4)}`);
        broadcast({
          type: 'result',
          success: event.subtype === 'success',
          cost: event.total_cost_usd,
          turns: event.num_turns,
          inputTokens: event.usage?.input_tokens ?? 0,
          outputTokens: event.usage?.output_tokens ?? 0,
          cacheReadTokens: event.usage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: event.usage?.cache_creation_input_tokens ?? 0,
          background: runtime.backgroundTasks.size > 0,
          more,
        });
        try { finishTurn(event.session_id || runtime.activeSessionId); } catch {}   // my74: job cost onto its Finished box
        await reportContextUsage(q);
        if (more) {
          // Keep the run open for the added message. If the CLI already folded it into
          // the turn just finished, nothing more arrives: close after 20 s of quiet.
          arun.pendingAdds--;
          arun.waitTimer = setTimeout(() => {
            arun.waitTimer = null;
            if (runtime.activeRun !== arun) return;
            arun.pendingAdds = 0;
            resultSeen = true;
            broadcast({ type: 'run_idle' });
            maybeEndRun();
          }, 20000);
          continue;
        }
        // A single streamed query can legitimately emit more than one `result`
        // — confirmed live: once for the foreground turn, then another each
        // time a background task's completion hands control back for a short
        // follow-up turn. Only close the channel once nothing is left running.
        resultSeen = true;
        maybeEndRun();
      }
    }
  } catch (err) {
    if (!abortController.signal.aborted) {
      const message = String(err?.message || err);
      log('ERROR', `query failed after ${((Date.now() - startedAt) / 1000).toFixed(1)}s: ${message}`);
      // A usage-limit rejection throws from HERE rather than ending quietly —
      // confirmed live, with wrapped text like "Claude Code returned an error
      // result: You've hit your session limit · resets …". None of that is a
      // fresh failure, so this branch does nothing when `limitHit` is set: the
      // `finally` block covers it, with no stale-session drop and no raw error
      // bubble on top of the notice.
      if (!limitHit) {
        if (isAuthError(message)) {
          // The SESSION is fine — keep it so the conversation resumes after
          // re-login. Dropping it here made a later "continue" start a new,
          // empty session.
          runtime.credentialsExpired = true;
          log('WARN', 'query failed on authentication — prompting re-login');
          broadcast({ type: 'auth_expired', subscription: isSubscriptionAuth() });
        } else if (resuming) {
          // A genuinely stale resume id — drop it so the next prompt starts
          // fresh. (A limit-hit session is not stale, and must keep its id: it is
          // exactly what auto-continue resumes from.)
          runtime.activeSessionId = null;
          saveActive();
        }
        broadcast({ type: 'error', message });
        failed = true;
        notify('stopped', { title: 'Claude stopped', message: message.slice(0, 200) });
      }
    }
  } finally {
    clearInterval(watchdog);
    if (!acct.free) syncChatAccount(acct.dir);   // my58
    channel.close();   // idempotent — tidy up on an error/abort path too
    if (runtime.activeQuery === abortController) runtime.activeQuery = null;
    if (runtime.activeRun && runtime.activeRun.q === q) runtime.activeRun = null;
    if (runtime.backgroundTasks.size) {
      runtime.backgroundTasks = new Map();
      broadcast({ type: 'background_tasks', tasks: [] });
    }
    if (abortController.signal.aborted) {
      log('INFO', `query aborted by user after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      broadcast({ type: 'aborted' });
    }

    if (!sawStateEvents && !failed && !limitHit && !abortController.signal.aborted && resultSeen) {
      notify('reply', { title: 'Claude finished', message: 'Your reply is ready.' });
    }

    slot.finishedUnseen = !abortController.signal.aborted && !failed;   // my58
    slot.finishedAt = Date.now();   // my77: folds into Previous chats 30 minutes after this
    slot.asks = !abortController.signal.aborted && /⟦QUESTION⟧/.test(slot.turnText || '');   // my77: "Chat 2 needs your answer"
    chatHooks.changed();
    // The new or updated session (and its title) should appear in the list.
    broadcast({ type: 'sessions', sessions: listSessions(), activeId: runtime.activeSessionId });

    // Anything the run just created — a new automation, a new entity — should be
    // linkable in the reply that announces it.
    refreshHaLinks().then(() =>
      broadcast({ type: 'ha_links', entities: runtime.haLinks.entities, automations: runtime.haLinks.automations }));

    if (limitHit && !abortController.signal.aborted) {
      notify('stopped', { title: 'Claude hit the usage limit', message: 'The 5-hour limit was reached.' });
      autoContinue.handleLimitHit(limitHit, {
        model, effort,
        permissionMode: permissionMode || DEFAULT_PERMISSION_MODE,
        autoAttempts,
      });
    }
  }
}
