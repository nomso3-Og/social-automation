#!/usr/bin/env node
// Writes an original, reference-style LinkedIn post about a rotating GRC/IT
// topic using Gemini's free tier, into pending-posts/ for approval. Nothing
// publishes automatically — see send-content.mjs. Runs at most once per
// config/content-topics.json's cadenceHours, tracked in state/content-gen.json.
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState, writeState } from '../lib/state.mjs';
import { STYLE_RULES, findStyleViolations } from '../lib/style.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PENDING_DIR = path.join(ROOT, 'pending-posts');

const config = JSON.parse(
  await readFile(path.join(ROOT, 'config', 'content-topics.json'), 'utf8')
);
const state = await readState('content-gen', { lastGeneratedAt: null, topicIndex: 0 });

const cadenceMs = (config.cadenceHours ?? 24) * 60 * 60 * 1000;
const now = Date.now();
if (state.lastGeneratedAt && now - state.lastGeneratedAt < cadenceMs) {
  console.log('Not due yet for new content.');
  process.exit(0);
}

const topic = config.topics[state.topicIndex % config.topics.length];
console.log(`Writing about: ${topic}`);

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });

const systemInstruction = `You write LinkedIn posts for a GRC (Governance,
Risk, Compliance) analyst who also works in IT. Given a topic, write one
educational post that shares something practically useful: a short breakdown,
the handful of things that actually matter, or the part people get wrong.
Open with a line that tells the reader what this is about.

Length: 100 to 250 words. At most 2 or 3 hashtags at the end.

${STYLE_RULES}`;

let response;
try {
  response = await ai.models.generateContent({
    model: 'gemini-flash-latest',
    contents: `Topic: ${topic}`,
    config: { systemInstruction },
  });
} catch (err) {
  // Gemini's free tier returns a transient 503 under load. Exiting non-zero
  // would fail the workflow step and take down the rest of the cron run.
  // State is left untouched, so the next run retries this same topic.
  console.error(`Content generation unavailable this run: ${err.message?.slice(0, 200) ?? err}`);
  process.exit(0);
}

const postText = response.text?.trim();
if (!postText) {
  console.error('No text in response; leaving state untouched to retry next run.');
  process.exit(0);
}

// Surfaced in the draft file rather than auto-corrected: you're reviewing
// this before it publishes anyway, and a flagged draft is more useful than a
// silently reworded one.
const styleFlags = findStyleViolations(postText);
if (styleFlags.length > 0) {
  console.warn(`  style flags: ${styleFlags.join('; ')}`);
}

await mkdir(PENDING_DIR, { recursive: true });
const fileName = `linkedin-${now}.json`;
await writeFile(
  path.join(PENDING_DIR, fileName),
  JSON.stringify(
    { platform: 'linkedin', topic, text: postText, approved: false, styleFlags },
    null,
    2
  ) + '\n'
);
console.log(`Drafted pending-posts/${fileName}`);

await writeState('content-gen', { lastGeneratedAt: now, topicIndex: state.topicIndex + 1 });
