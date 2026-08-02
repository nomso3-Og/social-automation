#!/usr/bin/env node
// Reads replies on the approval issues opened by request-approval.mjs and
// acts on them: `approve` flips the draft's approved flag so send-content.mjs
// publishes it on the same run, `decline` deletes the draft.
//
// Only comments from the repo owner count. Anyone can comment on a public
// repo's issues, and a comment here causes a post to go out on the owner's
// real account, so the author check is the security boundary of this whole
// flow. Do not loosen it.
import 'dotenv/config';
import { readdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listOpenIssues, listComments, commentOnIssue, closeIssue } from '../lib/github.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PENDING_DIR = path.join(ROOT, 'pending-posts');
const LABEL = 'pending-approval';

const owner = process.env.GITHUB_REPOSITORY_OWNER;
if (!owner) {
  console.error('GITHUB_REPOSITORY_OWNER is not set; refusing to act on comments.');
  process.exit(0);
}

// Whole-word match so "approved the change" or "I'd decline this if..." in a
// longer note doesn't accidentally trigger. The decision has to be the
// comment, not a mention inside prose.
function decisionFrom(text) {
  const t = text.trim().toLowerCase().replace(/[.!\s]+$/, '');
  if (/^approve(d)?$/.test(t) || /^\/approve$/.test(t)) return 'approve';
  if (/^decline(d)?$/.test(t) || /^\/decline$/.test(t) || /^reject$/.test(t)) return 'decline';
  return null;
}

async function findDraftByIssue(issueNumber) {
  let files;
  try {
    files = (await readdir(PENDING_DIR)).filter(f => f.endsWith('.json'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  for (const file of files) {
    const filePath = path.join(PENDING_DIR, file);
    const draft = JSON.parse(await readFile(filePath, 'utf8'));
    if (draft.issueNumber === issueNumber) return { file, filePath, draft };
  }
  return null;
}

let issues;
try {
  issues = await listOpenIssues(LABEL);
} catch (err) {
  console.error(`Couldn't list approval issues: ${err.message?.slice(0, 200) ?? err}`);
  process.exit(0);
}

if (!issues || issues.length === 0) {
  console.log('No open approval issues.');
  process.exit(0);
}

for (const issue of issues) {
  try {
    const comments = await listComments(issue.number);

    // Last decision wins, so changing your mind before the next run works.
    let decision = null;
    for (const c of comments) {
      if (c.user?.login?.toLowerCase() !== owner.toLowerCase()) continue;
      const d = decisionFrom(c.body ?? '');
      if (d) decision = d;
    }

    if (!decision) {
      console.log(`#${issue.number}: waiting on a reply`);
      continue;
    }

    const found = await findDraftByIssue(issue.number);
    if (!found) {
      console.log(`#${issue.number}: no matching draft left, closing`);
      await closeIssue(issue.number);
      continue;
    }

    if (decision === 'approve') {
      found.draft.approved = true;
      await writeFile(found.filePath, JSON.stringify(found.draft, null, 2) + '\n');
      console.log(`#${issue.number}: approved -> ${found.file}`);
      await commentOnIssue(issue.number, 'Approved. Publishing on this run.');
      await closeIssue(issue.number);
    } else {
      await unlink(found.filePath);
      console.log(`#${issue.number}: declined -> deleted ${found.file}`);
      await commentOnIssue(issue.number, 'Declined. Draft deleted, nothing was posted.');
      await closeIssue(issue.number);
    }
  } catch (err) {
    // One bad issue shouldn't stop the others or fail the run.
    console.error(`#${issue.number}: skipped, ${err.message?.slice(0, 200) ?? err}`);
  }
}
