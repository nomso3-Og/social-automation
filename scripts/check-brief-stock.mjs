#!/usr/bin/env node
// Opens a GitHub issue when topics/ is running out of unused research briefs,
// so restocking is a notification you receive rather than a date you have to
// remember.
//
// Why an issue and not a calendar reminder: the right moment to restock isn't
// a fixed date, it's whenever the queue gets short, and that moves with
// cadenceHours and with how many briefs you add at a time. This measures the
// actual queue every run.
//
// Deliberately quiet. One open issue at a time, closed automatically once the
// queue is healthy again, so a long dry spell doesn't produce a daily email.
import 'dotenv/config';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { readState } from '../lib/state.mjs';
import { createIssue, listOpenIssues, closeIssue, commentOnIssue } from '../lib/github.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'brief-stock';
const owner = process.env.GITHUB_REPOSITORY_OWNER;

const config = JSON.parse(
  await readFile(path.join(ROOT, 'config', 'content-topics.json'), 'utf8')
);
// `--dry-run` prints what it would do without touching GitHub, so the wording
// of a notification you'll receive by email can be checked before it's sent.
// `--threshold=N` overrides the configured trigger point for that check.
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const override = args.find(a => a.startsWith('--threshold='));

const threshold = override ? Number(override.split('=')[1]) : config.lowStockThreshold ?? 3;
const cadenceH = config.cadenceHours ?? 48;

let files = [];
try {
  files = (await readdir(path.join(ROOT, 'topics'))).filter(f => f.endsWith('.json'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const used = new Set((await readState('topics-used', { used: [] })).used);
const left = files.filter(f => !used.has(f)).sort();
const daysLeft = ((left.length * cadenceH) / 24).toFixed(1);

console.log(`${left.length} unused brief(s), ~${daysLeft} days of runway at ${cadenceH}h cadence.`);

let open = [];
try {
  open = dryRun ? [] : (await listOpenIssues(LABEL)) ?? [];
} catch (err) {
  // No token, rate limit, network. Not worth failing the run over: the next
  // tick re-checks, and the queue count is already logged above.
  console.error(`Couldn't read open issues: ${err.message?.slice(0, 160) ?? err}`);
  process.exit(0);
}

if (left.length > threshold) {
  // Restocked. Close the standing reminder rather than leaving a stale issue
  // that says the queue is empty when it isn't.
  for (const issue of open) {
    try {
      await commentOnIssue(
        issue.number,
        `Restocked: ${left.length} unused briefs now queued, about ${daysLeft} days of runway. Closing.`
      );
      await closeIssue(issue.number);
      console.log(`Closed #${issue.number} (queue is healthy again).`);
    } catch (err) {
      console.error(`  couldn't close #${issue.number}: ${err.message?.slice(0, 160) ?? err}`);
    }
  }
  process.exit(0);
}

if (open.length > 0) {
  console.log(`Already asked in #${open[0].number}, not opening another.`);
  process.exit(0);
}

const remaining = left.length
  ? left.map(f => `- \`topics/${f}\``).join('\n')
  : '_None. The writer is now falling back to live search, and then to the generic evergreen list._';

const body = [
  `### ${left.length} research brief${left.length === 1 ? '' : 's'} left`,
  '',
  `At the current cadence of one post every ${cadenceH} hours, that is about`,
  `**${daysLeft} days** before the queue runs dry.`,
  '',
  'Still queued:',
  '',
  remaining,
  '',
  '---',
  '',
  '**What happens if you do nothing:** posting continues, but quality drops.',
  'The writer falls back to live Google Search grounding, which is quota',
  'limited on the free tier and usually unavailable, and then to the generic',
  'topic list in `config/content-topics.json`. Those posts are evergreen and',
  'uncited rather than current and sourced.',
  '',
  '**To restock:** add one `.json` per topic under `topics/` and commit.',
  '`title`, `angle`, and `keyPoints` are the required fields; `sources` is',
  'optional but is what lets a post make a checkable factual claim. See',
  '`topics/README.md` for the shape, and any existing brief for an example.',
  '',
  `<sub>Opened automatically by \`check-brief-stock.mjs\` when unused briefs fell to ${threshold} or fewer.`,
  'It closes itself once the queue is topped up. Adjust the trigger point with',
  '`lowStockThreshold` in `config/content-topics.json`.</sub>',
].join('\n');

const title = `Research briefs running low: ${left.length} left (~${daysLeft} days)`;

if (dryRun) {
  console.log(`\n--- would open this issue (dry run) ---\n${title}\n\n${body}`);
  process.exit(0);
}

try {
  const issue = await createIssue({
    title,
    body,
    labels: [LABEL],
    assignees: owner ? [owner] : [],
  });
  console.log(`Opened #${issue.number}.`);
} catch (err) {
  console.error(`Couldn't open the restock issue: ${err.message?.slice(0, 200) ?? err}`);
}
