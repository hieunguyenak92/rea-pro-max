import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
  captureToWebIR,
  createWebRecoveryIR,
} from '../skills/rea-pro-max/lib/web-recovery/schema.mjs';
import { compileContract } from '../skills/rea-pro-max/lib/web-recovery/contract.mjs';
import {
  compareBehavior,
  compareVisual,
  deepDiff,
} from '../skills/rea-pro-max/lib/web-recovery/compare.mjs';
import { shrinkActions } from '../skills/rea-pro-max/lib/web-recovery/reducer.mjs';
import { replayWebFeature } from '../skills/rea-pro-max/lib/runtime/web-replay.mjs';

const actions = [
  { id: 'open', kind: 'navigate', route: '/' },
  { id: 'search', kind: 'input', target: '#search', value: 'café' },
  { id: 'submit', kind: 'click', target: '#submit' },
];

function capture({ candidate = false, incomplete = false, domText = 'Results' } = {}) {
  return createWebRecoveryIR({
    id: candidate ? 'candidate-capture' : 'target-capture', route: '/', state: { query: 'café' }, viewport: { width: 1024, height: 768, dpr: 1 }, actions,
    identities: { target: { id: 'target', sha256: 'a'.repeat(64) }, candidate: candidate ? { id: 'candidate', sha256: 'b'.repeat(64) } : null },
    coverage: { complete: !incomplete, action_ids: actions.map(item => item.id), channels: ['dom', 'visual', 'network', 'storage'] },
    observations: actions.map((action, index) => ({ action_id: action.id, dom: { summary: { index }, text: domText }, visual: { artifact_hash: candidate ? 'visual-candidate' : 'visual-target' }, network: { summary: { request: index } }, storage: { summary: { query: 'café' } }, complete: !incomplete })),
  });
}

test('web IR is versioned, typed and keeps route/state/viewport plus observations', () => {
  const ir = capture();
  assert.equal(ir.schema_version, 1);
  assert.equal(ir.kind, 'web-recovery-ir');
  assert.deepEqual(ir.route, { path: '/', query: '', hash: '' });
  assert.deepEqual(ir.viewport, { width: 1024, height: 768, dpr: 1 });
  assert.equal(ir.observations[1].dom.text, 'Results');
  const adapted = captureToWebIR({ kind: 'web-runtime-capture', complete: true, receipt: { complete: true, cases: [{ id: 'one', input: { kind: 'click', target: '#go' }, output: { ok: true }, state: { count: 1 }, effects: [] }] } });
  assert.equal(adapted.observations[0].storage.summary.count, 1);
});

test('contract compiler records finite expected observations and coverage', () => {
  const contract = compileContract(capture(), capture({ candidate: true }));
  assert.equal(contract.kind, 'web-recovery-contract');
  assert.deepEqual(contract.actions.map(item => item.id), ['open', 'search', 'submit']);
  assert.equal(contract.expected[1].observation.dom.text, 'Results');
  assert.equal(contract.coverage.complete, true);
  assert.equal(contract.unknowns.length, 0);
});

test('behavior ignores visual hash differences while visual comparison reports them separately', () => {
  const target = capture(); const candidate = capture({ candidate: true });
  const contract = compileContract(target, candidate);
  const behavior = compareBehavior(target, candidate, contract);
  assert.equal(behavior.status, 'pass');
  assert.deepEqual(behavior.compared_channels, ['dom', 'network', 'storage']);
  const visual = compareVisual(target, candidate, contract);
  assert.equal(visual.status, 'fail');
  assert.equal(visual.mismatches[0].path, '/visual/artifact_hash');
});

test('adapting runtime receipts only admits screenshot digests to the visual channel', () => {
  const receipt = screenshot_sha256 => ({
    kind: 'web-runtime-capture',
    complete: true,
    receipt: {
      complete: true,
      cases: [{ id: 'one', input: { kind: 'wait', milliseconds: 0 },
        output: { title: 'Owned demo', text: 'Unchanged', screenshot_sha256 }, state: {}, effects: [] }],
    },
  });
  const before = receipt('a'.repeat(64));
  const after = receipt('b'.repeat(64));
  const target = captureToWebIR(before, { id: 'reference' });
  const candidate = captureToWebIR(after, { id: 'candidate' });
  assert.equal(compareBehavior(target, candidate).status, 'unknown');
  const domOnly = compileContract(target, candidate, { required_channels: ['dom'] });
  assert.equal(compareBehavior(target, candidate, domOnly).status, 'pass');
  assert.equal(compareVisual(target, candidate).status, 'fail');
  assert.equal(target.observations[0].visual.artifact_hash, before.receipt.cases[0].output.screenshot_sha256);
  assert.deepEqual(target.observations[0].dom.summary, { title: 'Owned demo', text: 'Unchanged' });
});

test('actual Chromium separates a paint-only change from identical finite web behavior', { skip: !process.env.RPM_BROWSER_EXECUTABLE, timeout: 120_000 }, async t => {
  async function serve(color) {
    const server = createServer((request, response) => {
      if (request.url === '/style.css') {
        response.writeHead(200, { 'content-type': 'text/css' });
        response.end(`body { background: ${color}; }`);
      } else {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><title>Owned control</title><link rel="stylesheet" href="/style.css"><main>Identical behavior</main>');
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    return `http://127.0.0.1:${server.address().port}/`;
  }
  const [referenceUrl, candidateUrl] = await Promise.all([serve('#ffe600'), serve('#22aaff')]);
  const result = await replayWebFeature({
    referenceUrl, candidateUrl,
    executablePath: process.env.RPM_BROWSER_EXECUTABLE,
    scenario: { schema_version: 1, name: 'Owned CSS variant', actions: [{ id: 'inspect', kind: 'wait', milliseconds: 0 }] },
  });
  assert.equal(result.reference.complete, true, JSON.stringify(result.reference.failure));
  assert.equal(result.candidate.complete, true, JSON.stringify(result.candidate.failure));
  assert.equal(result.verification.behavior.status, 'pass', JSON.stringify(result.verification.behavior.mismatches));
  assert.equal(result.verification.visual.status, 'fail');
  assert.equal(result.verification.visual.mismatches[0].path, '/visual/artifact_hash');
});

test('incomplete coverage is unknown and does not become a behavior pass', () => {
  const target = capture(); const candidate = capture({ candidate: true, incomplete: true });
  const contract = compileContract(target, candidate);
  const result = compareBehavior(target, candidate, contract);
  assert.equal(result.status, 'unknown');
  assert.equal(result.cases.some(item => item.reasons.includes('incomplete_coverage')), true);
});

test('legacy replay IR with an invented empty network summary cannot certify network equality', () => {
  const input = capture();
  input.metadata = { environment_normalization: 'Origin and port are excluded from bounded URL observations; path/query/hash remain compared.' };
  for (const observation of input.observations) observation.network.summary = [];
  assert.equal(compareBehavior(input, input).status, 'unknown');
  assert.equal(compareVisual(input, input).status, 'pass');
  const different = structuredClone(input);
  different.observations[0].dom.text = 'Verified DOM difference';
  assert.equal(compareBehavior(input, different).status, 'fail');
});

test('explicit network count rejects two observed empty windows', () => {
  const input = capture();
  for (const observation of input.observations) observation.network.summary = [];
  const rules = [{ action_id: 'submit', method: 'POST', path: '/save', count: 1 }];
  const contract = compileContract(input, input, { required_channels: ['network'], network_counts: rules });
  const result = compareBehavior(input, input, contract);
  assert.equal(result.status, 'fail');
  assert.ok(result.mismatches.some(row => row.action_id === 'submit' && row.path === '/count/candidate/POST/~1save' &&
    row.reference === 1 && row.candidate === 0));
  const valid = structuredClone(input);
  valid.observations[2].network.summary = [{ method: 'POST', path: '/save' }];
  assert.equal(compareBehavior(valid, valid, contract).status, 'pass');
  const unavailable = structuredClone(input);
  delete unavailable.observations[2].network;
  assert.equal(compareBehavior(unavailable, unavailable, contract).status, 'unknown');
  assert.throws(() => compileContract(input, input, { network_counts: [{ ...rules[0], action_id: 'wrong' }] }),
    { code: 'web_contract_type' });
});

test('a supplied contract does not certify replay of another action or stale baseline', () => {
  const old = capture();
  const contract = compileContract(old, old);
  const mismatchedInput = structuredClone(old);
  mismatchedInput.actions[1].value = 'different';
  const inputResult = compareBehavior(mismatchedInput, mismatchedInput, contract);
  assert.equal(inputResult.status, 'unknown');
  assert.ok(inputResult.cases.find(row => row.id === 'search').reasons.includes('action_input_mismatch'));
  const mismatchedOutput = structuredClone(old);
  mismatchedOutput.observations[1].dom.text = 'different';
  const outputResult = compareBehavior(mismatchedOutput, mismatchedOutput, contract);
  assert.equal(outputResult.status, 'unknown');
  assert.ok(outputResult.cases.find(row => row.id === 'search').reasons.includes('stale_reference_observation:dom'));
});

test('deep diff is deterministic, path-addressable and bounded', () => {
  const one = { b: 1, a: [{ x: 'same' }, { x: 'old' }] };
  const two = { a: [{ x: 'same' }, { x: 'new' }, { x: 'extra' }], b: 2 };
  const first = deepDiff(one, two, { maxDifferences: 8 });
  const second = deepDiff(one, two, { maxDifferences: 8 });
  assert.deepEqual(first, second);
  assert.equal(first.differences[0].path, '/a/1/x');
  assert.equal(first.differences.some(item => item.kind === 'extra'), true);
  assert.equal(deepDiff({ a: [1, 2, 3] }, { a: [4, 5, 6] }, { maxDifferences: 1 }).truncated, true);
});

test('action reducer preserves setup dependencies and mismatch fingerprint', async () => {
  const sequence = [...actions, { id: 'settle', kind: 'wait', milliseconds: 1 }];
  const result = await shrinkActions(sequence, candidate => {
    const ids = candidate.map(item => item.id);
    return ids.includes('search') && ids.includes('submit') ? { status: 'mismatch', fingerprint: 'search-submit-behavior' } : { status: 'equivalent' };
  }, { maxTests: 100, stabilityRuns: 1 });
  assert.equal(result.status, 'reduced');
  assert.deepEqual(result.actions.map(item => item.id), ['open', 'search', 'submit']);
  assert.equal(result.fingerprint, 'search-submit-behavior');
  assert.equal(result.receipts.some(item => item.status === 'invalid'), true);
});

