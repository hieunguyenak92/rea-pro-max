import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileRuntime } from '../skills/rea-pro-max/lib/reconciliation.mjs';

const sha = '1'.repeat(64);
const inspect = nodes => ({ artifact: { kind: 'manifest-v3', sha256: sha }, contexts: [{ id: 'worker', kind: 'service-worker' }, { id: 'content', kind: 'content-script' }], nodes });
const handler = (id, channel, context = 'worker') => ({ id, kind: 'message-listener', channel, context_id: context });
const event = (id, type) => ({ kind: 'message-response', action_id: id, request: { type } });
const capture = events => ({ kind: 'runtime-capture', complete: true, events, receipt: { complete: true, bindings: { target_sha256: sha } }, provenance: { authority: 'provider-captured', target: { sha256: sha } } });

test('reconciliation binds the target and retains each repeated observed action', () => {
  const result = reconcileRuntime(inspect([handler('save', 'save|draft'), handler('content', 'save|draft', 'content')]), capture([
    event('one', 'save|draft'), { kind: 'storage-local', action_id: 'two' }, event('three', 'save|draft'),
  ]), { sessionCapture: true });
  assert.equal(result.status, 'matched');
  assert.equal(result.authority.runtime, 'provider-captured');
  assert.deepEqual(result.events.map(row => row.event_index), [0, 2]);
  assert.equal(result.matches[0].event_count, 2);
  assert.equal(result.coverage.storage_snapshots, 1);
});

test('saved captures remain reported and incomplete captures remain partial', () => {
  const result = reconcileRuntime(inspect([handler('save', 'save')]), { ...capture([event('one', 'save')]), complete: false });
  assert.equal(result.status, 'partial');
  assert.equal(result.events[0].authority, 'reported');
  assert.ok(result.unknowns.some(row => row.code === 'runtime_capture_incomplete'));
});

test('ambiguous or unresolved channels and duplicate action IDs retain distinct evidence', () => {
  const result = reconcileRuntime(inspect([handler('read', 'read'), handler('save-a', 'save'), handler('save-b', 'save'), handler('dynamic', null)]), capture([
    event('same', 'read'), event('same', 'save'), event('different', 'extra'), event('missing', null),
  ]));
  assert.equal(result.status, 'partial');
  assert.equal(result.coverage.matched_events, 1);
  assert.deepEqual(result.unmatched_runtime.map(row => row.event_index), [1, 2, 3]);
  assert.ok(result.unknowns.some(row => row.code === 'static_channel_ambiguous'));
});

test('a different artifact or web capture cannot establish an MV3 correlation', () => {
  const baseline = capture([event('one', 'save')]);
  assert.throws(() => reconcileRuntime(inspect([]), { ...baseline, provenance: { target: { sha256: '2'.repeat(64) } } }), { code: 'binding_mismatch' });
  assert.throws(() => reconcileRuntime(inspect([]), { ...baseline, kind: 'web-runtime-capture' }), { code: 'reconcile_unsupported' });
});
