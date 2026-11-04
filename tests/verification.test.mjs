import test from 'node:test';
import assert from 'node:assert/strict';
import { compareBehavior } from '../skills/rea-pro-max/lib/verification.mjs';

const hash = character => character.repeat(64);
function receipt(target = 'a') {
  return { schema_version: 1, complete: true, bindings: { target_sha256: hash(target), scenario_sha256: hash('b'), reset_sha256: hash('c'), toolchain_sha256: hash('d'), verifier_sha256: hash('e') }, cases: [{ id: 'save-restart', input: { text: 'Tiếng Việt' }, output: { saved: true }, state: { notes: ['Tiếng Việt'] }, effects: [{ kind: 'write', count: 1 }] }] };
}
const event = (channel, name, value = null) => ({ channel, name, value });

test('finite equivalent behavior permits different target artifacts while binding the common oracle', () => {
  const original = receipt(); const candidate = receipt('f'); candidate.cases[0].state = { notes: ['Tiếng Việt'] };
  const result = compareBehavior(original, candidate);
  assert.equal(result.status, 'pass'); assert.deepEqual(result.summary, { pass: 1, fail: 0, unknown: 0, missing: 0, extra: 0 });
  assert.match(result.scope, /does not attest runtime/u);
});

test('lost persisted writes and duplicate side effects remain behavioral failures', () => {
  const candidate = receipt('f'); candidate.cases[0].state.notes = []; candidate.cases[0].effects.push({ kind: 'write', count: 1 });
  const result = compareBehavior(receipt(), candidate);
  assert.equal(result.status, 'fail'); assert.deepEqual(result.cases[0].differences.map(item => item.path), ['/state', '/effects']);
});

test('different input or incomplete observations produce unknown, never equivalence', () => {
  const different = receipt('f'); different.cases[0].input.text = 'different';
  assert.equal(compareBehavior(receipt(), different).status, 'unknown');
  const partial = receipt('f'); partial.complete = false; partial.cases[0].output.saved = false;
  assert.equal(compareBehavior(receipt(), partial).status, 'unknown');
  const missing = receipt('f'); delete missing.cases[0].state;
  assert.equal(compareBehavior(receipt(), missing).cases[0].reasons.includes('missing_state'), true);
});

test('unmatched or empty case universes are explicitly incomplete', () => {
  const candidate = receipt('f'); candidate.cases[0].id = 'other-case';
  const result = compareBehavior(receipt(), candidate);
  assert.equal(result.status, 'unknown'); assert.equal(result.summary.missing, 1); assert.equal(result.summary.extra, 1); assert.equal(result.summary.unknown, 2);
  const empty = receipt(); empty.cases = [];
  assert.equal(compareBehavior(empty, empty).status, 'unknown');
});

test('scenario, reset, toolchain and verifier changes invalidate comparability', () => {
  for (const key of ['scenario_sha256', 'reset_sha256', 'toolchain_sha256', 'verifier_sha256']) {
    const candidate = receipt('f'); candidate.bindings[key] = hash('f');
    const result = compareBehavior(receipt(), candidate);
    assert.equal(result.status, 'unknown'); assert.equal(result.comparability.reasons.includes(`binding_mismatch:${key}`), true);
  }
  const missing = receipt('f'); delete missing.bindings.target_sha256;
  assert.equal(compareBehavior(receipt(), missing).status, 'unknown');
});

test('current expected artifact identities can reject a stale otherwise matching receipt', () => {
  const result = compareBehavior(receipt(), receipt('f'), { expected_bindings: { candidate: { target_sha256: hash('a') } } });
  assert.equal(result.status, 'unknown'); assert.equal(result.comparability.reasons.includes('stale_candidate:target_sha256'), true);
});

test('per-channel ordering allows only declared independent interleaving', () => {
  const original = receipt(); const candidate = receipt('f');
  original.cases[0].trace = [event('popup', 'open'), event('worker', 'receive'), event('popup', 'show')];
  candidate.cases[0].trace = [event('worker', 'receive'), event('popup', 'open'), event('popup', 'show')];
  assert.equal(compareBehavior(original, candidate).status, 'fail');
  assert.equal(compareBehavior(original, candidate, { trace_order: 'per-channel' }).status, 'pass');
  candidate.cases[0].trace = [event('popup', 'show'), event('popup', 'open'), event('worker', 'receive')];
  assert.equal(compareBehavior(original, candidate, { trace_order: 'per-channel' }).status, 'fail');
  candidate.cases[0].trace = [...original.cases[0].trace, event('worker', 'receive')];
  assert.equal(compareBehavior(original, candidate, { trace_order: 'per-channel' }).status, 'fail');
});

test('a missing trace cannot be silently normalized to an empty observation', () => {
  const original = receipt(); original.cases[0].trace = [];
  assert.equal(compareBehavior(original, receipt('f')).status, 'unknown');
});

test('explicit volatile metadata paths do not erase output or mutate inputs', () => {
  const original = receipt(); const candidate = receipt('f');
  original.cases[0].metadata = { 'duration/ms': 10 }; candidate.cases[0].metadata = { 'duration/ms': 20 };
  assert.equal(compareBehavior(original, candidate).status, 'fail');
  assert.equal(compareBehavior(original, candidate, { volatile_paths: ['/metadata/duration~1ms'] }).status, 'pass');
  assert.equal(original.cases[0].metadata['duration/ms'], 10);
  for (const path of ['/output', '/state/notes', '/effects', '/trace', '/metadata']) assert.throws(() => compareBehavior(original, candidate, { volatile_paths: [path] }), { code: 'unsafe_normalization' });
});

test('a clear comparable failure stays a failure alongside an unmatched case', () => {
  const candidate = receipt('f'); candidate.cases[0].output.saved = false;
  candidate.cases.push({ ...candidate.cases[0], id: 'extra' });
  const result = compareBehavior(receipt(), candidate); assert.equal(result.status, 'fail'); assert.equal(result.summary.fail, 1); assert.equal(result.summary.unknown, 1);
});

test('ambiguous receipt identities, unsupported contracts and malformed traces fail validation', () => {
  const duplicate = receipt(); duplicate.cases.push(duplicate.cases[0]);
  assert.throws(() => compareBehavior(duplicate, receipt()), { code: 'duplicate_case' });
  assert.throws(() => compareBehavior({ ...receipt(), schema_version: 2 }, receipt()), { code: 'receipt_version' });
  const bad = receipt(); bad.cases[0].trace = [{ channel: 'worker', name: 'save' }];
  assert.throws(() => compareBehavior(bad, receipt()), { code: 'invalid_trace' });
  assert.throws(() => compareBehavior(receipt(), receipt(), { trace_order: 'unordered' }), { code: 'invalid_contract' });
});

test('null metadata and unknown unexamined case fields are not silently treated as equivalent', () => {
  const original = receipt(); const candidate = receipt('f'); original.cases[0].metadata = null; candidate.cases[0].metadata = {};
  assert.equal(compareBehavior(original, candidate).status, 'fail');
  candidate.cases[0].side_effects = [{ kind: 'unexamined-write' }];
  assert.throws(() => compareBehavior(original, candidate), { code: 'invalid_receipt' });
});
