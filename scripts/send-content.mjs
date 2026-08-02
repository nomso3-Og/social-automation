#!/usr/bin/env node
// Publishes any pending-posts/*.json a human has approved (approved: true and
// a non-empty text), then removes the file. Nothing sends until you review
// research-content.mjs's draft, edit it if needed, and set "approved": true.
import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getComposio } from '../lib/composio.mjs';
import { publishOne } from './post.mjs';
import { archivePosted } from '../lib/archive.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PENDING_DIR = path.join(ROOT, 'pending-posts');

async function listPending() {
  try {
    return (await readdir(PENDING_DIR)).filter(f => f.endsWith('.json'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

const composio = getComposio();
const files = await listPending();

if (files.length === 0) {
  console.log('No pending posts.');
  process.exit(0);
}

for (const file of files) {
  const filePath = path.join(PENDING_DIR, file);
  const post = JSON.parse(await readFile(filePath, 'utf8'));

  if (!post.approved || !post.text?.trim()) {
    console.log(`Not approved yet: ${file}`);
    continue;
  }

  console.log(`Publishing ${file} to ${post.platform}...`);

  let result;
  try {
    result = await publishOne(post.platform, post.text, null, composio);
  } catch (err) {
    // An unconfigured platform (slug still REPLACE_ME) or a transient API
    // failure must not crash the step and take the rest of the cron run with
    // it. The draft is left in place, still approved, to retry next run.
    console.error(`  skipping ${file}: ${err.message?.slice(0, 200) ?? err}`);
    continue;
  }

  console.log(`  -> ${result.successful === false ? 'FAILED' : 'ok'}`);

  await archivePosted(PENDING_DIR, file, filePath);
  console.log(`  archived to pending-posts/posted/${file}`);
}
