import test from 'node:test';
import assert from 'node:assert/strict';
import { minimizeSequence } from '../skills/rea-pro-max/lib/reduction.mjs';

const stableMismatch = sequence => ({ status: sequence.includes('open') && sequence.includes('save') && sequence.indexOf('open') < sequence.indexOf('save') ? 'mismatch' : 'equivalent', fingerprint: 'lost-note-after-restart' });

test('ddmin removes noise while resetting every oracle attempt and retaining failure identity', async () => {
  let resets = 0; let dirty = false;
  const sequence = ['noise-a', 'open', 'noise-b', 'save', 'noise-c'];
  const result = await minimizeSequence(sequence, input => { assert.equal(dirty, false); dirty = true; return stableMismatch(input); }, { reset: () => { resets++; dirty = false; } });
  assert.equal(result.status, 'reduced'); assert.deepEqual(result.sequence, ['open', 'save']); assert.equal(result.minimality, 'one-minimal');
  assert.equal(resets, result.tests); assert.equal(result.receipts.length, result.tests); assert.equal(sequence.length, 5);
});

test('a different failure cannot replace the initial failure during reduction', async () => {
  const result = await minimizeSequence(['open', 'save'], sequence => sequence.length === 1 && sequence[0] === 'save' ? { status: 'mismatch', fingerprint: 'invalid-setup-error' } : stableMismatch(sequence));
  assert.deepEqual(result.sequence, ['open', 'save']); assert.equal(result.status, 'unchanged'); assert.equal(result.minimality, 'one-minimal');
});

test('invalid reduced setups are rejected without becoming a false counterexample', async () => {
  const result = await minimizeSequence(['noise', 'open', 'save'], sequence => !sequence.includes('open') && sequence.includes('save') ? { status: 'invalid', fingerprint: '' } : stableMismatch(sequence));
  assert.deepEqual(result.sequence, ['open', 'save']); assert.equal(result.minimality, 'one-minimal');
  assert.equal(result.receipts.some(receipt => receipt.status === 'invalid'), true);
});

test('an unstable original oracle stops reduction and preserves the input', async () => {
  let calls = 0;
  const result = await minimizeSequence(['open', 'save'], () => ({ status: ++calls % 2 ? 'mismatch' : 'equivalent', fingerprint: 'lost-note-after-restart' }));
  assert.equal(result.status, 'flaky_oracle'); assert.equal(result.tests, 2); assert.equal(result.minimality, 'not-established'); assert.deepEqual(result.sequence, ['open', 'save']);
});

test('an unstable candidate is not accepted as a stable smaller reproduction', async () => {
  let calls = 0;
  const result = await minimizeSequence(['open', 'save'], sequence => { calls++; return calls <= 2 ? stableMismatch(sequence) : { status: calls % 2 ? 'mismatch' : 'equivalent', fingerprint: 'lost-note-after-restart' }; });
  assert.equal(result.status, 'flaky_oracle'); assert.equal(result.minimality, 'not-established'); assert.deepEqual(result.sequence, ['open', 'save']);
});

test('unknown, malformed and throwing oracle results retain a diagnostic and no minimality claim', async () => {
  for (const oracle of [() => ({ status: 'unknown' }), () => true, () => { throw new Error('Fixture unavailable'); }]) {
    const result = await minimizeSequence(['open'], oracle);
    assert.equal(result.status, 'unknown'); assert.equal(result.minimality, 'not-established'); assert.equal(result.receipts[0].status, 'unknown');
  }
});

test('a baseline that does not fail cannot produce a misleading reduced failure', async () => {
  const result = await minimizeSequence(['open'], () => ({ status: 'equivalent', fingerprint: '' }));
  assert.equal(result.status, 'unknown'); assert.equal(result.tests, 2); assert.equal(result.sequence.length, 1);
});

test('call budget includes stability repetitions and preserves the last qualified sequence', async () => {
  const result = await minimizeSequence(['noise', 'open', 'save'], stableMismatch, { maxTests: 3, stabilityRuns: 2 });
  assert.equal(result.tests, 3); assert.equal(result.status, 'budget_exhausted'); assert.equal(result.minimality, 'not-established'); assert.deepEqual(result.sequence, ['noise', 'open', 'save']);
  const short = await minimizeSequence(['open', 'save'], stableMismatch, { maxTests: 1 });
  assert.equal(short.status, 'budget_exhausted'); assert.equal(short.fingerprint, null);
});

test('empty and singleton failures can be qualified without claiming global shortest', async () => {
  const oracle = () => ({ status: 'mismatch', fingerprint: 'startup-failure' });
  const empty = await minimizeSequence([], oracle); assert.equal(empty.status, 'unchanged'); assert.equal(empty.minimality, 'one-minimal');
  const singleton = await minimizeSequence(['irrelevant'], oracle); assert.deepEqual(singleton.sequence, []); assert.equal(singleton.status, 'reduced');
});

test('oracle receives isolated copies and failed resets never run the oracle', async () => {
  const input = [{ type: 'open' }]; const result = await minimizeSequence(input, sequence => { sequence[0]?.type && (sequence[0].type = 'mutated'); return { status: 'equivalent', fingerprint: '' }; });
  assert.equal(input[0].type, 'open'); assert.equal(result.sequence[0].type, 'open');
  let calls = 0;
  const failed = await minimizeSequence(['open'], () => { calls++; return { status: 'mismatch', fingerprint: 'x' }; }, { reset: () => { throw new Error('Cannot restore fixture'); } });
  assert.equal(calls, 0); assert.equal(failed.status, 'unknown'); assert.match(failed.receipts[0].detail, /Cannot restore/u);
});

test('failed resets are distinguished from successful resets and actual oracle calls', async () => {
  const result = await minimizeSequence(['open'], stableMismatch, { reset: () => { throw new Error('reset failed'); } });
  assert.equal(result.tests, 1); assert.equal(result.oracle_calls, 0); assert.equal(result.reset_calls, 1);
  assert.equal(result.reset_configured, true); assert.equal(result.reset_applied, false); assert.equal(result.receipts[0].reset_applied, false);
});
