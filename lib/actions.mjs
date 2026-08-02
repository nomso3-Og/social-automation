import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONFIG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config');

async function loadJson(name) {
  const raw = await readFile(path.join(CONFIG_DIR, `${name}.json`), 'utf8');
  return JSON.parse(raw);
}

export async function loadPlatforms() {
  return loadJson('platforms');
}

export async function loadActionSlug(platform, actionName) {
  const actions = await loadJson('actions.config');
  const slug = actions[platform]?.[actionName];
  if (!slug || slug === 'REPLACE_ME') {
    throw new Error(
      `No tool slug configured for ${platform}.${actionName} in config/actions.config.json. ` +
        `Run: npm run list-actions -- ${platform}   (then paste the real slug in)`
    );
  }
  return slug;
}
