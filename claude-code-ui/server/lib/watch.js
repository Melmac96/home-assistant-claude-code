/*
 * my50: the Pixel Watch 4 app. Two small routes for the watch:
 *   GET  /watch/state   -> house status, the newest reply cut short, any waiting A/B question
 *   POST /watch/answer  -> {letter:"A"|"B"} goes into the current chat as a plain message
 * On the direct port (7682) both need a paired-device key like everything else there
 * (index.js gates the whole port first). The watch app carries one such key.
 */
import { getHomeHealth } from './homehealth.js';
import { isQuiet } from './batch5.js';
import { runtime } from './state.js';
import { parseSession } from './sessions.js';
import { runQuery } from './run-query.js';
import { log } from './log.js';

const strip = (s) => String(s || '')
  .replace(/[\u{1F539}\u{1F7E6}\u{1F7E5}]/gu, '').replace(/⟦[^⟧]*⟧/g, '')
  .replace(/\*\*/g, '').replace(/`/g, '').replace(/[ \t]+/g, ' ').trim();

/** The newest assistant text of the current chat, as {reply, question, options}. */
export function newestReply() {
  const items = parseSession(runtime.activeSessionId);
  let last = null;
  for (let i = items.length - 1; i >= 0; i--) { if (items[i].kind === 'text') { last = items[i].text; break; } }
  if (!last) return { reply: '', question: '', options: [] };
  const q = /⟦QUESTION⟧([\s\S]*?)⟦\/QUESTION⟧/.exec(last);
  if (q) {
    const lines = q[1].split('\n').map(strip).filter(Boolean);
    const options = [];
    let question = '';
    for (const l of lines) {
      const m = /^([A-Z])\.\s*(.*)$/.exec(l);
      if (m) options.push({ letter: m[1], text: m[2].slice(0, 60) });
      else if (!question) question = l.replace(/^Q\d\s*/, '');
    }
    return { reply: '', question: question.slice(0, 140), options: options.slice(0, 4) };
  }
  const lines = last.split('\n').map(strip).filter(Boolean);
  return { reply: lines.slice(1).join(' ').slice(0, 220) || lines[0] || '', question: '', options: [] };
}

export function registerWatchRoutes(app, express) {
  app.get('/watch/state', (_req, res) => {
    const h = getHomeHealth();
    res.json({ home: { status: h.status, count: h.count }, quiet: isQuiet(), working: !!runtime.activeQuery, ...newestReply() });
  });
  app.post('/watch/answer', express.json({ limit: '1kb' }), (req, res) => {
    const letter = String(req.body?.letter || '').toUpperCase();
    if (!/^[A-D]$/.test(letter)) return res.status(400).json({ ok: false });
    log('INFO', `my50: watch answered ${letter}`);
    runQuery({ readyState: 3 }, { text: letter, permissionMode: 'default', add: true });
    res.json({ ok: true });
  });
}
