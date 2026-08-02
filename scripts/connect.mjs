#!/usr/bin/env node
// Interactive, one-time-per-platform: creates (or reuses) a Composio-managed
// auth config for a toolkit, then walks you through the OAuth approval.
import 'dotenv/config';
import { getComposio, USER_ID } from '../lib/composio.mjs';
import { loadPlatforms } from '../lib/actions.mjs';

const platformArg = process.argv[2];
const platforms = await loadPlatforms();

if (!platformArg || !platforms[platformArg]) {
  console.error('Usage: npm run connect -- <platform>');
  console.error(`Known platforms: ${Object.keys(platforms).join(', ')}`);
  process.exit(1);
}

const { toolkit } = platforms[platformArg];
const composio = getComposio();

console.log(`Looking for an existing auth config for toolkit "${toolkit}"...`);
const existing = await composio.authConfigs.list({ toolkit });
let authConfigId = existing.items?.[0]?.id;

if (!authConfigId) {
  console.log(`None found. Creating a Composio-managed auth config for "${toolkit}"...`);
  const created = await composio.authConfigs.create(toolkit, { type: 'use_composio_managed_auth' });
  authConfigId = created.id;
}

console.log(`Requesting a connection link for user "${USER_ID}"...`);
const connectionRequest = await composio.connectedAccounts.link(USER_ID, authConfigId);

console.log('\nOpen this URL and approve access:\n');
console.log(connectionRequest.redirectUrl);
console.log('\nWaiting for you to finish (up to 3 minutes)...');

const account = await connectionRequest.waitForConnection(180_000);
console.log(`\nConnected: ${toolkit} -> account ${account.id} (status: ${account.status})`);
console.log('Next: npm run list-actions -- ' + platformArg);
