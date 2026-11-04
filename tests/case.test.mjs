import test from 'node:test';
import assert from 'node:assert/strict';
import { createCase, reviseCase, addObservation, validateCase } from '../skills/rea-pro-max/lib/case.mjs';

const hash = character => character.repeat(64);
const bindings = { target_sha256: hash('a'), scenario_sha256: hash('b'), reset_sha256: hash('c'), toolchain_sha256: hash('d') };
const probe = { id: 'cold-worker', label: 'Restart the fixture worker', cost: 2, requires: ['fixture-browser'], effects: ['restart-worker'], reset: 'Fresh fixture profile', steps: ['Save a note', 'Close the popup', 'Wake the suspended worker'] };
function prepared() {
  const initial = createCase({ goal: 'Determine note persistence', target: { kind: 'mv3', sha256: hash('a') } });
  return reviseCase(initial, { probes: [probe], hypotheses: [{ id: 'memory', label: 'Worker memory', predictions: { 'cold-worker': 'lost' } }] }, 1);
}
const observation = () => ({ probe_id: 'cold-worker', outcome: 'lost', source: 'Owned fixture UI receipt', authority: 'reported', bindings, partial: false });

test('case creation and revisions retain independent immutable input data', () => {
  const target = { kind: 'mv3', sha256: hash('A'), metadata: { version: '1.0' } };
  const initial = createCase({ goal: 'Trace a message', target });
  target.metadata.version = 'modified';
  assert.equal(initial.target.metadata.version, '1.0');
  assert.equal(initial.target.sha256, hash('a'));
  const next = reviseCase(initial, { probes: [probe] }, initial.revision);
  assert.equal(initial.probes.length, 0); assert.equal(next.revision, 2);
  assert.throws(() => reviseCase(next, { goal: 'Stale edit' }, 1), { code: 'revision_conflict' });
});

test('a recipe and prediction must retain a real, unique target/probe identity', () => {
  const value = prepared();
  assert.throws(() => reviseCase(value, { probes: [probe, probe] }, 2), { code: 'duplicate_identity' });
  assert.throws(() => reviseCase(value, { probes: [] }, 2), { code: 'unknown_probe' });
  assert.throws(() => createCase({ goal: 'Investigate', target: { kind: 'mv3', sha256: 'not-a-digest' } }), { code: 'invalid_case' });
  assert.throws(() => reviseCase(value, { probes: [{ ...probe, reset: '' }] }, 2), { code: 'invalid_case' });
});

test('observations receive a content digest without upgrading reported authority', () => {
  const before = prepared(); const raw = observation(); const after = addObservation(before, raw, 2);
  assert.equal(before.observations.length, 0); assert.equal(after.observations[0].authority, 'reported');
  assert.equal(after.observations[0].content_sha256.length, 64);
  assert.equal(after.revision, 3); assert.equal(raw.id, undefined);
  const again = addObservation(after, raw, 3);
  assert.deepEqual(again, after);
  const partial = addObservation(after, { ...observation(), partial: true, outcome: 'retained' }, 3);
  assert.equal(partial.observations[1].partial, true);
});

test('a reused observation identity cannot silently acquire different content', () => {
  const before = prepared(); const after = addObservation(before, { ...observation(), id: 'manual-boot-test' }, 2);
  assert.throws(() => addObservation(after, { ...observation(), id: 'manual-boot-test', outcome: 'retained' }, 3), { code: 'observation_conflict' });
  assert.throws(() => addObservation(after, observation(), 2), { code: 'revision_conflict' });
  const changed = structuredClone(after); changed.observations[0].outcome = 'retained';
  assert.throws(() => validateCase(changed), { code: 'observation_integrity' });
});

test('historical observations remain bound to their original artifact after target revision', () => {
  const observed = addObservation(prepared(), observation(), 2);
  const revised = reviseCase(observed, { target: { kind: 'mv3', sha256: hash('e') } }, 3);
  assert.equal(revised.observations[0].bindings.target_sha256, hash('a'));
  assert.equal(revised.target.sha256, hash('e'));
});

test('malformed or unsupported case contracts fail instead of partial acceptance', () => {
  const value = prepared();
  assert.throws(() => reviseCase(value, { observations: [] }, 2), { code: 'invalid_case_patch' });
  assert.throws(() => reviseCase(value, {}, 2), { code: 'invalid_case_patch' });
  assert.throws(() => validateCase({ ...value, schema_version: 2 }), { code: 'case_version' });
  assert.throws(() => addObservation(value, { ...observation(), authority: 'proven' }, 2), { code: 'invalid_observation' });
  assert.throws(() => addObservation(value, { ...observation(), probe_id: 'unregistered-probe' }, 2), { code: 'unknown_probe' });
});

test('noncanonical or rolled-over case dates cannot masquerade as captured creation times', () => {
  const value = prepared();
  for (const created_at of ['1', '2026-02-31T00:00:00.000Z']) assert.throws(() => validateCase({ ...value, created_at }), { code: 'invalid_case' });
});
