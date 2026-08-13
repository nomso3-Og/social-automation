import { Composio } from '@composio/core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let client;

export function getComposio() {
  if (!client) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
      throw new Error('COMPOSIO_API_KEY is not set. Copy .env.example to .env and fill it in (see README.md).');
    }
    client = new Composio({
      apiKey,
      // LinkedIn's post tool takes `images` as file-uploadable params: the SDK
      // stages a local path to S3 and hands LinkedIn the reference. Without
      // this the path is passed through as a literal string and the image is
      // silently dropped.
      //
      // The allowlist is narrowed to this repo. The default is the home
      // directory, which is more of the filesystem than a posting script has
      // any business reading, and every image this repo posts is generated
      // into pending-posts/media or sits in a draft folder.
      dangerouslyAllowAutoUploadDownloadFiles: true,
      fileUploadDirs: [ROOT],
    });
  }
  return client;
}

export const USER_ID = process.env.COMPOSIO_USER_ID || 'default';
