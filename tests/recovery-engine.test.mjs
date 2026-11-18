import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyRecoveryPatches, runRecoveryPlan, validateRecoveryPlan } from '../skills/rea-pro-max/lib/recovery-engine.mjs';
import { hashBytes, RpmError } from '../skills/rea-pro-max/lib/common.mjs';

const initial = 'const durable = false;\n';

async function fixture(t, source = initial) {
  const root = await mkdtemp(join(tmpdir(), 'rpm-recovery-engine-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'reference'));
  await mkdir(join(root, 'candidate'));
  await writeFile(join(root, 'reference', 'worker.js'), 'const durable = true;\n');
  await writeFile(join(root, 'candidate', 'worker.js'), source);
  return root;
}

function plan(root, expected, patches = []) {
  return {
    schema_version: 1,
    kind: 'mv3',
    candidate_root: root,
    browser_executable: join(root, 'chromium'),
    reference_path: 'reference',
    candidate_path: 'candidate',
    scenario: { schema_version: 1, name: 'owned', actions: [] },
    max_attempts: 3,
    patches: patches.length ? patches : [{ path: 'candidate/worker.js', expected_sha256: expected, search: 'false', replace: 'true', expected_matches: 1 }],
  };
}

test('recovery plan validates typed providers and bounded hash patches', async t => {
  const root = await fixture(t);
  const expected = hashBytes(initial);
  const value = validateRecoveryPlan(plan(root, expected));
  assert.equal(value.kind, 'mv3');
  assert.equal(value.patches[0].path, 'candidate/worker.js');
  assert.throws(() => validateRecoveryPlan({ ...value, kind: 'native' }), { code: 'recovery_plan' });
  for (const path of ['../worker.js', 'reference/worker.js', 'candidate', 'candidate/worker.js:stream', 'candidate/NUL.js']) {
    assert.throws(() => validateRecoveryPlan({ ...value, patches: [{ ...value.patches[0], path }] }), { code: 'recovery_scope' });
  }
  for (const candidate_path of ['.', 'reference', 'reference/nested']) {
    assert.throws(() => validateRecoveryPlan({ ...value, candidate_path }), { code: 'recovery_scope' });
  }
});

test('hash-bound patch application refuses stale input and preserves an auditable digest', async t => {
  const root = await fixture(t);
  const expected = hashBytes(initial);
  const result = await applyRecoveryPatches(root, plan(root, expected).patches);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].before_sha256, expected);
  assert.equal(await readFile(join(root, 'candidate', 'worker.js'), 'utf8'), 'const durable = true;\n');
  await assert.rejects(() => applyRecoveryPatches(root, plan(root, expected).patches), { code: 'recovery_stale_patch' });
});

test('recovery loop replays after each explicit patch and stops on a pass', async t => {
  const root = await fixture(t);
  const expected = hashBytes(initial);
  const events = [];
  const result = await runRecoveryPlan(plan(root, expected), {
    replay: async current => {
      const source = await readFile(join(current.candidate_root, current.candidate_path, 'worker.js'), 'utf8');
      events.push(source);
      return { status: source.includes('true') ? 'pass' : 'fail', mismatch: source.includes('true') ? null : { first_action: 'save' } };
    },
  });
  assert.equal(result.status, 'pass');
  assert.equal(result.stop_reason, 'passed');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.patches.length, 1);
  assert.deepEqual(events, [initial, 'const durable = true;\n']);
});

test('recovery stops without writing when verdicts or captures are incomplete', async t => {
  const root = await fixture(t);
  const input = plan(root, hashBytes(initial));
  for (const replay of [{ status: 'unknown' }, { status: 'fail', candidate: { complete: false } }]) {
    const result = await runRecoveryPlan(input, { replay: async () => replay });
    assert.equal(result.status, 'unknown');
    assert.equal(result.stop_reason, 'unknown_replay');
    assert.deepEqual(result.attempts, [{ attempt: 1, replay }]);
    assert.equal(result.patches.length, 0);
    assert.equal(await readFile(join(root, 'candidate', 'worker.js'), 'utf8'), initial);
  }
});

test('recovery enforces an attempt budget before changing the receiving file', async t => {
  const root = await fixture(t);
  const result = await runRecoveryPlan({ ...plan(root, hashBytes(initial)), max_attempts: 1 }, { replay: async () => ({ status: 'fail' }) });
  assert.equal(result.status, 'fail');
  assert.equal(result.stop_reason, 'attempt_budget');
  assert.deepEqual(result.patches, []);
  assert.equal(await readFile(join(root, 'candidate', 'worker.js'), 'utf8'), initial);
});

test('cancellation after replay retains the mismatch and prevents a patch', async t => {
  const root = await fixture(t);
  const controller = new AbortController();
  const mismatch = { first_action: 'save' };
  const result = await runRecoveryPlan(plan(root, hashBytes(initial)), {
    signal: controller.signal,
    replay: async () => {
      controller.abort();
      return { status: 'fail', mismatch };
    },
  });
  assert.equal(result.status, 'unknown');
  assert.equal(result.stop_reason, 'cancelled');
  assert.deepEqual(result.attempts[0].replay.mismatch, mismatch);
  assert.deepEqual(result.patches, []);
  assert.equal(await readFile(join(root, 'candidate', 'worker.js'), 'utf8'), initial);
});

test('a stale patch and a failed follow-up replay retain earlier evidence', async t => {
  const root = await fixture(t);
  const mismatch = { first_action: 'save' };
  const stale = await runRecoveryPlan(plan(root, '0'.repeat(64)), { replay: async () => ({ status: 'fail', mismatch }) });
  assert.equal(stale.status, 'unknown');
  assert.equal(stale.stop_reason, 'patch_error');
  assert.equal(stale.failure.code, 'recovery_stale_patch');
  assert.deepEqual(stale.attempts[0].replay.mismatch, mismatch);
  assert.equal(await readFile(join(root, 'candidate', 'worker.js'), 'utf8'), initial);

  let calls = 0;
  const interrupted = await runRecoveryPlan(plan(root, hashBytes(initial)), {
    replay: async () => {
      if (++calls === 2) throw new RpmError('runtime_failed', 'Replay is unavailable.');
      return { status: 'fail', mismatch };
    },
  });
  assert.equal(interrupted.status, 'unknown');
  assert.equal(interrupted.stop_reason, 'replay_error');
  assert.equal(interrupted.failure.code, 'runtime_failed');
  assert.deepEqual(interrupted.attempts[0].replay.mismatch, mismatch);
  assert.equal(interrupted.patches.length, 1);
});

test('nested receiving paths must use regular directory components', async t => {
  const root = await fixture(t);
  const reference = join(root, 'reference');
  await symlink(reference, join(root, 'candidate', 'mounted'), process.platform === 'win32' ? 'junction' : 'dir');
  const current = await readFile(join(reference, 'worker.js'), 'utf8');
  const patches = [{ path: 'candidate/mounted/worker.js', search: 'true', replace: 'false', expected_sha256: hashBytes(current) }];
  const result = await runRecoveryPlan(plan(root, hashBytes(initial), patches), { replay: async () => ({ status: 'fail' }) });
  assert.equal(result.stop_reason, 'patch_error');
  assert.equal(result.failure.code, 'recovery_scope');
  assert.deepEqual(result.patches, []);
  assert.equal(await readFile(join(reference, 'worker.js'), 'utf8'), current);
});

test('replacement preserves a UTF-8 BOM and writes replacement tokens literally', async t => {
  const source = '\uFEFFconst symbol = false;\n';
  const root = await fixture(t, source);
  const patches = [{ path: 'candidate/worker.js', search: 'false', replace: '$&🙂', expected_sha256: hashBytes(source) }];
  const result = await applyRecoveryPatches(root, patches);
  assert.equal(await readFile(join(root, 'candidate', 'worker.js'), 'utf8'), '\uFEFFconst symbol = $&🙂;\n');
  assert.equal(result.applied[0].after_sha256, hashBytes('\uFEFFconst symbol = $&🙂;\n'));
});

test('replacement budget is measured in UTF-8 bytes before writing', async t => {
  const size = 1024 * 1024;
  const source = 'a'.repeat(size - 1) + 'b';
  const root = await fixture(t, source);
  const patches = [{ path: 'candidate/worker.js', search: 'b', replace: 'é', expected_sha256: hashBytes(source) }];
  await assert.rejects(() => applyRecoveryPatches(root, patches), { code: 'recovery_patch_bounds' });
  assert.equal(hashBytes(await readFile(join(root, 'candidate', 'worker.js'))), patches[0].expected_sha256);
});

test('actual Chromium replays the owned restart scenario before and after a hash-bound repair', { skip: !process.env.RPM_BROWSER_EXECUTABLE, timeout: 120_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'rpm-recovery-browser-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const assets = new URL('../skills/rea-pro-max/assets/recovery/', import.meta.url);
  await cp(new URL('reference/', assets), join(root, 'reference'), { recursive: true });
  await cp(new URL('starter/', assets), join(root, 'candidate'), { recursive: true });
  const scenario = JSON.parse(await readFile(new URL('scenario.json', assets), 'utf8'));
  const referenceWorker = join(root, 'reference', 'worker.js');
  const referenceBefore = hashBytes(await readFile(referenceWorker));
  const starterHash = hashBytes(await readFile(join(root, 'candidate', 'worker.js')));
  const patches = [{
    path: 'candidate/worker.js',
    expected_sha256: starterHash,
    search: 'let memory = emptyState();\nasync function readState() { return structuredClone(memory); }\nasync function writeState(state) { memory = structuredClone(state); }',
    replace: "const key = 'receiving_state';\nasync function readState() { return (await chrome.storage.local.get(key))[key] ?? emptyState(); }\nasync function writeState(state) { await chrome.storage.local.set({ [key]: state }); }",
  }];
  const result = await runRecoveryPlan({
    ...plan(root, starterHash, patches),
    browser_executable: process.env.RPM_BROWSER_EXECUTABLE,
    scenario,
    max_attempts: 2,
  });
  assert.equal(result.status, 'pass', JSON.stringify(result.failure ?? result.attempts.at(-1)?.replay.reference?.failure ?? result.stop_reason));
  assert.equal(result.attempts[0].replay.status, 'fail');
  assert.equal(result.attempts[0].replay.mismatch.first_action, 'cold-read');
  assert.equal(result.attempts[1].replay.status, 'pass');
  assert.equal(result.patches.length, 1);
  assert.equal(hashBytes(await readFile(referenceWorker)), referenceBefore);
});

