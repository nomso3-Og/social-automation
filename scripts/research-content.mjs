#!/usr/bin/env node
// Writes an original, reference-style LinkedIn post about a rotating GRC/IT
// topic using Gemini's free tier, into pending-posts/ for approval. Nothing
// publishes automatically — see send-content.mjs. Runs at most once per
// config/content-topics.json's cadenceHours, tracked in state/content-gen.json.
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState, writeState } from '../lib/state.mjs';
import { STYLE_RULES, findStyleViolations } from '../lib/style.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PENDING_DIR = path.join(ROOT, 'pending-posts');
const TOPICS_DIR = path.join(ROOT, 'topics');

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

// A researched brief in topics/ beats the generic rotating list: it carries
// real, checkable facts and real source URLs, so the post can say something
// specific instead of restating what the model already knew. Live search
// grounding is quota-limited on the free tier, so this is where currency
// actually comes from.
async function nextBrief() {
  let files;
  try {
    files = (await readdir(TOPICS_DIR)).filter(f => f.endsWith('.json')).sort();
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const used = new Set((await readState('topics-used', { used: [] })).used);
  const next = files.find(f => !used.has(f));
  if (!next) return null;

  const brief = JSON.parse(await readFile(path.join(TOPICS_DIR, next), 'utf8'));
  return { file: next, brief };
}

const picked = await nextBrief();
const topic = picked ? picked.brief.title : config.topics[state.topicIndex % config.topics.length];

if (picked) {
  console.log(`Writing from topics/${picked.file}: ${topic}`);
} else {
  console.log(`No unused briefs in topics/, falling back to the generic list: ${topic}`);
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });

const systemInstruction = `You write LinkedIn posts for a GRC (Governance,
Risk, Compliance) analyst who also works in IT.

Search the web for what's currently being discussed on the given topic, then
write one post about something specific and current you found: a change to a
framework, a recurring finding, a shift in what auditors are asking for.
Prefer a concrete development over a general explainer. Open with a line that
tells the reader what this is about.

Base the post on what the search actually returned. Do not state anything you
could not find. If the search turns up nothing current worth writing about,
say so plainly in one sentence instead of padding it out.

Do not put URLs in the post. Sources are attached separately, and a link you
type from memory is likely to be wrong.

Length: 100 to 250 words. At most 2 or 3 hashtags at the end.

${STYLE_RULES}`;

// Used when a researched brief is available. The brief's key points are the
// only facts in play, so no search is needed and nothing has to be recalled.
const BRIEF_INSTRUCTION = `You write LinkedIn posts for a GRC (Governance,
Risk, Compliance) analyst who also works in IT support.

You'll get a researched brief: an angle and a set of key points. Write one
post from it. Open with a line that tells the reader what this is about, then
make the point the angle is driving at.

The key points are the only facts you have. Use them and nothing else. Do not
add statistics, dates, framework versions, company names, or claims that
aren't in the brief, and do not soften a specific number into a vague one. You
don't have to use every point; pick the ones that make the strongest post.

Write it as someone who works in this field talking to peers, not as a summary
of an article. The reader should get something they can act on or argue with.

Do not put URLs in the post. Sources are attached to the draft separately.

Length: 100 to 250 words. At most 2 or 3 hashtags at the end.

${STYLE_RULES}`;

// Used when search grounding isn't available. Deliberately does not ask for
// anything current: with no search, "recent" claims would be invented.
const UNGROUNDED_INSTRUCTION = `You write LinkedIn posts for a GRC
(Governance, Risk, Compliance) analyst who also works in IT. Write one
educational post on the given topic that shares something practically useful:
a short breakdown, the handful of things that actually matter, or the part
people get wrong. Open with a line that tells the reader what this is about.

You have no web access for this. Write only durable, well-established
material. Do not reference recent news, this year's changes, current trends,
or anything time-sensitive, and do not cite sources or include URLs, because
you cannot verify any of it.

Length: 100 to 250 words. At most 2 or 3 hashtags at the end.

${STYLE_RULES}`;

// Google Search grounding has its own free-tier quota, far smaller than the
// one for ordinary generation: a plain call can succeed while the grounded
// call returns 429. Without a fallback the writer would retry the grounded
// call forever and never produce anything, which is worse than the evergreen
// posts it used to write.
//
// So: try grounded, and if only the grounding is unavailable, write the post
// ungrounded and label it. A flagged evergreen post beats silence, and the
// approval issue makes clear which one you're reading.
let response;

if (picked) {
  // A brief already carries researched facts and real sources, so there's
  // nothing to search for and no quota to spend.
  const b = picked.brief;
  const prompt = [
    `Topic: ${b.title}`,
    b.angle ? `Angle: ${b.angle}` : null,
    'Key points:',
    ...(b.keyPoints ?? []).map(p => `- ${p}`),
  ]
    .filter(Boolean)
    .join('\n');

  try {
    response = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: prompt,
      config: { systemInstruction: BRIEF_INSTRUCTION },
    });
  } catch (err) {
    console.error(`Content generation unavailable this run: ${err.message?.slice(0, 160) ?? err}`);
    process.exit(0);
  }
} else {
  // No brief left. Try live search, and fall back to writing without it.
  // Google Search grounding has its own free-tier quota, far smaller than the
  // one for ordinary generation: a plain call can succeed while the grounded
  // call returns 429. Without the fallback the writer would retry forever and
  // never produce anything.
  try {
    response = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: `Topic: ${topic}`,
      config: { systemInstruction, tools: [{ googleSearch: {} }] },
    });
  } catch (err) {
    console.warn(`  search grounding unavailable (${err?.status ?? 'error'}), falling back to no search`);
    try {
      response = await ai.models.generateContent({
        model: 'gemini-flash-latest',
        contents: `Topic: ${topic}`,
        config: { systemInstruction: UNGROUNDED_INSTRUCTION },
      });
    } catch (err2) {
      // Both paths gone: quota spent or the API is down. Exiting non-zero
      // would fail the step and take the rest of the cron run with it. State
      // is left untouched, so the next run retries this same topic.
      console.error(`Content generation unavailable this run: ${err2.message?.slice(0, 160) ?? err2}`);
      process.exit(0);
    }
  }
}

const postText = response.text?.trim();
if (!postText) {
  console.error('No text in response; leaving state untouched to retry next run.');
  process.exit(0);
}

// Sources never come from the model's own text. When a brief was used they're
// the URLs a human put in it; otherwise they're the pages the search tool
// actually returned. A model asked to cite will invent plausible-looking
// links, so neither path lets it write its own.
const grounding = response.candidates?.[0]?.groundingMetadata;
const searchQueries = grounding?.webSearchQueries ?? [];

const sources = picked
  ? (picked.brief.sources ?? []).filter(s => s?.url)
  : (grounding?.groundingChunks ?? [])
      .map(c => c.web)
      .filter(w => w?.uri)
      .map(w => ({ title: w.title ?? w.uri, url: w.uri }));

if (picked) {
  console.log(`  written from a researched brief, ${sources.length} source(s)`);
} else if (sources.length === 0) {
  console.warn('  NOT GROUNDED: no brief and no search sources, this is model recall');
} else {
  console.log(`  grounded in ${sources.length} source(s) from ${searchQueries.length} search(es)`);
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
    {
      platform: 'linkedin',
      topic,
      text: postText,
      approved: false,
      styleFlags,
      grounded: sources.length > 0,
      briefFile: picked ? `topics/${picked.file}` : null,
      searchQueries,
      sources,
    },
    null,
    2
  ) + '\n'
);
console.log(`Drafted pending-posts/${fileName}`);

// Recorded only after the draft is safely written, so a failure mid-run
// doesn't burn a brief without producing anything.
if (picked) {
  const used = await readState('topics-used', { used: [] });
  await writeState('topics-used', { used: [...used.used, picked.file] });
}

await writeState('content-gen', { lastGeneratedAt: now, topicIndex: state.topicIndex + 1 });
