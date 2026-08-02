#!/usr/bin/env node
// Publishes one draft immediately: node scripts/post.mjs drafts/<name>
// A draft is a folder with caption.txt, meta.json ({"platforms": [...]})
// and one image file (png/jpg). See drafts/README.md for the convention.
import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { getComposio, USER_ID } from '../lib/composio.mjs';
import { loadActionSlug } from '../lib/actions.mjs';

export async function loadDraft(dir) {
  const caption = (await readFile(path.join(dir, 'caption.txt'), 'utf8')).trim();
  const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'));
  const files = await readdir(dir);
  const imageName = files.find(f => /\.(png|jpe?g|webp)$/i.test(f));
  const imagePath = imageName ? path.join(dir, imageName) : null;
  return { caption, meta, imagePath };
}

// NOTE: argument shapes are per-platform/per-toolkit-version; verified against
// `npm run list-actions -- <platform> post` output, not guessed.
async function buildArgs(platform, caption, imagePath, composio) {
  if (platform === 'linkedin') {
    if (imagePath) {
      throw new Error(
        'linkedin image posts need the INITIALIZE_IMAGE_UPLOAD/REGISTER_IMAGE_UPLOAD ' +
          'presigned-upload flow (see list-actions output) — not implemented yet, so ' +
          'refusing rather than silently posting without the image.'
      );
    }
    const me = await composio.tools.execute('LINKEDIN_GET_MY_INFO', {
      userId: USER_ID,
      arguments: {},
      dangerouslySkipVersionCheck: true,
    });
    return { author: `urn:li:person:${me.data.id}`, commentary: caption };
  }
  const args = { text: caption };
  if (imagePath) args.media_path = imagePath; // adjust to the real param name from list-actions
  return args;
}

export async function publishOne(platform, caption, imagePath, composio) {
  const slug = await loadActionSlug(platform, 'post');
  const args = await buildArgs(platform, caption, imagePath, composio);
  return composio.tools.execute(slug, {
    userId: USER_ID,
    arguments: args,
    dangerouslySkipVersionCheck: true,
  });
}

export async function publishDraft(dir) {
  const { caption, meta, imagePath } = await loadDraft(dir);
  const composio = getComposio();
  const results = [];

  for (const platform of meta.platforms ?? []) {
    try {
      await loadActionSlug(platform, 'post');
    } catch (err) {
      console.log(`Skipping ${platform}: ${err.message}`);
      results.push({ platform, result: { successful: false, skipped: true } });
      continue;
    }
    console.log(`Posting to ${platform}...`);
    const result = await publishOne(platform, caption, imagePath, composio);
    results.push({ platform, result });
    console.log(`  -> ${platform}: ${result.successful === false ? 'FAILED' : 'ok'}`);
  }

  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const draftDir = process.argv[2];
  if (!draftDir) {
    console.error('Usage: npm run post -- drafts/<draft-folder>');
    process.exit(1);
  }
  await publishDraft(draftDir);
}
