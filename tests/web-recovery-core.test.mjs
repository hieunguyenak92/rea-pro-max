import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('incomplete coverage is unknown and does not become a behavior pass', () => {
  const target = capture(); const candidate = capture({ candidate: true, incomplete: true });
  const contract = compileContract(target, candidate);
  const result = compareBehavior(target, candidate, contract);
  assert.equal(result.status, 'unknown');
  assert.equal(result.cases.some(item => item.reasons.includes('incomplete_coverage')), true);
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

