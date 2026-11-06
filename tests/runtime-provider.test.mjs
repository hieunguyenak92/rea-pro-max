import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { captureMv3, runtimeDoctor, validateScenario } from '../skills/rea-pro-max/lib/runtime/mv3.mjs';
import { compareBehavior } from '../skills/rea-pro-max/lib/verification.mjs';

const base = { schema_version: 1, name: 'Owned persistence', page: 'runner.html', actions: [{ id: 'put', kind: 'message', message: { type: 'put', key: 'hello', value: 'world', requestId: 'one' } }, { id: 'reopen', kind: 'page-reopen' }, { id: 'warm', kind: 'message', message: { type: 'get', key: 'hello' } }, { id: 'stop', kind: 'worker-stop' }, { id: 'cold', kind: 'message', message: { type: 'get', key: 'hello' } }] };
const fixture = name => fileURLToPath(new URL(`../skills/rea-pro-max/assets/recovery/${name}`, import.meta.url));

test('runtime scenarios reject unknown actions, paths and unbounded payloads before execution', () => {
  assert.deepEqual(validateScenario(base), base);
  for (const page of ['../runner.html', '/runner.html', 'https://example.org/x.html', 'x/../runner.html', 'x\\runner.html']) assert.throws(() => validateScenario({ ...base, page }), { code: 'invalid_scenario' });
  assert.throws(() => validateScenario({ ...base, actions: [{ id: 'x', kind: 'shell', command: 'echo nope' }] }), { code: 'invalid_scenario' });
  assert.throws(() => validateScenario({ ...base, actions: [{ id: 'x', kind: 'message', message: { data: 'x'.repeat(17000) } }] }), { code: 'invalid_scenario' });
  assert.throws(() => validateScenario({ ...base, actions: [{ id: 'x', kind: 'idle', milliseconds: 1000 }] }), { code: 'invalid_scenario' });
  assert.throws(() => validateScenario({ ...base, actions: [base.actions[0], base.actions[0]] }), { code: 'invalid_scenario' });
});

test('runtime doctor requires an explicit absolute executable; never selects personal browser state', async () => {
  await assert.rejects(() => runtimeDoctor('chrome'), { code: 'browser_required' });
  await assert.rejects(() => runtimeDoctor('/no-such-browser/rea-pro-max'), { code: 'ENOENT' });
});

test('cancelled captures retain unknown and confirm cleanup instead of returning a successful receipt', async () => {
  const control = new AbortController(); control.abort();
  const result = await captureMv3({ executablePath: process.execPath, extensionPath: fixture('reference'), scenario: base, signal: control.signal });
  assert.equal(result.complete, false); assert.equal(result.receipt.complete, false);
  assert.equal(result.failure.code, 'request_cancelled'); assert.equal(result.receipt.cases.length, 0);
  assert.deepEqual(result.provenance.cleanup, { browser_terminated: true, profile_removed: true });
});

test('actual Chromium distinguishes page reopen and forced worker restart, detecting memory-only persistence', { skip: !process.env.RPM_BROWSER_EXECUTABLE, timeout: 120000 }, async () => {
  const options = { executablePath: process.env.RPM_BROWSER_EXECUTABLE, scenario: base };
  const reference = await captureMv3({ ...options, extensionPath: fixture('reference') });
  const regression = await captureMv3({ ...options, extensionPath: fixture('regression') });
  assert.equal(reference.complete, true, JSON.stringify(reference.failure || reference.unknowns));
  assert.equal(regression.complete, true, JSON.stringify(regression.failure || regression.unknowns));
  for (const result of [reference, regression]) {
    const stop = result.lifecycle.find(item => item.reset === 'forced-worker-stop');
    assert.equal(stop.qualified, true); assert.equal(stop.stopped_observed, true); assert.notEqual(stop.before_boot_id, stop.after_boot_id);
    assert.equal(stop.worker_debugger_attached, false);
    assert.equal(result.provenance.authority, 'provider-captured');
  }
  const verdict = compareBehavior(reference.receipt, regression.receipt);
  assert.equal(verdict.status, 'fail');
  assert.equal(verdict.cases.find(item => item.id === 'warm').status, 'pass');
  assert.equal(verdict.cases.find(item => item.id === 'cold').status, 'fail');
  const fidelity = await captureMv3({ ...options, extensionPath: fixture('reference'), scenario: { ...base, actions: [{ id: 'own-proto', kind: 'message', message: JSON.parse('{"type":"get","key":"x","__proto__":{"unexpected":true}}') }] } });
  assert.equal(fidelity.complete, true, JSON.stringify(fidelity.failure));
  assert.deepEqual(fidelity.receipt.cases[0].output, { ok: false, error: { code: 'invalid_message' } });
});

test('actual Chromium natural idle requires worker absence and a changed boot before qualification', { skip: !process.env.RPM_BROWSER_EXECUTABLE || !process.env.RPM_TEST_NATURAL_IDLE, timeout: 100000 }, async () => {
  const scenario = { ...base, actions: [base.actions[0], { id: 'idle', kind: 'idle', milliseconds: 35000 }, base.actions.at(-1)] };
  const result = await captureMv3({ executablePath: process.env.RPM_BROWSER_EXECUTABLE, extensionPath: fixture('reference'), scenario });
  assert.equal(result.complete, true, JSON.stringify(result.failure || result.unknowns));
  const idle = result.lifecycle[0];
  assert.equal(idle.reset, 'natural-idle'); assert.equal(idle.worker_absent_before_wake, true); assert.notEqual(idle.before_boot_id, idle.after_boot_id); assert.equal(idle.qualified, true);
  assert.equal(result.receipt.cases.at(-1).output.result.value, 'world');
});
