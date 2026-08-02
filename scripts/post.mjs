#!/usr/bin/env node
// Publishes one draft immediately: node scripts/post.mjs drafts/<name>
// A draft is a folder with caption.txt, meta.json ({"platforms": [...]})
// and one image file (png/jpg). See drafts/README.md for the convention.
import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { getComposio, USER_ID } from '../lib/composio.mjs';
import { loadActionSlug } from '../lib/actions.mjs';

const draftDir = process.argv[2];
if (!draftDir) {
  console.error('Usage: npm run post -- drafts/<draft-folder>');
  process.exit(1);
}

export async function loadDraft(dir) {
  const caption = (await readFile(path.join(dir, 'caption.txt'), 'utf8')).trim();
  const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'));
  const files = await readdir(dir);
  const imageName = files.find(f => /\.(png|jpe?g|webp)$/i.test(f));
  const imagePath = imageName ? path.join(dir, imageName) : null;
  return { caption, meta, imagePath };
}

export async function publishDraft(dir) {
  const { caption, meta, imagePath } = await loadDraft(dir);
  const composio = getComposio();
  const results = [];

  for (const platform of meta.platforms ?? []) {
    const slug = await loadActionSlug(platform, 'post');
    console.log(`Posting to ${platform} (${slug})...`);
    const args = { text: caption };
    if (imagePath) args.media_path = imagePath; // adjust to the real param name from list-actions
    const result = await composio.tools.execute(slug, { userId: USER_ID, arguments: args });
    results.push({ platform, result });
    console.log(`  -> ${platform}: ${result.successful === false ? 'FAILED' : 'ok'}`);
  }

  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await publishDraft(draftDir);
}
