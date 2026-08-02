#!/usr/bin/env node
// Prints the real tool slugs available for a platform's toolkit, so you can
// fill in config/actions.config.json instead of guessing slug names.
import 'dotenv/config';
import { getComposio, USER_ID } from '../lib/composio.mjs';
import { loadPlatforms } from '../lib/actions.mjs';

const platformArg = process.argv[2];
const search = process.argv[3]; // optional keyword, e.g. "post" or "mention"
const platforms = await loadPlatforms();

if (!platformArg || !platforms[platformArg]) {
  console.error('Usage: npm run list-actions -- <platform> [search-keyword]');
  console.error(`Known platforms: ${Object.keys(platforms).join(', ')}`);
  process.exit(1);
}

const { toolkit } = platforms[platformArg];
const composio = getComposio();

const filters = { toolkits: [toolkit], limit: 50 };
if (search) filters.search = search;

const tools = await composio.tools.get(USER_ID, filters);
const list = Array.isArray(tools) ? tools : (tools.tools ?? []);

if (list.length === 0) {
  console.log(`No tools found for toolkit "${toolkit}"${search ? ` matching "${search}"` : ''}.`);
  process.exit(0);
}

for (const tool of list) {
  const fn = tool.function ?? tool;
  const slug = fn.name ?? tool.slug ?? '(unknown slug)';
  const description = fn.description ?? tool.description ?? '';
  console.log(`${slug}\n  ${description}\n`);
}
