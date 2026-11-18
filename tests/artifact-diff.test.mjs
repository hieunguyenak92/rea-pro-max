import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compareArtifacts } from '../skills/rea-pro-max/lib/analysis/artifact-diff.mjs';
import { digest } from '../skills/rea-pro-max/lib/common.mjs';
import { ownedZip } from './fixtures/owned-zip.mjs';

async function snapshots(t, reference = {}, candidate = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rpm-artifact-diff-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [side, files] of Object.entries({ reference, candidate })) {
    const path = join(root, side);
    await mkdir(path);
    await Promise.all(Object.entries(files).map(([name, contents]) => writeFile(join(path, name), contents)));
  }
  return [join(root, 'reference'), join(root, 'candidate')];
}

test('compares two build trees, retaining only uniquely relocated content as a relocation', async t => {
  const paths = await snapshots(t, {
    'a.txt': 'updated', 'b.txt': 'move', 'also.txt': 'duplicate', 'gone.txt': 'duplicate', 'other.txt': 'same',
  }, {
    'a.txt': 'updated again', 'c.txt': 'move', 'also.txt': 'duplicate', 'new.txt': 'duplicate', 'other.txt': 'same',
  });
  const result = await compareArtifacts(...paths);
  assert.deepEqual(result.counts, { unchanged: 2, modified: 1, removed: 1, added: 1, relocated: 1 });
  assert.deepEqual(result.changes.map(row => [row.path, row.status, row.candidate_path]), [
    ['a.txt', 'modified', undefined], ['b.txt', 'relocated', 'c.txt'], ['gone.txt', 'removed', undefined], ['new.txt', 'added', undefined],
  ]);
  assert.deepEqual(result, await compareArtifacts(...paths));
  const { receipt_sha256, ...receipt } = result;
  assert.equal(receipt_sha256, digest(receipt));
  const scoped = await compareArtifacts(...paths, { include: ['other.txt'] });
  assert.equal(scoped.status, 'same-admitted-bytes');
  assert.equal(scoped.coverage.both_snapshots_unfiltered, false);
  assert.equal(scoped.reference.omitted.length, 4);
});

test('distinguishes a repackage from changed ZIP member contents', async t => {
  const payload = Buffer.from('original');
  const entry = { name: 'doc.txt', raw: payload };
  const [before, after] = await snapshots(t,
    { 'repacked.zip': ownedZip([entry]), 'updated.zip': ownedZip([entry, { name: 'old.txt' }]) },
    { 'repacked.zip': ownedZip([{ ...entry, method: 8 }], Buffer.from('build 2')), 'updated.zip': ownedZip([{ ...entry, raw: Buffer.from('updated') }, { name: 'new.txt' }]) });
  const result = await compareArtifacts(before, after);
  assert.equal(result.status, 'different');
  assert.equal(result.archives[0].status, 'same-file-content');
  assert.equal(result.archives[0].verified_unchanged_files, 1);
  assert.equal(result.archives[1].status, 'changed-file-content');
  assert.deepEqual(result.archives[1].changes.map(member => [member.name, member.status]), [['doc.txt', 'modified'], ['new.txt', 'added'], ['old.txt', 'removed']]);
  const single = await compareArtifacts(join(before, 'repacked.zip'), join(after, 'repacked.zip'));
  assert.equal(single.changes[0].path, '.');
  assert.equal(single.archives[0].status, 'same-file-content');
  await assert.rejects(() => compareArtifacts(before, join(after, 'repacked.zip')), { code: 'artifact_comparison_input' });
});

test('partial archive coverage preserves verified changes without inferring absences', async t => {
  const [before, after] = await snapshots(t,
    { 'limited.zip': ownedZip([{ name: 'doc.txt', raw: Buffer.from('first') }, { name: 'gone.txt' }]) },
    { 'limited.zip': ownedZip([{ name: 'doc.txt', raw: Buffer.from('second') }, { name: 'dup.txt' }, { name: 'dup.txt' }]) });
  const result = await compareArtifacts(before, after);
  assert.equal(result.archives[0].status, 'partial');
  assert.deepEqual(result.archives[0].changes.map(row => [row.name, row.status]), [['doc.txt', 'modified']]);
  assert.equal(result.archives[0].candidate.content_complete, false);
});

test('differently named single files retain equal content identity under an explicit scope', async t => {
  const [before, after] = await snapshots(t, { 'old.txt': 'same' }, { 'new.txt': 'same' });
  const result = await compareArtifacts(join(before, 'old.txt'), join(after, 'new.txt'), { include: ['old.txt', 'new.txt'] });
  assert.equal(result.status, 'same-admitted-bytes');
  assert.equal(result.reference.sha256, result.candidate.sha256);
});
