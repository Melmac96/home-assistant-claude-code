/*
 * my113 (Michael 15 Nov): when the mini TV (Android picture-in-picture, e.g. the IPTV player in the corner) is on the
 * HA Shield screen, haAi on the TV moves the working bar and the typing box in from the right so nothing sits behind it.
 * The server asks the Shield over adb every 2 s where a pinned window is and tells every screen when that changes;
 * only the TV layout (tv.js) acts on it. No mini TV, or the Shield cannot be reached = normal layout.
 */
import { execFile } from 'child_process';
import { log } from './log.js';
import { broadcast, send } from './broadcast.js';

const SHIELD = '192.168.1.102:5555';
let state = { on: false };
let lastKey = 'off', lastConnect = 0, warned = false;

const adb = (args, ms = 4000) => new Promise((res) => {
  execFile('adb', args, { timeout: ms }, (err, out) => res(err ? null : String(out || '')));
});

/** Reads the pinned window from 'dumpsys window windows' text; null when there is none. */
export function parsePip(text) {
  const m = /mBounds=Rect\((\d+), (\d+) - (\d+), (\d+)\)[^\n]*mWindowingMode=pinned/.exec(text || '');
  if (!m) return null;
  const [l, t, r, b] = m.slice(1).map(Number);
  return r > l && b > t ? { l, t, r, b } : null;
}

async function check() {
  let out = await adb(['-s', SHIELD, 'shell', 'dumpsys window windows | grep -m1 mWindowingMode=pinned']);
  if (out === null && Date.now() - lastConnect > 60000) {   // the adb link dropped: try once a minute
    lastConnect = Date.now();
    await adb(['connect', SHIELD], 6000);
    out = await adb(['-s', SHIELD, 'shell', 'dumpsys window windows | grep -m1 mWindowingMode=pinned']);
    if (out === null && !warned) { warned = true; log('WARN', 'my113: cannot reach the HA Shield over adb, the mini TV check is paused'); }
  }
  if (out !== null) warned = false;
  const p = out === null ? null : parsePip(out);
  state = p ? { on: true, ...p, sw: 1920, sh: 1080 } : { on: false };
  const key = p ? `${p.l},${p.t},${p.r},${p.b}` : 'off';
  if (key !== lastKey) { lastKey = key; broadcast({ type: 'tv_pip', ...state }); }
}

export function sendPip(ws) { send(ws, { type: 'tv_pip', ...state }); }
export function startTvPip() { setInterval(() => { check().catch(() => {}); }, 2000).unref?.(); }
