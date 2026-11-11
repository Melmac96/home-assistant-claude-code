/*
 * Sessions, read from Claude Code's own on-disk store.
 *
 * Multi-session browsing is built on the canonical JSONL transcripts at
 * ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl — the same files the CLI
 * writes, so a session started here can be picked up there and vice versa. The
 * only thing this app keeps of its own is a pointer to the active session.
 */
import { closeSync, existsSync, openSync, readFileSync, readSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs';
import { readFile } from 'fs/promises';   // my28
import path from 'path';
import { STORE_DIR, ACTIVE_FILE } from './config.js';
import { runtime } from './state.js';

export function sessionFile(id) {
  return path.join(STORE_DIR, `${id}.jsonl`);
}

export function loadActive() {
  try {
    if (existsSync(ACTIVE_FILE)) {
      runtime.activeSessionId = JSON.parse(readFileSync(ACTIVE_FILE, 'utf8')).sessionId || null;
    }
  } catch (e) { console.warn('Could not load active session:', e.message); }
  // A pointer to a session that no longer exists would replay an empty chat for
  // ever, so drop it.
  if (runtime.activeSessionId && !existsSync(sessionFile(runtime.activeSessionId))) {
    runtime.activeSessionId = null;
  }
}

export function saveActive() {
  try { writeFileSync(ACTIVE_FILE, JSON.stringify({ sessionId: runtime.activeSessionId })); }
  catch (e) { console.warn('Could not save active session:', e.message); }
}

export function blockText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (typeof b === 'string' ? b : b.text || '')).join('');
  return JSON.stringify(content);
}

/**
 * Slash commands (e.g. /compact) are recorded in the transcript as user messages
 * wrapped in <command-name>…/<local-command-stdout>… tags. They are plumbing,
 * not conversation, so they are dropped from the rendered history.
 */
export function isCommandEcho(text) {
  return typeof text === 'string' &&
    (text.includes('<command-name>') || text.includes('<local-command-stdout>'));
}

/**
 * Any harness-authored envelope that can land as a `user`-role transcript line
 * without being a thing the human actually typed: a slash-command echo, a
 * stray task-notification (see below), or a system reminder. Generic beyond
 * isCommandEcho() because origin alone does not always distinguish these —
 * some CLI builds write a task-notification's body without stamping origin.
 */
export function isHarnessEcho(text) {
  return typeof text === 'string' &&
    (isCommandEcho(text) || text.includes('<task-notification>') || text.includes('<system-reminder>'));
}

/**
 * `origin.kind` values the SDK stamps on a `user`-role message that was never
 * typed by the human at the keyboard: a background task finishing
 * ('task-notification'), another of the user's own sessions sending a message
 * ('peer'), or anything else machine-originated. 'human' and an absent origin
 * (older transcripts, or this app's own synthesized turns) are the only kinds
 * rendered as an ordinary user bubble.
 */
const NON_HUMAN_ORIGIN_KINDS = new Set([
  'task-notification', 'peer', 'channel', 'coordinator', 'observer', 'auto-continuation', 'observer-activity',
]);

/**
 * Pull the handful of fields a task-notification's injected text carries, for
 * the cases (older CLI builds) where it arrives as plain content rather than a
 * stamped origin. Tolerant of tag order and missing fields — this is read-only
 * display, never something to act on.
 */
export function parseTaskNotification(text) {
  if (typeof text !== 'string' || !text.includes('<task-notification>')) return null;
  const field = (tag) => text.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];
  return {
    taskId: field('task-id') || null,
    status: field('status') || 'completed',
    summary: field('summary') || 'Background task finished',
  };
}

// The two messages formatQuestionDenial() can produce. Fixed strings, so
// matching them is safe — and only ever consulted for a tool_result whose
// tool_use isn't in `toolNames` (a transcript truncated above the call).
const QUESTION_ANSWER_RE = /^The user (answered your question\(s\):|closed the question dialog without answering\.)/;

/**
 * An AskUserQuestion is answered by *denying* the tool call with the answer as
 * the message, so it lands in the transcript as is_error:true on a perfectly
 * ordinary reply. That is a deliberate choice made for the model's benefit, not
 * a failure the reader should see in red.
 */
export function isQuestionAnswer(toolName, isError, text) {
  if (!isError) return false;
  if (toolName === 'AskUserQuestion') return true;
  return toolName === undefined && QUESTION_ANSWER_RE.test(text);
}

/** Cap a tool result so one chatty command cannot flood the transcript. */
export function truncateOutput(raw) {
  return raw.length > 4000 ? raw.slice(0, 4000) + '\n…[truncated]' : raw;
}

/**
 * Turn one stored JSONL line into render item(s), matching the live event
 * shapes. Each item carries `ts` (epoch ms) so the UI can show when a message
 * happened after a reload.
 *
 * `toolNames` is tool_use id → tool name, carried across the whole transcript by
 * parseSession: a tool_result line only ever carries the id.
 */
// My Claude Code UI (my15): Claude Code's harness inserts a placeholder assistant
// message "No response requested." (model '<synthetic>') that buries the real report
// above it. Only that exact placeholder is ever hidden; real replies are never touched.
export function isNoResponsePlaceholder(ev) {
  const m = ev && ev.message;
  if (!m || m.model !== '<synthetic>' || !Array.isArray(m.content)) return false;
  const text = m.content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('').trim();
  return text === 'No response requested.' && m.content.every((b) => b && b.type === 'text');
}

export function lineToItems(line, toolNames = new Map()) {
  const items = [];
  const msg = line.message;
  if (line.isMeta || line.isSidechain || line.isCompactSummary || !msg) return items;
  const ts = line.timestamp ? Date.parse(line.timestamp) || undefined : undefined;
  const push = (o) => items.push(ts ? { ...o, ts } : o);

  if (line.type === 'user') {
    const content = msg.content;
    const originKind = line.origin?.kind;

    // A task-notification is the harness telling the host a background task
    // finished — never something the human typed. It must never render as a
    // user bubble, live or after reloading history (see lineToItems tests).
    if (originKind === 'task-notification') {
      const text = typeof content === 'string' ? content : blockText(content);
      const n = parseTaskNotification(text) || {};
      push({ kind: 'task_notice', taskId: n.taskId || null, status: n.status || 'completed',
        summary: n.summary || 'Background task finished' });
      return items;
    }
    // A delivered SubagentHandback report: a peer session (here, a background
    // subagent) sending a message, with the harness envelope already stripped
    // into `body`. Shown as a labelled report, not as if the user said it.
    if (originKind === 'peer' && typeof line.origin.body === 'string') {
      push({ kind: 'agent_report', from: line.origin.name || line.origin.from || 'background agent',
        text: line.origin.body });
      return items;
    }
    // Any other non-human origin (channel, coordinator, observer, …): never a
    // user bubble, but not worth a dedicated rendering either.
    if (NON_HUMAN_ORIGIN_KINDS.has(originKind)) return items;

    if (typeof content === 'string') {
      if (content.trim() && !isHarnessEcho(content)) push({ kind: 'user', text: content });
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'text' && b.text) {
          if (!isHarnessEcho(b.text)) push({ kind: 'user', text: b.text });
        } else if (b.type === 'tool_result') {
          const raw = blockText(b.content);
          const answered = isQuestionAnswer(toolNames.get(b.tool_use_id), !!b.is_error, raw);
          push({ kind: 'tool_result', id: b.tool_use_id, output: truncateOutput(raw),
            isError: !!b.is_error && !answered, answered });
        }
      }
    }
  } else if (line.type === 'assistant' && !isNoResponsePlaceholder(line)) {
    for (const b of (msg.content || [])) {
      if (b.type === 'text' && b.text) push({ kind: 'text', text: b.text });
      else if (b.type === 'tool_use') {
        toolNames.set(b.id, b.name);
        push({ kind: 'tool_use', id: b.id, name: b.name, input: b.input });
      }
    }
  }
  return items;
}

export function parseSession(id) {
  const file = sessionFile(id);
  if (!id || !existsSync(file)) return [];
  const items = [];
  const toolNames = new Map();
  for (const ln of readFileSync(file, 'utf8').split('\n')) {
    if (!ln.trim()) continue;
    let obj; try { obj = JSON.parse(ln); } catch { continue; }
    items.push(...lineToItems(obj, toolNames));
  }
  return items;
}

// my82: listing the chats read EVERY saved chat in full (613 MB, 2.5 s with the whole server standing
// still) only to find the titles. A title is the first real message, so it is now looked for in the
// first 256 KB of the file, and remembered: for good once found, otherwise until the file changes.
const HEAD_BYTES = 256 * 1024;
const titleCache = new Map();   // id -> { key, title, final }
function readHead(file, bytes) {
  const fd = openSync(file, 'r');
  try { const b = Buffer.alloc(bytes); const n = readSync(fd, b, 0, bytes, 0); return b.toString('utf8', 0, n); }
  finally { closeSync(fd); }
}

export function sessionTitle(id) {
  const file = sessionFile(id);
  let st; try { st = statSync(file); } catch { return null; }
  const key = `${st.size}:${st.mtimeMs}`;
  const c = titleCache.get(id);
  if (c && (c.final || c.key === key)) return c.title;
  let r = findTitle(st.size <= HEAD_BYTES ? readFileSync(file, 'utf8') : readHead(file, HEAD_BYTES), st.size <= HEAD_BYTES);
  if (!r.final && st.size > HEAD_BYTES) r = findTitle(readFileSync(file, 'utf8'), true);
  titleCache.set(id, { key, ...r });
  return r.title;
}

function findTitle(body, whole) {
  let greeting = null;
  try {
    const lines = body.split('\n');
    if (!whole) lines.pop();   // the last line may be cut off part-way
    for (const ln of lines) {
      if (!ln.trim()) continue;
      let obj; try { obj = JSON.parse(ln); } catch { continue; }
      if (obj.type !== 'user' || obj.isMeta || obj.isSidechain || obj.isCompactSummary) continue;
      // A task-notification, a delivered subagent report, or any other
      // non-human origin was never typed by the user and must not become the
      // title — same rule as lineToItems().
      if (NON_HUMAN_ORIGIN_KINDS.has(obj.origin?.kind)) continue;
      const c = obj.message?.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? (c.find((b) => b.type === 'text')?.text || '') : '';
      if (isHarnessEcho(text) || parseTaskNotification(text)) continue;
      const t = (text || '').replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const shown = t.length > 80 ? t.slice(0, 80) + '…' : t;
      // my28: a bare greeting makes a useless title, so use the first real message when there is one.
      if (/^(hi|hello|hey)( claude| there)?[\s!.,]*$/i.test(t)) { greeting = greeting || shown; continue; }
      return { title: shown, final: true };
    }
  } catch {}
  return { title: greeting, final: false };
}

export function listSessions() {
  if (!existsSync(STORE_DIR)) return [];
  const out = [];
  for (const f of readdirSync(STORE_DIR)) {
    if (!f.endsWith('.jsonl')) continue;
    const id = f.slice(0, -6);
    let mtime = 0; try { mtime = statSync(path.join(STORE_DIR, f)).mtimeMs; } catch {}
    const title = sessionTitle(id);
    if (!title) continue;   // an empty shell the CLI left behind, not a conversation
    out.push({ id, title, updatedAt: mtime });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteSession(id) {
  titleCache.delete(id);   // my82
  try { unlinkSync(sessionFile(id)); return true; }
  catch (e) { console.warn('Could not delete session:', e.message); return false; }
}

// my28: search every saved chat, words only (what Michael typed and what Claude said), newest first.
export async function searchSessions(q) {
  const needle = String(q || '').toLowerCase();
  if (needle.length < 2 || !existsSync(STORE_DIR)) return [];
  const raw = !/["\\]/.test(needle);   // a quick test on the raw file is only safe with nothing JSON would escape
  const files = readdirSync(STORE_DIR).filter((f) => f.endsWith('.jsonl')).map((f) => {
    let m = 0; try { m = statSync(path.join(STORE_DIR, f)).mtimeMs; } catch {}
    return { f, m };
  }).sort((a, b) => b.m - a.m);
  const out = [];
  for (const { f, m } of files) {
    if (out.length >= 30) break;
    let body;
    try { body = await readFile(path.join(STORE_DIR, f), 'utf8'); } catch { continue; }
    if (raw && !body.toLowerCase().includes(needle)) continue;
    let snippet = null;
    for (const ln of body.split('\n')) {
      if (!ln.trim()) continue;
      let obj; try { obj = JSON.parse(ln); } catch { continue; }
      for (const it of lineToItems(obj)) {
        if (it.kind !== 'user' && it.kind !== 'text') continue;
        const t = it.text.replace(/\s+/g, ' ');
        const at = t.toLowerCase().indexOf(needle);
        if (at < 0) continue;
        snippet = (at > 50 ? '…' : '') + t.slice(Math.max(0, at - 50), at + needle.length + 70) + '…';
        break;
      }
      if (snippet) break;
    }
    if (!snippet) continue;
    const id = f.slice(0, -6);
    out.push({ id, title: sessionTitle(id) || 'Chat', updatedAt: m, snippet });
  }
  return out;
}
