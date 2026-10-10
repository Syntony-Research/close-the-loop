#!/usr/bin/env node
// Trusted harness. Candidate inputs are JSON DATA ONLY; never import candidate files.
import { constants } from 'node:fs';
import { lstat, realpath, readdir, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePack } from '../src/engine.mjs';
import { validateArenaPack } from '../src/arena-world.mjs';

export const LIMITS = Object.freeze({ files: 100, fileBytes: 128 * 1024, totalBytes: 2 * 1024 * 1024 });
export async function replayDirectory(directory) {
  const requested = resolve(directory);
  const rootInfo = await lstat(requested);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Submissions must be a real directory, not a symlink.');
  const root = await realpath(requested);
  const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length > LIMITS.files + 1) throw new Error('Too many submission files.');
  const results = [];
  let totalBytes = 0;
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Submissions cannot contain symlinks, directories, or special files.');
    if (entry.name === 'README.md') continue;
    if (!/^[a-z0-9][a-z0-9_-]{0,75}\.json$/.test(entry.name)) throw new Error('Use lowercase letters, numbers, underscores, and hyphens for JSON submission filenames.');
    const target = join(root, entry.name);
    if (await realpath(target) !== target) throw new Error('Submission path escaped the data directory.');
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > LIMITS.fileBytes) throw new Error('Submission is not a regular file or exceeds 128 KiB.');
      totalBytes += info.size;
      if (totalBytes > LIMITS.totalBytes) throw new Error('Submissions exceed the 2 MiB combined limit.');
      // Fixed-size bounded read also protects against a file growing after stat().
      const bytes = Buffer.alloc(LIMITS.fileBytes + 1);
      let count = 0;
      while (count < bytes.length) {
        const read = await handle.read(bytes, count, bytes.length - count, count);
        if (!read.bytesRead) break;
        count += read.bytesRead;
      }
      if (count > LIMITS.fileBytes) throw new Error('Submission exceeds 128 KiB.');
      let pack;
      try { pack = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count))); }
      catch { results.push({ file: entry.name, errors: ['Invalid UTF-8 JSON.'] }); continue; }
      const isArena = pack?.schemaVersion === 'arena-1.0.0';
      const errors = isArena ? validateArenaPack(pack) : validatePack(pack);
      results.push({ file: entry.name, errors, ...(isArena
        ? { format: 'arena-1.0.0' }
        : errors.length === 0 ? { technicalScore: pack.evidence.technicalScore, completenessScore: pack.governance.completenessScore } : {}) });
    } finally { await handle.close(); }
  }
  if (!results.length) throw new Error('No JSON submissions found.');
  if (results.length > LIMITS.files) throw new Error('Too many submission files.');
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--submissions') throw new Error('Usage: node scripts/replay.mjs --submissions ./submissions');
  const results = await replayDirectory(args[1]);
  for (const result of results) {
    const summary = result.format === 'arena-1.0.0'
      ? 'arena world replay matched; model provenance is not authenticated'
      : `technical ${result.technicalScore}/80; governance completeness ${result.completenessScore}/20`;
    console.log(`${result.errors.length ? 'FAIL' : 'PASS'} ${result.file}: ${result.errors.length ? result.errors.join(' ') : summary}`);
  }
  console.log('CI recomputes synthetic world outcomes from submitted data. It does not rerun or authenticate a language model. Humans review decisions; this is not an official ranking or security certification.');
  if (results.some(result => result.errors.length)) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Replay failed: ${error.message}`); process.exitCode = 1; });
}
