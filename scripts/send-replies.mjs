#!/usr/bin/env node
// Sends any pending-replies/*.json that a human has approved
// (approved: true and a non-empty replyText), then removes the file.
import 'dotenv/config';
import { readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getComposio, USER_ID } from '../lib/composio.mjs';
import { loadActionSlug } from '../lib/actions.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PENDING_DIR = path.join(ROOT, 'pending-replies');

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
  console.log('No pending replies.');
  process.exit(0);
}

for (const file of files) {
  const filePath = path.join(PENDING_DIR, file);
  const reply = JSON.parse(await readFile(filePath, 'utf8'));

  if (!reply.approved || !reply.replyText?.trim()) {
    console.log(`Not approved yet: ${file}`);
    continue;
  }

  const slug = await loadActionSlug(reply.platform, 'reply');
  console.log(`Sending reply for ${file} via ${slug}...`);

  // NOTE: adjust arg names to match the real tool schema from list-actions.
  await composio.tools.execute(slug, {
    userId: USER_ID,
    arguments: { text: reply.replyText, in_reply_to_id: reply.mentionId },
    dangerouslySkipVersionCheck: true,
  });

  await unlink(filePath);
  console.log(`  sent and removed ${file}`);
}
