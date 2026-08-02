#!/usr/bin/env node
// Turns project/homelab write-ups in homelabs/*.md into story-driven
// portfolio posts, drafted into pending-posts/ for approval.
//
// Trigger: add a .md file to homelabs/ and commit it. The next cron run picks
// it up. (A local chokidar watcher would need a process running on your
// machine around the clock; this repo runs on GitHub Actions instead, so the
// commit is the event.)
//
// Files already turned into a draft are recorded in state/homelab-seen.json
// by content hash, so editing a write-up regenerates it and re-running
// changes nothing.
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState, writeState } from '../lib/state.mjs';
import { STYLE_RULES, findStyleViolations } from '../lib/style.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOMELABS_DIR = path.join(ROOT, 'homelabs');
const PENDING_DIR = path.join(ROOT, 'pending-posts');

async function listWriteups() {
  try {
    return (await readdir(HOMELABS_DIR)).filter(f => f.toLowerCase().endsWith('.md') && f !== 'README.md');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

const files = await listWriteups();
if (files.length === 0) {
  console.log('No homelab write-ups found.');
  process.exit(0);
}

const state = await readState('homelab-seen', { processed: {} });
const pending = [];

for (const file of files) {
  const raw = await readFile(path.join(HOMELABS_DIR, file), 'utf8');
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  if (state.processed[file] === hash) continue;
  pending.push({ file, raw, hash });
}

if (pending.length === 0) {
  console.log(`No new or edited write-ups (${files.length} already drafted).`);
  process.exit(0);
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });

const systemInstruction = `You turn a practitioner's raw project notes into a
LinkedIn portfolio post. The person built this themselves, so write in first
person about work they actually did.

Cover, in whatever order reads best: what problem the project solved, how it
was put together, the tools involved, and anything it says about governance,
risk, or compliance. Include real metrics or outcomes ONLY if they appear in
the notes.

The notes are the single source of truth. Do not add tools, results, numbers,
or architecture details that are not in them. If the notes are thin on a
point, write less rather than inventing it.

Open with the interesting part, not a throat-clearing intro. Length: 150 to
300 words. At most 2 or 3 hashtags at the end.

${STYLE_RULES}`;

await mkdir(PENDING_DIR, { recursive: true });

for (const { file, raw, hash } of pending) {
  console.log(`Writing post for homelabs/${file}...`);

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: `Project notes (file: ${file}):\n\n${raw}`,
      config: { systemInstruction },
    });

    const postText = response.text?.trim();
    if (!postText) {
      console.error(`  no text returned, leaving unprocessed to retry next run`);
      continue;
    }

    const styleFlags = findStyleViolations(postText);
    if (styleFlags.length > 0) console.warn(`  style flags: ${styleFlags.join('; ')}`);

    const slug = file.replace(/\.md$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const fileName = `homelab-${slug}-${Date.now()}.json`;
    await writeFile(
      path.join(PENDING_DIR, fileName),
      JSON.stringify(
        { platform: 'linkedin', source: `homelabs/${file}`, text: postText, approved: false, styleFlags },
        null,
        2
      ) + '\n'
    );
    console.log(`  drafted pending-posts/${fileName}`);

    // Recorded per file as we go, so a failure partway through doesn't force
    // already-drafted write-ups to be regenerated on the next run.
    state.processed[file] = hash;
    await writeState('homelab-seen', state);
  } catch (err) {
    // Gemini's free tier returns a transient 503 under load. Crashing here
    // would fail the workflow step and take down the rest of the cron run.
    // The file stays unprocessed, so the next run retries it.
    console.error(`  skipping ${file} this run: ${err.message?.slice(0, 200) ?? err}`);
  }
}
