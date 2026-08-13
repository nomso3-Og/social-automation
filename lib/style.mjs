// Shared voice rules for every AI-written post in this repo, so
// research-content.mjs and homelab-watcher.mjs can't drift apart.
//
// These exist because generated copy kept reading as machine-written: em
// dashes everywhere, "in today's digital age" openers, and every sentence
// the same length. Each rule below is a specific tell, not a general
// aspiration.

export const BANNED_WORDS = [
  'delve',
  'testament',
  'tapestry',
  'revolutionize',
  'revolutionise',
  "in today's digital age",
  'in the digital age',
  'look no further',
  'furthermore',
  'moreover',
  'unlock the power',
  'game changer',
  'game-changer',
  'landscape of',
  'navigate the complexities',
  'ever-evolving',
  'seamless',
  'robust solution',
  'leverage synergies',
  'at the end of the day',
  'it is worth noting',
];

export const STYLE_RULES = `
VOICE
Write as a working GRC and IT practitioner, not a commentator. Ground it in
real friction: what breaks, what auditors actually ask for, what the
troubleshooting path looks like. Prefer a concrete detail over a general
claim.

BANNED WORDS AND PHRASES (never use any of these):
${BANNED_WORDS.map(w => `"${w}"`).join(', ')}.

PUNCTUATION
Never use an em dash (—), an en dash (–), or a double hyphen (--) anywhere.
Use a period, a comma, or start a new sentence instead. Do not use hyphens
as list markers.

SENTENCE RHYTHM
Vary sentence length hard. Put a short, blunt sentence next to a longer
technical one. Do not write paragraph after paragraph of same-length
sentences, which is the clearest sign a machine wrote it.

FORMATTING
No bolded label at the start of every line. No bullet list where every item
has identical grammatical shape. If you list things, let the items differ in
length and structure. Plain paragraphs are usually better than a list.

SUBJECT AND HASHTAGS
The audience is GRC and IT support practitioners. Hashtags must sit in that
world: GRC, compliance, risk, audit, ISO 27001, SOC 2, NIST, information
security, IT support, service desk, ITIL. Do not use developer-culture or
startup tags, specifically #BuildInPublic, #DevOps, #100DaysOfCode,
#coding, #webdev, #startup, or #indiehacker. If a genuinely fitting tag
doesn't exist, use none.

Never bolt a compliance angle onto something that isn't one. If the material
is ordinary engineering work, write about it plainly or don't write about it,
but do not reach for an imagined auditor to make it sound relevant.

CLOSING QUESTION
End with one question, on its own line, just before the hashtags.

It has to be answerable from the reader's own working experience, and it has
to be about the specific thing the post just discussed. Ask about their
situation, not their opinion of your post. "How long does a user access
review actually take your team?" works. "What are your thoughts on access
reviews?" does not, because nobody has a thought to offer, they have a
Tuesday afternoon they lost to it.

Never use these or anything like them: "What are your thoughts?",
"Thoughts?", "What do you think?", "What's your experience?", "Agree?",
"Am I wrong?", "Let me know in the comments", "Drop a comment below",
"Sound off below". They are engagement bait, everyone recognises them, and
they get scrolled past.

One question only. Do not stack two, and do not follow the question with a
sentence that answers it for the reader.

HONESTY
Do not invent statistics, dates, percentages, company names, or sources. If
you are not confident a specific number is correct, describe it
qualitatively or leave it out. Never imply you did something you did not do.

OUTPUT
Return only the post text. No preamble, no "Here is a post:", no surrounding
quotes, no markdown code fences.
`.trim();

// Cheap post-generation check for the rules a model most often ignores.
// Returns an array of human-readable problems; empty means it looks clean.
export function findStyleViolations(text) {
  const problems = [];
  const lower = text.toLowerCase();

  for (const word of BANNED_WORDS) {
    if (lower.includes(word.toLowerCase())) problems.push(`banned phrase: "${word}"`);
  }
  if (/[—–]/.test(text)) problems.push('contains an em dash or en dash');
  if (/(^|\s)--(\s|$)/.test(text)) problems.push('contains a double hyphen');
  if (/^\s*[-*]\s+/m.test(text)) problems.push('uses hyphen/asterisk list markers');
  if (/```/.test(text)) problems.push('contains a markdown code fence');

  // Off-field hashtags. These kept appearing on posts for a GRC and IT
  // support audience, where they read as borrowed from a different career.
  const OFF_TOPIC_TAGS = [
    'buildinpublic', 'devops', '100daysofcode', 'coding', 'webdev',
    'startup', 'indiehacker', 'frontend', 'javascript', 'react',
  ];
  for (const tag of text.match(/#[A-Za-z0-9_]+/g) ?? []) {
    if (OFF_TOPIC_TAGS.includes(tag.slice(1).toLowerCase())) {
      problems.push(`off-topic hashtag: ${tag}`);
    }
  }

  // Closing question. The point of asking one is to start a conversation with
  // someone who does this work, which the stock prompts below never do: they
  // ask for an opinion on the post rather than a fact about the reader's job,
  // so they read as engagement bait and get scrolled past.
  const bait = [
    'what are your thoughts',
    'what do you think',
    "what's your experience",
    'what is your experience',
    'let me know in the comments',
    'drop a comment',
    'comment below',
    'sound off',
    'agree?',
    'am i wrong',
    'thoughts?',
  ];
  const hit = bait.find(p => lower.includes(p));
  if (hit) problems.push(`generic engagement bait: "${hit}"`);

  // Ignore the hashtag block when looking for the question, so a post that
  // ends "...? #GRC #SOC2" still counts as asking one.
  const withoutTags = text.replace(/(^|\s)#[A-Za-z0-9_]+[?!.]*/g, '').trim();
  if (!withoutTags.includes('?')) problems.push('no closing question');

  return problems;
}
