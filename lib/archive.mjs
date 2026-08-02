import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

// Moves a sent pending-*/*.json into pending-*/posted/, stamped with when it
// went out, instead of deleting it — keeps a browsable history of what the
// automation actually published.
export async function archivePosted(dir, file, filePath) {
  const postedDir = path.join(dir, 'posted');
  await mkdir(postedDir, { recursive: true });
  const record = JSON.parse(await readFile(filePath, 'utf8'));
  record.postedAt = new Date().toISOString();
  await writeFile(path.join(postedDir, file), JSON.stringify(record, null, 2) + '\n');
  await unlink(filePath);
}
