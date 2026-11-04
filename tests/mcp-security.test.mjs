import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createCase } from '../skills/rea-pro-max/lib/case.mjs';

const entrypoint = fileURLToPath(new URL('../skills/rea-pro-max/scripts/mcp-server.mjs', import.meta.url));
const timeout = 20000;
const caseDocument = () => createCase({ goal: 'Owned case for path admission', target: { kind: 'extracted-javascript', sha256: 'a'.repeat(64) } });
const behaviorDocument = () => ({ schema_version: 1, complete: true,
  bindings: Object.fromEntries(['target_sha256', 'scenario_sha256', 'reset_sha256', 'toolchain_sha256', 'verifier_sha256'].map((name, index) => [name, String(index + 1).repeat(64)])),
  cases: [{ id: 'owned', input: {}, output: {}, state: {}, effects: [] }],
});

async function session(t, clientOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'rpm-mcp-security-'));
  const workspace = join(directory, 'workspace');
  const outside = join(directory, 'outside');
  const sibling = join(directory, 'workspace-private');
  await Promise.all([workspace, outside, sibling].map(path => mkdir(path)));
  await Promise.all([
    writeFile(join(workspace, 'safe.js'), "chrome.runtime.sendMessage({type:'owned'});"),
    writeFile(join(outside, 'secret.js'), "fetch('/outside-secret');"),
    writeFile(join(sibling, 'secret.js'), "fetch('/sibling-secret');"),
  ]);
  const transport = new StdioClientTransport({ command: process.execPath, args: [entrypoint, '--workspace', workspace], stderr: 'pipe' });
  const client = new Client({ name: 'rea-pro-max-independent-security-tests', version: '1.0.0' }, clientOptions);
  const errors = [];
  let stderr = '';
  client.onerror = error => errors.push(error);
  transport.stderr.on('data', chunk => { stderr += chunk.toString(); });
  t.after(async () => { await client.close(); await rm(directory, { recursive: true, force: true }); });
  await client.connect(transport, { timeout: 10000 });
  const call = (name, args = {}) => client.callTool({ name, arguments: args }, { timeout: 10000 });
  return { directory, workspace, outside, sibling, client, call, errors, stderr: () => stderr };
}

function success(result) {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.equal(typeof result.structuredContent, 'object');
  assert.notEqual(result.structuredContent, null);
  return result.structuredContent;
}

function denied(result) {
  assert.equal(result.isError, true, JSON.stringify(result));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 64 * 1024, 'Errors must remain bounded.');
  assert.ok(result.content.some(item => item.type === 'text' && item.text.length > 0));
  return result.structuredContent?.error;
}

async function linkOrSkip(t, target, path, type) {
  try {
    await symlink(target, path, type);
    assert.equal((await lstat(path)).isSymbolicLink(), true, 'The admitted fixture must be an actual symbolic link.');
    return true;
  }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) { t.skip('Host does not permit creating symlinks.'); return false; }
    throw error;
  }
}

test('MCP modern client rejects workspace escapes and prefix-sibling reads while preserving protocol operation', { timeout }, async t => {
  const s = await session(t, { versionNegotiation: { mode: 'auto' } });
  assert.equal(s.client.getProtocolEra(), 'modern');
  for (const path of [
    '../outside/secret.js', 'nested/../../outside/secret.js', join(s.outside, 'secret.js'),
    join(s.sibling, 'secret.js'), `file://${join(s.outside, 'secret.js')}`,
    'safe.js\0', 'C:\\outside\\secret.js', '\\\\server\\share\\secret.js',
  ]) denied(await s.call('inspect_artifact', { path }));
  const inspected = success(await s.call('inspect_artifact', { path: 'safe.js' }));
  assert.equal(typeof inspected.handle, 'string');
  success(await s.call('inspect_artifact', { path: join(s.workspace, 'safe.js') }));
  success(await s.call('inspect_artifact', { path: await realpath(join(s.workspace, 'safe.js')) }));
  assert.deepEqual(s.errors, [], 'Malformed stdout or transport errors must not poison the MCP connection.');
  assert.equal(await readFile(join(s.outside, 'secret.js'), 'utf8'), "fetch('/outside-secret');");
});

test('MCP refuses selected and parent symlinks for both artifact and JSON reads', { timeout }, async t => {
  const s = await session(t);
  if (!await linkOrSkip(t, join(s.outside, 'secret.js'), join(s.workspace, 'linked.js'), 'file')) return;
  if (!await linkOrSkip(t, s.outside, join(s.workspace, 'linked-directory'), 'dir')) return;
  await Promise.all([
    writeFile(join(s.outside, 'case.json'), JSON.stringify(caseDocument())),
    writeFile(join(s.outside, 'receipt.json'), JSON.stringify(behaviorDocument())),
  ]);
  denied(await s.call('inspect_artifact', { path: 'linked.js' }));
  denied(await s.call('inspect_artifact', { path: 'linked-directory/secret.js' }));
  denied(await s.call('import_case', { path: 'linked-directory/case.json' }));
  denied(await s.call('verify_behavior', { reference_path: 'linked-directory/receipt.json', candidate_path: 'linked-directory/receipt.json' }));
  success(await s.call('inspect_artifact', { path: 'safe.js' }));
  assert.equal((await lstat(join(s.workspace, 'linked.js'))).isSymbolicLink(), true);
  assert.deepEqual(s.errors, []);
});

test('MCP exports exclusively and refuses traversal, dangling links and linked output parents', { timeout }, async t => {
  const s = await session(t);
  const { handle } = success(await s.call('inspect_artifact', { path: 'safe.js' }));
  await writeFile(join(s.workspace, 'keep.json'), 'preserved');
  denied(await s.call('export_artifact', { handle, output_path: 'keep.json', format: 'json' }));
  assert.equal(await readFile(join(s.workspace, 'keep.json'), 'utf8'), 'preserved');
  for (const output_path of ['../outside/export.json', join(s.outside, 'export.json'), join(s.sibling, 'export.json')]) {
    denied(await s.call('export_artifact', { handle, output_path, format: 'json' }));
  }
  await assert.rejects(lstat(join(s.outside, 'export.json')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(s.sibling, 'export.json')), { code: 'ENOENT' });
  success(await s.call('export_artifact', { handle, output_path: 'new.json', format: 'json' }));
  const exported = await readFile(join(s.workspace, 'new.json'));
  denied(await s.call('export_artifact', { handle, output_path: 'new.json', format: 'json' }));
  assert.deepEqual(await readFile(join(s.workspace, 'new.json')), exported);
  if (!await linkOrSkip(t, join(s.outside, 'missing.json'), join(s.workspace, 'dangling.json'), 'file')) return;
  denied(await s.call('export_artifact', { handle, output_path: 'dangling.json', format: 'json' }));
  assert.equal((await lstat(join(s.workspace, 'dangling.json'))).isSymbolicLink(), true);
  await assert.rejects(lstat(join(s.outside, 'missing.json')), { code: 'ENOENT' });
  if (!await linkOrSkip(t, s.outside, join(s.workspace, 'linked-output'), 'dir')) return;
  denied(await s.call('export_artifact', { handle, output_path: 'linked-output/new.json', format: 'json' }));
  await assert.rejects(lstat(join(s.outside, 'new.json')), { code: 'ENOENT' });
  assert.deepEqual(s.errors, []);
});

test('MCP parses hostile artifact source without executing its writes or arbitrary oracle modules', { timeout }, async t => {
  const s = await session(t);
  const sentinel = join(s.outside, 'executed.txt');
  const oracle = join(s.workspace, 'untrusted-oracle.mjs');
  const body = `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(sentinel)}, 'executed'); throw new Error('must never execute');`;
  await Promise.all([writeFile(join(s.workspace, 'hostile.mjs'), body), writeFile(oracle, body)]);
  const tools = await s.client.listTools();
  for (const tool of tools.tools) assert.doesNotMatch(tool.name, /(?:shrink|shell|exec|oracle|launch|fetch)/iu);
  success(await s.call('inspect_artifact', { path: 'hostile.mjs' }));
  denied(await s.call('inspect_artifact', { path: 'safe.js', oracle }));
  denied(await s.call('run_owned_lab', { oracle }));
  const unavailable = await s.call('shrink', { oracle }).catch(error => error);
  assert.ok(unavailable instanceof Error || unavailable.isError === true);
  await assert.rejects(lstat(sentinel), { code: 'ENOENT' });
  success(await s.call('get_capabilities'));
  assert.deepEqual(s.errors, []);
});

test('MCP rejects malformed and oversized JSON files without terminating the server', { timeout }, async t => {
  const s = await session(t);
  await Promise.all([
    writeFile(join(s.workspace, 'malformed.json'), '{'),
    writeFile(join(s.workspace, 'oversized.json'), ' '.repeat(4 * 1024 * 1024) + JSON.stringify(caseDocument())),
    writeFile(join(s.workspace, 'oversized-receipt.json'), ' '.repeat(4 * 1024 * 1024) + JSON.stringify(behaviorDocument())),
    writeFile(join(s.workspace, 'invalid-case.json'), '{}'),
    writeFile(join(s.workspace, 'invalid-utf8.json'), Buffer.from([0xff, 0xfe])),
  ]);
  for (const path of ['malformed.json', 'oversized.json', 'invalid-case.json', 'invalid-utf8.json']) {
    denied(await s.call('import_case', { path }));
    denied(await s.call('verify_behavior', { reference_path: path, candidate_path: path }));
  }
  denied(await s.call('verify_behavior', { reference_path: 'oversized-receipt.json', candidate_path: 'oversized-receipt.json' }));
  success(await s.call('inspect_artifact', { path: 'safe.js' }));
  assert.deepEqual(s.errors, []);
});

test('MCP rejects schema and paging bounds without returning unbounded data', { timeout }, async t => {
  const s = await session(t);
  const { handle } = success(await s.call('inspect_artifact', { path: 'safe.js' }));
  for (const args of [
    { handle, section: 'nodes', limit: 51 }, { handle, section: 'nodes', limit: -1 },
    { handle, section: 'nodes', offset: -1 }, { handle, section: 'nodes', offset: 0.5 },
    { handle, section: 'nodes', query: 'x'.repeat(201) },
    { handle, section: 'nodes', unexpected: true },
    { handle: 'unknown-handle', section: 'nodes' },
  ]) denied(await s.call('read_artifact', args));
  const page = await s.call('read_artifact', { handle, section: 'nodes', offset: 0, limit: 1 });
  success(page);
  assert.ok(Buffer.byteLength(JSON.stringify(page)) < 128 * 1024);
  denied(await s.call('inspect_artifact', { path: '' }));
  denied(await s.call('list_task_prompts', { limit: 11 }));
  denied(await s.call('list_task_prompts', { limit: 1, target: 'x'.repeat(10000) }));
  assert.deepEqual(s.errors, []);
});

test('MCP bounds retained artifacts and rejects an evicted handle without losing the newest result', { timeout }, async t => {
  const s = await session(t);
  const first = success(await s.call('inspect_artifact', { path: 'safe.js' }));
  let newest;
  for (let index = 0; index < 16; index++) newest = success(await s.call('inspect_artifact', { path: 'safe.js' }));
  assert.equal(denied(await s.call('read_artifact', { handle: first.handle, section: 'summary' })).code, 'unknown_handle');
  success(await s.call('read_artifact', { handle: newest.handle, section: 'summary' }));
  assert.deepEqual(s.errors, []);
});

test('MCP case validation failures preserve state and concurrent revisions commit once', { timeout }, async t => {
  const s = await session(t);
  const inspection = success(await s.call('inspect_artifact', { path: 'safe.js' }));
  const record = success(await s.call('create_case', { inspection_handle: inspection.handle, goal: 'Owned atomic mutation case', capabilities: [] }));
  const case_handle = record.handle;
  success(await s.call('export_artifact', { handle: case_handle, output_path: 'before.json', format: 'json' }));
  const before = JSON.parse(await readFile(join(s.workspace, 'before.json'), 'utf8'));
  assert.equal(before.revision, 1);
  denied(await s.call('revise_case', { case_handle, expected_revision: 1, patch: { observations: [] } }));
  denied(await s.call('revise_case', { case_handle, expected_revision: 1, patch: { hypotheses: [{ id: 'h', label: 'Missing probe reference', predictions: { absent: 'outcome' } }] } }));
  denied(await s.call('revise_case', { case_handle: inspection.handle, expected_revision: 1, patch: { goal: 'Wrong handle kind' } }));
  success(await s.call('export_artifact', { handle: case_handle, output_path: 'after-failure.json', format: 'json' }));
  assert.deepEqual(JSON.parse(await readFile(join(s.workspace, 'after-failure.json'), 'utf8')), before);
  const contenders = await Promise.all(['First mutation', 'Second mutation'].map(goal => s.call('revise_case', { case_handle, expected_revision: 1, patch: { goal } })));
  assert.equal(contenders.filter(result => result.isError !== true).length, 1);
  const conflict = contenders.find(result => result.isError === true);
  assert.equal(denied(conflict).code, 'revision_conflict');
  success(await s.call('export_artifact', { handle: case_handle, output_path: 'committed.json', format: 'json' }));
  const committed = JSON.parse(await readFile(join(s.workspace, 'committed.json'), 'utf8'));
  assert.equal(committed.revision, 2);
  assert.ok(['First mutation', 'Second mutation'].includes(committed.goal));
  assert.equal(committed.id, before.id);
  assert.deepEqual(committed.target, before.target);
  assert.deepEqual(s.errors, []);
});

test('MCP bounded mutation responses never report failure after committing a case change', { timeout }, async t => {
  const s = await session(t);
  const inspection = success(await s.call('inspect_artifact', { path: 'safe.js' }));
  const record = success(await s.call('create_case', { inspection_handle: inspection.handle, goal: 'Owned response atomicity case' }));
  const before = success(await s.call('read_artifact', { handle: record.handle, section: 'full' })).data;
  const target = { ...before.target, ...Object.fromEntries(Array.from({ length: 10000 }, (_, index) => [`extra_${index}`, null])) };
  const result = await s.call('revise_case', { case_handle: record.handle, expected_revision: 1, patch: { target } });
  success(await s.call('export_artifact', { handle: record.handle, output_path: 'response-atomicity.json', format: 'json' }));
  const after = JSON.parse(await readFile(join(s.workspace, 'response-atomicity.json'), 'utf8'));
  if (result.isError === true) {
    denied(result);
    assert.equal(after.revision, before.revision, 'A response-size error must not conceal an already committed mutation.');
    assert.ok(JSON.stringify(after) === JSON.stringify(before), 'Failed mutation must preserve every saved field.');
  } else {
    success(result);
    assert.equal(after.revision, 2);
    assert.equal(Object.keys(after.target).length, Object.keys(target).length);
    assert.ok(Object.entries(target).every(([key, value]) => Object.hasOwn(after.target, key) && after.target[key] === value));
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 128 * 1024);
  }
  assert.deepEqual(s.errors, []);
});

test('MCP returns a finite unknown verdict handle even when comparability reasons need paging', { timeout }, async t => {
  const s = await session(t);
  const expected = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`missing_${'x'.repeat(100)}_${index}_sha256`, '1'.repeat(64)]));
  await Promise.all([
    writeFile(join(s.workspace, 'receipt.json'), JSON.stringify(behaviorDocument())),
    writeFile(join(s.workspace, 'contract.json'), JSON.stringify({ expected_bindings: { reference: expected } })),
  ]);
  const result = await s.call('verify_behavior', { reference_path: 'receipt.json', candidate_path: 'receipt.json', contract_path: 'contract.json' });
  const verdict = success(result);
  assert.equal(verdict.summary.status, 'unknown');
  assert.equal(typeof verdict.handle, 'string');
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 128 * 1024);
  const page = success(await s.call('read_artifact', { handle: verdict.handle, section: '/comparability/reasons', offset: 0, limit: 3 }));
  assert.equal(page.total, 1000);
  assert.equal(page.items.length, 3);
  assert.ok(page.items.every(reason => reason.startsWith('stale_reference:')));
  assert.deepEqual(s.errors, []);
});

test('MCP refuses FIFO inputs without blocking and remains usable afterward', { timeout }, async t => {
  if (process.platform === 'win32') { t.skip('POSIX FIFO fixture is unavailable on Windows.'); return; }
  const s = await session(t);
  const result = spawnSync('mkfifo', [join(s.workspace, 'pipe.json')], { encoding: 'utf8', timeout: 2000 });
  if (result.error?.code === 'ENOENT') { t.skip('mkfifo is unavailable.'); return; }
  assert.equal(result.status, 0, result.stderr);
  denied(await s.call('inspect_artifact', { path: 'pipe.json' }));
  denied(await s.call('import_case', { path: 'pipe.json' }));
  success(await s.call('get_capabilities'));
  assert.deepEqual(s.errors, []);
});
