import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

// Moves a sent pending-*/*.json into pending-*/posted/, stamped with when it
// went out, instead of deleting it — keeps a browsable history of what the
// automation actually published.
// `record` lets the caller pass an already-updated copy (e.g. with a rewritten
// imagePath after the media file moved). Omit it to archive what's on disk.
export async function archivePosted(dir, file, filePath, record = null) {
  const postedDir = path.join(dir, 'posted');
  await mkdir(postedDir, { recursive: true });
  record = record ?? JSON.parse(await readFile(filePath, 'utf8'));
  record.postedAt = new Date().toISOString();
  await writeFile(path.join(postedDir, file), JSON.stringify(record, null, 2) + '\n');
  await unlink(filePath);
}
