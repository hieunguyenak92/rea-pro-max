import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureMv3 } from '../skills/rea-pro-max/lib/runtime/mv3.mjs';
import { replayFeature, checkExpected } from '../skills/rea-pro-max/lib/runtime/replay.mjs';

const tokens = process.argv.slice(2), flags = {};
for (let index = 0; index < tokens.length; index += 2) {
  if (!['--browser', '--out'].includes(tokens[index]) || !tokens[index + 1] || flags[tokens[index]]) throw new Error('Use check-recovery.mjs --browser ABSOLUTE_CHROMIUM [--out NEW_DIRECTORY].');
  flags[tokens[index]] = tokens[index + 1];
}
if (!flags['--browser']) throw new Error('Select --browser explicitly. This check executes owned MV3 fixtures in real Chromium.');
const assets = fileURLToPath(new URL('../skills/rea-pro-max/assets/recovery/', import.meta.url));
const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/recovery/acceptance.json', import.meta.url), 'utf8'));
const scenario = JSON.parse(readFileSync(resolve(assets, 'scenario.json'), 'utf8'));
const options = { executablePath: flags['--browser'] };
const evidence = { date: new Date().toISOString(), scope: 'Owned public fixtures. Receiving implementation authored separately from reference and acceptance corpus; not a permanently blinded or general effectiveness benchmark.', checks: [], captures: [] };
const progress = value => process.stderr.write(`${value}\n`);
progress('Checking starter mismatch');
const before = await replayFeature({ ...options, referencePath: resolve(assets, 'reference'), candidatePath: resolve(assets, 'starter'), scenario });
assert.equal(before.status, 'fail', JSON.stringify(before));
assert.equal(before.verification.cases.find(item => item.id === 'warm-read').status, 'pass');
assert.equal(before.verification.cases.find(item => item.id === 'cold-read').status, 'fail');
evidence.checks.push({ name: 'starter fails after real forced restart', status: 'pass', verdict: before.status });
evidence.before = before;
progress('Checking recovered implementation');
const after = await replayFeature({ ...options, referencePath: resolve(assets, 'reference'), candidatePath: resolve(assets, 'recovered'), scenario });
assert.equal(after.status, 'pass', JSON.stringify(after));
evidence.checks.push({ name: 'recovered matches reference in declared scenario', status: 'pass', verdict: after.status });
evidence.after = after;
for (const item of corpus.cases) {
  const actions = item.actions.map((action, index) => ({ id: `step-${index + 1}`, kind: action.kind === 'worker-restart' ? 'worker-stop' : action.kind, ...(action.kind === 'message' ? { message: action.message } : {}) }));
  const expected = item.actions.flatMap((action, index) => action.kind === 'message' ? [{ id: `step-${index + 1}`, output: action.expected }] : []);
  for (const variant of ['reference', 'recovered']) {
    progress(`Acceptance: ${variant}/${item.id}`);
    const capture = await captureMv3({ ...options, extensionPath: resolve(assets, variant), scenario: { schema_version: 1, name: item.id, page: 'runner.html', actions } });
    const verdict = checkExpected(capture, expected);
    assert.equal(verdict.status, 'pass', JSON.stringify({ variant, case: item.id, verdict, failure: capture.failure }));
    evidence.checks.push({ name: `${variant}/${item.id}`, status: verdict.status, actions: expected.length });
    evidence.captures.push({ variant, case: item.id, capture, verdict });
  }
}
progress('Checking natural idle separately');
const idleScenario = { schema_version: 1, name: 'Natural idle qualified independently', page: 'runner.html', actions: [scenario.actions[0], { id: 'idle', kind: 'idle', milliseconds: 35000 }, scenario.actions[4]] };
const idle = await captureMv3({ ...options, extensionPath: resolve(assets, 'recovered'), scenario: idleScenario });
assert.equal(idle.complete, true, JSON.stringify(idle.failure || idle.unknowns));
assert.equal(idle.lifecycle[0].worker_absent_before_wake, true);
assert.equal(idle.lifecycle[0].qualified, true);
assert.equal(idle.receipt.cases.at(-1).output.result.value, 'A decision worth keeping.');
evidence.idle = idle; evidence.checks.push({ name: 'recovered retains save across qualified natural idle', status: 'pass' });
if (flags['--out']) {
  const directory = resolve(flags['--out']);
  if (existsSync(directory)) throw new Error('Choose a new evidence directory.');
  mkdirSync(directory);
  writeFileSync(resolve(directory, 'runtime-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
}
console.log(JSON.stringify({ checks: evidence.checks, total: evidence.checks.length, evidence: flags['--out'] ? resolve(flags['--out'], 'runtime-evidence.json') : null }, null, 2));
