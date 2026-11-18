import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkRelease } from '../skills/rea-pro-max/lib/release-check.mjs';
import { digest, hashBytes } from '../skills/rea-pro-max/lib/common.mjs';
import { ownedZip } from './fixtures/owned-zip.mjs';

const asset = fileURLToPath(new URL('../skills/rea-pro-max/assets/labs/release', import.meta.url));
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const writeJson = (path, record) => writeFile(path, JSON.stringify(record));
const wasm = code => Buffer.from(code, 'hex');
const i64 = wasm('0061736d010000000105016000017e030201000707010367657400000a0601040042020b');

async function lab(t) {
  const root = await mkdtemp(join(tmpdir(), 'rpm-release-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(asset, root, { recursive: true });
  const policyPath = join(root, 'policy.json');
  return { root, policyPath, plan: await readJson(policyPath) };
}

test('one release policy evaluates all four signals and binds the exact files twice consistently', async t => {
  const { root, policyPath } = await lab(t);
  const result = await checkRelease(policyPath);
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.checks.map(check => [check.id, check.status]), [
    ['build-files', 'pass'], ['wasm-interface', 'pass'], ['api-coverage', 'pass'], ['playwright-trace', 'pass'],
  ]);
  assert.equal(result.artifacts.archives[0].status, 'same-file-content');
  assert.equal(result.policy_file_sha256, hashBytes(await readFile(policyPath)));
  assert.equal(result.checks[1].candidate_sha256, hashBytes(await readFile(join(root, 'candidate/engine.wasm'))));
  assert.equal(result.checks[2].har_sha256, hashBytes(await readFile(join(root, 'traffic.har'))));
  assert.equal(result.checks[3].sources.trace.sha256, hashBytes(await readFile(join(root, 'catalog.trace'))));
  assert.equal(result.authority.saved_observations, 'reported');
  assert.deepEqual(await checkRelease(policyPath), result);
  const { receipt_sha256, ...body } = result;
  assert.equal(receipt_sha256, digest(body));
});

test('an allowed file change still fails a declared ABI check and retains other verdicts', async t => {
  const { root, policyPath } = await lab(t);
  await writeFile(join(root, 'candidate/engine.wasm'), i64);
  const result = await checkRelease(policyPath);
  assert.equal(result.status, 'fail');
  assert.equal(result.checks[0].status, 'pass');
  assert.equal(result.checks[1].changes[0].status, 'type-changed');
  assert.equal(result.checks[1].changes[0].name, 'get');
  assert.equal(result.checks[2].status, 'pass');
});

test('required files and archive verification fail closed even when artifact bytes agree', async t => {
  const { root, policyPath, plan } = await lab(t);
  plan.required_files.push('missing.json');
  await writeJson(policyPath, plan);
  const omitted = await checkRelease(policyPath);
  assert.equal(omitted.status, 'fail');
  assert.ok(omitted.checks[0].findings.some(row => row.path === 'missing.json' && row.reason === 'required_file_missing'));
  plan.required_files.pop();
  await writeJson(policyPath, plan);
  const malformed = Buffer.from('504b0304deadbeef', 'hex');
  await Promise.all(['reference', 'candidate'].map(side => writeFile(join(root, side, 'assets.zip'), malformed)));
  const unverifiable = await checkRelease(policyPath);
  assert.equal(unverifiable.status, 'unknown');
  assert.equal(unverifiable.artifacts.archives[0].status, 'partial');
});

test('explicit null rule lists are rejected, and missing or unreadable target declarations never pass', async t => {
  const { policyPath, plan } = await lab(t);
  for (const key of ['required_files', 'allowed_changes', 'repack_only', 'wasm_interfaces', 'deployment_targets']) {
    await writeJson(policyPath, { ...plan, [key]: null });
    await assert.rejects(checkRelease(policyPath), { code: 'release_policy' });
  }
  for (const [file, status] of [['missing.class', 'fail'], ['engine.wasm', 'unknown']]) {
    await writeJson(policyPath, { ...plan, deployment_targets: [file] });
    const result = await checkRelease(policyPath);
    assert.equal(result.status, status);
    assert.equal(result.checks.find(row => row.id === 'deployment-targets').status, status);
  }
});

test('a verified changed member fails repack-only even when another member cannot be decoded', async t => {
  const { root, policyPath } = await lab(t);
  for (const side of ['reference', 'candidate']) {
    const archive = ownedZip([{ name: 'value', raw: Buffer.from(side) }, { name: 'other', method: 99 }]);
    await writeFile(join(root, side, 'assets.zip'), archive);
  }
  const result = await checkRelease(policyPath);
  assert.equal(result.artifacts.archives[0].status, 'partial');
  assert.equal(result.status, 'fail');
  assert.equal(result.checks[0].findings[0].reason, 'archive_member_changed');
});

test('explicit HAR origin and expected status enforce positive recorded evidence', async t => {
  const { root, policyPath, plan } = await lab(t);
  const trafficFile = join(root, 'traffic.har');
  const har = await readJson(trafficFile);
  har.log.entries[0].request.url = 'https://wrong.invalid/items/42';
  har.log.entries[1].response.status = 500;
  await writeJson(trafficFile, har);
  const failed = await checkRelease(policyPath);
  assert.equal(failed.status, 'fail');
  assert.equal(failed.checks[2].out_of_scope_requests, 1);
  assert.deepEqual(failed.checks[2].operations.map(row => row.observed_statuses), [[], [500]]);
  plan.api.required_operations = [{ method: 'GET', path: '/items/search', expected_status: 500 }];
  await writeJson(policyPath, plan);
  assert.equal((await checkRelease(policyPath)).status, 'pass');
});

test('long same-origin unmatched entries fail and unassigned HAR entries retain uncertainty', async t => {
  const { root, policyPath, plan } = await lab(t);
  plan.api.reject_unmatched = true;
  await writeJson(policyPath, plan);
  const trafficFile = join(root, 'traffic.har');
  const har = await readJson(trafficFile);
  har.log.entries[2].request.url = 'https://catalog.invalid/missing?q=' + 'a'.repeat(4100);
  await writeJson(trafficFile, har);
  const long = await checkRelease(policyPath);
  assert.equal(long.status, 'fail');
  assert.equal(long.checks[2].coverage.observations.unmatched, 1);

  har.log.entries[2].request.url = 'unknown URL';
  await writeJson(trafficFile, har);
  const malformed = await checkRelease(policyPath);
  assert.equal(malformed.status, 'unknown');
  assert.equal(malformed.checks[2].unattributed_requests, 1);
});

test('a readable but malformed HAR keeps its exact identity without printing raw content', async t => {
  const { root, policyPath } = await lab(t);
  const trafficFile = join(root, 'traffic.har');
  await writeFile(trafficFile, 'not-json-a');
  const result = await checkRelease(policyPath);
  assert.equal(result.status, 'unknown');
  assert.equal(result.checks[2].reason, 'invalid_json');
  assert.doesNotMatch(JSON.stringify(result), /not-json-a/u);
  await writeFile(trafficFile, 'not-json-b');
  assert.notEqual(result.receipt_sha256, (await checkRelease(policyPath)).receipt_sha256);
});

test('trace-level errors fail the policy and incomplete traces are unknown', async t => {
  const { root, policyPath } = await lab(t);
  const path = join(root, 'catalog.trace');
  const trace = await readFile(path, 'utf8');
  await writeFile(path, trace + JSON.stringify({ type: 'error', message: 'SYNTHETIC DIAGNOSTIC' }) + '\n');
  const result = await checkRelease(policyPath);
  assert.equal(result.status, 'fail');
  assert.equal(result.checks.at(-1).coverage.trace.trace_errors, 1);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC DIAGNOSTIC/u);
  await writeFile(path, trace.split('\n').slice(0, -2).join('\n') + '\n');
  assert.equal((await checkRelease(policyPath)).status, 'unknown');
});

test('checks path admission before reading policy-selected evidence', async t => {
  const { policyPath, plan } = await lab(t);
  plan.api.har_path = '../traffic.har';
  await writeJson(policyPath, plan);
  await assert.rejects(() => checkRelease(policyPath), { code: 'release_policy' });
});
