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
app.use(express.static(FRONTEND_DIR));

ensureUploadDir();
app.use('/uploads', express.static(UPLOAD_DIR));

// Only when the `debug` app option is on. Otherwise these routes do not exist
// and the requests fall through to the SPA below.
if (DEBUG_MODE) registerDiagRoutes(app);

// Single-page app: every other path serves the shell, so ingress deep links work.
app.get('*', (_req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

attach(wss);

// ── Startup ──────────────────────────────────────────────────────────────────
// run-query imports auto-continue (to schedule a resume when a limit stops a
// run); auto-continue needs to call back into run-query when that resume fires.
// Injecting it here keeps the module graph one-way.
autoContinue.setResumeRunner(runQuery);
setOvernightRunner(runQuery);   // my48
setTimedRunner(runQuery);   // my79 H17

sanitizeMcpState();
loadActive();
autoContinue.load();
notifier.load();
cleanupUploads();          // drop attachments older than a week
refreshHaLinks();          // populate entity/automation link targets
autoContinue.rearmOnBoot();

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
