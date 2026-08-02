#!/usr/bin/env node
// Publishes any pending-posts/*.json a human has approved (approved: true and
// a non-empty text), then removes the file. Nothing sends until you review
// research-content.mjs's draft, edit it if needed, and set "approved": true.
import 'dotenv/config';
import { readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getComposio } from '../lib/composio.mjs';
import { publishOne } from './post.mjs';

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
  const result = await publishOne(post.platform, post.text, null, composio);
  console.log(`  -> ${result.successful === false ? 'FAILED' : 'ok'}`);

  await unlink(filePath);
  console.log(`  removed ${file}`);
}
