/*
 * my115 (Michael C, 15 Nov 2026): ONE live link to Home Assistant's event stream, shared by everything in haAi that
 * listens to it (the Messages page and the button-use counts used to keep two separate links, both reading every
 * call_service event, and some of those are over 32 KB). It also:
 *  - says so in the log when Home Assistant refuses the sign-in (auth_invalid), instead of sitting silent;
 *  - comes back by itself, waiting a little longer after each failure (up to 5 minutes);
 *  - can watch one entity's state (subscribe_trigger), so a value can be pushed instead of asked for every 30 s.
 *
 *   onEvent('call_service', (event) => ...)          every event of that type
 *   onState('sensor.x', (newState, oldState) => ...) whenever that entity changes
 */
import { WebSocket } from 'ws';
import { SUPERVISOR_URL } from './config.js';
import { log } from './log.js';

const eventSubs = new Map();   // event_type -> [handler]
const stateSubs = new Map();   // entity_id -> [handler]
let ws = null, nextId = 1, retry = 0, timer = null, started = false, authWarned = false;
const routes = new Map();      // subscription id -> (msg) => void

function subscribeAll() {
  routes.clear();
  for (const type of eventSubs.keys()) {
    const id = nextId++;
    routes.set(id, (m) => { for (const h of eventSubs.get(type) || []) { try { h(m.event); } catch (e) { log('WARN', `HA event ${type}: ${e?.message || e}`); } } });
    ws.send(JSON.stringify({ id, type: 'subscribe_events', event_type: type }));
  }
  for (const entity of stateSubs.keys()) {
    const id = nextId++;
    routes.set(id, (m) => {
      const t = m.event?.variables?.trigger;
      for (const h of stateSubs.get(entity) || []) { try { h(t?.to_state || null, t?.from_state || null); } catch (e) { log('WARN', `HA state ${entity}: ${e?.message || e}`); } }
    });
    ws.send(JSON.stringify({ id, type: 'subscribe_trigger', trigger: { platform: 'state', entity_id: entity } }));
  }
}

function again() {
  clearTimeout(timer);
  const wait = Math.min(300000, 15000 * 2 ** Math.min(retry, 5));
  retry++;
  timer = setTimeout(connect, wait);
  timer.unref?.();
}

function connect() {
  clearTimeout(timer);
  try { ws = new WebSocket(`${SUPERVISOR_URL.replace(/^http/, 'ws')}/core/websocket`); }
  catch (e) { log('WARN', `Home Assistant event link failed: ${e?.message || e}`); ws = null; again(); return; }
  const me = ws;
  me.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'auth_required') me.send(JSON.stringify({ type: 'auth', access_token: process.env.SUPERVISOR_TOKEN }));
    else if (m.type === 'auth_ok') { retry = 0; authWarned = false; subscribeAll(); }
    else if (m.type === 'auth_invalid') {
      if (!authWarned) log('ERROR', `Home Assistant refused haAi's event link sign-in: ${m.message || ''}. Messages page and button counts are paused; trying again.`);
      authWarned = true;
      try { me.close(); } catch { /* close handler retries */ }
    } else if (m.type === 'event') routes.get(m.id)?.(m);
    else if (m.type === 'result' && m.success === false) log('WARN', `Home Assistant refused a subscription: ${JSON.stringify(m.error || {}).slice(0, 200)}`);
  });
  me.on('error', (e) => log('WARN', `Home Assistant event link error: ${e?.message || e}`));
  me.on('close', () => { if (ws === me) ws = null; again(); });
}

function ensure() {
  if (ws && ws.readyState === 1) subscribeAll();   // a new listener after start-up: subscribe again on the open link
  if (!started) { started = true; setTimeout(connect, 0); }
}

export function onEvent(type, handler) {
  eventSubs.set(type, [...(eventSubs.get(type) || []), handler]);
  ensure();
}

export function onState(entityId, handler) {
  stateSubs.set(entityId, [...(stateSubs.get(entityId) || []), handler]);
  ensure();
}
