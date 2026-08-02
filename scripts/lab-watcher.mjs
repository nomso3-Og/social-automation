#!/usr/bin/env node
// Watches the repos in config/lab-watch.json for new commits and drafts a
// post about each one into pending-posts/, behind the same approval gate as
// everything else.
//
// This used to auto-publish: it wrote straight to scheduled/ with
// publishAt=now, using the raw commit message as the caption. That produced
// posts nobody would want on a profile ("fix: typo in readme") and, for a
// private repo, a link every reader gets a 404 on. Commits are a trigger
// worth keeping; the commit message is not the post.
//
// The repo link is only included when the repo is actually public.
import 'dotenv/config';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { readState, writeState } from '../lib/state.mjs';
import { STYLE_RULES, findStyleViolations } from '../lib/style.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PENDING_DIR = path.join(ROOT, 'pending-posts');

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
  await readFile(path.join(ROOT, 'config', 'lab-watch.json'), 'utf8')
);

const geminiKey = process.env.GEMINI_API_KEY;
const ai = geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : null;

const systemInstruction = `You write LinkedIn posts for a GRC (Governance,
Risk, Compliance) analyst who also works in IT. You'll get a commit message
from a project they're building. Write a short post about what they worked on.

The commit message is the only thing you know. Do not invent tools, metrics,
architecture, or motivations that aren't in it. If the commit is small or
routine, write something brief and matter-of-fact rather than inflating it
into a milestone. A modest, honest post beats a grand one built on nothing.

Length: 60 to 150 words. At most 2 hashtags.

${STYLE_RULES}`;

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
    // draft nothing. Without this, adding a repo to lab-watch.json backfills
    // whatever commit happens to be latest. Watchers should start from "now".
    if (state.lastSha === null) {
      console.log(`  first run — baseline set to ${latest.sha.slice(0, 7)}, not drafting`);
      await writeState(stateKey, { lastSha: latest.sha });
      continue;
    }

    // Only link a repo readers can actually open.
    let isPublic = false;
    try {
      const meta = await githubGet(`https://api.github.com/repos/${owner}/${repo}`);
      isPublic = meta.private === false;
    } catch {
      console.warn('  could not determine repo visibility, omitting the link');
    }

    const title = latest.commit.message.split('\n')[0];
    const bodyText = latest.commit.message.split('\n').slice(1).join(' ').trim();
    const url = isPublic ? latest.html_url : null;

    let postText = null;

    if (ai) {
      try {
        const prompt = [
          `Repository: ${owner}/${repo}`,
          `Commit: ${title}`,
          bodyText ? `Details: ${bodyText}` : null,
          url ? `Link to include at the end: ${url}` : 'Do not include any link.',
        ]
          .filter(Boolean)
          .join('\n');

        const response = await ai.models.generateContent({
          model: 'gemini-flash-latest',
          contents: prompt,
          config: { systemInstruction },
        });
        postText = response.text?.trim() || null;
      } catch (err) {
        console.warn(`  couldn't write a post: ${err.message?.slice(0, 120) ?? err}`);
      }
    }

    // Falls back to the configured template so a missing/failing Gemini key
    // still produces something reviewable, rather than dropping the commit.
    if (!postText) {
      postText = fillTemplate(captionTemplate ?? '{title}\n\n{url}', {
        title,
        summary: bodyText,
        url: url ?? '',
      }).trim();
      console.log('  used the caption template');
    }

    const styleFlags = findStyleViolations(postText);
    if (styleFlags.length > 0) console.warn(`  style flags: ${styleFlags.join('; ')}`);

    await mkdir(PENDING_DIR, { recursive: true });
    const fileName = `lab-${owner}-${repo}-${latest.sha.slice(0, 7)}.json`;
    await writeFile(
      path.join(PENDING_DIR, fileName),
      JSON.stringify(
        {
          platform: platforms?.[0] ?? 'linkedin',
          source: `${owner}/${repo}@${latest.sha.slice(0, 7)}`,
          text: postText,
          approved: false,
          styleFlags,
        },
        null,
        2
      ) + '\n'
    );

    console.log(`  new commit ${latest.sha.slice(0, 7)} -> pending-posts/${fileName}`);
    await writeState(stateKey, { lastSha: latest.sha });
  } catch (err) {
    // One misconfigured/inaccessible watched repo (wrong name, private repo
    // without LAB_WATCH_TOKEN, etc.) must not take down the rest of the cron
    // run — later steps have nothing to do with this specific repo.
    console.error(`  skipping ${owner}/${repo}: ${err.message}`);
  }
}
