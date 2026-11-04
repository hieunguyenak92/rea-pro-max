import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { digest } from '../skills/rea-pro-max/lib/common.mjs';
import { behaviorDocument, simulateWorker } from '../skills/rea-pro-max/lib/lab.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'skills/rea-pro-max/scripts/rea-pro-max.mjs');
const fixture = join(root, 'skills/rea-pro-max/assets/labs/mv3/reference');
const hash = character => character.repeat(64);
function workspace(t) {
  const directory = mkdtempSync(join(tmpdir(), 'rpm-cli-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function run(args, status = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, status, `CLI ${args[0]} exited ${result.status}: ${result.stderr}`);
  if (status === 0 || status === 2 || status === 3) assert.equal(result.stderr, '');
  return result;
}
const parse = result => JSON.parse(result.stdout);
const read = file => JSON.parse(readFileSync(file, 'utf8'));
function save(directory, name, value) {
  const file = join(directory, name); writeFileSync(file, JSON.stringify(value)); return file;
}
function receipt(target = 'a') {
  return { schema_version: 1, complete: true, bindings: { target_sha256: hash(target), scenario_sha256: hash('b'), reset_sha256: hash('c'), toolchain_sha256: hash('d'), verifier_sha256: hash('e') }, cases: [{ id: 'persist', input: { text: '東京 · Tiếng Việt' }, output: { saved: true }, state: { notes: ['東京 · Tiếng Việt'] }, effects: [] }] };
}

test('demo exports a reproducible failing case, a reduced sequence and a standalone report without overwriting', t => {
  const directory = workspace(t); const out = join(directory, 'lab');
  const result = parse(run(['demo', '--out', out]));
  assert.equal(result.verification, 'fail');
  assert.equal(result.reduction.status, 'reduced');
  assert.equal(result.reduction.original_actions, 5);
  assert.equal(result.reduction.reduced_actions, 3);
  for (const artifact of result.artifacts) assert.equal(typeof read(join(out, artifact)), 'object');
  assert.equal(read(join(out, 'verification.json')).status, 'fail');
  for (const [document, kind] of [['reference', 'reference'], ['candidate', 'regression']]) {
    const receipt = read(join(out, `${document}.json`));
    const source = readFileSync(join(out, 'fixtures/mv3', kind, 'worker.js'));
    assert.equal(receipt.bindings.target_sha256, createHash('sha256').update(source).digest('hex'));
    assert.equal(receipt.bindings.scenario_sha256, digest(receipt.cases[0].input));
  }
  const reduced = read(join(out, 'reduction.json'));
  assert.deepEqual(reduced.sequence.map(action => action.type), ['save', 'restart', 'read']);
  assert.equal(reduced.minimality, 'one-minimal');
  assert.equal(read(join(out, 'planner.json')).status, 'open');
  const html = readFileSync(result.report, 'utf8');
  const embedded = html.match(/<script type="application\/json" id="rpm-data">([\s\S]*?)<\/script>/u);
  assert.ok(embedded); assert.deepEqual(JSON.parse(embedded[1]), read(join(out, 'lab.json')));
  assert.doesNotMatch(html, /__RPM_(?:DATA|STYLE|SCRIPT)__/u);
  assert.doesNotMatch(html, /<(?:script|link)\b[^>]*(?:src|href)\s*=/iu);
  const before = readFileSync(result.report);
  const duplicate = run(['demo', '--out', out], 1);
  assert.equal(JSON.parse(duplicate.stderr).error, 'output_exists');
  assert.deepEqual(readFileSync(result.report), before);
});

test('inspection survives a CLI JSON roundtrip and cases retain revisions and observation provenance', t => {
  const directory = workspace(t); const inspectionFile = join(directory, 'inspection.json');
  const inspected = parse(run(['inspect', fixture, '--out', inspectionFile]));
  assert.deepEqual(read(inspectionFile), inspected);
  assert.equal(inspected.artifact.kind, 'manifest-v3');
  const caseFile = join(directory, 'case.json');
  const initial = parse(run(['case', 'init', '--inspection', inspectionFile, '--goal', 'Find retained state', '--out', caseFile]));
  assert.equal(initial.target.sha256, inspected.artifact.sha256);
  const patch = save(directory, 'patch.json', {
    hypotheses: [{ id: 'memory', label: 'Volatile memory', predictions: { restart: 'lost' } }, { id: 'persistent', label: 'Persistent state', predictions: { restart: 'retained' } }],
    probes: [{ id: 'restart', label: 'Restart an owned worker', cost: 2, reset: 'Fresh owned state', steps: ['Save a clip', 'Restart', 'Read clips'], requires: [], effects: [] }],
  });
  const revised = parse(run(['case', 'revise', caseFile, '--patch', patch, '--revision', '1']));
  assert.equal(revised.revision, 2); assert.deepEqual(read(caseFile), revised);
  const bindings = { target_sha256: inspected.artifact.sha256, scenario_sha256: hash('b'), reset_sha256: hash('c'), toolchain_sha256: hash('d') };
  const bindingsFile = save(directory, 'bindings.json', bindings);
  const before = parse(run(['plan', caseFile, '--bindings', bindingsFile, '--budget', '2']));
  assert.equal(before.next_probe_id, 'restart');
  const observation = save(directory, 'observation.json', { probe_id: 'restart', outcome: 'retained', source: 'Owned fixture observation', authority: 'reported', bindings, partial: false });
  const observed = parse(run(['case', 'observe', caseFile, '--receipt', observation, '--revision', '2']));
  assert.equal(observed.revision, 3); assert.equal(observed.observations[0].authority, 'reported');
  const after = parse(run(['plan', caseFile, '--bindings', bindingsFile]));
  assert.equal(after.status, 'resolved'); assert.deepEqual(after.surviving_ids, ['persistent']);
  assert.equal(after.applied_observations[0].authority, 'reported');
  const stale = run(['case', 'revise', caseFile, '--patch', patch, '--revision', '2'], 1);
  assert.equal(JSON.parse(stale.stderr).error, 'revision_conflict'); assert.deepEqual(read(caseFile), observed);
});

test('verification exit codes distinguish pass, mismatch, insufficient evidence and invalid input', t => {
  const directory = workspace(t); const referenceFile = save(directory, 'reference.json', receipt());
  for (const [kind, expected] of [['equal', 0], ['mismatch', 2], ['partial', 3]]) {
    const candidate = receipt('f');
    if (kind === 'mismatch') candidate.cases[0].state.notes = [];
    if (kind === 'partial') candidate.complete = false;
    const candidateFile = save(directory, `${kind}.json`, candidate); const output = join(directory, `${kind}-verdict.json`);
    const result = parse(run(['verify', '--reference', referenceFile, '--candidate', candidateFile, '--out', output], expected));
    assert.equal(result.status, { equal: 'pass', mismatch: 'fail', partial: 'unknown' }[kind]);
    assert.deepEqual(read(output), result);
    const protectedFile = readFileSync(output);
    assert.equal(JSON.parse(run(['verify', '--reference', referenceFile, '--candidate', candidateFile, '--out', output], 1).stderr).error, 'output_exists');
    assert.deepEqual(readFileSync(output), protectedFile);
  }
  const invalid = save(directory, 'invalid.json', { schema_version: 999 });
  assert.equal(JSON.parse(run(['verify', '--reference', referenceFile, '--candidate', invalid], 1).stderr).error, 'receipt_version');
});

test('report embeds untrusted JSON as inert parseable data and refuses overwrite', t => {
  const directory = workspace(t);
  const payload = { schema_version: 1, title: '</script><script>globalThis.PWNED=true</script>\u2028\u2029', kind: 'lab', narrative: { description: '<img src=x onerror=alert(1)> & __RPM_SCRIPT__' } };
  const source = save(directory, 'data.json', payload); const out = join(directory, 'report.html');
  assert.equal(run(['report', source, '--out', out]).stdout.trim(), out);
  const html = readFileSync(out, 'utf8');
  const embedded = html.match(/<script type="application\/json" id="rpm-data">([\s\S]*?)<\/script>/u);
  assert.ok(embedded); assert.deepEqual(JSON.parse(embedded[1]), payload);
  assert.doesNotMatch(embedded[1], /[<\u2028\u2029]/u);
  assert.doesNotMatch(html, /<script>globalThis\.PWNED/u);
  const previous = readFileSync(out);
  assert.equal(JSON.parse(run(['report', source, '--out', out], 1).stderr).error, 'output_exists');
  assert.deepEqual(readFileSync(out), previous);
});

test('shrink explicitly invokes an owned module with reset before every oracle attempt', t => {
  const directory = workspace(t); const input = save(directory, 'actions.json', ['noise', 'save', 'restart', 'read', 'noise']);
  const oracle = join(directory, 'owned-oracle.mjs');
  writeFileSync(oracle, `let ready = false;
export async function reset() { ready = true; }
export async function oracle(sequence) {
  if (!ready) throw new Error('Missing reset'); ready = false;
  return { status: ['save','restart','read'].every(event => sequence.includes(event)) ? 'mismatch' : 'equivalent', fingerprint: 'lost-persistence' };
}\n`);
  const out = join(directory, 'reduced.json');
  const result = parse(run(['shrink', '--input', input, '--oracle', oracle, '--max-tests', '80', '--out', out]));
  assert.equal(result.status, 'reduced'); assert.equal(result.minimality, 'one-minimal');
  assert.deepEqual(result.sequence, ['save', 'restart', 'read']); assert.deepEqual(read(out), result);
  assert.equal(result.reset_applied, true); assert.equal(result.oracle_calls, result.reset_calls);
  assert.equal(result.receipts.every(item => item.reset_applied), true);
});

test('uncertain, unstable and budget-limited reductions exit 3 and retain the reason', t => {
  const directory = workspace(t); const input = save(directory, 'actions.json', ['save', 'read']);
  const scenarios = [
    ['unknown', 'export const oracle = () => ({status:"unknown"});', [], 'unknown'],
    ['flaky', 'let count = 0; export const oracle = () => ({status: ++count % 2 ? "mismatch" : "equivalent", fingerprint:"same-failure"});', [], 'flaky_oracle'],
    ['budget', 'export const oracle = () => ({status:"mismatch", fingerprint:"same-failure"});', ['--max-tests', '1'], 'budget_exhausted'],
  ];
  for (const [name, source, options, expected] of scenarios) {
    const module = join(directory, `${name}.mjs`); writeFileSync(module, source);
    const result = parse(run(['shrink', '--input', input, '--oracle', module, ...options], 3));
    assert.equal(result.status, expected); assert.equal(result.minimality, 'not-established'); assert.ok(result.reason);
  }
});

test('behavior receipts bind the actual requested sequence instead of the default scenario', async () => {
  const sequence = [{ type: 'save', text: 'A second scenario' }, { type: 'read' }];
  const result = await simulateWorker('reference', sequence); const document = behaviorDocument(result, 'second-scenario');
  assert.deepEqual(document.cases[0].input, sequence);
  assert.equal(document.cases[0].id, 'second-scenario');
  assert.equal(document.bindings.scenario_sha256, digest(sequence));
  assert.deepEqual(document.cases[0].state, [{ id: '0001', text: 'A second scenario' }]);
  sequence[0].text = 'Changed caller input';
  assert.equal(document.cases[0].input[0].text, 'A second scenario');
});

test('symlink JSON and oracle inputs are rejected before interpretation', t => {
  const directory = workspace(t); const source = save(directory, 'data.json', receipt());
  const linked = join(directory, 'linked.json');
  try { symlinkSync(source, linked); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Symlink privilege is unavailable.'); return; } throw error; }
  assert.equal(JSON.parse(run(['report', linked, '--out', join(directory, 'bad.html')], 1).stderr).error, 'input_bounds');
  const module = join(directory, 'owned.mjs'); writeFileSync(module, 'export const oracle = () => ({status:"equivalent"});');
  const moduleLink = join(directory, 'linked.mjs'); symlinkSync(module, moduleLink);
  assert.equal(JSON.parse(run(['shrink', '--input', source, '--oracle', moduleLink], 1).stderr).error, 'oracle_input');
});

test('CLI invoked through a symlinked parent directory still executes its entrypoint', t => {
  const directory = workspace(t); const alias = join(directory, 'installed-skill');
  try { symlinkSync(join(root, 'skills/rea-pro-max'), alias, 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Directory symlink privilege is unavailable.'); return; } throw error; }
  const result = spawnSync(process.execPath, [join(alias, 'scripts/rea-pro-max.mjs'), 'help'], { cwd: directory, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, '');
  assert.match(result.stdout, /REA Pro Max 0\.2\.0/u);
});

test('malformed JSON, ambiguous options and extra positional arguments are rejected', t => {
  const directory = workspace(t); const source = save(directory, 'data.json', receipt());
  const malformed = join(directory, 'malformed.json'); writeFileSync(malformed, '{');
  assert.equal(JSON.parse(run(['report', malformed, '--out', join(directory, 'bad.html')], 1).stderr).error, 'invalid_json');
  const module = join(directory, 'owned.mjs'); writeFileSync(module, 'export const oracle = () => ({status:"equivalent"});');
  for (const args of [['inspect', fixture, '--mystery'], ['inspect', fixture, '--out', 'a', '--out', 'b'], ['demo', '--out'], ['inspect', fixture, 'ignored-extra'], ['version', '--unknown', 'value'], ['plan', source, '--budget'], ['shrink', '--input', source, '--oracle', module, '--max-tests'], ['case', 'init', 'ignored-extra']]) {
    assert.equal(JSON.parse(run(args, 1).stderr).error, 'arguments');
  }
});

test('help, version and prompt inventory are available without external services', () => {
  assert.match(run(['help']).stdout, /REA Pro Max 0\.2\.0/u);
  assert.equal(run(['version']).stdout.trim(), '0.2.0');
  const prompts = parse(run(['prompts'])); assert.ok(prompts.length >= 5);
  const target = prompts[0].target; const selected = parse(run(['prompts', '--target', target]));
  assert.ok(selected.length); assert.equal(selected.every(item => item.target === target), true);
});


test('fresh JSON output refuses a dangling symlink without replacing it', t => {
  const directory = workspace(t); const linked = join(directory, 'new-output.json');
  try { symlinkSync(join(directory, 'missing-target.json'), linked); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Symlink privilege is unavailable.'); return; } throw error; }
  const result = run(['inspect', fixture, '--out', linked], 1);
  assert.equal(JSON.parse(result.stderr).error, 'output_exists');
  assert.equal(lstatSync(linked).isSymbolicLink(), true);
});

test('main CLI MCP command uses the independent stdio entry and closes cleanly on EOF', t => {
  const directory = workspace(t);
  const started = spawnSync(process.execPath, [cli,'mcp','--workspace',directory], {cwd:directory,input:'',encoding:'utf8',timeout:20000});
  assert.equal(started.error,undefined); assert.equal(started.status,0); assert.equal(started.stdout,''); assert.equal(started.stderr,'');
  assert.equal(JSON.parse(run(['mcp','--workspace'],1).stderr).error,'arguments');
  assert.match(run(['help']).stdout,/mcp --workspace ABSOLUTE_DIRECTORY/u);
});
