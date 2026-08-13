#!/usr/bin/env node
// Renders a brief's summary card to a file so you can look at it before it
// ever reaches a post: npm run preview-card -- topics/007-nist-csf-govern.json
//
// Exists because the card is the one part of the pipeline you can't judge from
// JSON. Layout problems (an overflowing headline, a point cut mid-clause) are
// obvious in the image and invisible in the draft.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCardPng, measureCard } from '../lib/summary-card.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'card-previews');

let targets = process.argv.slice(2);

// No arguments: render every brief, which is the useful default after editing
// the card layout.
if (targets.length === 0) {
  const files = (await readdir(path.join(ROOT, 'topics'))).filter(f => f.endsWith('.json'));
  targets = files.map(f => path.join('topics', f));
  console.log(`No file given, rendering all ${targets.length} briefs.\n`);
}

await mkdir(OUT_DIR, { recursive: true });
let failed = 0;

for (const target of targets) {
  const rel = path.isAbsolute(target) ? target : path.join(ROOT, target);
  try {
    const brief = JSON.parse(await readFile(rel, 'utf8'));
    const spec = {
      eyebrow: brief.eyebrow ?? 'GRC',
      title: brief.title,
      points: brief.keyPoints ?? [],
      footer: 'GRC and IT support notes',
    };
    const measured = measureCard(spec);
    const png = renderCardPng(spec);
    const out = path.join(OUT_DIR, path.basename(target).replace(/\.json$/, '.png'));
    await writeFile(out, png);
    console.log(
      `${path.basename(target).padEnd(38)} ${measured.pointsUsed} points, ` +
        `${Math.round(measured.height)}/${measured.max}px${measured.fits ? '' : '  OVERFLOWS'} -> ` +
        path.relative(ROOT, out)
    );
    if (!measured.fits) failed++;
  } catch (err) {
    console.error(`${path.basename(target)}: ${err.message?.slice(0, 160) ?? err}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} card(s) had problems.`);
  process.exit(1);
}
