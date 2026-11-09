/*
 * my47: "Look at my screen" (user pick A, batch 3, 2026-11-09). Takes a picture of one of the home screens with adb
 * (the add-on has adb) and hands it to the page as a base64 PNG, which the page adds to the message.
 * Only these three addresses are allowed; nothing else can be asked for.
 */
import { execFile } from 'child_process';
import { log } from './log.js';

const DEVICES = {
  'ha-shield': { name: 'HA Shield', ip: '192.168.1.102' },
  'main-shield': { name: 'Main Shield', ip: '192.168.1.237' },
  'fire-tv': { name: 'Fire TV', ip: '192.168.1.204' },
};
const run = (args, opts = {}) => new Promise((resolve, reject) => {
  execFile('adb', args, { timeout: 20000, maxBuffer: 30 * 1024 * 1024, encoding: 'buffer', ...opts }, (err, out, errOut) => {
    if (err) reject(Object.assign(err, { stdout: String(out || ''), stderr: String(errOut || '') })); else resolve(out);
  });
});

export async function takeScreenshot(key) {
  const d = DEVICES[key];
  if (!d) return { ok: false, error: 'Unknown screen' };
  const target = `${d.ip}:5555`;
  try {
    const c = String(await run(['connect', target])).trim();
    if (/unauthorized|failed to authenticate/i.test(c)) return { ok: false, error: `${d.name} has not allowed this yet. Look at its screen and tap Allow.` };
    if (/cannot|unable|refused|timed out/i.test(c)) return { ok: false, error: `${d.name} did not answer. It may be off.` };
    const png = await run(['-s', target, 'exec-out', 'screencap', '-p']);
    if (!Buffer.isBuffer(png) || png.length < 100 || png[1] !== 0x50) return { ok: false, error: `${d.name} is not allowed to show its screen (unauthorised or protected).` };
    return { ok: true, name: d.name, data: png.toString('base64') };
  } catch (e) {
    log('WARN', `screenshot ${key} failed: ${e.message}`);
    return { ok: false, error: `${d.name} did not answer. It may be off.` };
  }
}
