import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'state');

export async function readState(name, fallback = {}) {
  try {
    const raw = await readFile(path.join(STATE_DIR, `${name}.json`), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

export async function writeState(name, value) {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(path.join(STATE_DIR, `${name}.json`), JSON.stringify(value, null, 2) + '\n');
}
