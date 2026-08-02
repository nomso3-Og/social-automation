#!/usr/bin/env node
// Polls each configured platform for new mentions and drafts a reply for
// approval — it never sends automatically. Review pending-replies/*.json,
// set "approved": true and fill in "replyText", then run
// `npm run send-replies` (or let the next cron tick do it).
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getComposio, USER_ID } from '../lib/composio.mjs';
import { loadPlatforms, loadActionSlug } from '../lib/actions.mjs';
import { readState, writeState } from '../lib/state.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PENDING_DIR = path.join(ROOT, 'pending-replies');

const composio = getComposio();
const platforms = await loadPlatforms();

for (const platform of Object.keys(platforms)) {
  let slug;
  try {
    slug = await loadActionSlug(platform, 'searchMentions');
  } catch {
    console.log(`Skipping ${platform}: no searchMentions slug configured yet.`);
    continue;
  }

  const stateKey = `mentions-${platform}`;
  const state = await readState(stateKey, { lastSeenId: null });

  console.log(`Checking mentions for ${platform}...`);
  // NOTE: the exact request/response shape depends on the real tool found via
  // `npm run list-actions -- ${platform} mention`. Adjust args/field names below
  // to match what that tool actually expects/returns.
  const result = await composio.tools.execute(slug, {
    userId: USER_ID,
    arguments: state.lastSeenId ? { since_id: state.lastSeenId } : {},
  });

  const mentions = result.data?.mentions ?? result.data?.items ?? result.data ?? [];
  if (!Array.isArray(mentions) || mentions.length === 0) {
    console.log(`  no new mentions`);
    continue;
  }

  await mkdir(PENDING_DIR, { recursive: true });

  let newestId = state.lastSeenId;
  for (const mention of mentions) {
    const id = mention.id ?? mention.mention_id ?? mention.tweet_id;
    if (!id) continue;
    const filePath = path.join(PENDING_DIR, `${platform}-${id}.json`);
    await writeFile(
      filePath,
      JSON.stringify(
        {
          platform,
          mentionId: id,
          author: mention.author ?? mention.username ?? null,
          text: mention.text ?? mention.content ?? null,
          url: mention.url ?? null,
          approved: false,
          replyText: '',
        },
        null,
        2
      ) + '\n'
    );
    console.log(`  drafted pending-replies/${platform}-${id}.json`);
    newestId = id;
  }

  await writeState(stateKey, { lastSeenId: newestId });
}
