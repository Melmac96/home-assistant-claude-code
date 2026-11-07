/*
 * haAi (my23): the login for the DIRECT port (7682), used by the stand-alone Android app.
 *
 * Why it exists: the ingress route (port 7681, only reachable through Home Assistant)
 * has no login of its own. The direct port is open to the home network, so EVERYTHING
 * on it needs a paired-device key first. The ingress port is untouched and never gated.
 *
 * Pairing: a 6-digit code is made inside haAi while it is opened through Home Assistant
 * (2 minutes, one use). The device types it on the pairing page, and gets a long random
 * key in a cookie. Only the SHA-256 of each key is stored (/data/devices.json, mode 600).
 * Five wrong codes in 10 minutes lock pairing for 10 minutes.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { readFileSync, writeFileSync, chmodSync } from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';
import { log } from './log.js';

export const DIRECT_PORT = parseInt(process.env.DIRECT_PORT || '7682', 10);
const FILE = path.join(DATA_DIR, 'devices.json');
const COOKIE = 'haai_key';
const sha = (k) => createHash('sha256').update(k).digest();

let devices = [];
try { devices = JSON.parse(readFileSync(FILE, 'utf8')); if (!Array.isArray(devices)) devices = []; } catch { devices = []; }
function save() {
  try { writeFileSync(FILE, JSON.stringify(devices, null, 1)); chmodSync(FILE, 0o600); } catch (e) { log('ERROR', 'devices save failed: ' + e.message); }
}

let pending = null;
let fails = [];
let lockedUntil = 0;

export const isDirect = (req) => req.socket && req.socket.localPort === DIRECT_PORT;

function readKey(req) {
  const h = req.headers || {};
  const m = /(?:^|;\s*)haai_key=([0-9a-f]{64})/.exec(h.cookie || '');
  if (m) return m[1];
  const b = /^Bearer ([0-9a-f]{64})$/.exec(h.authorization || '');
  return b ? b[1] : null;
}

/** The paired device this request belongs to, or null. */
export function deviceFor(req) {
  const key = readKey(req);
  if (!key) return null;
  const want = sha(key);
  for (const d of devices) {
    const have = Buffer.from(d.hash, 'hex');
    if (have.length === want.length && timingSafeEqual(have, want)) {
      if (!d.lastSeen || Date.now() - d.lastSeen > 60000) { d.lastSeen = Date.now(); save(); }
      return d;
    }
  }
  return null;
}

export function startPairing() {
  pending = { code: String(randomInt(0, 1000000)).padStart(6, '0'), expires: Date.now() + 120000 };
  return { code: pending.code, expires: pending.expires };
}

export function redeem(code, name) {
  const now = Date.now();
  if (now < lockedUntil) return { error: 'Too many wrong codes. Try again in a few minutes.' };
  const ok = pending && now < pending.expires && typeof code === 'string' && code.length === 6
    && timingSafeEqual(Buffer.from(code), Buffer.from(pending.code));
  if (!ok) {
    fails = fails.filter((t) => now - t < 600000); fails.push(now);
    if (fails.length >= 5) { lockedUntil = now + 600000; pending = null; fails = []; log('WARN', 'device pairing locked for 10 minutes after wrong codes'); }
    return { error: 'That code is wrong or has run out. Make a new one in haAi (through Home Assistant).' };
  }
  pending = null; fails = [];
  const key = randomBytes(32).toString('hex');
  const id = randomBytes(4).toString('hex');
  devices.push({ id, name: String(name || 'Device').slice(0, 40), hash: sha(key).toString('hex'), created: now, lastSeen: now });
  save();
  log('INFO', `device paired: ${id}`);
  return { key, id };
}

export const listDevices = () => devices.map(({ id, name, created, lastSeen }) => ({ id, name, created, lastSeen }));
export function removeDevice(id) { const n = devices.length; devices = devices.filter((d) => d.id !== id); if (devices.length !== n) save(); return devices.length !== n; }

export const cookieHeader = (key) => `${COOKIE}=${key}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`;

export const PAIR_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>haAi</title>
<style>body{margin:0;background:#000;color:#ececee;font-family:Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
.c{width:min(340px,90vw);border:1px solid #26282d;border-top:2px solid #1f5fae;border-bottom:2px solid #1f5fae;border-radius:16px;padding:22px;background:#101113;text-align:center}
h1{font-size:22px;margin:0 0 6px}h1 b{color:#9a9da4}h1 i{color:#4da3ff;font-style:normal}p{color:#7d8087;font-size:14px}
input{width:100%;box-sizing:border-box;font-size:26px;letter-spacing:.3em;text-align:center;background:#0a0a0b;border:1px solid #26282d;border-radius:10px;color:#fff;padding:10px;margin:8px 0}
input:focus{outline:0;border-color:#4da3ff}button{width:100%;padding:13px;border:0;border-radius:11px;background:#4da3ff;color:#000;font-weight:700;font-size:16px;margin-top:6px}
#m{color:#ff6b6b;min-height:20px;font-size:14px}</style></head><body><div class="c"><h1><b>ha</b><i>Ai</i></h1>
<p>Pair this device. In haAi (opened through Home Assistant) go to Settings, Paired devices, tap Pair a device, then type the 6 numbers here.</p>
<input id="c" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="000000"><div id="m"></div><button id="b">Pair</button></div>
<script>document.getElementById('b').onclick=async()=>{const m=document.getElementById('m');m.textContent='';
try{const r=await fetch('/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:document.getElementById('c').value.trim(),name:navigator.userAgent.indexOf('Tablet')>-1||Math.min(screen.width,screen.height)>=600?'Tablet':'Phone'})});
const j=await r.json();if(j.ok){location.reload();}else m.textContent=j.error||'Did not work.';}catch(e){m.textContent='Could not reach haAi.';}};</script></body></html>`;
