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

  return problems;
}
