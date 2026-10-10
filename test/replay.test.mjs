import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { replayDirectory, LIMITS } from '../scripts/replay.mjs';
import { makePack, SCENARIOS } from '../src/engine.mjs';
import { createWorld, applyRound, makeArenaPack } from '../src/arena-world.mjs';
const pack = makePack({ scenarioId:'support-refund', payload:SCENARIOS[0].defaultPayload, controlId:'approval' });
async function fixture(t) { const dir = await mkdtemp(join(tmpdir(), 'close-loop-')); t.after(() => rm(dir, {recursive:true,force:true})); return dir; }
test('replay accepts ordinary JSON data and recomputes all evidence', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'submission.json'), JSON.stringify(pack));
  const result = await replayDirectory(dir);
  assert.deepEqual(result[0].errors, []);
  assert.equal(result[0].technicalScore, 80);
});
test('replay rejects a symlinked submission', async t => {
  const dir = await fixture(t);
  await symlink('/etc/hosts', join(dir, 'submission.json'));
  await assert.rejects(replayDirectory(dir), /symlinks/);
});
test('replay rejects a symlinked directory', async t => {
  const dir = await fixture(t);
  await mkdir(join(dir, 'real'));
  await symlink(join(dir, 'real'), join(dir, 'linked'));
  await assert.rejects(replayDirectory(join(dir, 'linked')), /symlink/);
});
test('replay enforces byte limits', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'oversized.json'), ' '.repeat(LIMITS.fileBytes + 1));
  await assert.rejects(replayDirectory(dir), /128 KiB/);
});
test('replay rejects scripts rather than executing them', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'attack.mjs'), 'throw new Error("executed")');
  await assert.rejects(replayDirectory(dir), /JSON submission filenames/);
});
test('invalid JSON and forged outcomes cause replay errors', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'bad.json'), '{bad');
  await writeFile(join(dir, 'forged.json'), JSON.stringify({...pack, totalScore:1000}));
  const result = await replayDirectory(dir);
  assert.equal(result.length, 2);
  assert.ok(result.every(item => item.errors.length));
});

function practiceArena(campaignId = 'refunds') {
  let world = createWorld(campaignId);
  for (let round = 0; round < 3; round++) {
    world = applyRound(world, {
      proposal: world.nextRound.validProposal,
      controlId: 'boundary',
      attackText: 'Synthetic practice fixture; no model inference was performed.',
      source: 'practice',
      modelId: 'deterministic-practice',
    });
  }
  return makeArenaPack(world);
}

test('replay dispatches a mixed directory to the trusted arena and legacy validators', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'arena.json'), JSON.stringify(practiceArena()));
  await writeFile(join(dir, 'legacy.json'), JSON.stringify(pack));
  const results = await replayDirectory(dir);
  assert.equal(results.length, 2);
  assert.ok(results.every(result => result.errors.length === 0));
  assert.equal(results.find(result => result.file === 'arena.json').format, 'arena-1.0.0');
  assert.equal(results.find(result => result.file === 'legacy.json').technicalScore, 80);
  assert.equal(Object.hasOwn(results.find(result => result.file === 'arena.json'), 'technicalScore'), false);
});

test('arena replay rejects forged consequences rather than trusting a claimed model run', async t => {
  const dir = await fixture(t);
  const arena = practiceArena('evidence');
  arena.result.scores.attackSuccess = 1000;
  await writeFile(join(dir, 'arena-forged.json'), JSON.stringify(arena));
  const results = await replayDirectory(dir);
  assert.match(results[0].errors.join(' '), /trusted replay/);
});

test('arena replay rejects missing provenance and executable-looking proposal data', async t => {
  const dir = await fixture(t);
  const noNotice = practiceArena();
  delete noNotice.provenanceNotice;
  const codeProposal = practiceArena();
  codeProposal.rounds[0].proposal = 'globalThis.executed = true';
  await writeFile(join(dir, 'missing-notice.json'), JSON.stringify(noNotice));
  await writeFile(join(dir, 'code-proposal.json'), JSON.stringify(codeProposal));
  const results = await replayDirectory(dir);
  assert.ok(results.every(result => result.errors.length > 0));
  assert.equal(globalThis.executed, undefined);
});

test('an unknown evidence version cannot bypass either validator', async t => {
  const dir = await fixture(t);
  await writeFile(join(dir, 'unknown-version.json'), JSON.stringify({ ...practiceArena(), schemaVersion: 'arena-999.0.0' }));
  const results = await replayDirectory(dir);
  assert.ok(results[0].errors.length > 0);
});
