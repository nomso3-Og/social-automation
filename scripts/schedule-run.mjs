#!/usr/bin/env node
// Publishes any draft in scheduled/ whose meta.json publishAt is due, then
// moves it into drafts/posted/. Meant to run on the GitHub Actions cron.
import 'dotenv/config';
import { readdir, readFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishDraft } from './post.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEDULED_DIR = path.join(ROOT, 'scheduled');
const POSTED_DIR = path.join(ROOT, 'drafts', 'posted');

async function listDraftFolders(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

const folders = await listDraftFolders(SCHEDULED_DIR);
if (folders.length === 0) {
  console.log('Nothing scheduled.');
  process.exit(0);
}

const now = Date.now();

for (const name of folders) {
  const dir = path.join(SCHEDULED_DIR, name);
  let meta;
  try {
    meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'));
  } catch (err) {
    console.warn(`Skipping ${name}: unreadable meta.json (${err.message})`);
    continue;
  }

  const publishAt = meta.publishAt ? Date.parse(meta.publishAt) : now;
  if (Number.isNaN(publishAt) || publishAt > now) {
    console.log(`Not due yet: ${name} (publishAt=${meta.publishAt})`);
    continue;
  }

  console.log(`Publishing due draft: ${name}`);
  try {
    await publishDraft(dir);
    await mkdir(POSTED_DIR, { recursive: true });
    await rename(dir, path.join(POSTED_DIR, `${name}-${now}`));
  } catch (err) {
    console.error(`Failed to publish ${name}: ${err.message}`);
  }
}
