/*
 * Claude Code UI — Home Assistant app.
 *
 * A browser-based Claude Code interface: an Express + WebSocket server that
 * drives the Claude Agent SDK and streams the result to a chat UI, with direct
 * access to the Home Assistant configuration and live state.
 *
 * This file is the composition root and nothing else — it wires the modules in
 * server/lib together, loads the persisted state, and listens. Anything with
 * behaviour of its own lives in a module; if you are looking for something:
 *
 *   config.js         every environment variable and derived path
 *   state.js          the mutable values that span the whole process
 *   broadcast.js      connected sockets, send() and broadcast()
 *   auth.js           credentials and the device-login flow
 *   sessions.js       Claude Code's on-disk transcript store
 *   dialogs.js        AskUserQuestion interception
 *   permissions.js    the /addon_configs guard and canUseTool
 *   auto-continue.js  resuming after a usage limit resets
 *   run-query.js      one turn: SDK options in, wire events out
 *   ws-protocol.js    what a browser is told, and what it may ask for
 *   diag.js           the /diag routes (debug option only)
 *   ha-auth.js        the HA admin-token guard those routes sit behind
 *   uploads.js        attachments
 *   ha-links.js       entity/automation link targets
 *   notify.js         pushing "needs attention" through Home Assistant
 *   mcp.js            stripping persisted MCP servers at startup
 */
import { createServer } from 'http';
import { createHash } from 'crypto';   // my82
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';   // my82
import { spawn } from 'child_process';   // my84
import path from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';

import {
  PORT, WORK_DIR, PLUGIN_DIR, FRONTEND_DIR, UPLOAD_DIR, DEBUG_MODE,
  ALLOW_ADDON_CONFIGS, ENABLE_ESPHOME, ESPHOME_CONFIG_DIR, VERBOSE_LOGGING,
} from './lib/config.js';
import { isSubscriptionAuth } from './lib/auth.js';
import { loadActive } from './lib/sessions.js';
import { sanitizeMcpState } from './lib/mcp.js';
import { ensureUploadDir, cleanupUploads } from './lib/uploads.js';
import { refreshHaLinks } from './lib/ha-links.js';
import { registerDiagRoutes } from './lib/diag.js';
import { attach } from './lib/ws-protocol.js';
import { runQuery } from './lib/run-query.js';
import * as autoContinue from './lib/auto-continue.js';
import { setOvernightRunner } from './lib/batch4.js';   // my48
import { setTimedRunner } from './lib/my79.js';   // my79
import { startMy87 } from './lib/my87.js';   // my87
import * as notifier from './lib/notify.js';
import * as deviceAuth from './lib/device-auth.js';
import { registerWatchRoutes } from './lib/watch.js';   // my50

// ── HTTP ─────────────────────────────────────────────────────────────────────
const app = express();
const server = createServer(app);
// haAi (my23): a second, published port for the stand-alone app. Everything on it needs a paired-device key.
const directServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });
function onUpgrade(req, socket, head) {
  const direct = deviceAuth.isDirect(req);
  if ((req.url || '').split('?')[0] !== '/ws') { socket.destroy(); return; }
  if (direct && !deviceAuth.deviceFor(req)) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => { ws.direct = direct; wss.emit('connection', ws, req); });
}
server.on('upgrade', onUpgrade);
directServer.on('upgrade', onUpgrade);

app.use((req, res, next) => {
  if (!deviceAuth.isDirect(req)) return next();
  if (req.method === 'POST' && req.path === '/pair') return next();
  if (deviceAuth.deviceFor(req)) return next();
  if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) return res.status(401).type('html').send(deviceAuth.PAIR_PAGE);
  res.status(401).json({ error: 'not paired' });
});
app.post('/pair', express.json({ limit: '1kb' }), (req, res) => {
  if (!deviceAuth.isDirect(req)) return res.status(404).end();
  const r = deviceAuth.redeem(String(req.body?.code || ''), req.body?.name);
  if (r.error) return res.status(403).json({ ok: false, error: r.error });
  res.setHeader('Set-Cookie', deviceAuth.cookieHeader(r.key));
  res.json({ ok: true });
});

registerWatchRoutes(app, express);   // my50: after the direct-port login gate

// my82: the page files (about 50) were checked again on every open (max-age=0). Now the phone keeps
// them until the next haAi update: index.html (never kept) points at them under v/<fingerprint of
// the page files>/, so any change to them gives every file a new address at once.
function pageFingerprint(dir) {
  const h = createHash('sha1');
  const walk = (d) => {
    for (const f of readdirSync(d).sort()) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p); else h.update(p).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex').slice(0, 10);
}
const PAGE_VER = pageFingerprint(FRONTEND_DIR);
const INDEX_HTML = readFileSync(path.join(FRONTEND_DIR, 'index.html'), 'utf8')
  .replace(/\b(src|href)="(?![a-z]+:|\/|#)([^"]+)"/g, `$1="v/${PAGE_VER}/$2"`);
const sendIndex = (_req, res) => { res.set('Cache-Control', 'no-cache'); res.type('html').send(INDEX_HTML); };
app.get(['/', '/index.html'], sendIndex);
app.use(`/v/${PAGE_VER}`, express.static(FRONTEND_DIR, { maxAge: '365d', immutable: true, index: false }));
app.use(express.static(FRONTEND_DIR));

ensureUploadDir();
app.use('/uploads', express.static(UPLOAD_DIR));

// Only when the `debug` app option is on. Otherwise these routes do not exist
// and the requests fall through to the SPA below.
if (DEBUG_MODE) registerDiagRoutes(app);

// Single-page app: every other path serves the shell, so ingress deep links work.
app.get('*', sendIndex);   // my82: the same page, with the kept-file addresses

attach(wss);

// ── Startup ──────────────────────────────────────────────────────────────────
// run-query imports auto-continue (to schedule a resume when a limit stops a
// run); auto-continue needs to call back into run-query when that resume fires.
// Injecting it here keeps the module graph one-way.
autoContinue.setResumeRunner(runQuery);
setOvernightRunner(runQuery);   // my48
setTimedRunner(runQuery);   // my79 H17
startMy87(runQuery);   // my87 next chat by itself

sanitizeMcpState();
loadActive();
autoContinue.load();
notifier.load();
cleanupUploads();          // drop attachments older than a week
refreshHaLinks();          // populate entity/automation link targets
autoContinue.rearmOnBoot();

// my84 (Michael 2026-11-12): keep the Claude Code mailbox running, so the Claude app's notes are answered
// even after haAi restarts. The script exits at once if a copy is already running (its own pid file).
const MAILBOX = '/config/opencode/tools/claude_mailbox.py';
function keepMailbox() {
  if (!existsSync(MAILBOX)) return;
  try { spawn('python3', ['-I', MAILBOX], { detached: true, stdio: 'ignore' }).unref(); } catch (e) { console.log(`mailbox start failed: ${e?.message || e}`); }
}
setTimeout(keepMailbox, 20000);
setInterval(keepMailbox, 5 * 60000);

directServer.listen(deviceAuth.DIRECT_PORT, '0.0.0.0');
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Claude Code UI listening on port ${PORT}`);
  console.log(`  Working dir: ${WORK_DIR}`);
  console.log(`  Plugin dir:  ${PLUGIN_DIR}`);
  console.log(`  /addon_configs access: ${ALLOW_ADDON_CONFIGS ? 'enabled' : 'blocked'}`);
  console.log(`  ESPHome capability: ${ENABLE_ESPHOME ? `on (${ESPHOME_CONFIG_DIR || 'no config dir'})` : 'off'}`);
  console.log(`  Auto-continue on limit: ${autoContinue.autoContinue.enabled ? 'on' : 'off'} ` +
    `(${isSubscriptionAuth() ? 'subscription' : 'api-key'} auth)`);
  console.log(`  Verbose logging: ${VERBOSE_LOGGING ? 'on' : 'off'}`);
});
