import { Composio } from '@composio/core';

let client;

export function getComposio() {
  if (!client) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
      throw new Error('COMPOSIO_API_KEY is not set. Copy .env.example to .env and fill it in (see README.md).');
    }
    client = new Composio({ apiKey });
  }
  return client;
}

export const USER_ID = process.env.COMPOSIO_USER_ID || 'default';
