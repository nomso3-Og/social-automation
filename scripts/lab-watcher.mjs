#!/usr/bin/env node
// Watches the repos in config/lab-watch.json for new commits and turns each
// new one into an auto-post: writes a scheduled/ draft with publishAt=now,
// which schedule-run.mjs picks up on the same or next cron tick. This is the
// "post it when I finish a lab" path — it posts without approval by design.
// To add a review buffer, set a future publishAt below, or delete the
// scheduled/ folder before the next cron run.
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState, writeState } from '../lib/state.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEDULED_DIR = path.join(ROOT, 'scheduled');

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.warn('GITHUB_TOKEN not set — reading public repo data unauthenticated (low rate limit).');
}

async function githubGet(url) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'social-automation-lab-watcher',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`);
  return res.json();
}

function fillTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
}

const { repos } = JSON.parse(
  await (await import('node:fs/promises')).readFile(path.join(ROOT, 'config', 'lab-watch.json'), 'utf8')
);

for (const watch of repos) {
  const { owner, repo, branch = 'main', path: subPath, platforms, captionTemplate } = watch;
  const stateKey = `lab-watch-${owner}-${repo}`;

  try {
    const state = await readState(stateKey, { lastSha: null });

    console.log(`Checking ${owner}/${repo}@${branch}...`);
    const params = new URLSearchParams({ sha: branch, per_page: '5' });
    if (subPath) params.set('path', subPath);
    const commits = await githubGet(`https://api.github.com/repos/${owner}/${repo}/commits?${params}`);

    if (!Array.isArray(commits) || commits.length === 0) {
      console.log('  no commits found');
      continue;
    }

    const latest = commits[0];
    if (latest.sha === state.lastSha) {
      console.log('  nothing new');
      continue;
    }

    // First run for this repo: record the current HEAD as the baseline and
    // post nothing. Without this, adding a repo to lab-watch.json backfills
    // whatever commit happens to be latest — auto-posting an old commit to a
    // live account with no approval step. Watchers should start from "now".
    if (state.lastSha === null) {
      console.log(`  first run — baseline set to ${latest.sha.slice(0, 7)}, not posting`);
      await writeState(stateKey, { lastSha: latest.sha });
      continue;
    }

    const title = latest.commit.message.split('\n')[0];
    const caption = fillTemplate(captionTemplate ?? '{title}\n\n{url}', {
      title,
      summary: latest.commit.message.split('\n').slice(1).join(' ').trim(),
      url: latest.html_url,
    });

    const folderName = `lab-${owner}-${repo}-${latest.sha.slice(0, 7)}`;
    const dir = path.join(SCHEDULED_DIR, folderName);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'caption.txt'), caption + '\n');
    await writeFile(
      path.join(dir, 'meta.json'),
      JSON.stringify({ platforms, publishAt: new Date().toISOString(), source: latest.html_url }, null, 2) + '\n'
    );

    console.log(`  new commit ${latest.sha.slice(0, 7)} -> scheduled/${folderName}`);
    await writeState(stateKey, { lastSha: latest.sha });
  } catch (err) {
    // One misconfigured/inaccessible watched repo (wrong name, private repo
    // without LAB_WATCH_TOKEN, etc.) must not take down the rest of the cron
    // run — schedule-run/mentions/send-replies/research-content/send-content
    // all run as later steps in the same job and have nothing to do with
    // this specific repo.
    console.error(`  skipping ${owner}/${repo}: ${err.message}`);
  }
}
