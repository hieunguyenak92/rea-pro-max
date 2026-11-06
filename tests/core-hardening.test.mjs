import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { readJson } from '../skills/rea-pro-max/lib/common.mjs';
import { inspectArtifact } from '../skills/rea-pro-max/lib/analysis/inspect.mjs';
import { readEvidenceSource } from '../skills/rea-pro-max/lib/analysis/source.mjs';

async function fixture(t, files) {
  const folder = await mkdtemp(join(tmpdir(), 'rpm-hardening-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  for (const [name, value] of Object.entries(files)) {
    const path = join(folder, name);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return folder;
}

test('reachable TypeScript imports are retained with an explicit unsupported coverage diagnostic', async t => {
  const folder = await fixture(t, {
    'app.js': 'import "./feature.ts"; fetch("/api");',
    'feature.ts': 'const endpoint: string = "/feature"; fetch(endpoint);',
  });
  const result = await inspectArtifact(folder);
  assert.ok(result.nodes.some(node => node.kind === 'source-module' && node.file === 'feature.ts'));
  assert.ok(result.unknowns.some(item => item.code === 'unsupported_source_extension' && item.file === 'feature.ts'));
  assert.deepEqual(result.coverage.unparsed_files, ['feature.ts']);
  assert.equal(result.coverage.analyzed_files.includes('feature.ts'), false);
  assert.equal(result.nodes.filter(node => node.api === 'fetch').some(node => node.file === 'feature.ts'), false);
});

test('explicit include and exclude scopes skip irrelevant files and bind scope identity', async t => {
  const folder = await fixture(t, {
    'src/main.js': 'fetch("/owned");',
    'src/ignored.js': 'fetch("/ignored");',
    'vendor/large.js': 'fetch("/vendor");',
  });
  const result = await inspectArtifact(folder, { include: ['src'], exclude: ['src/ignored.js'] });
  assert.deepEqual(result.artifact.file_count, 1);
  assert.deepEqual(result.coverage.admitted_files, ['src/main.js']);
  assert.ok(result.coverage.omitted_files.some(item => item.path === 'src/ignored.js' && item.reason === 'excluded'));
  assert.equal(result.coverage.scope.explicit, true);
  const sameFiles = await inspectArtifact(folder, { include: ['src/main.js'] });
  assert.notEqual(result.artifact.sha256, sameFiles.artifact.sha256);
});

test('shared JSON reader bounds regular files and rejects symlink races at open', async t => {
  const folder = await fixture(t, { 'value.json': { ok: true } });
  const path = join(folder, 'value.json');
  assert.deepEqual(readJson(path, 100), { ok: true });
  assert.throws(() => readJson(path, 2), error => error.code === 'input_bounds');
  const link = join(folder, 'value-link.json');
  try { await symlink(path, link); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return; throw error; }
  assert.throws(() => readJson(link, 100), error => error.code === 'input_bounds');
});

test('scope paths reject traversal and globs instead of widening admission', async t => {
  const folder = await fixture(t, { 'src/main.js': 'fetch("/owned");' });
  await assert.rejects(inspectArtifact(folder, { include: ['../src'] }), error => error.code === 'invalid_scope');
  await assert.rejects(inspectArtifact(folder, { exclude: ['src/*.js'] }), error => error.code === 'invalid_scope');
  for (const path of ['C:/src', 'C:\\src', 'src\\main.js', './', 'src/./main.js']) await assert.rejects(inspectArtifact(folder, { include: [path] }), error => error.code === 'invalid_scope');
});

test('unreferenced unsupported sources remain explicit and never count as analyzed', async t => {
  const folder = await fixture(t, { 'app.js': 'fetch("/owned");', 'feature.tsx': 'export const App = () => <button/>;' });
  const result = await inspectArtifact(folder);
  assert.ok(result.unknowns.some(item => item.code === 'unsupported_source_extension' && item.file === 'feature.tsx' && !item.reachable));
  assert.equal(result.coverage.analyzed_files.includes('feature.tsx'), false);
});

test('include scopes omit irrelevant directory trees before enumeration and bound omission records', async t => {
  const folder = await fixture(t, { 'src/main.js': 'fetch("/owned");', ...Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`vendor/deep/${index}.txt`, 'ignored'])) });
  const result = await inspectArtifact(folder, { include: ['src'], maxVisitedEntries: 8 });
  assert.deepEqual(result.coverage.omitted_files, [{ path: 'vendor', reason: 'outside_include', kind: 'directory' }]);
  assert.equal(result.coverage.scope.visited_entries, 4);
  await assert.rejects(inspectArtifact(folder, { exclude: ['src', 'vendor'], maxOmissions: 1 }), error => error.code === 'artifact_bounds');
});

test('explicit policy contributes to a selected-file identity', async t => {
  const folder = await fixture(t, { 'app.js': 'fetch("/owned");' });
  const direct = await inspectArtifact(join(folder, 'app.js'));
  const scoped = await inspectArtifact(join(folder, 'app.js'), { include: ['app.js'] });
  assert.notEqual(direct.artifact.sha256, scoped.artifact.sha256);
  await assert.rejects(inspectArtifact(join(folder, 'app.js'), { exclude: ['app.js'] }), error => error.code === 'empty_scope');
});

test('source excerpts preserve exact ranges, remain bounded and reject stale or escaping evidence', async t => {
  const folder = await fixture(t, { 'app.js': 'const label = "東京";\nfetch("/owned");' });
  const result = await inspectArtifact(folder);
  const proof = result.evidence.find(item => item.operation === 'fetch');
  assert.ok(proof);
  const excerpt = await readEvidenceSource(result, proof.id);
  assert.equal(excerpt.source, 'fetch("/owned")'); assert.equal(excerpt.line, 2); assert.equal(excerpt.truncated, false);
  const short = await readEvidenceSource(result, proof.id, { maxChars: 5 });
  assert.equal(short.source, 'fetch'); assert.equal(short.truncated, true); assert.equal(short.requested_end, proof.end);
  await assert.rejects(readEvidenceSource(result, proof.id, { maxChars: 16001 }), error => error.code === 'source_bounds');
  await assert.rejects(readEvidenceSource({ ...result, evidence: [{ ...proof, file: '../outside.js' }] }, proof.id), error => error.code === 'invalid_evidence');
  await writeFile(join(folder, 'app.js'), 'fetch("/changed");');
  await assert.rejects(readEvidenceSource(result, proof.id), error => error.code === 'source_changed');
});

test('selected directory replacement during canonical admission is rejected', async t => {
  const folder = await fixture(t, { 'artifact/app.js': 'fetch("/owned");' });
  const selected = join(folder, 'artifact');
  const inventoryModule = new URL('../skills/rea-pro-max/lib/analysis/inventory.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const selected = ${JSON.stringify(selected)};
    const original = fs.promises.realpath;
    fs.promises.realpath = async function(path, ...args) {
      if (path === selected) { fs.renameSync(selected, selected + '-old'); fs.mkdirSync(selected); }
      return original(path, ...args);
    };
    syncBuiltinESMExports();
    const { inventory } = await import(${JSON.stringify(inventoryModule)});
    try { await inventory(selected); console.log('accepted'); }
    catch (error) { console.log(error.code); }
  `], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), 'input_changed');
});

test('shared JSON reader rechecks a file grown after its initial size admission', async t => {
  const folder = await fixture(t, { 'value.json': {} });
  const selected = join(folder, 'value.json');
  const common = new URL('../skills/rea-pro-max/lib/common.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const selected = ${JSON.stringify(selected)};
    const original = fs.lstatSync;
    fs.lstatSync = function(path, ...args) { const stat = original(path, ...args); if (path === selected) fs.writeFileSync(path, JSON.stringify({ data: 'x'.repeat(1024) })); return stat; };
    syncBuiltinESMExports();
    const { readJson } = await import(${JSON.stringify(common)});
    try { readJson(selected, 16); console.log('accepted'); }
    catch (error) { console.log(error.code); }
  `], { encoding: 'utf8', timeout: 5000 });
  assert.equal(child.error, undefined); assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout.trim(), 'input_bounds');
});
