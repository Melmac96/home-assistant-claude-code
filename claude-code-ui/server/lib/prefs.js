/*
 * my41: the model and thinking effort choice, kept on the server so every device (phone, tablet,
 * app) shows the SAME choice. Default = the newest Sonnet on Medium. The page turns 'latest-sonnet'
 * into whichever Sonnet the catalog offers, so a new Sonnet is picked up on its own.
 */
import { readFileSync, writeFileSync, renameSync } from 'fs';
import path from 'path';
import { DATA_DIR, EFFORT_LEVELS } from './config.js';

const FILE = path.join(DATA_DIR, 'haai-prefs.json');
const DEFAULT = { model: 'latest-sonnet', effort: 'medium' };

export function getPrefs() {
  try {
    const j = JSON.parse(readFileSync(FILE, 'utf8'));
    return { model: typeof j.model === 'string' && j.model ? j.model : DEFAULT.model, effort: EFFORT_LEVELS.has(j.effort) ? j.effort : DEFAULT.effort };
  } catch { return { ...DEFAULT }; }
}
export function setPrefs(msg) {
  const cur = getPrefs();
  const model = /^[A-Za-z0-9._:\/-]{2,120}$/.test(String(msg.model || '')) ? String(msg.model) : cur.model;
  const effort = EFFORT_LEVELS.has(msg.effort) ? msg.effort : cur.effort;
  writeFileSync(FILE + '.tmp', JSON.stringify({ model, effort }));
  renameSync(FILE + '.tmp', FILE);
  return { model, effort };
}
