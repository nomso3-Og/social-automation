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

const systemInstruction =
  'You write LinkedIn posts for a GRC (Governance, Risk, Compliance) analyst ' +
  'who also works in IT. Given a topic, write one educational, reference-style ' +
  'post that shares practical knowledge (a checklist, a set of key concepts, or ' +
  'a short breakdown) the way InfoSec and compliance professionals share ' +
  'cheat-sheet-style posts. Rules: sound like a real person wrote it, plain ' +
  'direct sentences, contractions are fine, no corporate marketing language. ' +
  'Never use an em dash (—) or a double hyphen (--) anywhere in the text. ' +
  '100 to 250 words. At most 2-3 relevant hashtags at the end. Do not fabricate ' +
  'statistics, facts, or sources; only state what you are confident is accurate. ' +
  'Output ONLY the post text, nothing else (no preamble, no "Here is a post:").';

const response = await ai.models.generateContent({
  model: 'gemini-flash-latest',
  contents: `Topic: ${topic}`,
  config: { systemInstruction },
});

const postText = response.text?.trim();
if (!postText) {
  console.error('No text in response.');
  process.exit(1);
}

await mkdir(PENDING_DIR, { recursive: true });
const fileName = `linkedin-${now}.json`;
await writeFile(
  path.join(PENDING_DIR, fileName),
  JSON.stringify({ platform: 'linkedin', topic, text: postText, approved: false }, null, 2) + '\n'
);
console.log(`Drafted pending-posts/${fileName}`);

await writeState('content-gen', { lastGeneratedAt: now, topicIndex: state.topicIndex + 1 });
