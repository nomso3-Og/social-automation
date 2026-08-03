#!/usr/bin/env node
// Opens a GitHub issue for any draft in pending-posts/ that doesn't have one
// yet, so approving a post is a phone notification and a one-word reply
// instead of editing JSON on github.com.
//
// The issue is assigned to the repo owner, which triggers a direct
// notification (GitHub mobile push + email) regardless of watch settings.
//
// The draft JSON stays the source of truth. The issue is only the approval
// surface; check-approvals.mjs reads replies back and flips the flag.
import 'dotenv/config';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIssue } from '../lib/github.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PENDING_DIR = path.join(ROOT, 'pending-posts');
const LABEL = 'pending-approval';

const owner = process.env.GITHUB_REPOSITORY_OWNER;

async function listDrafts() {
  try {
    return (await readdir(PENDING_DIR)).filter(f => f.endsWith('.json'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

const files = await listDrafts();
if (files.length === 0) {
  console.log('No drafts pending.');
  process.exit(0);
}

let opened = 0;

for (const file of files) {
  const filePath = path.join(PENDING_DIR, file);
  const draft = JSON.parse(await readFile(filePath, 'utf8'));

  if (draft.issueNumber) continue;
  if (draft.approved) continue; // already approved by hand, no need to ask

  const origin = draft.source ? `\`${draft.source}\`` : `topic: ${draft.topic ?? 'n/a'}`;
  const flags = draft.styleFlags?.length
    ? `\n\n**Style flags:** ${draft.styleFlags.join('; ')}`
    : '';

  // Written to read well inside GitHub's notification email, since replying
  // to that email is the intended way to use this. GitHub turns the reply
  // into a comment, and check-approvals reads the first line, so a signature
  // underneath is fine.
  const body = [
    '### Reply to this email with one word',
    '',
    '**`approve`** publishes it. **`decline`** throws it away.',
    'Nothing posts until you do.',
    '',
    `Drafted for **${draft.platform}** from ${origin}.`,
    '',
    '---',
    '',
    draft.text,
    '',
    '---',
    `${flags}`,
    '',
    '<sub>Want to change the wording first? Edit `text` in the draft file below,',
    'then reply `approve`. Replying from the GitHub app or the web works too.</sub>',
    '',
    `<sub>Draft file: \`pending-posts/${file}\`</sub>`,
  ].join('\n');

  try {
    const issue = await createIssue({
      title: `Approve post: ${(draft.topic ?? draft.source ?? file).slice(0, 60)}`,
      body,
      labels: [LABEL],
      assignees: owner ? [owner] : [],
    });

    draft.issueNumber = issue.number;
    await writeFile(filePath, JSON.stringify(draft, null, 2) + '\n');
    console.log(`Opened #${issue.number} for ${file}`);
    opened++;
  } catch (err) {
    // A failure here shouldn't take down the cron run. The draft keeps no
    // issueNumber, so the next run tries again.
    console.error(`  couldn't open an issue for ${file}: ${err.message?.slice(0, 200) ?? err}`);
  }
}

if (opened === 0) console.log('Every draft already has an approval issue.');
